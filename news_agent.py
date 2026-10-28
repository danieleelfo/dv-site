#!/usr/bin/env python3
"""
news_agent — agente i18n per la sezione AI Ethics di dv-site.

Legge src/content/aiEthics.js (incluse modifiche non committate), rielabora le
traduzioni it/es/fr/ca/nl di TUTTI gli articoli partendo dall'inglese, valida la
sintassi con node, e crea un commit LOCALE (nessun push: il push è manuale).

Uso (dal terminale, dalla root di dv-site):
    python3 news_agent.py            # traduce + commit locale
    python3 news_agent.py --dry-run # traduce ma niente commit, mostra report

Requisiti: python3, node (per il parse/serialize e il check sintassi),
un LLM locale raggiungibile via API compatibile Ollama (default localhost:11434).
"""

import json
import subprocess
import sys
import pathlib

# ---------------------------------------------------------------- CONFIG ---
DV_SITE_DIR = pathlib.Path(__file__).resolve().parent
DATA_FILE = DV_SITE_DIR / "src" / "content" / "aiEthics.js"

LLM_URL = "http://127.0.0.1:11434/api/chat"   # API Ollama-compatible
LLM_MODEL = "mistral:latest"                    # adatta al modello locale tuo
LLM_OPTIONS = {"temperature": 0.3}

LANGS = ["it", "es", "fr", "ca", "nl"]
LANG_NAME = {
    "it": "italiano", "es": "spagnolo", "fr": "francese",
    "ca": "catalano", "nl": "olandese",
}
# Convenzioni tipografiche di Danny
LANG_QUOTES = {  # caporali per citazioni interne
    "it": "« »", "es": "« »", "fr": "« »", "ca": "« »", "nl": "\" \"",
}

COMMIT_MSG = "chore(ai-ethics): update i18n translations (news_agent)"

# ------------------------------------------------- PARSE / SERIALIZE (JS) ---
# Node fa parse e serialize del file: niente regex fragili sul testo JS.
# NB: import ESM relativi alla cwd di dv-site (specificatore './' obbligatorio)

JS_DUMP = """
import { ARTICLES } from './src/content/aiEthics.js';
console.log(JSON.stringify(ARTICLES));
"""

JS_WRITE = r"""
const [dataPath, payloadPath, outFile] = process.argv.slice(1);
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const original = fs.readFileSync(dataPath, 'utf8');
// preserva tutto ciò che sta fuori dall'array ARTICLES
const START = 'export const ARTICLES = [';
const startIdx = original.indexOf(START);
if (startIdx === -1) { console.error('ARTICLES non trovato'); process.exit(1); }
const prefix = original.slice(0, startIdx + START.length);
// la chiusura dell'array: prima riga che inizia (colonna 0) con '];'
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

// articoli aggiornati: payload = {"<slug>": {"<lang>": contentLangObject}}
const articles = JSON.parse(fs.readFileSync(payloadPath + '.base', 'utf8'));
for (const a of articles) {
  const upd = payload[a.slug];
  if (upd) for (const lang of Object.keys(upd)) a.content[lang] = upd[lang];
}
const body = articles.map(a => dump(a, '  ')).join(',\n');
fs.writeFileSync(outFile, prefix + '\n' + body + ',\n' + tail);
console.log('OK');
"""


def run_node(code: str, args: list) -> str:
    p = subprocess.run(
        ["node", "--input-type=module", "-e", code, *args],
        capture_output=True, text=True, cwd=DV_SITE_DIR,
    )
    if p.returncode != 0:
        raise RuntimeError(f"node ha fallito:\n{p.stderr}")
    return p.stdout


def load_articles() -> list:
    out = run_node(JS_DUMP, [])
    return json.loads(out)


def write_file(articles: list, updates: dict) -> None:
    tmp = DV_SITE_DIR / ".news_agent_tmp"
    tmp_base = DV_SITE_DIR / ".news_agent_tmp.base"
    tmp.write_text(json.dumps(updates))
    tmp_base.write_text(json.dumps(articles))
    run_node(JS_WRITE, [str(DATA_FILE), str(tmp), str(DATA_FILE)])
    tmp.unlink()
    tmp_base.unlink()


# ------------------------------------------------------------------- LLM ---
def llm_translate(lang: str, text: str, context: str) -> str:
    import urllib.request
    style = (
        f"Sei un traduttore editoriale per il sito AI Ethics di Danny Villanova. "
        f"Traduci in {LANG_NAME[lang]} il testo inglese che ti viene dato. "
        f"Regole: registro giornalistico, frasi fluente, NON letterale; "
        f"usa apostrofi tipografici (\u2019), mai apostrofi dritti; "
        f"per le citazioni usa {LANG_QUOTES[lang]}; non tradurre nomi propri, "
        f"sigle (AI, S-1, METR) né URL. "
        f"Rispondi SOLO con la traduzione, nessun commento."
    )
    payload = {
        "model": LLM_MODEL,
        "stream": False,
        "options": LLM_OPTIONS,
        "messages": [
            {"role": "system", "content": style},
            {"role": "user", "content": f"Contesto articolo: {context}\n\nTesto da tradurre:\n{text}"},
        ],
    }
    req = urllib.request.Request(
        LLM_URL, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        out = json.load(r)
    return out["message"]["content"].strip()


def sanity(translated: str, original: str) -> bool:
    """Filtra risposte chiaramente rotte del modello locale."""
    if not translated or len(translated) < 4:
        return False
    if translated.lower().startswith(("i'm sorry", "sorry", "come traduttore")):
        return False
    # i URL nel body non devono sparire
    if "http" in original and "http" not in translated:
        return False
    return True


# ------------------------------------------------------------------ CORE ---
def translate_article(article: dict) -> dict:
    """Ritorna {lang: {title, dek, body}} tradotti dall'inglese."""
    en = article["content"]["en"]
    updates = {}
    context = en["title"]
    for lang in LANGS:
        print(f"  [{lang}]", end=" ", flush=True)
        try:
            title = llm_translate(lang, en["title"], context)
            dek = llm_translate(lang, en["dek"], context)
            body = []
            for block in en["body"]:
                if block["type"] == "list":
                    items = [
                        llm_translate(lang, it, context) for it in block["items"]
                    ]
                    body.append({"type": "list", "items": items})
                else:
                    t = llm_translate(lang, block["text"], context)
                    if not sanity(t, block["text"]):
                        raise RuntimeError(f"traduzione insicura per blocco {block['type']}")
                    body.append({"type": block["type"], "text": t})
            if not all([sanity(title, en["title"]), sanity(dek, en["dek"])]):
                raise RuntimeError("traduzione insicura per title/dek")
            updates[lang] = {"title": title, "dek": dek, "body": body}
            print("ok", end="", flush=True)
        except Exception as e:
            print(f"FALLITO ({e})", end="", flush=True)
        print("", flush=True)
    return updates


def fnv1a12(text: str) -> str:
    h = 0x811c9dc5
    for b in text.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}{(h >> 16) ^ h:04x}"


def main() -> int:
    dry = "--dry-run" in sys.argv
    print("news_agent — sync traduzioni AI Ethics")
    articles = load_articles()
    print(f"Trovati {len(articles)} articoli: {', '.join(a['slug'] for a in articles)}")

    updates = {}
    for a in articles:
        print(f"Articolo: {a['slug']}")
        done = translate_article(a)
        if len(done) == len(LANGS):
            # hash coerente: calcolato sul contenuto EN corrente (modifiche incluse)
            en = a["content"]["en"]
            h = fnv1a12(json.dumps(
                {k: v for k, v in en.items() if k != "_enHash"},
                ensure_ascii=False, sort_keys=True,
            ))
            en["_enHash"] = h
            for lang, c in done.items():
                c["_enHash"] = h
            done["en"] = {"_enHash": h}
            updates[a["slug"]] = done
        else:
            print(f"  ⚠ salto {a['slug']}: traduzioni incomplete")

    if not updates:
        print("Nessun articolo aggiornato. Esco senza commit.")
        return 1

    write_file(articles, updates)

    # validazione sintassi OBBLIGATORIA prima di ogni commit
    chk = subprocess.run(["node", "--check", str(DATA_FILE)], capture_output=True, text=True)
    if chk.returncode != 0:
        print(f"❌ SINTASSI NON VALIDA, commit annullato:\n{chk.stderr}")
        subprocess.run(["git", "-C", str(DV_SITE_DIR), "checkout", "--", str(DATA_FILE)])
        return 1
    print("✅ Sintassi JS valida (node --check)")

    if dry:
        print("(dry-run: nessun commit)")
        return 0

    subprocess.run(["git", "-C", str(DV_SITE_DIR), "add", str(DATA_FILE)], check=True)
    diff = subprocess.run(
        ["git", "-C", str(DV_SITE_DIR), "diff", "--cached", "--quiet"],
        capture_output=True,
    )
    if diff.returncode == 0:
        print("Nessuna modifica effettiva: niente da committare.")
        return 0
    subprocess.run(["git", "-C", str(DV_SITE_DIR), "commit", "-m", COMMIT_MSG], check=True)
    head = subprocess.run(
        ["git", "-C", str(DV_SITE_DIR), "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True,
    ).stdout.strip()
    print(f"✅ Commit LOCALE {head} creato. Push manuale quando vuoi (git push).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
