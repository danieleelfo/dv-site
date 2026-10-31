"""
Read-only GraDV image archive API.

Reads GraDV/history.db directly. The database is never created or modified here.
"""
import io
import os
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import Response


def build_gradv_archive_router(verify_admin_token):
    router = APIRouter(prefix="/api/gradv/archive", tags=["gradv-archive"])

    def db_path() -> Path:
        return Path(
            os.environ.get(
                "GRADV_DB",
                str(Path.home() / "Desktop" / "Danny" / "GraDV" / "history.db"),
            )
        ).expanduser()

    def connect():
        path = db_path()
        if not path.is_file():
            raise HTTPException(
                status_code=503,
                detail=f"Database GraDV non trovato: {path}",
            )
        # mode=ro garantisce che questa API non possa modificare il DB.
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True)

    @router.get("")
    async def list_images(
        page: int = Query(1, ge=1),
        page_size: int = Query(18, ge=1, le=60),
        q: str = Query("", max_length=500),
        authorization: str | None = Header(None),
    ):
        verify_admin_token(authorization)
        offset = (page - 1) * page_size
        where = "WHERE prompt LIKE ?" if q.strip() else ""
        params = [f"%{q.strip()}%"] if q.strip() else []

        try:
            with connect() as conn:
                total = conn.execute(
                    f"SELECT COUNT(*) FROM images {where}", params
                ).fetchone()[0]
                rows = conn.execute(
                    f"""
                    SELECT id, prompt, seed, width, height, steps, created_at
                    FROM images
                    {where}
                    ORDER BY created_at DESC, id DESC
                    LIMIT ? OFFSET ?
                    """,
                    [*params, page_size, offset],
                ).fetchall()
        except sqlite3.Error as exc:
            raise HTTPException(status_code=500, detail=f"Errore lettura GraDV DB: {exc}")

        items = [
            {
                "id": row[0],
                "prompt": row[1] or "",
                "seed": row[2],
                "width": row[3],
                "height": row[4],
                "steps": row[5],
                "created_at": row[6],
            }
            for row in rows
        ]
        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size),
        }

    @router.get("/{image_id}/image")
    async def get_image(
        image_id: int,
        thumbnail: bool = False,
        authorization: str | None = Header(None),
    ):
        verify_admin_token(authorization)
        try:
            with connect() as conn:
                row = conn.execute(
                    "SELECT image_data FROM images WHERE id = ?",
                    (image_id,),
                ).fetchone()
        except sqlite3.Error as exc:
            raise HTTPException(status_code=500, detail=f"Errore lettura GraDV DB: {exc}")

        if not row or not row[0]:
            raise HTTPException(status_code=404, detail="Immagine non trovata.")

        image_bytes = bytes(row[0])
        media_type = "image/png"

        if thumbnail:
            try:
                from PIL import Image
                with Image.open(io.BytesIO(image_bytes)) as image:
                    image.thumbnail((420, 420))
                    output = io.BytesIO()
                    image.convert("RGB").save(output, format="JPEG", quality=78, optimize=True)
                    image_bytes = output.getvalue()
                media_type = "image/jpeg"
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Creazione anteprima fallita: {exc}")

        return Response(
            content=image_bytes,
            media_type=media_type,
            headers={"Cache-Control": "private, max-age=300"},
        )

    return router
