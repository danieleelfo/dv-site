# comic_page.py
# Composizione di una pagina Comics multi-vignetta con Pillow.
# POST /api/image/comic-page: images[] + bubbles (JSON per vignetta) + layout.
import io
import json
import math

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageDraw

from image_bubbles import _draw_bubble

MAX_PANELS = 12
MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_TOTAL_BYTES = 120 * 1024 * 1024
PANEL_W = 760
PANEL_H = 570
GUTTER = 24
MARGIN = 36


def build_comic_page_router(verify_admin_token):
    router = APIRouter()

    @router.post("/api/image/comic-page")
    async def comic_page(
        authorization: str | None = Header(None),
        images: list[UploadFile] = File(...),
        bubbles: str = Form("[]"),
        layout: str = Form("grid"),
    ):
        verify_admin_token(authorization)

        if not images:
            raise HTTPException(status_code=400, detail="Aggiungi almeno una vignetta.")
        if len(images) > MAX_PANELS:
            raise HTTPException(status_code=400, detail=f"Massimo {MAX_PANELS} vignette.")
        layout = (layout or "grid").strip().lower()
        if layout not in ("grid", "vertical", "horizontal"):
            raise HTTPException(status_code=400, detail="Layout non valido.")

        try:
            bubble_sets = json.loads(bubbles)
        except ValueError:
            raise HTTPException(status_code=400, detail="Configurazione balloon non valida.")
        if not isinstance(bubble_sets, list) or len(bubble_sets) != len(images):
            raise HTTPException(status_code=400, detail="Balloon non corrispondenti alle vignette.")

        decoded = []
        total = 0
        for upload in images:
            data = await upload.read()
            total += len(data)
            if len(data) > MAX_IMAGE_BYTES:
                raise HTTPException(status_code=400, detail="Una foto supera 15 MB.")
            if total > MAX_TOTAL_BYTES:
                raise HTTPException(status_code=400, detail="Dimensione totale delle foto superiore a 120 MB.")
            try:
                image = Image.open(io.BytesIO(data)).convert("RGB")
                image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            except Exception:
                raise HTTPException(status_code=400, detail="Una delle immagini non è leggibile.")
            decoded.append(image)

        count = len(decoded)
        panel_w, panel_h = PANEL_W, PANEL_H
        if layout == "vertical":
            cols = 1
            panel_h = max(240, min(PANEL_H, (4096 - MARGIN * 2 - GUTTER * (count - 1)) // count))
        elif layout == "horizontal":
            cols = count
            panel_w = max(240, min(PANEL_W, (4096 - MARGIN * 2 - GUTTER * (count - 1)) // count))
        else:
            cols = min(2, count)
        rows = math.ceil(count / cols)
        page_w = MARGIN * 2 + cols * panel_w + (cols - 1) * GUTTER
        page_h = MARGIN * 2 + rows * panel_h + (rows - 1) * GUTTER
        page = Image.new("RGB", (page_w, page_h), "#171b20")
        page_draw = ImageDraw.Draw(page)

        for index, (source, specs) in enumerate(zip(decoded, bubble_sets)):
            if not isinstance(specs, list):
                raise HTTPException(status_code=400, detail=f"Balloon non validi nella vignetta {index + 1}.")
            if len(specs) > 20:
                raise HTTPException(status_code=400, detail="Massimo 20 balloon per vignetta.")
            row, col = divmod(index, cols)
            x = MARGIN + col * (panel_w + GUTTER)
            y = MARGIN + row * (panel_h + GUTTER)

            # Vignetta con proporzioni originali: contain, senza tagliare la foto.
            panel = Image.new("RGB", (panel_w, panel_h), "#ffffff")
            fitted = source.copy()
            fitted.thumbnail((panel_w, panel_h), Image.Resampling.LANCZOS)
            px = (panel_w - fitted.width) // 2
            py = (panel_h - fitted.height) // 2
            panel.paste(fitted, (px, py))

            # Le coordinate sono relative alla foto, non ai margini bianchi.
            draw = ImageDraw.Draw(panel)
            mapped = []
            sx = fitted.width / source.width
            sy = fitted.height / source.height
            scale = min(sx, sy)
            for spec in specs:
                if not isinstance(spec, dict):
                    continue
                item = dict(spec)
                item["x"] = (px + float(item.get("x", 0.5)) * fitted.width) / panel_w
                item["y"] = (py + float(item.get("y", 0.5)) * fitted.height) / panel_h
                # Il frontend React usa camelCase; _draw_bubble usa snake_case.
                # Accettiamo entrambi per mantenere compatibilità con eventuali client esistenti.
                tail_x = item.get("tail_x", item.get("tailX", 0.5))
                tail_y = item.get("tail_y", item.get("tailY", 0.5))
                font_size = item.get("font_size", item.get("fontSize", 44))
                item["tail_x"] = (px + float(tail_x) * fitted.width) / panel_w
                item["tail_y"] = (py + float(tail_y) * fitted.height) / panel_h
                item["w"] = float(item.get("w", 0.34)) * fitted.width / panel_w
                item["font_size"] = max(10, round(float(font_size) * scale))
                mapped.append(item)
            for item in mapped:
                _draw_bubble(draw, panel.size, item)

            page.paste(panel, (x, y))
            page_draw.rectangle((x, y, x + panel_w - 1, y + panel_h - 1), outline="#080b0e", width=5)

        output = io.BytesIO()
        page.save(output, "PNG", optimize=True)
        return Response(content=output.getvalue(), media_type="image/png")

    return router
