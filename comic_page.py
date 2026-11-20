# comic_page.py
# Composizione di una pagina Comics multi-vignetta con Pillow.
# POST /api/image/comic-page: images[] + bubbles (JSON per vignetta) + layout.
import io
import json
import math

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageDraw, ImageColor, ImageOps

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
MAX_IMAGE_PIXELS = 50_000_000  # una foto da 50 megapixel in RGB occupa circa 150 MB in memoria


def _fit_page(page):
    """Rete di sicurezza: riscala la pagina finita dentro PAGE_MAX, proporzioni intatte."""
    if page.width > PAGE_MAX or page.height > PAGE_MAX:
        page.thumbnail((PAGE_MAX, PAGE_MAX), Image.Resampling.LANCZOS)
    return page


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


# Layout "diagonal": strisce a tutta larghezza, una sotto l'altra, separate da tagli
# obliqui paralleli. Ogni foto resta intera (i balloon si disegnano sulla foto come
# negli altri layout); gli angoli vengono tagliati dalla diagonale.
DIAG_W = 900
DIAG_MIN_W = 360
DIAG_SLANT = 0.09  # dislivello del taglio rispetto alla larghezza (circa 5 gradi)
DIAG_SS = 4        # supersampling dei bordi obliqui (antialias)


def _apply_bubbles(panel, source, specs, index):
    """Disegna i balloon sulla foto `panel` (coordinate relative all'immagine)."""
    if not isinstance(specs, list):
        raise HTTPException(status_code=400, detail=f"Balloon non validi nella vignetta {index + 1}.")
    if len(specs) > 20:
        raise HTTPException(status_code=400, detail=f"Massimo 20 balloon per vignetta {index + 1}.")
    draw = ImageDraw.Draw(panel)
    scale = min(panel.width / source.width, panel.height / source.height)
    def _num(value, low, high, default):
        if value is None:
            return default
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Balloon non validi nella vignetta {index + 1}: valore non numerico.")
        if not math.isfinite(number):
            raise HTTPException(status_code=400, detail=f"Balloon non validi nella vignetta {index + 1}: valore non finito.")
        return min(max(number, low), high)

    def _valid_color(value):
        try:
            ImageColor.getrgb(str(value))
            return True
        except ValueError:
            return False

    mapped = []
    for spec in specs:
        if not isinstance(spec, dict):
            continue
        item = dict(spec)
        item["x"] = _num(item.get("x", 0.5), 0.0, 1.0, 0.5)
        item["y"] = _num(item.get("y", 0.5), 0.0, 1.0, 0.5)
        # Il frontend React usa camelCase; _draw_bubble usa snake_case.
        # Accettiamo entrambi per mantenere compatibilita' con eventuali client esistenti.
        item["tail_x"] = _num(item.get("tail_x", item.get("tailX", 0.5)), 0.0, 1.0, 0.5)
        item["tail_y"] = _num(item.get("tail_y", item.get("tailY", 0.5)), 0.0, 1.0, 0.5)
        item["w"] = _num(item.get("w", 0.34), 0.05, 1.0, 0.34)
        font_size = _num(item.get("font_size", item.get("fontSize", 44)), 8.0, 400.0, 44.0)
        item["font_size"] = max(10, round(font_size * scale))
        item["text"] = str(item.get("text", ""))[:500]
        for key in ("color", "fill"):
            if key in item and not _valid_color(item[key]):
                del item[key]  # colore non valido: _draw_bubble usa il predefinito
        mapped.append(item)
    for item in mapped:
        _draw_bubble(draw, panel.size, item)


def _encode_page(page, fmt):
    output = io.BytesIO()
    if fmt == "pdf":
        page.save(output, "PDF", resolution=150.0)
        return Response(content=output.getvalue(), media_type="application/pdf")
    page.save(output, "PNG", optimize=True)
    return Response(content=output.getvalue(), media_type="image/png")


def _compose_diagonal(decoded, bubble_sets, caption_texts):
    n = len(decoded)
    plan = None
    for width in range(DIAG_W, DIAG_MIN_W - 1, -60):
        slant = round(width * DIAG_SLANT)
        photo_h = [max(1, round(width * src.height / src.width)) for src in decoded]
        blocks = [_caption_block(caption_texts[i], width) for i in range(n)]
        comp_h = []
        for i in range(n):
            if blocks[i]:
                # Spazio extra sotto il testo: il taglio obliquo non deve mangiarlo.
                extra = slant + GUTTER if i < n - 1 else 0
                comp_h.append(photo_h[i] + blocks[i]["height"] + extra)
            else:
                comp_h.append(photo_h[i])
        page_h = MARGIN * 2 + sum(comp_h) - slant * (n - 1)
        if page_h <= PAGE_MAX:
            plan = (width, slant, photo_h, blocks, comp_h, page_h)
            break
    if plan is None:
        # Nessuna larghezza rientra nel budget: si compone comunque alla
        # larghezza minima e _fit_page riscala il risultato finale. Cosi'
        # un fumetto lungo con molte didascalie non blocca piu' con un 400.
        plan = (DIAG_MIN_W, round(DIAG_MIN_W * DIAG_SLANT), None, None, None, None)
    width, slant, photo_h, blocks, comp_h, page_h = plan
    if photo_h is None:
        photo_h = [max(1, round(width * src.height / src.width)) for src in decoded]
        blocks = [_caption_block(caption_texts[i], width) for i in range(n)]
        comp_h = []
        for i in range(n):
            if blocks[i]:
                extra = slant + GUTTER if i < n - 1 else 0
                comp_h.append(photo_h[i] + blocks[i]["height"] + extra)
            else:
                comp_h.append(photo_h[i])
        page_h = MARGIN * 2 + sum(comp_h) - slant * (n - 1)

    page = Image.new("RGB", (width + MARGIN * 2, page_h), PAGE_BG)
    half_gap = GUTTER // 2
    inset = 3  # il bordo di 5px sta tutto dentro l'immagine della striscia
    top_y = MARGIN
    for i, source in enumerate(decoded):
        photo = source.resize((width, photo_h[i]), Image.Resampling.LANCZOS)
        _apply_bubbles(photo, source, bubble_sets[i], i)

        comp = Image.new("RGB", (width, comp_h[i]), CAPTION_BG)
        comp.paste(photo, (0, 0))
        block = blocks[i]
        if block:
            draw = ImageDraw.Draw(comp)
            draw.line((0, photo_h[i], width, photo_h[i]), fill=BORDER, width=5)
            ty = photo_h[i] + CAPTION_PAD
            for line in block["lines"]:
                draw.text((CAPTION_PAD, ty), line, font=block["font"], fill=CAPTION_FG)
                ty += block["line_h"]

        # Contorno: bordi alto/basso piatti ai margini della pagina, obliqui tra le strisce.
        if i == 0:
            top_left = top_right = inset
        else:
            top_left, top_right = half_gap, slant + half_gap
        if i == n - 1:
            bottom_left = bottom_right = comp_h[i] - inset
        else:
            bottom_right, bottom_left = comp_h[i] - half_gap, comp_h[i] - slant - half_gap
        points = [(inset, top_left), (width - inset, top_right), (width - inset, bottom_right), (inset, bottom_left)]
        closed = [(x * DIAG_SS, y * DIAG_SS) for x, y in points + [points[0]]]
        big = (width * DIAG_SS, comp_h[i] * DIAG_SS)
        full = Image.new("L", big, 0)
        edge = Image.new("L", big, 0)
        ImageDraw.Draw(full).polygon(closed, fill=255)
        ImageDraw.Draw(full).line(closed, fill=255, width=5 * DIAG_SS, joint="curve")
        ImageDraw.Draw(edge).line(closed, fill=255, width=5 * DIAG_SS, joint="curve")
        full = full.resize(comp.size, Image.Resampling.LANCZOS)
        edge = edge.resize(comp.size, Image.Resampling.LANCZOS)
        comp.paste(Image.new("RGB", comp.size, BORDER), (0, 0), edge)
        page.paste(comp, (MARGIN, top_y), full)
        top_y += comp_h[i] - slant
    return _fit_page(page)


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
        if layout not in ("grid", "grid3", "vertical", "horizontal", "single", "diagonal"):
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
                image = Image.open(io.BytesIO(data))
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(status_code=400, detail="Una foto è troppo grande (max 50 megapixel).")
                # Le foto da smartphone possono avere la rotazione nei metadati EXIF.
                image = ImageOps.exif_transpose(image).convert("RGB")
                image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=400, detail="Una delle immagini non è leggibile.")
            decoded.append(image)

        count = len(decoded)
        if layout == "diagonal":
            return _encode_page(_compose_diagonal(decoded, bubble_sets, caption_texts), fmt)
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

        # Niente errore 400: se anche dopo i tentativi la pagina sfora
        # PAGE_MAX, si compone comunque alle dimensioni calcolate e _fit_page
        # riscala il risultato finito (didascalie incluse, proporzioni intatte).
        page_w = min(page_w, PAGE_MAX * 2)
        page_h = min(page_h, PAGE_MAX * 2)

        page = Image.new("RGB", (page_w, page_h), PAGE_BG)
        page_draw = ImageDraw.Draw(page)

        for index, (source, panel, specs) in enumerate(zip(decoded, fitted, bubble_sets)):
            row, col = divmod(index, cols)
            x = MARGIN + sum(cell_w[:col]) + col * GUTTER
            y = MARGIN + sum(cell_h[:row]) + row * GUTTER

            # Vignetta = la foto stessa, proporzioni originali, zero letterbox
            # bianco: i balloon sono disegnati direttamente sulla foto e le
            # coordinate restano relative all'immagine (niente offset).
            _apply_bubbles(panel, source, specs, index)

            # Foto centrata nella sua cella; il bordo segue la foto, non la cella.
            block_h = panel.height + cap_h[index]
            px = x + (cell_w[col] - panel.width) // 2
            py = y + (cell_h[row] - block_h) // 2
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

        return _encode_page(_fit_page(page), fmt)

    return router
