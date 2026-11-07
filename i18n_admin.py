"""
I18N ADMIN — editor dei file di locale del sito (src/i18n/locales/*.json).

Pagina I18nAdmin.jsx: ricerca chiave, editing per chiave nelle 6 lingue
(en come riferimento), pubblicazione con commit+push su main.

Le chiavi sono percorsi annidati con la sintassi puntata
("nav.home", "expertise.items.0.title"): oggetti e array.

Rotte (tutte Google auth admin via verify_admin_token):
    GET  /api/admin/i18n              i 6 file di locale (parzati)
    POST /api/admin/i18n/save         applica {lang: {percorso: valore}} e committa
"""

import json
import subprocess
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

DV_SITE_DIR = Path(__file__).resolve().parent
LOCALES_DIR = DV_SITE_DIR / "src" / "i18n" / "locales"
LANGS = ("en", "it", "es", "fr", "ca", "nl")


def _locale_path(lang):
    return LOCALES_DIR / f"{lang}.json"


def _read_locale(lang):
    try:
        with open(_locale_path(lang), "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise HTTPException(404, f"Locale {lang}.json non trovato.")
    except Exception as exc:
        raise HTTPException(500, f"{lang}.json non valido: {exc}")


def _git(args):
    return subprocess.run(
        ["git", "-C", str(DV_SITE_DIR), *args], capture_output=True, text=True
    )


def _set_path(data, path, value):
    """Imposta value in un percorso annidato 'a.b.0.c' (oggetti e array)."""
    parts = path.split(".")
    node = data
    for i, part in enumerate(parts[:-1]):
        nxt_is_num = parts[i + 1].isdigit()
        if isinstance(node, list):
            idx = int(part)
            while len(node) <= idx:
                node.append([] if nxt_is_num else {})
            node = node[idx]
        else:
            if part not in node or not isinstance(node[part], (dict, list)):
                node[part] = [] if nxt_is_num else {}
            node = node[part]
    last = parts[-1]
    if isinstance(node, list):
        idx = int(last)
        while len(node) <= idx:
            node.append(None)
        node[idx] = value
    else:
        node[last] = value


def build_i18n_router(verify_admin_token):
    router = APIRouter()

    class SaveIn(BaseModel):
        # { "it": { "nav.home": "Home", ... }, "fr": {...} }
        changes: dict
        message: str = ""

    @router.get("/api/admin/i18n")
    def get_locales(authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        return {"langs": {lang: _read_locale(lang) for lang in LANGS}}

    @router.post("/api/admin/i18n/save")
    def save_locales(body_in: SaveIn, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        if not body_in.changes:
            raise HTTPException(422, "Nessuna modifica da salvare.")
        for lang in body_in.changes:
            if lang not in LANGS:
                raise HTTPException(422, f"Lingua non supportata: {lang}")

        pull = _git(["pull", "--ff-only", "origin", "main"])
        if pull.returncode != 0:
            raise HTTPException(
                409, "git pull --ff-only fallito (repo sporco o divergente?): "
                     + pull.stderr[-400:]
            )

        touched = []
        for lang, updates in body_in.changes.items():
            data = _read_locale(lang)
            for path, value in updates.items():
                if not path or not isinstance(value, str):
                    raise HTTPException(422, f"Percorso o valore non valido: {path!r}")
                _set_path(data, path, value)
            _locale_path(lang).write_text(
                json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            touched.append(lang)

        for lang in touched:
            _git(["add", str(_locale_path(lang))])
        langs_ok = "/".join(touched).upper()
        msg = body_in.message.strip() or f"i18n: update {langs_ok} (da I18n Admin)"
        commit = _git(["commit", "-m", msg])
        if commit.returncode != 0:
            for lang in touched:
                _git(["checkout", "--", str(_locale_path(lang))])
            raise HTTPException(500, "git commit fallito: " + commit.stderr[-400:])
        push = _git(["push", "origin", "main"])
        if push.returncode != 0:
            raise HTTPException(
                502, "Commit creato ma push fallito (pushare a mano): "
                     + push.stderr[-400:]
            )
        sha = _git(["rev-parse", "--short", "HEAD"]).stdout.strip()
        return {"saved": True, "langs": touched, "commit": msg, "sha": sha}

    return router
