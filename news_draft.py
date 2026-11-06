"""
NEWS DRAFT — bozza articolo AI News con traduzione e pubblicazione.

Editor di Test7: tre riquadri (en/it/es), la lingua salvata per ultima
è la "master"; Traduci rigenera una lingua dal master con Ollama.

Persistenza: news_draft.json accanto a gateway.py (nessuna tabella).
Pubblicazione: git pull --ff-only, inserimento in testa ad ARTICLES in
src/content/aiEthics.js via Node (stile news_agent), node --check,
commit e push su main. Rollback del file se la sintassi non valida.

Rotte (tutte Google auth admin via verify_admin_token):
    GET  /api/admin/news-draft               legge la bozza (o default vuota)
    POST /api/admin/news-draft/save          salva una lingua (diventa master)
    POST /api/admin/news-draft/translate     traduce dal master alla lingua target
    POST /api/admin/news-draft/publish       articolo in aiEthics.js + commit + push
"""

import json
import os
import subprocess
import urllib.request
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

DV_SITE_DIR = Path(__file__).resolve().parent
DRAFT_FILE = DV_SITE_DIR / "news_draft.json"
DATA_FILE = DV_SITE_DIR / "src" / "content" / "aiEthics.js"

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
LLM_MODEL = os.environ.get("NEWS_DRAFT_MODEL", "mistral:latest")

LANGS = {"en": "inglese", "it": "italiano", "es": "spagnolo"}
LANG_QUOTES = {"en": '" "', "it": "« »", "es": "« »"}

COMMIT_PREFIX = "AI News: articolo"


# ------------------------------------------------------------ BOZZA (JSON) ---

def _empty_draft():
    return {
        "slug": "",
        "date": "",
        "readTime": 2,
        "sources": "",
        "content": {},
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
    """Traduzione editoriale (stesso stile di news_agent.py)."""
    style = (
        f"Sei un traduttore editoriale per il sito AI News di Danny Villanova. "
        f"Traduci in {LANGS[lang]} il testo inglese che ti viene dato. "
        f"Regole: registro giornalistico, frasi fluide, NON letterale; "
        f"usa apostrofi tipografici (’), mai apostrofi dritti; "
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
    """Traduce {title, dek, body} dal master alla lingua target."""
    context = src["title"]
    out = {}
    for field in ("title", "dek"):
        t = _llm_translate(target_lang, src[field], context)
        if not _sanity(t, src[field]):
            raise HTTPException(502, f"Traduzione insicura per {field} ({target_lang}).")
        out[field] = t
    # body: paragrafi separati da riga vuota, righe "## " = heading
    paragraphs = [p.strip() for p in src["body"].split("\n\n") if p.strip()]
    translated_paras = []
    for para in paragraphs:
        t = _llm_translate(target_lang, para, context)
        if not _sanity(t, para):
            raise HTTPException(502, f"Traduzione insicura nel body ({target_lang}).")
        translated_paras.append(t)
    out["body"] = "\n\n".join(translated_paras)
    return out


# ---------------------------------------------------------------- BLOCCHI ---

def _blocks_from_text(text):
    """Testo → blocchi di aiEthics.js. Paragrafi su riga vuota, '## ' = h3."""
    blocks = []
    for para in text.split("\n\n"):
        para = para.strip()
        if not para:
            continue
        if para.startswith("## "):
            blocks.append({"type": "h3", "text": para[3:].strip()})
        else:
            blocks.append({"type": "p", "text": para.replace("\n", " ")})
    if not blocks:
        raise HTTPException(422, "Il body dell'articolo è vuoto.")
    return blocks


def _parse_sources(text):
    """Righe 'Etichetta | URL' → [{label, url}]."""
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


# ------------------------------------------------------------ NODE (FILE) ---

JS_DUMP = """
import { ARTICLES } from './src/content/aiEthics.js';
console.log(JSON.stringify(ARTICLES));
"""

JS_WRITE = r"""
const [dataPath, payloadPath] = process.argv.slice(1);
const fs = require('fs');
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

// articoli esistenti + nuovo articolo in testa
const articles = JSON.parse(fs.readFileSync(payloadPath + '.base', 'utf8'));
articles.unshift(JSON.parse(fs.readFileSync(payloadPath + '.new', 'utf8')));
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
    p = subprocess.run(
        ["git", "-C", str(DV_SITE_DIR), *args],
        capture_output=True, text=True,
    )
    return p


# ---------------------------------------------------------------- ROUTER ---

class ContentIn(BaseModel):
    title: str = ""
    dek: str = ""
    body: str = ""


class SaveIn(BaseModel):
    lang: str
    content: ContentIn
    slug: str | None = None
    date: str | None = None
    readTime: int | None = None
    sources: str | None = None


class TranslateIn(BaseModel):
    target_lang: str


class PublishIn(BaseModel):
    slug: str
    date: str
    readTime: int = 2
    sources: str = ""


def build_news_draft_router(verify_admin_token):
    router = APIRouter()

    @router.get("/api/admin/news-draft")
    def get_draft(authorization: str | None = None):
        verify_admin_token(authorization)
        return _read_draft()

    @router.post("/api/admin/news-draft/save")
    def save_lang(body_in: SaveIn, authorization: str | None = None):
        verify_admin_token(authorization)
        if body_in.lang not in LANGS:
            raise HTTPException(422, "Lingua non supportata (en/it/es).")
        draft = _read_draft()
        draft["content"][body_in.lang] = body_in.content.model_dump()
        draft["master"] = body_in.lang
        if body_in.slug is not None:
            draft["slug"] = body_in.slug.strip()
        if body_in.date is not None:
            draft["date"] = body_in.date.strip()
        if body_in.readTime is not None:
            draft["readTime"] = body_in.readTime
        if body_in.sources is not None:
            draft["sources"] = body_in.sources
        _write_draft(draft)
        return draft

    @router.post("/api/admin/news-draft/translate")
    def translate_lang(body_in: TranslateIn, authorization: str | None = None):
        verify_admin_token(authorization)
        target = body_in.target_lang
        if target not in LANGS:
            raise HTTPException(422, "Lingua non supportata (en/it/es).")
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

    @router.post("/api/admin/news-draft/publish")
    def publish(body_in: PublishIn, authorization: str | None = None):
        verify_admin_token(authorization)
        draft = _read_draft()
        for k, v in [("slug", body_in.slug), ("date", body_in.date),
                     ("readTime", body_in.readTime), ("sources", body_in.sources)]:
            draft[k] = v

        slug = draft["slug"].strip()
        if not slug or not draft["date"].strip():
            raise HTTPException(422, "Slug e date sono obbligatori.")
        if not draft["content"].get("en", {}).get("body"):
            raise HTTPException(422, "Manca il contenuto inglese (obbligatorio).")

        # 1. sync del repo locale (abort se non pulito)
        pull = _git(["pull", "--ff-only", "origin", "main"])
        if pull.returncode != 0:
            raise HTTPException(
                409, "git pull --ff-only fallito (repo locale sporco o divergente?): "
                     + pull.stderr[-400:]
            )

        # 2. articoli esistenti → number = max + 1
        articles = json.loads(_run_node(JS_DUMP, []))
        number = max((a.get("number") or 0) for a in articles) + 1

        # 3. articolo nuovo (in testa)
        content = {}
        for lang in ("en", "it", "es"):
            c = draft["content"].get(lang)
            if c and c.get("body"):
                content[lang] = {
                    "title": c["title"].strip(),
                    "dek": c["dek"].strip(),
                    "body": _blocks_from_text(c["body"]),
                }
        article = {
            "slug": slug,
            "category": "NEWS",
            "number": number,
            "date": draft["date"].strip(),
            "readTime": draft["readTime"],
            "sources": _parse_sources(draft["sources"]),
            "content": content,
        }

        # 4. scrittura aiEthics.js via Node
        tmp_base = DV_SITE_DIR / ".news_draft.base"
        tmp_new = DV_SITE_DIR / ".news_draft.new"
        tmp_base.write_text(json.dumps(articles, ensure_ascii=False), encoding="utf-8")
        tmp_new.write_text(json.dumps(article, ensure_ascii=False), encoding="utf-8")
        try:
            _run_node(JS_WRITE, [str(DATA_FILE), str(tmp_new)])
        finally:
            tmp_base.unlink(missing_ok=True)
            tmp_new.unlink(missing_ok=True)

        # 5. validazione sintassi OBBLIGATORIA (rollback se KO)
        chk = subprocess.run(
            ["node", "--check", str(DATA_FILE)], capture_output=True, text=True
        )
        if chk.returncode != 0:
            _git(["checkout", "--", str(DATA_FILE)])
            raise HTTPException(500, "Sintassi JS non valida, commit annullato: "
                                     + chk.stderr[-400:])

        # 6. commit + push
        _git(["add", str(DATA_FILE)])
        langs_ok = "/".join(content.keys()).upper()
        msg = f"{COMMIT_PREFIX} #{number} {slug} ({langs_ok}, da Test7 draft)"
        commit = _git(["commit", "-m", msg])
        if commit.returncode != 0:
            raise HTTPException(500, "git commit fallito: " + commit.stderr[-400:])
        push = _git(["push", "origin", "main"])
        if push.returncode != 0:
            raise HTTPException(
                502, "Commit creato ma push fallito (pushare a mano): " + push.stderr[-400:]
            )
        sha = _git(["rev-parse", "--short", "HEAD"]).stdout.strip()

        # 7. bozza pubblicata → reset
        _write_draft(_empty_draft())
        return {"published": True, "slug": slug, "number": number, "commit": msg, "sha": sha}

    return router
