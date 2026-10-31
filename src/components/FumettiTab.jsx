// Tab Fumetti di ImageLab — 1 foto + fumetti (balloon / rettangolo /
// pensiero / urlo) disegnati lato server con Pillow (POST /api/image/bubbles).
// Nessuna AI: come la modalita' "solo fusione" di Multifoto, la risposta e'
// immediata e torna come PNG.
//
// UX: trascinamento fumetti, coda visibile in preview (tratto / puntini per
// il pensiero), spostamento con le frecce (Shift = passo fine), duplica,
// selezione = porta in primo piano, "usa risultato come nuova foto".

import { useEffect, useRef, useState } from "react";
import ArchivePicker from "./ArchivePicker.jsx";

const API = "https://api.danielevillanova.com";
const TOKEN_KEY = "dv_google_id_token";

// Tipi di fumetto (stessi nomi lato gateway, image_bubbles.py).
const BUBBLE_TYPES = [
  ["speech", "Balloon (ovale)"],
  ["rect", "Rettangolo"],
  ["thought", "Pensiero (nuvola)"],
  ["shout", "Urlo (spigoloso)"],
];

function decodeJwt(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(part).split("").map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
  } catch { return null; }
}
function valid(token) { const p = token ? decodeJwt(token) : null; return !!p?.exp && p.exp * 1000 > Date.now() + 5000; }
function readToken() { try { const t = localStorage.getItem(TOKEN_KEY); return valid(t) ? t : ""; } catch { return ""; } }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

let _nextId = 1;

export default function FumettiTab({ embedded = false } = {}) {
  const [token, setToken] = useState(readToken);
  const canvasRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [natW, setNatW] = useState(1000);
  const [bubbles, setBubbles] = useState([]);
  const [selId, setSelId] = useState(null);
  const [tailMode, setTailMode] = useState(false);
  const [status, setStatus] = useState("idle");
  const [resultUrl, setResultUrl] = useState("");
  const [error, setError] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  const sel = bubbles.find(b => b.id === selId) || null;

  // ------------------------------------------------------------------
  // Auth condivisa con ImageLab (stesso token in localStorage).
  // ------------------------------------------------------------------
  useEffect(() => {
    function onStorage(event) {
      if (event.key === TOKEN_KEY) setToken(readToken());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ------------------------------------------------------------------
  // Frecce: spostano il fumetto selezionato (Shift = passo fine).
  // Canc/Backspace: eliminano il fumetto selezionato.
  // Ignora i tasti quando il focus e' su input/textarea/select.
  // ------------------------------------------------------------------
  useEffect(() => {
    function onKey(e) {
      if (!selId) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(selId); return; }
      const step = e.shiftKey ? 0.002 : 0.01;
      if (e.key === "ArrowLeft") { e.preventDefault(); patch(selId, { x: clamp01(sel.x - step) }); }
      else if (e.key === "ArrowRight") { e.preventDefault(); patch(selId, { x: clamp01(sel.x + step) }); }
      else if (e.key === "ArrowUp") { e.preventDefault(); patch(selId, { y: clamp01(sel.y - step) }); }
      else if (e.key === "ArrowDown") { e.preventDefault(); patch(selId, { y: clamp01(sel.y + step) }); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selId, sel && sel.x, sel && sel.y]);

  // ------------------------------------------------------------------
  // Foto
  // ------------------------------------------------------------------
  function onFile(event) {
    const f = event.target.files && event.target.files[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Il file non è un'immagine."); return; }
    if (f.size > 15 * 1024 * 1024) { setError("Immagine oltre 15 MB."); return; }
    setError("");
    setResultUrl("");
    setStatus("idle");
    const url = URL.createObjectURL(f);
    setFile(f);
    setPreview(url);
    const img = new Image();
    img.onload = () => setNatW(img.naturalWidth || 1000);
    img.src = url;
  }

  // Selezione dall'archivio: entra nello stesso identico stato di un upload.
  function onArchiveSelect(f) {
    if (!f || !f.type.startsWith("image/")) {
      setError("Il file selezionato non è un'immagine.");
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setError("Immagine oltre 15 MB.");
      return;
    }
    setError("");
    setResultUrl("");
    setStatus("idle");
    const url = URL.createObjectURL(f);
    setFile(f);
    setPreview(url);
    const img = new Image();
    img.onload = () => setNatW(img.naturalWidth || 1000);
    img.src = url;
    setShowArchive(false);
  }

  // ------------------------------------------------------------------
  // Fumetti
  // ------------------------------------------------------------------
  function addBubble() {
    const id = _nextId++;
    setBubbles(bs => [...bs, {
      id,
      type: "speech",
      text: "",
      x: 0.5, y: 0.2, w: 0.34,
      fontSize: 44,
      fill: "#ffffff",
      color: "#111111",
      tailX: 0.5, tailY: 0.7,
    }]);
    setSelId(id);
    setTailMode(false);
  }

  function duplicateBubble() {
    if (!sel) return;
    const id = _nextId++;
    setBubbles(bs => [...bs, { ...sel, id, x: clamp01(sel.x + 0.04), y: clamp01(sel.y + 0.06) }]);
    setSelId(id);
    setTailMode(false);
  }

  function patch(id, p) {
    setBubbles(bs => bs.map(b => (b.id === id ? { ...b, ...p } : b)));
  }

  function remove(id) {
    setBubbles(bs => bs.filter(b => b.id !== id));
    if (selId === id) setSelId(null);
  }

  // Selezionare = anche portare in primo piano (z-order).
  function bringToFront(id) {
    setSelId(id);
    setBubbles(bs => {
      const b = bs.find(x => x.id === id);
      return b ? [...bs.filter(x => x.id !== id), b] : bs;
    });
  }

  function onCanvasClick(event) {
    if (!file) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = clamp01((event.clientX - rect.left) / rect.width);
    const fy = clamp01((event.clientY - rect.top) / rect.height);
    if (!sel) return;
    if (tailMode) {
      patch(sel.id, { tailX: fx, tailY: fy });
      setTailMode(false);
    } else {
      patch(sel.id, { x: fx, y: fy });
    }
  }

  // Trascinamento del fumetto (pointer events, funziona anche su touch).
  function onBubblePointerDown(e, b) {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    bringToFront(b.id);
    setTailMode(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cw = rect.width || 1;
    const ch = rect.height || 1;
    const startFx = b.x;
    const startFy = b.y;
    const startCx = e.clientX;
    const startCy = e.clientY;
    const move = (ev) => {
      patch(b.id, {
        x: clamp01(startFx + (ev.clientX - startCx) / cw),
        y: clamp01(startFy + (ev.clientY - startCy) / ch),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // Rapporto tra la larghezza del PNG finale e quella del canvas visibile:
  // serve per mostrare in preview la stessa dimensione relativa del testo.
  function previewScale() {
    const cw = canvasRef.current ? canvasRef.current.clientWidth : 0;
    return cw > 0 ? natW / cw : 4;
  }

  function bubbleStyle(b) {
    const scale = previewScale();
    const fs = Math.max(9, b.fontSize / scale);
    const radius = b.type === "rect" ? "12px" : "50%";
    return {
      position: "absolute",
      left: (b.x * 100) + "%",
      top: (b.y * 100) + "%",
      transform: "translate(-50%, -50%)",
      width: (b.w * 100) + "%",
      minHeight: (fs * 1.6) + "px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      padding: (fs * 0.35) + "px " + (fs * 0.45) + "px",
      background: b.fill,
      color: b.color,
      fontSize: fs + "px",
      lineHeight: 1.3,
      border: "2px solid #111",
      borderRadius: radius,
      cursor: "grab",
      whiteSpace: "pre-wrap",
      boxShadow: b.id === selId ? "0 0 0 3px #3fd0c9" : "none",
      touchAction: "none",
    };
  }

  // ------------------------------------------------------------------
  // Disegno: POST /api/image/bubbles (Pillow sul Mac, no AI)
  // ------------------------------------------------------------------
  async function draw(event) {
    if (event) event.preventDefault();
    if (!file || !token) return;
    const withText = bubbles.filter(b => (b.text || "").trim());
    if (!withText.length) { setError("Aggiungi almeno un fumetto con del testo."); return; }
    setStatus("drawing");
    setError("");
    try {
      // Payload pulito: solo i campi che il server conosce (niente id).
      const clean = withText.map(({ id, ...rest }) => rest);
      const body = new FormData();
      body.append("image", file, file.name);
      body.append("bubbles", JSON.stringify({ bubbles: clean }));
      const res = await fetch(API + "/api/image/bubbles", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body,
      });
      if (!res.ok) {
        let detail = "HTTP " + res.status;
        try {
          const j = await res.json();
          detail = (j && (j.detail || j.error)) || detail;
          if (typeof detail !== "string") detail = JSON.stringify(detail);
        } catch (e) { /* corpo non JSON */ }
        throw new Error(detail);
      }
      const blob = await res.blob();
      setResultUrl(URL.createObjectURL(blob));
      setStatus("done");
    } catch (err) {
      setError(err.message || String(err));
      setStatus("error");
    }
  }

  function downloadResult() {
    if (!resultUrl) return;
    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = "fumetti-" + (file ? file.name.replace(/\.[^.]+$/, "") : "foto") + ".png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // Continua sul risultato: la vignetta finita diventa la nuova foto base
  // (i fumetti restano, per fare altre battute sopra).
  async function useResultAsPhoto() {
    if (!resultUrl) return;
    try {
      const blob = await (await fetch(resultUrl)).blob();
      const f = new File([blob], "fumetti-" + Date.now() + ".png", { type: "image/png" });
      setFile(f);
      const url = URL.createObjectURL(f);
      setPreview(url);
      const img = new Image();
      img.onload = () => setNatW(img.naturalWidth || 1000);
      img.src = url;
      setResultUrl("");
      setStatus("idle");
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  // ------------------------------------------------------------------
  // Login richiesto (gestito dal tab Genera di ImageLab)
  // ------------------------------------------------------------------
  if (!token) {
    return (
      <section className="fb-panel fb-login">
        <h2>Fumetti</h2>
        <p>Accedi con Google dal tab Genera, poi torna qui.</p>
        <style>{FB_STYLES}</style>
      </section>
    );
  }

  return (
    <div className="fb-wrap">
      {!embedded && (
        <header className="fb-header">
          <div>
            <p className="fb-kicker">D. VILLANOVA · IMAGE LAB</p>
            <h1>Fumetti</h1>
            <p className="fb-muted">Carica una foto, aggiungi i fumetti con il testo e Pillow li disegna sul Mac.</p>
          </div>
        </header>
      )}

      <div className="fb-grid">
        {/* ------------------------------------------------------ */}
        {/* FOTO + CANVAS                                           */}
        {/* ------------------------------------------------------ */}
        <section className="fb-panel">
          <h2>1 · Foto</h2>

          <div className="fb-upload">
            <input id="fb-file" type="file" accept="image/*" onChange={onFile} />
            <label htmlFor="fb-file">
              <b>{file ? file.name : "Scegli una foto"}</b>
              <small>PNG/JPG fino a 15 MB</small>
            </label>
            <button type="button" className="fb-btn" onClick={() => setShowArchive(true)}>
              Dall'archivio
            </button>
          </div>

          {preview && (
            <div className="fb-canvas" ref={canvasRef} onClick={onCanvasClick}>
              <img src={preview} alt="foto" draggable={false} />

              {/* Code in preview: tratto dal centro del fumetto alla punta.
                  thought = puntini. Sotto le bolle, così si vede solo fuori. */}
              <svg className="fb-tailsvg" aria-hidden="true">
                {bubbles.map(b => {
                  const len = Math.hypot(b.tailX - b.x, b.tailY - b.y) * 100;
                  if (len < 5) return null;
                  return (
                    <line
                      key={b.id}
                      x1={(b.x * 100) + "%"} y1={(b.y * 100) + "%"}
                      x2={(b.tailX * 100) + "%"} y2={(b.tailY * 100) + "%"}
                      stroke={b.fill}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeDasharray={b.type === "thought" ? "0.1 8" : undefined}
                    />
                  );
                })}
              </svg>

              {bubbles.map(b => (
                <div
                  key={b.id}
                  style={bubbleStyle(b)}
                  onPointerDown={(e) => onBubblePointerDown(e, b)}
                  onClick={(e) => { e.stopPropagation(); bringToFront(b.id); }}
                >
                  {b.text || <span className="fb-empty">Testo…</span>}
                </div>
              ))}
            </div>
          )}

          <p className="fb-hint">
            Trascina i fumetti sulla foto, oppure clic per spostare il selezionato.
            Frecce = spostamento preciso (Shift = fine), Canc = elimina.
            Con "Posiziona coda" attivo, il clic punta la coda (chi parla).
          </p>

          <div className="fb-actions">
            <button type="button" className="fb-btn" onClick={addBubble}>+ Aggiungi fumetto</button>
            {sel && (
              <button
                type="button"
                className={"fb-btn" + (tailMode ? " fb-btn-active" : "")}
                onClick={() => setTailMode(m => !m)}
              >
                {tailMode ? "Clic la punta della coda…" : "Posiziona coda"}
              </button>
            )}
            {sel && (
              <button type="button" className="fb-btn" onClick={duplicateBubble}>Duplica</button>
            )}
            {sel && (
              <button type="button" className="fb-btn fb-btn-danger" onClick={() => remove(sel.id)}>
                Elimina fumetto
              </button>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------ */}
        {/* CONFIGURAZIONE FUMETTO SELEZIONATO                      */}
        {/* ------------------------------------------------------ */}
        <section className="fb-panel">
          <h2>2 · Fumetto selezionato</h2>

          {!sel && (
            <p className="fb-hint">Nessun fumetto selezionato: aggiungine uno o cliccane uno sulla foto.</p>
          )}

          {sel && (
            <form onSubmit={draw} className="fb-form">
              <label className="fb-label" htmlFor={"fb-type-" + sel.id}>Tipo</label>
              <select
                id={"fb-type-" + sel.id}
                className="fb-input"
                value={sel.type}
                onChange={(e) => patch(sel.id, { type: e.target.value })}
              >
                {BUBBLE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>

              <label className="fb-label" htmlFor={"fb-text-" + sel.id}>Testo</label>
              <textarea
                id={"fb-text-" + sel.id}
                className="fb-input fb-text"
                rows={3}
                maxLength={500}
                value={sel.text}
                placeholder="Testo del fumetto…"
                onChange={(e) => patch(sel.id, { text: e.target.value })}
              />

              <label className="fb-label" htmlFor={"fb-w-" + sel.id}>
                Larghezza: {Math.round(sel.w * 100)}%
              </label>
              <input
                id={"fb-w-" + sel.id}
                type="range"
                min="0.08" max="0.9" step="0.01"
                value={sel.w}
                onChange={(e) => patch(sel.id, { w: Number(e.target.value) })}
              />

              <div className="fb-fields">
                <div className="fb-field">
                  <label className="fb-label" htmlFor={"fb-fs-" + sel.id}>Dimensione testo (px)</label>
                  <input
                    id={"fb-fs-" + sel.id}
                    className="fb-input"
                    type="number" min="12" max="200" step="1"
                    value={sel.fontSize}
                    onChange={(e) => patch(sel.id, { fontSize: Number(e.target.value) || 44 })}
                  />
                </div>
                <div className="fb-field">
                  <label className="fb-label" htmlFor={"fb-fill-" + sel.id}>Colore bolla</label>
                  <input
                    id={"fb-fill-" + sel.id}
                    className="fb-input fb-color"
                    type="color"
                    value={sel.fill}
                    onChange={(e) => patch(sel.id, { fill: e.target.value })}
                  />
                </div>
                <div className="fb-field">
                  <label className="fb-label" htmlFor={"fb-color-" + sel.id}>Colore testo</label>
                  <input
                    id={"fb-color-" + sel.id}
                    className="fb-input fb-color"
                    type="color"
                    value={sel.color}
                    onChange={(e) => patch(sel.id, { color: e.target.value })}
                  />
                </div>
              </div>

              <button className="fb-btn fb-primary" type="submit" disabled={!file || status === "drawing"}>
                {status === "drawing" ? "Disegno…" : "Disegna fumetti"}
              </button>
            </form>
          )}

          {error && <div className="fb-error" role="alert">{error}</div>}

          {resultUrl && status === "done" && (
            <div className="fb-result">
              <h3>Risultato</h3>
              <img src={resultUrl} alt="risultato" />
              <div className="fb-actions">
                <button type="button" className="fb-btn fb-primary" onClick={downloadResult}>Scarica PNG</button>
                <button type="button" className="fb-btn" onClick={useResultAsPhoto}>Usa come nuova foto</button>
              </div>
            </div>
          )}

          <footer className="fb-footer">
            Fumetti · disegno: <code>/api/image/bubbles</code> · Pillow sul Mac, no AI
          </footer>
        </section>
      </div>

      {showArchive && (
        <ArchivePicker
          idToken={token}
          onSelect={onArchiveSelect}
          onClose={() => setShowArchive(false)}
        />
      )}

      <style>{FB_STYLES}</style>
    </div>
  );
}

const FB_STYLES = `
.fb-wrap{max-width:1180px;margin:auto}
.fb-header{display:flex;align-items:center;justify-content:space-between;gap:1.2rem;flex-wrap:wrap;padding-bottom:1.2rem;border-bottom:1px solid var(--border,#1f2b35);margin-bottom:1.2rem}
.fb-header h1{font:400 clamp(2rem,4vw,3rem)/1.15 var(--serif,Georgia,serif);margin:.25rem 0}
.fb-kicker{color:var(--accent,#3fd0c9);font-size:.68rem;font-weight:700;letter-spacing:.14em;margin:0 0 .4rem}
.fb-muted{color:var(--ink-dim,#8fa1ac);font-size:.78rem;line-height:1.55}
.fb-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.85fr);gap:1rem;align-items:start}
.fb-panel{min-width:0;padding:1.25rem;border:1px solid var(--border,#1f2b35);border-radius:12px;background:var(--panel,#121a22)}
.fb-panel h2{font-size:1.15rem;margin:0 0 1rem}
.fb-panel h3{font-size:1rem;margin:1rem 0 .6rem}
.fb-upload{display:flex;align-items:center;gap:.8rem;margin-bottom:1rem}
.fb-upload input{max-width:280px;color:var(--ink-dim,#8fa1ac);font-size:.8rem}
.fb-upload label{cursor:pointer}
.fb-upload b{display:block;color:var(--accent,#3fd0c9);font-size:.85rem}
.fb-upload small{display:block;color:var(--ink-dim,#8fa1ac);font-size:.72rem}
.fb-canvas{position:relative;display:inline-block;max-width:100%;border:1px solid var(--border,#33414c);border-radius:9px;overflow:hidden;cursor:crosshair;background:#080c10}
.fb-canvas img{display:block;max-width:100%;max-height:520px;user-select:none;-webkit-user-drag:none}
.fb-tailsvg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}
.fb-empty{opacity:.45;font-style:italic}
.fb-hint{color:var(--ink-dim,#8fa1ac);font-size:.76rem;line-height:1.55;margin:.8rem 0}
.fb-label{display:block;margin:.85rem 0 .4rem;color:var(--ink-dim,#8fa1ac);font-size:.78rem;font-weight:600}
.fb-input{display:block;width:100%;min-width:0;padding:.7rem .8rem;border:1px solid var(--border,#1f2b35);border-radius:7px;background:var(--bg,#0b1015);color:var(--ink,#e7edf1);font:inherit;font-size:.88rem}
.fb-text{min-height:90px;resize:vertical;line-height:1.5}
.fb-fields{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem}
.fb-field input[type=range]{width:100%;accent-color:var(--accent,#3fd0c9)}
.fb-color{padding:.25rem;height:2.6rem}
.fb-btn{display:inline-flex;align-items:center;justify-content:center;padding:.6rem .9rem;border:1px solid var(--border,#1f2b35);border-radius:6px;background:transparent;color:var(--ink,#e7edf1);font:inherit;font-size:.8rem;font-weight:600;cursor:pointer}
.fb-btn:disabled{opacity:.45;cursor:not-allowed}
.fb-btn-active{border-color:var(--accent,#3fd0c9);color:var(--accent,#3fd0c9)}
.fb-btn-danger{border-color:#7f1d1d;color:#fca5a5}
.fb-primary{border-color:var(--accent,#3fd0c9);background:var(--accent,#3fd0c9);color:#071212}
.fb-actions{display:flex;align-items:center;flex-wrap:wrap;gap:.6rem;margin-top:1rem}
.fb-form .fb-primary{margin-top:1.1rem;width:100%}
.fb-error{margin-top:1rem;padding:.9rem;border:1px solid #7f1d1d;border-radius:8px;background:#7f1d1d20;color:#fca5a5;font-size:.82rem;overflow-wrap:anywhere}
.fb-result img{display:block;width:100%;max-height:520px;object-fit:contain;border-radius:8px;background:#080c10}
.fb-footer{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1.3rem;padding-top:.9rem;border-top:1px solid var(--border,#1f2b35);font-size:.72rem;color:var(--ink-dim,#8fa1ac)}
.fb-footer code{color:var(--ink,#e7edf1)}
.fb-login{max-width:550px;margin:1.5rem auto;text-align:center}
.fb-login p{color:var(--ink-dim,#8fa1ac);font-size:.82rem}
@media(max-width:850px){.fb-grid{grid-template-columns:1fr}.fb-fields{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.fb-fields{grid-template-columns:1fr}.fb-panel{padding:.9rem}}
`;
