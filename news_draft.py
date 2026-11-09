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
    POST /api/admin/news-draft/save               salva soltanto una lingua
    POST /api/admin/news-draft/master             imposta esplicitamente la lingua master
    POST /api/admin/news-draft/translate          traduce dal master (6 lingue)
    POST /api/admin/news-draft/translate-all      traduce dal master TUTTE le lingue
    GET  /api/admin/news-draft/jobs/{id}          stato di un job di traduzione
    POST /api/admin/news-draft/translate?field    traduce SOLO title/dek di una lingua
    POST /api/admin/news-draft/check              controllo contenuti vs master (no LLM)
    POST /api/admin/news-draft/image              upload immagine (multipart)
    POST /api/admin/news-draft/publish            insert nuovo o update esistente
"""

import json
import os
import re
import subprocess
import threading
import time
import urllib.request
import uuid
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

# Marker di prompt/istruzioni che non devono mai finire nella traduzione.
LEAK_MARKERS = (
    "testo da tradurre", "contesto articolo", "traduci in ", "rispondi solo con",
    "ecco la traduzione", "translation:", "translated text:", "text to translate",
    "context article", "contenu de l'article", "titolo dell'articolo",
    "sottotitolo dell'articolo", "testo à traduire", "come traduttore",
    "ecco la versione", "in questo articolo analizziamo",
)

# Sigle note ammesse anche se non compaiono nel testo EN dell'articolo.
ALLOW_CAPS = {
    "AI", "SEC", "IPO", "USA", "UK", "EU", "METR", "API", "HTTP", "HTTPS",
    "URL", "GPT", "LLM", "LLMS", "CEO", "CTO", "COO", "NASA", "IBM", "PDF",
    "JS", "CSS", "HTML", "JSON", "SQL", "RAM", "CPU", "GPU", "DAG", "SAM",
    "AGI", "ETA", "OGM", "ONG", "AVV", "SRL", "SPA", "S-1",
}

# Parole che in alcune lingue restano maiuscole a metà frase senza essere
# nomi propri (lingue/nazionalità). Chiavi in minuscolo.
COMMON_CAPS = {
    "inglese", "italiano", "italiani", "italiana", "spagnolo", "spagnola",
    "francese", "francesi", "catalano", "catalana", "olandese", "olandesi",
    "americano", "americana", "americani", "americane", "europeo", "europea",
    "européen", "européenne", "engels", "engelse", "nederlands", "nederlandse",
    "nederlander", "frans", "franse", "espanol", "española", "europese",
    "amerikaans", "amerikaanse", "italiaanse", "spaanse", "europa",
    "inglés", "anglès", "italià", "català", "française",
}

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


# ------------------------------------------------------------------ JOBS ---
# Tradurre una lingua intera = ~20 chiamate LLM, tutte = ~100: la richiesta
# sincrona sfora il timeout di qualunque proxy/tunnel davanti al gateway e
# il browser mostra "Failed to fetch". Il lavoro gira in un thread e il
# frontend polla GET /jobs/{id}.

_JOBS = {}


def _start_job(work):
    jid = uuid.uuid4().hex[:12]
    job = {"done": False, "error": None, "draft": None, "note": ""}
    _JOBS[jid] = job

    def run():
        try:
            work(job)
        except HTTPException as e:
            job["error"] = str(e.detail)
        except Exception as e:
            job["error"] = f"{type(e).__name__}: {e}"
        finally:
            job["done"] = True

    threading.Thread(target=run, daemon=True).start()
    return jid


# ------------------------------------------------------------------- LLM ---

def _llm_translate(lang, text, context, field=None):
    # Istruzioni specifiche per campo corto: senza queste, Mistral tende a
    # "sproloquiare" (ripete il contesto, incolla istruzioni o l'articolo
    # intero anche quando gli è stato dato solo il titolo).
    field_hint = ""
    if field == "title":
        field_hint = (
            "Il testo da tradurre è il TITOLO di un articolo: restituisci SOLO il "
            "titolo tradotto, UNA sola riga, senza virgolette di contorno e senza "
            "nessun altro testo, etichetta o spiegazione. "
        )
    elif field == "dek":
        field_hint = (
            "Il testo da tradurre è il SOTTOTITOLO (dek) di un articolo: "
            "restituisci SOLO il sottotitolo tradotto, un unico breve paragrafo, "
            "senza nessun altro testo, etichetta o spiegazione. "
        )
    style = (
        f"Sei un traduttore editoriale per il sito AI News di Danny Villanova. "
        + field_hint +
        f"Traduci in {ALL_LANGS[lang]} il testo inglese che ti viene dato. "
        f"Contesto/titolo articolo: {context!r}. "
        f"Regole: registro giornalistico, frasi fluide, NON letterale; "
        f"usa apostrofi tipografici (\u2019), mai apostrofi dritti; "
        f"per le citazioni usa {LANG_QUOTES[lang]}; non tradurre nomi propri, "
        f"sigle (AI, GPT, EFS) né URL. "
        f"Per le precisazioni usa le parentesi tonde ( ... ) come nell'originale, "
        f"mai coppie di trattini — ... —; mantieni la formattazione del blocco "
        f"identica all'originale (righe di elenco '- ', intestazioni '## '). "
        f"Restituisci esclusivamente il testo tradotto, senza intestazioni, "
        f"etichette, prefazioni, spiegazioni o ripetizioni del testo originale."
    )
    payload = {
        "model": LLM_MODEL,
        "stream": False,
        "options": {"temperature": 0.3},
        "messages": [
            {"role": "system", "content": style},
            {
                "role": "user",
                "content": text,
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
    lowered = translated.lower().strip()
    if lowered.startswith(("i'm sorry", "sorry", "come traduttore")):
        return False
    # Blocca risposte che ripetono etichette o istruzioni del prompt.
    leaked_prompt = ("testo da tradurre", "contesto articolo", "traduci in ", "rispondi solo con", "ecco la traduzione", "translation:", "translated text:", "text to translate", "context article", "contenu de l'article", "titolo dell'articolo", "sottotitolo dell'articolo", "testo à traduire")
    if any(marker in lowered for marker in leaked_prompt):
        return False
    if len(original) > 80 and translated.strip() == original.strip():
        return False
    # Campo corto: la traduzione non può esplodere di lunghezza
    # (il modello ha restituito anche interi paragrafi per un titolo).
    if len(original) < 250 and len(translated) > 1.6 * len(original) + 60:
        return False
    if len(translated) > 2.2 * len(original) + 100:
        return False
    if "http" in original and "http" not in translated:
        return False
    return True


def _translate_content(src, target_lang):
    context = src.get("title", "")
    out = {}
    for field in ("title", "dek"):
        original = (src.get(field) or "").strip()
        if not original:
            out[field] = ""
            continue
        t = _llm_translate(
            target_lang, original,
            None if field == "title" else context,
            field=field,
        )
        if field == "title":
            t = next((ln.strip() for ln in t.splitlines() if ln.strip()), t)
        else:
            t = t.split("\\n\\n")[0].strip()
        if not _sanity(t, original):
            raise HTTPException(502, f"Traduzione insicura per {field} ({target_lang}).")
        out[field] = t

    # Traduci per blocchi, non come testo indistinto: così h3, paragrafi
    # e liste mantengono esattamente il tipo e l'ordine dell'originale.
    translated_blocks = []
    for block_no, block in enumerate(_parse_blocks_lenient(src.get("body", "")), 1):
        kind = block.get("type")
        if kind == "h3":
            original = (block.get("text") or "").strip()
            translated = _llm_translate(target_lang, original, context, field="title")
            translated = next((ln.strip() for ln in translated.splitlines() if ln.strip()), translated)
            if not _sanity(translated, original):
                raise HTTPException(502, f"Traduzione insicura nell'intestazione {block_no} ({target_lang}).")
            translated_blocks.append("## " + translated)
        elif kind == "list":
            items = []
            for item_no, item in enumerate(block.get("items") or [], 1):
                translated = _llm_translate(target_lang, item, context)
                translated = next((ln.strip() for ln in translated.splitlines() if ln.strip()), translated)
                if not _sanity(translated, item):
                    raise HTTPException(502, f"Traduzione insicura nella lista {block_no}, voce {item_no} ({target_lang}).")
                items.append("- " + translated)
            translated_blocks.append("\\n".join(items))
        else:
            original = (block.get("text") or "").strip()
            translated = _llm_translate(target_lang, original, context)
            if not _sanity(translated, original):
                raise HTTPException(502, f"Traduzione insicura nel paragrafo {block_no} ({target_lang}).")
            translated_blocks.append(translated)
    out["body"] = "\\n\\n".join(translated_blocks)
    if not out["body"].strip():
        raise HTTPException(422, "Il body del master è vuoto.")
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


def _parse_blocks_lenient(text):
    """Come _blocks_from_text ma senza mai sollevare (per il check contenuti)."""
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
    return blocks


def _unknown_names(text, en_words):
    """Nomi propri maiuscoli a metà frase che non compaiono nell'originale.

    Salta la prima parola di ogni frase (mai maiuscola per costruzione).
    Controllo euristico: produce avvisi da valutare a occhio, non errori.
    """
    out = set()
    for chunk in re.split(r"(?<=[.!?;:])\s+", text or ""):
        words = chunk.replace("\n", " ").split()
        for w in words[1:]:
            m = re.match(r"^[A-ZÀ-Þ][a-zà-ÿ'’\-]{3,}[.,;:!?]?$", w)
            if not m:
                continue
            core = w.strip(".,;:!?").lower()
            if core in en_words or core in COMMON_CAPS:
                continue
            out.add(w.strip(".,;:!?"))
    return sorted(out)


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


class MasterIn(BaseModel):
    lang: str


class TranslateIn(BaseModel):
    target_lang: str
    # Snapshot dell'articolo effettivamente aperto nell'editor.
    master_lang: str | None = None
    content: dict[str, ContentIn] | None = None
    number: int | None = None
    slug: str | None = None
    date: str | None = None
    readTime: int | None = None
    sources: str | None = None
    image: dict | None = None
    # Se valorizzato ("title" | "dek") traduce SOLO quel campo.
    field: str | None = None


class TranslateAllIn(BaseModel):
    master_lang: str | None = None
    content: dict[str, ContentIn] | None = None
    number: int | None = None
    slug: str | None = None
    date: str | None = None
    readTime: int | None = None
    sources: str | None = None
    image: dict | None = None


class CheckIn(BaseModel):
    content: dict


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
        # Salvare una lingua NON cambia la lingua master.
        _write_draft(draft)
        return draft

    @router.post("/api/admin/news-draft/master")
    def set_master(body_in: MasterIn, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        if body_in.lang not in ("en", "it", "es"):
            raise HTTPException(422, "La lingua master può essere EN, IT o ES.")
        draft = _read_draft()
        content = draft.get("content") or {}
        selected = content.get(body_in.lang) or {}
        if not selected.get("body"):
            raise HTTPException(409, f"Nessun contenuto {body_in.lang.upper()} salvato da impostare come master.")
        draft["master"] = body_in.lang
        _write_draft(draft)
        return {"master": body_in.lang}

    @router.post("/api/admin/news-draft/translate")
    def translate_lang(body_in: TranslateIn, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        target = body_in.target_lang
        if target not in ALL_LANGS:
            raise HTTPException(422, "Lingua non supportata (en/it/es/fr/ca/nl).")
        draft = _read_draft()
        if body_in.content is not None:
            draft["content"] = {lang: value.model_dump() for lang, value in body_in.content.items()}
        for key in ("number", "slug", "date", "readTime", "sources", "image"):
            value = getattr(body_in, key, None)
            if value is not None:
                draft[key] = value
        master = body_in.master_lang or draft.get("master") or "en"
        draft["master"] = master
        src = draft["content"].get(master)
        if not src or not src.get("body"):
            raise HTTPException(409, f"Nessun contenuto master ({master}) da tradurre.")
        if master == target:
            raise HTTPException(422, "La lingua target è già il master.")
        if body_in.field:
            # Traduzione di UN SOLO campo (title o dek) del master.
            if body_in.field not in ("title", "dek"):
                raise HTTPException(422, "field deve essere 'title' o 'dek'.")
            src_text = (src.get(body_in.field) or "").strip()
            if not src_text:
                raise HTTPException(
                    409, f"Il master ({master}) non ha un {body_in.field} da tradurre."
                )
            t = _llm_translate(
                target, src_text,
                None if body_in.field == "title" else src.get("title", ""),
                field=body_in.field,
            )
            if body_in.field == "title":
                t = next((ln.strip() for ln in t.splitlines() if ln.strip()), t)
            else:
                t = t.split("\n\n")[0].strip()
            if not _sanity(t, src_text):
                raise HTTPException(
                    502, f"Traduzione insicura per {body_in.field} ({target})."
                )
            cur = draft["content"].get(target) or {}
            draft["content"][target] = {
                "title": cur.get("title", ""),
                "dek": cur.get("dek", ""),
                "body": cur.get("body", ""),
                body_in.field: t,
            }
            _write_draft(draft)
            return draft
        # Traduzione INTERA lingua: job in background (vedi _start_job),
        # il frontend polla /jobs/{id}. Il campo singolo (title/dek) è una
        # sola chiamata LLM e resta sincrono.
        # Salva lo snapshot prima di avviare il job: il job non deve leggere
        # una bozza vecchia o appartenente a un altro articolo.
        _write_draft(draft)

        def work(job, _target=target, _src=src, _snapshot=draft):
            d = json.loads(json.dumps(_snapshot, ensure_ascii=False))
            d["content"][_target] = _translate_content(_src, _target)
            _write_draft(d)
            job["draft"] = d

        return {"job_id": _start_job(work)}

    @router.post("/api/admin/news-draft/translate-all")
    def translate_all(body_in: TranslateAllIn, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        draft = _read_draft()
        if body_in.content is not None:
            draft["content"] = {lang: value.model_dump() for lang, value in body_in.content.items()}
        for key in ("number", "slug", "date", "readTime", "sources", "image"):
            value = getattr(body_in, key, None)
            if value is not None:
                draft[key] = value
        master = body_in.master_lang or draft.get("master") or "en"
        draft["master"] = master
        src = draft["content"].get(master)
        if not src or not src.get("body"):
            raise HTTPException(409, f"Nessun contenuto master ({master}) da tradurre.")

        _write_draft(draft)

        def work(job, _master=master, _src=src, _snapshot=draft):
            d = json.loads(json.dumps(_snapshot, ensure_ascii=False))
            for lang in ALL_LANGS:
                if lang == _master:
                    continue
                d["content"][lang] = _translate_content(_src, lang)
                _write_draft(d)  # salva dopo ogni lingua: i progressi restano
                job["note"] = f"lingua completata: {lang}"
            job["draft"] = d

        return {"job_id": _start_job(work)}

    @router.get("/api/admin/news-draft/jobs/{job_id}")
    def job_status(job_id: str, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        job = _JOBS.get(job_id)
        if not job:
            raise HTTPException(404, "Job sconosciuto (o gateway riavviato).")
        out = {"done": job["done"], "error": job["error"], "note": job["note"]}
        if job["done"]:
            if not job["error"]:
                out["draft"] = job["draft"] or _read_draft()
            _JOBS.pop(job_id, None)  # consegnato: libera
        return out

    @router.post("/api/admin/news-draft/check")
    def check_content(body_in: CheckIn, authorization: str | None = Header(None)):
        """Controllo contenuti DETERMINISTICO (nessun LLM) vs master EN.

        Lingua per lingua: campi vuoti, title/dek multi-riga o anomali o
        identici all'inglese, body identico, struttura dei blocchi diversa
        dal master, blocchi fuori misura, marker di prompt leakati,
        sigle/nomi propri assenti nell'originale (l'LLM li inventa).
        """
        verify_admin_token(authorization)
        content = body_in.content or {}
        master = "en"
        en = content.get(master) or {}
        en_title = (en.get("title") or "").strip()
        en_dek = (en.get("dek") or "").strip()
        en_body = (en.get("body") or "").strip()
        if not en_body:
            raise HTTPException(409, "Nessun contenuto EN (master) da confrontare.")
        en_blocks = _parse_blocks_lenient(en_body)
        en_words = set(re.findall(
            r"[a-zà-ÿ'’]+",
            (en_title + " " + en_dek + " " + en_body).lower()
        ))
        report = {}
        for lang in ALL_LANGS:
            if lang == master:
                continue
            c = content.get(lang) or {}
            title = (c.get("title") or "").strip()
            dek = (c.get("dek") or "").strip()
            body = (c.get("body") or "").strip()
            warns = []
            for name, val in (("title", title), ("dek", dek), ("body", body)):
                if not val:
                    warns.append(name + " vuoto")
            if title and en_title:
                if "\n" in title:
                    warns.append("title su più righe")
                if len(title) > 1.8 * len(en_title) + 40:
                    warns.append(
                        f"title anomalo: {len(title)} caratteri vs {len(en_title)} EN"
                    )
                if title == en_title and len(title) > 60:
                    warns.append("title identico all'inglese")
                if "—" in title and "—" not in en_title:
                    warns.append("title: trattino — assente nel master")
                if "(" in en_title and "(" not in title:
                    warns.append("title: parentesi tonde del master perse")
            if dek and en_dek:
                if "\n\n" in dek:
                    warns.append("dek su più paragrafi")
                if len(dek) > 1.8 * len(en_dek) + 60:
                    warns.append(
                        f"dek anomalo: {len(dek)} caratteri vs {len(en_dek)} EN"
                    )
                if dek == en_dek and len(dek) > 80:
                    warns.append("dek identico all'inglese")
                if "—" in dek and "—" not in en_dek:
                    warns.append("dek: trattino — assente nel master")
                if "(" in en_dek and "(" not in dek:
                    warns.append("dek: parentesi tonde del master perse")
            if body:
                if body == en_body:
                    warns.append("body identico all'inglese (traduzione mancante?)")
                blocks = _parse_blocks_lenient(body)
                if len(blocks) != len(en_blocks):
                    warns.append(f"{len(blocks)} blocchi vs {len(en_blocks)} EN")
                else:
                    for i, (be, bl) in enumerate(zip(en_blocks, blocks), 1):
                        if be.get("type") != bl.get("type"):
                            warns.append(
                                f"blocco {i}: tipo '{bl.get('type')}' vs "
                                f"'{be.get('type')}' EN"
                            )
                            continue
                        if be.get("type") == "list":
                            bi, bj = be.get("items") or [], bl.get("items") or []
                            if len(bj) != len(bi):
                                warns.append(
                                    f"blocco {i}: {len(bj)} voci lista vs {len(bi)} EN"
                                )
                            te, tl = " ".join(bi), " ".join(bj)
                        else:
                            te, tl = be.get("text") or "", bl.get("text") or ""
                        if len(tl) > 2.5 * len(te) + 80:
                            warns.append(
                                f"blocco {i} fuori misura: {len(tl)} vs {len(te)} caratteri EN"
                            )
                        elif len(te) > 80 and tl.strip() == te.strip():
                            warns.append(f"blocco {i} identico all'inglese")
                        if "—" in tl and "—" not in te:
                            warns.append(f"blocco {i}: trattino — assente nel master")
                        if "(" in te and "(" not in tl:
                            warns.append(f"blocco {i}: parentesi tonde del master perse")
                whole = (title + "\n" + dek + "\n" + body).lower()
                leaked = [m for m in LEAK_MARKERS if m in whole]
                if leaked:
                    warns.append(
                        "marker di prompt leakati: " + ", ".join(repr(m) for m in leaked[:4])
                    )
                caps = sorted({
                    t for t in re.findall(r"\b[A-Z]{2,}\b", title + " " + dek + " " + body)
                    if t not in ALLOW_CAPS and t.lower() not in en_words
                })
                if caps:
                    warns.append(
                        "sigle/nomi MAIUSCOLI assenti nell'originale: "
                        + ", ".join(caps[:8])
                    )
                names = _unknown_names(title + "\n" + dek + "\n" + body, en_words)
                if names:
                    warns.append(
                        "nomi propri assenti nell'originale: " + ", ".join(names[:8])
                    )
            if warns:
                report[lang] = warns
        return {"report": report, "ok": not report}

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
