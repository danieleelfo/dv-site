# image_bubbles.py
# --------------------------------------------------------------------------
# FUMETTI — tab Fumetti di ImageLab (dv-site)
#
# POST /api/image/bubbles
#   multipart: image (1 foto, max 15 MB) + bubbles (JSON)
#   JSON: {"bubbles": [
#     {type, text, x, y, w, font_size, fill, color, tail_x, tail_y}, ...
#   ]}
#   - type: speech | rect | thought | shout
#   - x, y, w, tail_x, tail_y: frazioni 0-1 rispetto all'immagine
#   - font_size: pixel sul PNG finale
#   - fill / color: colori HTML (bolla / testo)
# Disegna i fumetti con Pillow e ritorna il PNG. Nessuna AI, nessun job:
# come /api/image/compose la risposta e' immediata.
# --------------------------------------------------------------------------

import io
import json
import math

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageDraw, ImageFont

MAX_BUBBLES = 20
MAX_BUBBLE_TEXT = 500
MAX_BUBBLE_UPLOAD_BYTES = 15 * 1024 * 1024
BUBBLE_TYPES = ("speech", "rect", "thought", "shout")

_FONT_PATHS = (
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)
_font_cache = {}


def _font(px):
    px = max(10, min(300, int(px)))
    if px not in _font_cache:
        face = None
        for path in _FONT_PATHS:
            try:
                face = ImageFont.truetype(path, px)
                break
            except Exception:
                continue
        if face is None:
            face = ImageFont.load_default()
        _font_cache[px] = face
    return _font_cache[px]


def _font_size(font):
    return getattr(font, "size", 44) or 44


def _frac(value, default=0.5):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, value))


def _color(value, default):
    value = str(value or "").strip()
    if not value.startswith("#"):
        return default
    return value


def _wrap(text, font, max_w):
    lines = []
    for para in str(text).split("\n"):
        words = para.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            candidate = current + " " + word
            if font.getlength(candidate) <= max_w:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def _boundary_point(box, cx, cy, tx, ty):
    # Punto appena dentro il bordo della bolla lungo la retta centro -> target.
    for i in range(1, 201):
        t = i / 200.0
        px = cx + (tx - cx) * t
        py = cy + (ty - cy) * t
        if px <= box[0] or px >= box[2] or py <= box[1] or py >= box[3]:
            k = (i - 1) / 200.0
            return (cx + (tx - cx) * k, cy + (ty - cy) * k)
    return (cx, cy)


def _draw_tail(draw, box, cx, cy, tx, ty, fill, outline, width, thought=False):
    ax, ay = _boundary_point(box, cx, cy, tx, ty)
    dx, dy = tx - ax, ty - ay
    dist = math.hypot(dx, dy)
    if dist < 8:
        return
    length = min(dist, max(60.0, dist * 0.6))
    ux, uy = dx / dist, dy / dist

    if thought:
        # Tre cerchi decrescenti dal bordo verso il punto (nuvola di pensiero).
        for i, frac in enumerate((0.35, 0.6, 0.85)):
            r = max(4.0, width * 1.8 * (1.0 - i * 0.28))
            px = ax + ux * length * frac
            py = ay + uy * length * frac
            draw.ellipse(
                (px - r, py - r, px + r, py + r),
                fill=fill,
                outline=outline,
                width=max(1, width // 2),
            )
        return

    # Triangolo: base leggermente dentro la bolla, punta verso il target.
    bx, by = ax - ux * 12, ay - uy * 12
    base = max(14.0, width * 3.0)
    px, py = -uy, ux
    p1 = (bx + px * base / 2, by + py * base / 2)
    p2 = (bx - px * base / 2, by - py * base / 2)
    tip = (ax + ux * length, ay + uy * length)
    draw.polygon([p1, tip, p2], fill=fill)
    draw.line([p1, tip, p2, p1], fill=outline, width=max(1, width // 2))


def _draw_bubble(draw, size, spec):
    W, H = size
    btype = str(spec.get("type") or "speech")
    if btype not in BUBBLE_TYPES:
        btype = "speech"
    text = str(spec.get("text") or "")[:MAX_BUBBLE_TEXT]
    font = _font(spec.get("font_size") or 44)
    fsize = _font_size(font)
    fill = _color(spec.get("fill"), "#ffffff")
    color = _color(spec.get("color"), "#111111")
    outline = "#111111"
    width = max(2, int(fsize / 12))

    cx = _frac(spec.get("x")) * W
    cy = _frac(spec.get("y")) * H
    bw = max(60, int(_frac(spec.get("w"), 0.35) * W))
    tx = _frac(spec.get("tail_x")) * W
    ty = _frac(spec.get("tail_y")) * H

    lines = _wrap(text, font, bw - fsize * 1.2) if text else [""]
    line_h = fsize * 1.3
    pad_y = fsize * 0.5
    bh = max(60, int(len(lines) * line_h + pad_y * 2))

    x0 = int(cx - bw / 2)
    y0 = int(cy - bh / 2)
    box = (x0, y0, x0 + bw, y0 + bh)

    # La coda viene disegnata prima: la bolla poi ne copre la base.
    _draw_tail(
        draw, box, cx, cy, tx, ty,
        fill, outline, width,
        thought=(btype == "thought"),
    )

    if btype in ("speech", "thought"):
        draw.ellipse(box, fill=fill, outline=outline, width=width)
    elif btype == "rect":
        draw.rounded_rectangle(
            box, radius=max(10, fsize // 2), fill=fill, outline=outline, width=width
        )
    else:  # shout: poligono spigoloso intorno al rettangolo del testo
        rx, ry = bw / 2.0, bh / 2.0
        spikes = max(12, int((bw + bh) / 45))
        pts = []
        for i in range(spikes * 2):
            ang = math.pi * 2 * i / (spikes * 2)
            r = 1.16 if i % 2 == 0 else 1.0
            pts.append((cx + rx * r * math.cos(ang), cy + ry * r * math.sin(ang)))
        draw.polygon(pts, fill=fill)
        draw.line(pts + [pts[0]], fill=outline, width=max(1, width // 2), joint="curve")

    if text:
        draw.multiline_text(
            (cx, cy), "\n".join(lines), font=font, fill=color,
            anchor="mm", align="center",
        )


def build_bubbles_router(verify_admin_token):
    router = APIRouter()

    @router.post("/api/image/bubbles")
    async def image_bubbles(
        authorization: str | None = Header(None),
        image: UploadFile = File(...),
        bubbles: str = Form(...),
    ):
        verify_admin_token(authorization)

        try:
            payload = json.loads(bubbles)
        except ValueError:
            raise HTTPException(status_code=400, detail="JSON dei fumetti non valido.")

        items = payload.get("bubbles") if isinstance(payload, dict) else payload
        if not isinstance(items, list) or not items:
            raise HTTPException(status_code=400, detail="Nessun fumetto da disegnare.")
        if len(items) > MAX_BUBBLES:
            raise HTTPException(
                status_code=400, detail=f"Massimo {MAX_BUBBLES} fumetti."
            )

        data = await image.read()
        if len(data) > MAX_BUBBLE_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="Immagine oltre 15 MB.")

        try:
            img = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception:
            raise HTTPException(status_code=400, detail="Immagine non leggibile.")

        # Limita la RAM: mai oltre 2048px di lato (come /api/image/compose).
        if max(img.size) > 2048:
            img.thumbnail((2048, 2048), Image.LANCZOS)

        draw = ImageDraw.Draw(img)
        for spec in items:
            if isinstance(spec, dict):
                _draw_bubble(draw, img.size, spec)

        buf = io.BytesIO()
        img.save(buf, "PNG")
        return Response(content=buf.getvalue(), media_type="image/png")

    return router
