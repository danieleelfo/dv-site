"""
NEWS DRAFT — News Admin: bozza/revisione articoli AI News.

Test7: selettore "news#" (nuovo articolo o esistente), tre box EN/IT/ES,
anteprima con selettore lingua (6 lingue, fallback EN come il sito),
traduzione dal master con Ollama, immagine opzionale, pubblicazione con
commit+push (insert nuovo articolo o update di quello esistente).

Persistenza: news_draft.json accanto a gateway.py.
Immagini: public/news/ del repo locale (committate al publish).

Rotte (tutte Google auth admin via verify_admin_token):
    GET  /api/admin/news-draft                    bozza corrente (o default)
    GET  /api/admin/news-draft/articles           lista articoli per il selettore
    GET  /api/admin/news-draft/article/{number}   articolo esistente → box/meta
    POST /api/admin/news-draft/save               salva una lingua (diventa master)
    POST /api/admin/news-draft/translate          traduce dal master (6 lingue)
    POST /api/admin/news-draft/translate-all      traduce dal master TUTTE le lingue
    POST /api/admin/news-draft/image              upload immagine (multipart)
    POST /api/admin/news-draft/publish            insert nuovo o update esistente
"""

import json
import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel

DV_SITE_DIR = Path(__file__).resolve().parent
DRAFT_FILE = DV_SITE_DIR / "news_draft.json"
DATA_FILE = DV_SITE_DIR / "src" / "content" / "aiEthics.js"
NEWS_IMG_DIR = DV_SITE_DIR / "public" / "news"

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
LLM_MODEL = os.environ.get("NEWS_DRAFT_MODEL", "mistral:latest")

BOX_LANGS = ("en", "it", "es")
ALL_LANGS = {"en": "inglese", "it": "italiano", "es": "spagnolo",
             "fr": "francese", "ca": "catalano", "nl": "olandese"}
LANG_QUOTES = {"en": '" "', "it": "« »", "es": "« »", "fr": "« »",
               "ca": "« »", "nl": '" "'}

COMMIT_PREFIX = "AI News:"


# ------------------------------------------------------------ BOZZA (JSON) ---

def _empty_draft():
    return {
        "number": None,      # None = nuovo articolo; int = revisione esistente
        "slug": "",
        "date": "",
        "readTime": 2,
        "sources": "",
        "image": None,       # {src, caption} opzionale
        "content": {},       # lang -> {title, dek, body(testo)}
        "master": None,
    }


def _read_draft():
    try:
        data = json.loads(DRAFT_FILE.read_text(encoding="utf-8"))
    except Exception:
        return _empty_draft()
    draft = _empty_draft()
    draft.update({k: v for k, v in data.items() if k in draft})
    return draft


def _write_draft(draft):
    DRAFT_FILE.write_text(
        json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ------------------------------------------------------------------- LLM ---

def _llm_translate(lang, text, context):
    style = (
        f"Sei un traduttore editoriale per il sito AI News di Danny Villanova. "
        f"Traduci in {ALL_LANGS[lang]} il testo inglese che ti viene dato. "
        f"Regole: registro giornalistico, frasi fluide, NON letterale; "
        f"usa apostrofi tipografici (\u2019), mai apostrofi dritti; "
        f"per le citazioni usa {LANG_QUOTES[lang]}; non tradurre nomi propri, "
        f"sigle (AI, GPT, EFS) né URL. "
        f"Rispondi SOLO con la traduzione, nessun commento."
    )
    payload = {
        "model": LLM_MODEL,
        "stream": False,
        "options": {"temperature": 0.3},
        "messages": [
            {"role": "system", "content": style},
            {
                "role": "user",
                "content": f"Contesto articolo: {context}\n\nTesto da tradurre:\n{text}",
            },
        ],
    }
    req = urllib.request.Request(
        OLLAMA_URL + "/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        out = json.load(r)
    return out["message"]["content"].strip()


def _sanity(translated, original):
    if not translated or len(translated) < 2:
        return False
    if translated.lower().startswith(("i'm sorry", "sorry", "come traduttore")):
        return False
    if "http" in original and "http" not in translated:
        return False
    return True


def _translate_content(src, target_lang):
    context = src.get("title", "")
    out = {}
    for field in ("title", "dek"):
        t = _llm_translate(target_lang, src[field], context)
        if not _sanity(t, src[field]):
            raise HTTPException(502, f"Traduzione insicura per {field} ({target_lang}).")
        out[field] = t
    paragraphs = [p.strip() for p in src["body"].split("\n\n") if p.strip()]
    translated_paras = []
    for para in paragraphs:
        t = _llm_translate(target_lang, para, context)
        if not _sanity(t, para):
            raise HTTPException(502, f"Traduzione insicura nel body ({target_lang}).")
        translated_paras.append(t)
    out["body"] = "\n\n".join(translated_paras)
    return out


# -------------------------------------------------- TESTO <-> BLOCCHI/SRC ---

def _blocks_from_text(text):
    blocks = []
    for para in (text or "").split("\n\n"):
        para = para.strip()
        if not para:
            continue
        if para.startswith("## "):
            blocks.append({"type": "h3", "text": para[3:].strip()})
            continue
        lines = [l.strip() for l in para.split("\n") if l.strip()]
        if lines and all(l.startswith("- ") for l in lines):
            blocks.append({"type": "list", "items": [l[2:].strip() for l in lines]})
            continue
        blocks.append({"type": "p", "text": " ".join(lines)})
    if not blocks:
        raise HTTPException(422, "Il body dell'articolo è vuoto.")
    return blocks


def _text_from_blocks(blocks):
    parts = []
    for b in blocks or []:
        if b.get("type") == "h3":
            parts.append("## " + b.get("text", ""))
        elif b.get("type") == "list":
            parts.append("\n".join("- " + str(i) for i in b.get("items", [])))
        else:
            parts.append(b.get("text", ""))
    return "\n\n".join(parts)


def _parse_sources(text):
    sources = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if "|" in line:
            label, url = line.split("|", 1)
            label, url = label.strip(), url.strip()
        else:
            label, url = line, ""
        if label:
            sources.append({"label": label, "url": url})
    return sources


def _sources_to_text(sources):
    return "\n".join(f"{s.get('label', '')} | {s.get('url', '')}" for s in sources or [])


# ------------------------------------------------------------ NODE (FILE) ---

JS_DUMP = """
import { ARTICLES } from './src/content/aiEthics.js';
console.log(JSON.stringify(ARTICLES));
"""

JS_WRITE = r"""
import fs from 'node:fs';
const [dataPath, payloadPath, basePath] = process.argv.slice(1);
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const original = fs.readFileSync(dataPath, 'utf8');
const START = 'export const ARTICLES = [';
const startIdx = original.indexOf(START);
if (startIdx === -1) { console.error('ARTICLES non trovato'); process.exit(1); }
const prefix = original.slice(0, startIdx + START.length);
const tailMatch = original.match(/\n\];\n/);
if (!tailMatch) { console.error('chiusura ARTICLES non trovata'); process.exit(1); }
const tail = original.slice(tailMatch.index);

function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"; }
function dump(v, ind) {
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const in1 = ind + '  ';
    const items = v.map(x => in1 + dump(x, in1) + ',');
    return '[\n' + items.join('\n') + '\n' + ind + ']';
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    const in1 = ind + '  ';
    const items = keys.map(k => in1 + k + ': ' + dump(v[k], in1) + ',');
    return '{\n' + items.join('\n') + '\n' + ind + '}';
  }
  if (typeof v === 'string') return q(v);
  return JSON.stringify(v);
}

const articles = JSON.parse(fs.readFileSync(basePath, 'utf8'));
if (payload.mode === 'update') {
  const idx = articles.findIndex(a => a.number === payload.article.number);
  if (idx === -1) { console.error('articolo #' + payload.article.number + ' non trovato'); process.exit(1); }
  articles[idx] = payload.article;
} else {
  articles.unshift(payload.article);
}
const body = articles.map(a => dump(a, '  ')).join(',\n');
fs.writeFileSync(dataPath, prefix + '\n' + body + ',\n' + tail);
console.log('OK');
"""


def _run_node(code, args):
    p = subprocess.run(
        ["node", "--input-type=module", "-e", code, *args],
        capture_output=True, text=True, cwd=DV_SITE_DIR,
    )
    if p.returncode != 0:
        raise HTTPException(500, f"node ha fallito: {p.stderr[-800:]}")
    return p.stdout


def _git(args):
    return subprocess.run(
        ["git", "-C", str(DV_SITE_DIR), *args], capture_output=True, text=True
    )


def _dump_articles():
    return json.loads(_run_node(JS_DUMP, []))


# ---------------------------------------------------------------- ROUTER ---

class ContentIn(BaseModel):
    title: str = ""
    dek: str = ""
    body: str = ""


class SaveIn(BaseModel):
    lang: str
    content: ContentIn
    number: int | None = None
    slug: str | None = None
    date: str | None = None
    readTime: int | None = None
    sources: str | None = None
    image: dict | None = None


class TranslateIn(BaseModel):
    target_lang: str


class PublishIn(BaseModel):
    number: int | None = None
    slug: str
    date: str
    readTime: int = 2
    sources: str = ""
    image: dict | None = None


def build_news_draft_router(verify_admin_token):
    router = APIRouter()

    @router.get("/api/admin/news-draft")
    def get_draft(authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        return _read_draft()

    @router.get("/api/admin/news-draft/articles")
    def list_articles(authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        articles = _dump_articles()
        return {
            "articles": [
                {
                    "number": a.get("number"),
                    "slug": a.get("slug"),
                    "date": a.get("date"),
                    "readTime": a.get("readTime"),
                    "title": (a.get("content", {}).get("en") or {}).get("title", ""),
                    "langs": [l for l in (a.get("content") or {}) if l],
                }
                for a in articles
            ]
        }

    @router.get("/api/admin/news-draft/article/{number}")
    def get_article(number: int, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        articles = _dump_articles()
        for a in articles:
            if a.get("number") == number:
                content = {}
                for lang, c in (a.get("content") or {}).items():
                    if not c:
                        continue
                    content[lang] = {
                        "title": c.get("title", ""),
                        "dek": c.get("dek", ""),
                        "body": _text_from_blocks(c.get("body")),
                    }
                return {
                    "number": number,
                    "slug": a.get("slug", ""),
                    "date": a.get("date", ""),
                    "readTime": a.get("readTime", 2),
                    "sources": _sources_to_text(a.get("sources")),
                    "image": a.get("image"),
                    "content": content,
                }
        raise HTTPException(404, f"Articolo #{number} non trovato.")

    @router.post("/api/admin/news-draft/save")
    def save_lang(body_in: SaveIn, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        if body_in.lang not in ALL_LANGS:
            raise HTTPException(422, "Lingua non supportata (en/it/es/fr/ca/nl).")
        draft = _read_draft()
        draft["content"][body_in.lang] = body_in.content.model_dump()
        draft["master"] = body_in.lang
        if body_in.number is not None:
            draft["number"] = body_in.number
        if body_in.slug is not None:
            draft["slug"] = body_in.slug.strip()
        if body_in.date is not None:
            draft["date"] = body_in.date.strip()
        if body_in.readTime is not None:
            draft["readTime"] = body_in.readTime
        if body_in.sources is not None:
            draft["sources"] = body_in.sources
        if body_in.image is not None:
            draft["image"] = body_in.image
        _write_draft(draft)
        return draft

    @router.post("/api/admin/news-draft/translate")
    def translate_lang(body_in: TranslateIn, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        target = body_in.target_lang
        if target not in ALL_LANGS:
            raise HTTPException(422, "Lingua non supportata (en/it/es/fr/ca/nl).")
        draft = _read_draft()
        master = draft.get("master") or "en"
        src = draft["content"].get(master)
        if not src or not src.get("body"):
            raise HTTPException(409, f"Nessun contenuto master ({master}) da tradurre.")
        if master == target:
            raise HTTPException(422, "La lingua target è già il master.")
        draft["content"][target] = _translate_content(src, target)
        _write_draft(draft)
        return draft

    @router.post("/api/admin/news-draft/translate-all")
    def translate_all(authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        draft = _read_draft()
        master = draft.get("master") or "en"
        src = draft["content"].get(master)
        if not src or not src.get("body"):
            raise HTTPException(409, f"Nessun contenuto master ({master}) da tradurre.")
        done = []
        for lang in ALL_LANGS:
            if lang == master:
                continue
            draft["content"][lang] = _translate_content(src, lang)
            _write_draft(draft)  # salva dopo ogni lingua: i progressi restano
            done.append(lang)
        return draft

    @router.post("/api/admin/news-draft/image")
    async def upload_image(
        image: UploadFile = File(...),
        authorization: str | None = Header(None),
    ):
        verify_admin_token(authorization)
        ext = (Path(image.filename or "img.jpg").suffix or ".jpg").lower()
        if ext not in (".jpg", ".jpeg", ".png", ".webp"):
            raise HTTPException(422, "Formato immagine non supportato (jpg/png/webp).")
        data = await image.read()
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(413, "Immagine troppo grande (max 10 MB).")
        NEWS_IMG_DIR.mkdir(parents=True, exist_ok=True)
        name = f"news-{int(time.time())}{ext}"
        (NEWS_IMG_DIR / name).write_bytes(data)
        return {"src": "/news/" + name}

    @router.post("/api/admin/news-draft/publish")
    def publish(body_in: PublishIn, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        draft = _read_draft()
        draft["number"] = body_in.number
        draft["slug"] = body_in.slug.strip()
        draft["date"] = body_in.date.strip()
        draft["readTime"] = body_in.readTime
        draft["sources"] = body_in.sources
        if body_in.image is not None:
            draft["image"] = body_in.image

        if not draft["slug"] or not draft["date"]:
            raise HTTPException(422, "Slug e date sono obbligatori.")
        if not draft["content"].get("en", {}).get("body"):
            raise HTTPException(422, "Manca il contenuto inglese (obbligatorio).")

        pull = _git(["pull", "--ff-only", "origin", "main"])
        if pull.returncode != 0:
            raise HTTPException(
                409, "git pull --ff-only fallito (repo locale sporco o divergente?): "
                     + pull.stderr[-400:]
            )

        articles = _dump_articles()
        existing = None
        if draft["number"]:
            existing = next(
                (a for a in articles if a.get("number") == draft["number"]), None
            )
            if existing is None:
                raise HTTPException(404, f"Articolo #{draft['number']} non trovato.")

        # Contenuto: i 3 box (en/it/es) vengono (ri)scritti dal testo;
        # le altre lingue restano quelle esistenti (se revisione).
        if existing:
            content = dict(existing.get("content") or {})
        else:
            content = {}
        for lang, c in draft["content"].items():
            if c and c.get("body"):
                content[lang] = {
                    "title": (c.get("title") or "").strip(),
                    "dek": (c.get("dek") or "").strip(),
                    "body": _blocks_from_text(c["body"]),
                }
        for lang in list(content):
            if lang not in ALL_LANGS:
                del content[lang]

        if existing:
            article = dict(existing)
            article.update({
                "date": draft["date"],
                "readTime": draft["readTime"],
                "sources": _parse_sources(draft["sources"]) or existing.get("sources", []),
                "content": content,
            })
            if draft["image"]:
                article["image"] = draft["image"]
            elif "image" in article:
                del article["image"]
            mode = "update"
            number = draft["number"]
        else:
            number = max((a.get("number") or 0) for a in articles) + 1
            article = {
                "slug": draft["slug"],
                "category": "NEWS",
                "number": number,
                "date": draft["date"],
                "readTime": draft["readTime"],
                "sources": _parse_sources(draft["sources"]),
                "content": content,
            }
            if draft["image"]:
                article["image"] = draft["image"]
            mode = "insert"

        tmp_base = DV_SITE_DIR / ".news_draft.base"
        tmp_new = DV_SITE_DIR / ".news_draft.new"
        tmp_base.write_text(json.dumps(articles, ensure_ascii=False), encoding="utf-8")
        tmp_new.write_text(
            json.dumps({"mode": mode, "article": article}, ensure_ascii=False),
            encoding="utf-8",
        )
        try:
            _run_node(JS_WRITE, [str(DATA_FILE), str(tmp_new), str(tmp_base)])
        finally:
            tmp_base.unlink(missing_ok=True)
            tmp_new.unlink(missing_ok=True)

        chk = subprocess.run(
            ["node", "--check", str(DATA_FILE)], capture_output=True, text=True
        )
        if chk.returncode != 0:
            _git(["checkout", "--", str(DATA_FILE)])
            raise HTTPException(500, "Sintassi JS non valida, commit annullato: "
                                     + chk.stderr[-400:])

        # file da committare: data + eventuale immagine caricata
        to_add = [str(DATA_FILE)]
        if draft["image"] and str(draft["image"].get("src", "")).startswith("/news/"):
            img_path = DV_SITE_DIR / "public" / draft["image"]["src"].lstrip("/")
            if img_path.is_file():
                to_add.append(str(img_path))
        for p in to_add:
            _git(["add", p])

        langs_ok = "/".join(content.keys()).upper()
        if mode == "update":
            msg = f"{COMMIT_PREFIX} update #{number} {draft['slug']} ({langs_ok}, da News Admin)"
        else:
            msg = f"{COMMIT_PREFIX} articolo #{number} {draft['slug']} ({langs_ok}, da News Admin)"
        commit = _git(["commit", "-m", msg])
        if commit.returncode != 0:
            raise HTTPException(500, "git commit fallito: " + commit.stderr[-400:])
        push = _git(["push", "origin", "main"])
        if push.returncode != 0:
            raise HTTPException(
                502, "Commit creato ma push fallito (pushare a mano): " + push.stderr[-400:]
            )
        sha = _git(["rev-parse", "--short", "HEAD"]).stdout.strip()

        _write_draft(_empty_draft())
        return {"published": True, "mode": mode, "slug": draft["slug"],
                "number": number, "commit": msg, "sha": sha}

    return router
