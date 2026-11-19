# comic_page.py
# Composizione di una pagina Comics multi-vignetta con Pillow.
# POST /api/image/comic-page: images[] + bubbles (JSON per vignetta) + layout.
import io
import json
import math

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageDraw

from image_bubbles import _draw_bubble, _font, _font_size, _wrap

MAX_PANELS = 12
MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_TOTAL_BYTES = 120 * 1024 * 1024
# Box massimo per vignetta: alto (760x1400) per non schiacciare le foto in
# verticale. La vignetta finale ha le proporzioni della foto (contain nel
# box) e viene incollata com'e': niente bande bianche di riempimento.
PANEL_BOX = (760, 1400)
SINGLE_BOX = (1400, 2000)
PAGE_MAX = 4096
PAGE_BG = "#171b20"
BORDER = "#080b0e"
GUTTER = 24
MARGIN = 36
# Testo sotto la vignetta (didascalia).
CAPTION_BG = "#f3ecd6"
CAPTION_FG = "#16130f"
CAPTION_PAD = 22
CAPTION_MAX_CHARS = 2000


def _caption_block(text, width):
    """Righe, font e altezza del riquadro testo sotto una foto."""
    if not text:
        return None
    font = _font(max(16, round(width * 0.042)))
    lines = _wrap(text, font, max(40, width - CAPTION_PAD * 2))
    line_h = round(_font_size(font) * 1.35)
    return {
        "font": font,
        "lines": lines,
        "line_h": line_h,
        "height": CAPTION_PAD * 2 + line_h * len(lines),
    }


def build_comic_page_router(verify_admin_token):
    router = APIRouter()

    @router.post("/api/image/comic-page")
    async def comic_page(
        authorization: str | None = Header(None),
        images: list[UploadFile] = File(...),
        bubbles: str = Form("[]"),
        layout: str = Form("grid"),
        format: str = Form("png"),
        captions: str = Form("[]"),
    ):
        verify_admin_token(authorization)

        if not images:
            raise HTTPException(status_code=400, detail="Aggiungi almeno una vignetta.")
        if len(images) > MAX_PANELS:
            raise HTTPException(status_code=400, detail=f"Massimo {MAX_PANELS} vignette.")
        layout = (layout or "grid").strip().lower()
        if layout not in ("grid", "grid3", "vertical", "horizontal", "single"):
            raise HTTPException(status_code=400, detail="Layout non valido.")
        if layout == "single" and len(images) != 1:
            raise HTTPException(
                status_code=400,
                detail="Il layout copertina richiede esattamente una vignetta.",
            )
        fmt = (format or "png").strip().lower()
        if fmt not in ("png", "pdf"):
            raise HTTPException(status_code=400, detail="Formato non valido (png o pdf).")

        try:
            bubble_sets = json.loads(bubbles)
        except ValueError:
            raise HTTPException(status_code=400, detail="Configurazione balloon non valida.")
        if not isinstance(bubble_sets, list) or len(bubble_sets) != len(images):
            raise HTTPException(status_code=400, detail="Balloon non corrispondenti alle vignette.")

        try:
            caption_list = json.loads(captions or "[]")
        except ValueError:
            raise HTTPException(status_code=400, detail="Testi delle vignette non validi.")
        if not isinstance(caption_list, list):
            raise HTTPException(status_code=400, detail="Testi delle vignette non validi.")
        if not caption_list:
            caption_list = [""] * len(images)
        if len(caption_list) != len(images):
            raise HTTPException(status_code=400, detail="Testi non corrispondenti alle vignette.")
        caption_texts = []
        for index, value in enumerate(caption_list):
            text = "" if value is None else str(value).strip()
            if len(text) > CAPTION_MAX_CHARS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Testo troppo lungo nella vignetta {index + 1} (max {CAPTION_MAX_CHARS} caratteri).",
                )
            caption_texts.append(text)

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
        box = SINGLE_BOX if layout == "single" else PANEL_BOX
        fitted = []
        for source in decoded:
            image = source.copy()
            image.thumbnail(box, Image.Resampling.LANCZOS)
            fitted.append(image)

        # --- colonne/righe e celle: dimensioni dalle foto reali --------------
        if layout == "vertical":
            cols = 1
        elif layout == "horizontal":
            cols = count
        elif layout == "grid":
            cols = min(2, count)
        else:  # grid3 / single
            cols = min(3, count)
        rows = math.ceil(count / cols)

        blocks = []
        cap_h = []

        def _refresh_captions():
            blocks[:] = [_caption_block(caption_texts[i], fitted[i].width) for i in range(count)]
            cap_h[:] = [b["height"] if b else 0 for b in blocks]

        def _measure():
            # Per ogni vignetta: larghezza/altezza cella di colonna/riga.
            if layout == "vertical":
                w = [max(f.width for f in fitted)]
                h = [f.height + cap_h[i] for i, f in enumerate(fitted)]
            elif layout == "horizontal":
                w = [f.width for f in fitted]
                h = [max(f.height + cap_h[i] for i, f in enumerate(fitted))]
            else:
                w = [0] * cols
                h = [0] * rows
                for index, img in enumerate(fitted):
                    r, col = divmod(index, cols)
                    w[col] = max(w[col], img.width)
                    h[r] = max(h[r], img.height + cap_h[index])
            return w, h

        _refresh_captions()
        cell_w, cell_h = _measure()
        gutters_x = GUTTER * (cols - 1)
        gutters_y = GUTTER * (rows - 1)
        page_w = MARGIN * 2 + sum(cell_w) + gutters_x
        page_h = MARGIN * 2 + sum(cell_h) + gutters_y

        # --- budget pagina: se sfora PAGE_MAX, scala tutto uniformemente ----
        # I riquadri di testo vengono ricalcolati sulla larghezza aggiornata.
        for _attempt in range(4):
            if page_w <= PAGE_MAX and page_h <= PAGE_MAX:
                break
            scale = min(PAGE_MAX / page_w, PAGE_MAX / page_h)
            for i, img in enumerate(fitted):
                fitted[i] = img.resize(
                    (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
                    Image.Resampling.LANCZOS,
                )
            _refresh_captions()
            cell_w, cell_h = _measure()
            page_w = MARGIN * 2 + sum(cell_w) + gutters_x
            page_h = MARGIN * 2 + sum(cell_h) + gutters_y

        if page_w > PAGE_MAX or page_h > PAGE_MAX:
            raise HTTPException(
                status_code=400,
                detail=f"La pagina con le didascalie supera il limite di {PAGE_MAX}px. Riduci il testo o usa un layout diverso.",
            )

        page = Image.new("RGB", (page_w, page_h), PAGE_BG)
        page_draw = ImageDraw.Draw(page)

        for index, (source, panel, specs) in enumerate(zip(decoded, fitted, bubble_sets)):
            if not isinstance(specs, list):
                raise HTTPException(status_code=400, detail=f"Balloon non validi nella vignetta {index + 1}.")
            if len(specs) > 20:
                raise HTTPException(status_code=400, detail=f"Massimo 20 balloon per vignetta {index + 1}.")

            row, col = divmod(index, cols)
            x = MARGIN + sum(cell_w[:col]) + col * GUTTER
            y = MARGIN + sum(cell_h[:row]) + row * GUTTER

            # Vignetta = la foto stessa, proporzioni originali, zero letterbox
            # bianco: i balloon sono disegnati direttamente sulla foto e le
            # coordinate restano relative all'immagine (niente offset).
            draw = ImageDraw.Draw(panel)
            scale = min(panel.width / source.width, panel.height / source.height)
            mapped = []
            for spec in specs:
                if not isinstance(spec, dict):
                    continue
                item = dict(spec)
                item["x"] = float(item.get("x", 0.5))
                item["y"] = float(item.get("y", 0.5))
                # Il frontend React usa camelCase; _draw_bubble usa snake_case.
                # Accettiamo entrambi per mantenere compatibilita' con eventuali client esistenti.
                item["tail_x"] = float(item.get("tail_x", item.get("tailX", 0.5)))
                item["tail_y"] = float(item.get("tail_y", item.get("tailY", 0.5)))
                item["w"] = float(item.get("w", 0.34))
                font_size = item.get("font_size", item.get("fontSize", 44))
                item["font_size"] = max(10, round(float(font_size) * scale))
                mapped.append(item)
            for item in mapped:
                _draw_bubble(draw, panel.size, item)

            # Foto centrata nella sua cella; il bordo segue la foto, non la cella.
            px = x + (cell_w[col] - panel.width) // 2
            py = y + (cell_h[row] - panel.height) // 2
            page.paste(panel, (px, py))
            page_draw.rectangle(
                (px, py, px + panel.width - 1, py + panel.height - 1),
                outline=BORDER,
                width=5,
            )
            block = blocks[index]
            if block:
                cy = py + panel.height
                page_draw.rectangle(
                    (px, cy, px + panel.width - 1, cy + block["height"] - 1),
                    fill=CAPTION_BG,
                    outline=BORDER,
                    width=5,
                )
                ty = cy + CAPTION_PAD
                for line in block["lines"]:
                    page_draw.text((px + CAPTION_PAD, ty), line, font=block["font"], fill=CAPTION_FG)
                    ty += block["line_h"]

        output = io.BytesIO()
        if fmt == "pdf":
            page.save(output, "PDF", resolution=150.0)
            return Response(content=output.getvalue(), media_type="application/pdf")
        page.save(output, "PNG", optimize=True)
        return Response(content=output.getvalue(), media_type="image/png")

    return router
