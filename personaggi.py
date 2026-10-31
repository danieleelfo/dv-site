"""
PERSONAGGI — CRUD personaggi per le storie.

Tabella Postgres "personaggi" (creata LAZY al primo uso, niente init
manuale: CREATE TABLE IF NOT EXISTS):
    id, nome, descrizione, filename, created_at

Le foto vivono in PERSONAGGI_DIR (default: cartella "personaggi"
accanto a gateway.py), upload diretto dal frontend. Nessun legame
con history.db di GraDV: archivio indipendente.

Rotte (tutte Google auth via verify_admin_token):
    GET    /api/admin/personaggi              lista
    POST   /api/admin/personaggi              crea (multipart: nome, descrizione, image)
    PUT    /api/admin/personaggi/{id}         aggiorna (campi opzionali)
    DELETE /api/admin/personaggi/{id}         elimina (riga + file)
    GET    /api/admin/personaggi/{id}/image    serve la foto
"""

import os
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

PERSONAGGI_DIR = Path(
    os.environ.get("PERSONAGGI_DIR", str(Path(__file__).resolve().parent / "personaggi"))
)

# Formati foto accettati: content-type -> estensione.
_ALLOWED_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_MAX_IMAGE_BYTES = 15 * 1024 * 1024

_table_ready = False


def _ensure_table(get_connection):
    """Crea la tabella al primo utilizzo (idempotente)."""
    global _table_ready
    if _table_ready:
        return
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS personaggi (
                    id SERIAL PRIMARY KEY,
                    nome TEXT NOT NULL,
                    descrizione TEXT NOT NULL DEFAULT '',
                    filename TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
        conn.commit()
    finally:
        conn.close()
    _table_ready = True


def _filename_ok(filename):
    """Nome file valido (uuid generato dal server, mai input utente)."""
    return bool(re.fullmatch(r"[A-Za-z0-9._-]{1,200}", filename or ""))


async def _save_image(image):
    """Valida e salva la foto upload; ritorna il nome file generato."""
    content_type = (image.content_type or "").lower().split(";")[0].strip()
    ext = _ALLOWED_EXT.get(content_type)
    if not ext:
        raise HTTPException(
            status_code=400,
            detail="Formato foto non supportato (png, jpg o webp).",
        )
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Foto vuota.")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Foto troppo grande (max 15 MB).")
    PERSONAGGI_DIR.mkdir(parents=True, exist_ok=True)
    filename = uuid.uuid4().hex + ext
    (PERSONAGGI_DIR / filename).write_bytes(data)
    return filename


def _unlink_image(filename):
    """Cancella il file foto se esiste (non fallisce mai la richiesta)."""
    if filename and _filename_ok(filename):
        try:
            (PERSONAGGI_DIR / filename).unlink()
        except OSError:
            pass


def build_personaggi_router(verify_admin_token, get_connection):
    router = APIRouter(prefix="/api/admin/personaggi", tags=["personaggi"])

    @router.get("")
    async def list_personaggi(authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        _ensure_table(get_connection)
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, nome, descrizione, (filename <> '') AS has_image,
                           EXTRACT(EPOCH FROM created_at)::int AS created_at
                    FROM personaggi
                    ORDER BY id DESC
                    """
                )
                rows = cur.fetchall()
        finally:
            conn.close()
        return {
            "items": [
                {
                    "id": r[0],
                    "nome": r[1],
                    "descrizione": r[2],
                    "has_image": bool(r[3]),
                    "created_at": r[4],
                }
                for r in rows
            ]
        }

    @router.post("")
    async def create_personaggio(
        authorization: str | None = Header(None),
        nome: str = Form(...),
        descrizione: str = Form(""),
        image: UploadFile | None = File(None),
    ):
        verify_admin_token(authorization)
        _ensure_table(get_connection)

        nome = (nome or "").strip()
        descrizione = (descrizione or "").strip()
        if not nome:
            raise HTTPException(status_code=400, detail="Il nome del personaggio e' obbligatorio.")
        if len(nome) > 200:
            raise HTTPException(status_code=400, detail="Nome troppo lungo (max 200).")
        if len(descrizione) > 4000:
            raise HTTPException(status_code=400, detail="Descrizione troppo lunga (max 4000).")
        if image is None:
            raise HTTPException(status_code=400, detail="La foto del personaggio e' obbligatoria.")

        filename = await _save_image(image)

        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO personaggi (nome, descrizione, filename) VALUES (%s, %s, %s) RETURNING id",
                    (nome, descrizione, filename),
                )
                row_id = cur.fetchone()[0]
            conn.commit()
        finally:
            conn.close()
        return {"id": row_id, "nome": nome}

    @router.put("/{personaggio_id}")
    async def update_personaggio(
        personaggio_id: int,
        authorization: str | None = Header(None),
        nome: str | None = Form(None),
        descrizione: str | None = Form(None),
        image: UploadFile | None = File(None),
    ):
        verify_admin_token(authorization)
        _ensure_table(get_connection)
        old_filename = None
        new_filename = None
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT filename FROM personaggi WHERE id = %s", (personaggio_id,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Personaggio non trovato.")
                old_filename = row[0]

                if image is not None:
                    new_filename = await _save_image(image)

                updates = []
                params = []
                if nome is not None:
                    n = nome.strip()
                    if not n:
                        raise HTTPException(status_code=400, detail="Il nome non puo' essere vuoto.")
                    if len(n) > 200:
                        raise HTTPException(status_code=400, detail="Nome troppo lungo (max 200).")
                    updates.append("nome = %s")
                    params.append(n)
                if descrizione is not None:
                    d = descrizione.strip()
                    if len(d) > 4000:
                        raise HTTPException(status_code=400, detail="Descrizione troppo lunga (max 4000).")
                    updates.append("descrizione = %s")
                    params.append(d)
                if new_filename:
                    updates.append("filename = %s")
                    params.append(new_filename)

                if updates:
                    params.append(personaggio_id)
                    cur.execute(
                        "UPDATE personaggi SET " + ", ".join(updates) + " WHERE id = %s",
                        params,
                    )
                    conn.commit()
        finally:
            conn.close()
        if new_filename and old_filename:
            _unlink_image(old_filename)
        return {"ok": True}

    @router.delete("/{personaggio_id}")
    async def delete_personaggio(personaggio_id: int, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        _ensure_table(get_connection)
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT filename FROM personaggi WHERE id = %s", (personaggio_id,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Personaggio non trovato.")
                filename = row[0]
                cur.execute("DELETE FROM personaggi WHERE id = %s", (personaggio_id,))
                conn.commit()
        finally:
            conn.close()
        _unlink_image(filename)
        return {"ok": True}

    @router.get("/{personaggio_id}/image")
    async def get_personaggio_image(personaggio_id: int, authorization: str | None = Header(None)):
        verify_admin_token(authorization)
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT filename FROM personaggi WHERE id = %s", (personaggio_id,))
                row = cur.fetchone()
        finally:
            conn.close()
        if not row or not _filename_ok(row[0]):
            raise HTTPException(status_code=404, detail="Foto del personaggio non trovata.")
        path = PERSONAGGI_DIR / row[0]
        if not path.is_file():
            raise HTTPException(status_code=404, detail="File della foto non presente sul disco.")
        return FileResponse(path, headers={"Cache-Control": "private, max-age=60"})

    return router
