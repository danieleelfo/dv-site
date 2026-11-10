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
    POST /api/admin/news-draft/reset             azzera la bozza (nuovo articolo)
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
# Stessa API usata da LeleAdmin per il comando "modelli": il modello non è
# configurato qui, viene letto da Leles a ogni nuovo job di traduzione.
LELES_API_URL = os.environ.get("LELES_API_URL", "http://127.0.0.1:8082").rstrip("/")
LELES_MODEL_CHAT_ID = int(os.environ.get("NEWS_DRAFT_LELES_CHAT_ID", "8733881519"))
# Timeout per SINGOLA chiamata LLM: un blocco che si impantana costa
# al massimo 300s x 2 tentativi, non 600s buttati via (e il job prosegue).
LLM_TIMEOUT = int(os.environ.get("NEWS_DRAFT_LLM_TIMEOUT", "300"))

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


# Salva manuale e job di traduzione (thread) toccano lo stesso
# news_draft.json: il lock serializza le scritture, e il job scrive con
# _job_write_langs (solo le SUE lingue, mai il file intero).
_DRAFT_LOCK = threading.Lock()


def _job_write_langs(d, langs):
    """Il job aggiorna nel draft SOLO le lingue indicate, senza clobber totale.

    Così un Salva manuale fatto mentre il job gira (su un'altra lingua,
    slug, meta...) non viene perso. Se nel frattempo la bozza è passata a
    un altro articolo (numero/slug diversi), il risultato del job è
    scartato: nessuna contaminazione tra articoli.
    """
    with _DRAFT_LOCK:
        cur = _read_draft()
        if (cur.get("number") or None) != (d.get("number") or None) \
                or (cur.get("slug") or "") != (d.get("slug") or ""):
            raise HTTPException(
                409, "Bozza cambiata durante la traduzione (altro articolo): "
                     "risultato scartato."
            )
        for lang in langs:
            cur["content"][lang] = d["content"][lang]
        _write_draft(cur)


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

def _active_leles_model():
    """Legge il modello Leles attivo usando lo stesso comando 'modelli' di LeleAdmin.

    Non interroga /api/tags: serve il modello selezionato in ACTIVE_MODELS['leles'],
    non un modello installato o il modello del Reviewer/Super-Leles.
    """
    payload = {
        "message": "modelli",
        "chat_id": LELES_MODEL_CHAT_ID,
    }
    req = urllib.request.Request(
        LELES_API_URL + "/ask",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            data = json.load(response)
    except Exception as exc:
        raise HTTPException(
            503,
            f"Non riesco a leggere i modelli attivi da Leles ({type(exc).__name__}: {exc}). "
            "Traduzione annullata: nessun modello alternativo verrà usato.",
        )
    answer = str(data.get("answer") or "")
    match = re.search(r"(?im)^\s*Leles\s*→\s*([^\s]+)", answer)
    if not match:
        raise HTTPException(
            502,
            "Leles ha risposto a 'modelli', ma non trovo la riga del modello Leles. "
            "Traduzione annullata.",
        )
    return match.group(1).strip()


def _llm_translate(lang, text, context, model, field=None):
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
    elif field == "heading":
        field_hint = (
            "Il testo da tradurre è una BREVE INTESTAZIONE DI SEZIONE, non il titolo "
            "dell'articolo. Traduci soltanto questa intestazione; restituisci una "
            "sola riga, senza prefazioni, virgolette o spiegazioni. Mantieni il "
            "significato e la brevità dell'originale. "
        )
    style = (
        f"Sei un traduttore editoriale per il sito AI News di Danny Villanova. "
        + field_hint +
        f"Traduci in {ALL_LANGS[lang]} il testo che ti viene dato. "
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
        "model": model,
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
    with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as r:
        out = json.load(r)
    return out["message"]["content"].strip()


def _sanity(translated, original, field="body"):
    """Filtro anti-risposte fuori tema, non un giudizio sulla sicurezza del testo.

    Le traduzioni possono essere più lunghe dell'originale (in particolare ES/IT);
    per i paragrafi il limite è volutamente largo. Non rifiutiamo una traduzione
    solo perché contiene nomi propri o una frase rimasta uguale.
    """
    translated = (translated or "").strip()
    original = (original or "").strip()
    if len(translated) < 2:
        return False
    lowered = translated.lower()
    if lowered.startswith(("i'm sorry", "sorry", "come traduttore")):
        return False
    if any(marker in lowered for marker in LEAK_MARKERS):
        return False
    if field in ("title", "dek", "heading"):
        max_len = max(220, len(original) * 3 + 120)
    else:
        max_len = max(1200, len(original) * 4 + 300)
    if len(translated) > max_len:
        return False
    return True


def _clean_field(t, field):
    """Normalizza la risposta LLM secondo il campo (title/dek/heading/list/body)."""
    if field in ("title", "heading", "list"):
        return next((ln.strip() for ln in t.splitlines() if ln.strip()), t)
    if field == "dek":
        return t.split("\n\n")[0].strip()
    return t.strip()


def _translate_with_retry(lang, text, context, field, label, warns, model, attempts=2):
    """Una chiamata LLM con retry: un blocco sfortunato non ammazza più il job.

    Ritorna la traduzione pulita. Se tutti i tentativi falliscono,
    solleva HTTP 502: non inserisce mai il testo originale nella lingua target.
    """
    for attempt in range(1, attempts + 1):
        try:
            raw = _llm_translate(
                lang, text, context, model,
                field=field if field in ("title", "dek", "heading") else None,
            )
        except Exception as e:
            warns.append(f"{label}: tentativo {attempt} fallito ({type(e).__name__})")
            time.sleep(3)
            continue
        t = _clean_field(raw, field)
        if _sanity(t, text, field=field):
            return t
        warns.append(f"{label}: risposta insicura al tentativo {attempt}")
    raise HTTPException(
        502,
        f"{label}: traduzione non riuscita dopo {attempts} tentativi. "
        + "; ".join(warns[-attempts:]),
    )


def _translate_content(src, target_lang, model, warns=None, on_progress=None):
    warns = warns if warns is not None else []
    context = src.get("title", "")
    out = {}
    for field in ("title", "dek"):
        original = (src.get(field) or "").strip()
        if not original:
            out[field] = ""
            continue
        t = _translate_with_retry(
            target_lang, original,
            None if field == "title" else context,
            field, f"{field} ({target_lang})", warns, model,
        )
        out[field] = t

    # Traduci per blocchi, non come testo indistinto: così h3, paragrafi
    # e liste mantengono esattamente il tipo e l'ordine dell'originale.
    translated_blocks = []
    blocks = list(_parse_blocks_lenient(src.get("body", "")))
    total = len(blocks)
    for block_no, block in enumerate(blocks, 1):
        if on_progress:
            on_progress(block_no, total)
        kind = block.get("type")
        if kind == "h3":
            original = (block.get("text") or "").strip()
            t = _translate_with_retry(
                target_lang, original, context, "heading",
                f"intestazione {block_no} ({target_lang})", warns, model,
            )
            translated_blocks.append("## " + t)
        elif kind == "list":
            items = []
            for item_no, item in enumerate(block.get("items") or [], 1):
                t = _translate_with_retry(
                    target_lang, item, context, "list",
                    f"lista {block_no} voce {item_no} ({target_lang})", warns, model,
                )
                items.append("- " + t)
            translated_blocks.append("\n".join(items))
        else:
            original = (block.get("text") or "").strip()
            t = _translate_with_retry(
                target_lang, original, context, "body",
                f"paragrafo {block_no} ({target_lang})", warns, model,
            )
            translated_blocks.append(t)
    out["body"] = "\n\n".join(translated_blocks)
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
    number: int | None = None
    content: dict[str, ContentIn] | None = None


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
    # Lingua master da usare per il confronto (default: bozza corrente o EN).
    master: str | None = None


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

    @router.post("/api/admin/news-draft/reset")
    def reset_draft(authorization: str | None = Header(None)):
        """Nuovo articolo: azzera tutta la bozza (da chiamare dal selettore "nuovo")."""
        verify_admin_token(authorization)
        with _DRAFT_LOCK:
            _write_draft(_empty_draft())
        return _empty_draft()

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
                prev = _read_draft()
                master = (
                    prev.get("master")
                    if prev.get("number") == number and prev.get("master") in content
                    else "en"
                )
                # Selezionare un articolo RISCRIVE la bozza per intero:
                # nessun residuo (lingue, slug, immagine, sources) di un
                # articolo precedente può finire nel Salva o nel publish.
                draft = {
                    "number": number,
                    "slug": a.get("slug", ""),
                    "date": a.get("date", ""),
                    "readTime": a.get("readTime", 2),
                    "sources": _sources_to_text(a.get("sources")),
                    "image": a.get("image"),
                    "content": content,
                    "master": master,
                }
                with _DRAFT_LOCK:
                    _write_draft(draft)
                return draft
        raise HTTPException(404, f"Articolo #{number} non trovato.")

    @router.post("/api/admin/news-draft/save")
    def save_lang(body_in: SaveIn, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        if body_in.lang not in ALL_LANGS:
            raise HTTPException(422, "Lingua non supportata (en/it/es/fr/ca/nl).")
        # Salva per lingua ISOLATO: sotto lock rilegge la bozza corrente e
        # tocca SOLO la lingua (e la meta passata) — le altre lingue non
        # vengono ridefinite qui, quindi niente residui e niente sovrascritture.
        with _DRAFT_LOCK:
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
        with _DRAFT_LOCK:
            draft = _read_draft()
            if body_in.content is not None:
                draft["content"] = {
                    lang: value.model_dump() for lang, value in body_in.content.items()
                }
            if body_in.number is not None:
                draft["number"] = body_in.number
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
        active_model = _active_leles_model()
        with _DRAFT_LOCK:
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
                warns = []
                t = _translate_with_retry(
                    target, src_text,
                    None if body_in.field == "title" else src.get("title", ""),
                    body_in.field, f"{body_in.field} ({target})", warns,
                    active_model,
                )
                if t is None:
                    raise HTTPException(
                        502, f"Traduzione fallita per {body_in.field} ({target}): "
                             + "; ".join(warns[-2:])
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

        def work(job, _target=target, _src=src, _snapshot=draft, _model=active_model):
            d = json.loads(json.dumps(_snapshot, ensure_ascii=False))
            # Svuota la lingua target PRIMA di tradurre: se il job fallisce,
            # nel draft non resta la vecchia traduzione sporca.
            d["content"][_target] = {"title": "", "dek": "", "body": ""}
            _job_write_langs(d, [_target])
            warns = []

            def prog(i, n):
                job["note"] = f"Modello Leles {_model} · {_target}: blocco {i}/{n}"

            d["content"][_target] = _translate_content(
                _src, _target, _model, warns=warns, on_progress=prog
            )
            _job_write_langs(d, [_target])
            if warns:
                job["note"] = f"{_target}: {len(warns)} avvisi — " + "; ".join(warns[-4:])
            job["draft"] = d

        return {"job_id": _start_job(work), "model": active_model}

    @router.post("/api/admin/news-draft/translate-all")
    def translate_all(body_in: TranslateAllIn, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        with _DRAFT_LOCK:
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

        active_model = _active_leles_model()

        def work(job, _master=master, _src=src, _snapshot=draft, _model=active_model):
            d = json.loads(json.dumps(_snapshot, ensure_ascii=False))
            all_warns = []
            for lang in ALL_LANGS:
                if lang == _master:
                    continue
                # Svuota la lingua prima di (ri)tradurla: una traduzione
                # fallita non lascia nel draft la vecchia versione sporca.
                d["content"][lang] = {"title": "", "dek": "", "body": ""}
                _job_write_langs(d, [lang])
                warns = []

                def prog(i, n, _lang=lang):
                    job["note"] = f"Modello Leles {_model} · {_lang}: blocco {i}/{n}"

                d["content"][lang] = _translate_content(
                    _src, lang, _model, warns=warns, on_progress=prog
                )
                _job_write_langs(d, [lang])  # salva dopo ogni lingua: i progressi restano
                if warns:
                    all_warns.extend(f"{lang}: {w}" for w in warns)
                    job["note"] = f"lingua {lang} completata con {len(warns)} avvisi"
                else:
                    job["note"] = f"lingua completata: {lang}"
            if all_warns:
                job["note"] = "avvisi: " + "; ".join(all_warns[-6:])
            job["draft"] = d

        return {"job_id": _start_job(work), "model": active_model}

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
        """Controllo contenuti DETERMINISTICO (nessun LLM) vs lingua master.

        La lingua master arriva dal frontend (o dalla bozza corrente, default
        EN): finché era hardcoded a EN, col master IT il report confrontava
        tutte le lingue con l'inglese invece che con l'italiano.

        Lingua per lingua: campi vuoti, title/dek multi-riga o anomali o
        identici al master, body identico, struttura dei blocchi diversa
        dal master, blocchi fuori misura, marker di prompt leakati,
        sigle/nomi propri assenti nell'originale (l'LLM li inventa).
        """
        verify_admin_token(authorization)
        content = body_in.content or {}
        master = (body_in.master or "").lower() or None
        if not master:
            d = _read_draft()
            if d.get("master"):
                master = d["master"]
        if not master or master not in ALL_LANGS:
            master = "en"
        en = content.get(master) or {}
        en_title = (en.get("title") or "").strip()
        en_dek = (en.get("dek") or "").strip()
        en_body = (en.get("body") or "").strip()
        if not en_body:
            raise HTTPException(
                409, f"Nessun contenuto {master.upper()} (master) da confrontare."
            )
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
                        f"title anomalo: {len(title)} caratteri vs {len(en_title)} {master.upper()}"
                    )
                if title == en_title and len(title) > 60:
                    warns.append("title identico al master")
                if "—" in title and "—" not in en_title:
                    warns.append("title: trattino — assente nel master")
                if "(" in en_title and "(" not in title:
                    warns.append("title: parentesi tonde del master perse")
            if dek and en_dek:
                if "\n\n" in dek:
                    warns.append("dek su più paragrafi")
                if len(dek) > 1.8 * len(en_dek) + 60:
                    warns.append(
                        f"dek anomalo: {len(dek)} caratteri vs {len(en_dek)} {master.upper()}"
                    )
                if dek == en_dek and len(dek) > 80:
                    warns.append("dek identico al master")
                if "—" in dek and "—" not in en_dek:
                    warns.append("dek: trattino — assente nel master")
                if "(" in en_dek and "(" not in dek:
                    warns.append("dek: parentesi tonde del master perse")
            if body:
                if body == en_body:
                    warns.append("body identico al master (traduzione mancante?)")
                blocks = _parse_blocks_lenient(body)
                if len(blocks) != len(en_blocks):
                    warns.append(f"{len(blocks)} blocchi vs {len(en_blocks)} {master.upper()}")
                else:
                    for i, (be, bl) in enumerate(zip(en_blocks, blocks), 1):
                        if be.get("type") != bl.get("type"):
                            warns.append(
                                f"blocco {i}: tipo '{bl.get('type')}' vs "
                                f"'{be.get('type')}' {master.upper()}"
                            )
                            continue
                        if be.get("type") == "list":
                            bi, bj = be.get("items") or [], bl.get("items") or []
                            if len(bj) != len(bi):
                                warns.append(
                                    f"blocco {i}: {len(bj)} voci lista vs {len(bi)} {master.upper()}"
                                )
                            te, tl = " ".join(bi), " ".join(bj)
                        else:
                            te, tl = be.get("text") or "", bl.get("text") or ""
                        if len(tl) > 2.5 * len(te) + 80:
                            warns.append(
                                f"blocco {i} fuori misura: {len(tl)} vs {len(te)} caratteri {master.upper()}"
                            )
                        elif len(te) > 80 and tl.strip() == te.strip():
                            warns.append(f"blocco {i} identico al master")
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
        return {"report": report, "ok": not report, "master": master}

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
        with _DRAFT_LOCK:
            draft = _read_draft()
            draft["number"] = body_in.number
            draft["slug"] = body_in.slug.strip()
            draft["date"] = body_in.date.strip()
            draft["readTime"] = body_in.readTime
            draft["sources"] = body_in.sources
            if body_in.image is not None:
                draft["image"] = body_in.image
            _write_draft(draft)

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

        with _DRAFT_LOCK:
            _write_draft(_empty_draft())
        return {"published": True, "mode": mode, "slug": draft["slug"],
                "number": number, "commit": msg, "sha": sha}

    return router
