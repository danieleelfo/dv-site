// Comics Editor: pagina multi-vignetta, balloon per foto, riordino mobile.
import { useEffect, useRef, useState } from "react";
import ArchivePicker from "./ArchivePicker.jsx";
import { clearComicsDraft, loadComicsDraft, saveComicsDraft } from "../utils/comicsDraft.js";

const API = "https://api.danielevillanova.com";
const TOKEN_KEY = "dv_google_id_token";
const MAX_PANELS = 12;
const TYPES = [
  ["speech", "Balloon"],
  ["rect", "Rettangolo"],
  ["thought", "Pensiero"],
  ["shout", "Urlo"],
];
let nextPanelId = 1;
let nextBubbleId = 1;

function decodeJwt(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(part).split("").map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
  } catch { return null; }
}
function valid(token) { const p = token ? decodeJwt(token) : null; return !!p?.exp && p.exp * 1000 > Date.now() + 5000; }
function readToken() { try { const t = localStorage.getItem(TOKEN_KEY); return valid(t) ? t : ""; } catch { return ""; } }
function clamp(v) { return Math.max(0, Math.min(1, v)); }

function makePanel(file, source = null, saved = null) {
  const preview = URL.createObjectURL(file);
  return {
    id: saved?.id ?? nextPanelId++,
    file,
    preview,
    bubbles: saved?.bubbles || [],
    archiveId: source?.id ?? saved?.archiveId ?? null,
  };
}
function makeBubble() {
  return {
    id: nextBubbleId++, type: "speech", text: "",
    x: 0.5, y: 0.2, w: 0.34, fontSize: 44,
    fill: "#ffffff", color: "#111111", tailX: 0.5, tailY: 0.7,
  };
}

export default function FumettiTab({ embedded = false } = {}) {
  const [token, setToken] = useState(readToken);
  const [panels, setPanels] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [layout, setLayout] = useState("grid");
  const [draftReady, setDraftReady] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const draftKey = (() => {
    const email = decodeJwt(token)?.email || "local";
    return "comics:" + email.toLowerCase();
  })();
  const [selectedBubbleId, setSelectedBubbleId] = useState(null);
  const [tailMode, setTailMode] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  const active = panels.find(p => p.id === activeId) || panels[0] || null;
  const bubbles = active?.bubbles || [];
  const selectedBubble = bubbles.find(b => b.id === selectedBubbleId) || null;

  useEffect(() => {
    function onStorage(e) { if (e.key === TOKEN_KEY) setToken(readToken()); }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Ripristina la bozza dopo refresh: gli originali GraDV vengono
  // scaricati nuovamente tramite ID; le foto locali arrivano da IndexedDB.
  useEffect(() => {
    let cancelled = false;
    setDraftReady(false);
    setDraftMessage("");

    async function restoreDraft() {
      try {
        const saved = await loadComicsDraft(draftKey);
        if (cancelled) return;
        if (!saved || !Array.isArray(saved.panels)) {
          setDraftReady(true);
          return;
        }

        const restored = [];
        for (const item of saved.panels) {
          if (cancelled) return;
          let blob = item.blob || null;

          if (item.archiveId && token) {
            try {
              const response = await fetch(
                API + "/api/gradv/archive/" + encodeURIComponent(item.archiveId) + "/image",
                { headers: { Authorization: "Bearer " + token } }
              );
              if (response.ok) blob = await response.blob();
            } catch {
              // Se l'archivio non risponde, prova la copia locale se presente.
            }
          }

          if (!blob) {
            setDraftMessage("Una foto della bozza non è recuperabile: potrebbe essere stata rimossa dall'archivio.");
            continue;
          }

          const type = blob.type || item.type || "image/png";
          const file = new File([blob], item.name || ("vignetta-" + (restored.length + 1) + ".png"), {
            type,
            lastModified: item.lastModified || Date.now(),
          });
          restored.push(makePanel(file, { id: item.archiveId }, item));
        }

        if (cancelled) {
          restored.forEach(panel => URL.revokeObjectURL(panel.preview));
          return;
        }
        panels.forEach(panel => { if (panel.preview) URL.revokeObjectURL(panel.preview); });
        setPanels(restored);
        setActiveId(restored.some(p => p.id === saved.activeId) ? saved.activeId : (restored[0]?.id ?? null));
        setLayout(saved.layout || "grid");
        const panelIds = restored.map(p => Number(p.id) || 0);
        const bubbleIds = restored.flatMap(p => p.bubbles || []).map(b => Number(b.id) || 0);
        nextPanelId = Math.max(nextPanelId, ...panelIds, 0) + 1;
        nextBubbleId = Math.max(nextBubbleId, ...bubbleIds, 0) + 1;
      } catch (err) {
        setDraftMessage("Ripristino bozza non riuscito: " + (err.message || String(err)));
      } finally {
        if (!cancelled) setDraftReady(true);
      }
    }

    restoreDraft();
    return () => { cancelled = true; };
  }, [draftKey, token]);

  // Autosalvataggio: Blob delle foto locali + ID delle immagini GraDV,
  // ordine, balloon e layout. Non vengono salvati URL temporanei o PNG finali.
  useEffect(() => {
    if (!draftReady) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        if (!panels.length) {
          await clearComicsDraft(draftKey);
          setDraftMessage("");
          return;
        }
        await saveComicsDraft(draftKey, {
          layout,
          activeId,
          panels: panels.map(panel => ({
            id: panel.id,
            name: panel.file.name,
            type: panel.file.type,
            lastModified: panel.file.lastModified,
            blob: panel.archiveId ? null : panel.file,
            archiveId: panel.archiveId || null,
            bubbles: panel.bubbles,
          })),
        });
        setDraftMessage("Bozza salvata automaticamente su questo dispositivo.");
      } catch (err) {
        setDraftMessage("Salvataggio locale non disponibile: " + (err.message || String(err)));
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draftReady, draftKey, panels, activeId, layout]);

  useEffect(() => () => {
    panels.forEach(p => { if (p.preview) URL.revokeObjectURL(p.preview); });
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  }, []);

  function addFiles(fileList, archiveItems = []) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const validFiles = incoming.filter(f => f.type.startsWith("image/") && f.size <= 15 * 1024 * 1024);
    const rejected = incoming.length - validFiles.length;
    const room = MAX_PANELS - panels.length;
    const accepted = validFiles.slice(0, Math.max(0, room));
    if (rejected) setError("Alcuni file non sono immagini o superano 15 MB.");
    else if (validFiles.length > room) setError("Massimo " + MAX_PANELS + " vignette.");
    else setError("");
    if (!accepted.length) return;
    const created = accepted.map((file, index) => makePanel(file, archiveItems[index] || null));
    setPanels(old => [...old, ...created]);
    setActiveId(created[0].id);
    setSelectedBubbleId(null);
    setResultUrl("");
    setStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onArchiveSelect(files, selectedItems = []) {
    addFiles(files, selectedItems);
    setShowArchive(false);
  }

  function updateActive(updater) {
    if (!active) return;
    setPanels(old => old.map(p => p.id === active.id
      ? { ...p, bubbles: typeof updater === "function" ? updater(p.bubbles) : updater }
      : p));
    setResultUrl("");
    setStatus("idle");
  }

  function addBubble() {
    const b = makeBubble();
    updateActive(old => [...old, b]);
    setSelectedBubbleId(b.id);
    setTailMode(false);
  }
  function patchBubble(id, patch) {
    updateActive(old => old.map(b => b.id === id ? { ...b, ...patch } : b));
  }
  function removeBubble(id) {
    updateActive(old => old.filter(b => b.id !== id));
    if (selectedBubbleId === id) setSelectedBubbleId(null);
  }
  function removePanel(id) {
    const removed = panels.find(p => p.id === id);
    if (removed?.preview) URL.revokeObjectURL(removed.preview);
    const next = panels.filter(p => p.id !== id);
    setPanels(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
    setSelectedBubbleId(null);
    setResultUrl("");
    setStatus("idle");
  }
  function movePanel(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= panels.length) return;
    const next = [...panels];
    [next[index], next[target]] = [next[target], next[index]];
    setPanels(next);
    setResultUrl("");
    setStatus("idle");
  }
  function replacePanel(id, file) {
    if (!file || !file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) {
      setError("Scegli un'immagine valida fino a 15 MB.");
      return;
    }
    const preview = URL.createObjectURL(file);
    setPanels(old => old.map(p => {
      if (p.id !== id) return p;
      URL.revokeObjectURL(p.preview);
      return { ...p, file, preview, bubbles: [] };
    }));
    setActiveId(id);
    setSelectedBubbleId(null);
    setResultUrl("");
    setStatus("idle");
    setError("");
  }

  function onCanvasClick(e) {
    if (!active || !selectedBubble) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width);
    const y = clamp((e.clientY - r.top) / r.height);
    if (tailMode) {
      patchBubble(selectedBubble.id, { tailX: x, tailY: y });
      setTailMode(false);
    } else patchBubble(selectedBubble.id, { x, y });
  }

  function bubbleStyle(b) {
    const canvasWidth = canvasRef.current?.clientWidth || 360;
    const scale = Math.max(1, (active?.file ? 760 / canvasWidth : 2));
    const fs = Math.max(9, b.fontSize / scale);
    return {
      position: "absolute", left: (b.x * 100) + "%", top: (b.y * 100) + "%",
      transform: "translate(-50%,-50%)", width: (b.w * 100) + "%",
      minHeight: (fs * 1.6) + "px", display: "flex", alignItems: "center",
      justifyContent: "center", textAlign: "center", padding: (fs * .35) + "px",
      background: b.fill, color: b.color, fontSize: fs + "px", lineHeight: 1.25,
      border: "2px solid #111", borderRadius: b.type === "rect" ? "10px" : "50%",
      whiteSpace: "pre-wrap", cursor: "grab", touchAction: "none",
      boxShadow: b.id === selectedBubbleId ? "0 0 0 3px #3fd0c9" : "none",
    };
  }
  function startBubbleDrag(e, bubble) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedBubbleId(bubble.id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX, sy = e.clientY, ox = bubble.x, oy = bubble.y;
    const move = ev => patchBubble(bubble.id, {
      x: clamp(ox + (ev.clientX - sx) / rect.width),
      y: clamp(oy + (ev.clientY - sy) / rect.height),
    });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  async function generate(e) {
    e?.preventDefault();
    if (!panels.length || !token || status === "drawing") return;
    setStatus("drawing");
    setError("");
    try {
      const body = new FormData();
      panels.forEach(p => body.append("images", p.file, p.file.name));
      body.append("layout", layout);
      body.append("bubbles", JSON.stringify(panels.map(p =>
        p.bubbles.filter(b => (b.text || "").trim()).map(({ id, ...b }) => b)
      )));
      const response = await fetch(API + "/api/image/comic-page", {
        method: "POST", headers: { Authorization: "Bearer " + token }, body,
      });
      if (!response.ok) {
        let message = "HTTP " + response.status;
        try { const data = await response.json(); message = data.detail || message; } catch {}
        throw new Error(typeof message === "string" ? message : JSON.stringify(message));
      }
      const blob = await response.blob();
      setResultUrl(URL.createObjectURL(blob));
      setStatus("done");
    } catch (err) {
      setError(err.message || String(err));
      setStatus("error");
    }
  }

  function download() {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = "fumetto-completo.png";
    document.body.appendChild(a); a.click(); a.remove();
  }

  if (!token) return <section className="fb-panel"><h2>Comics Editor</h2><p>Accedi con Google dal tab Genera, poi torna qui.</p><style>{STYLES}</style></section>;

  return (
    <div className="fb-wrap">
      {!embedded && <header className="fb-header"><div><p className="fb-kicker">D. VILLANOVA · IMAGE LAB</p><h1>Comics Editor</h1><p className="fb-muted">Componi una pagina a fumetti con più foto, balloon e ordine personalizzato.</p></div></header>}
      <section className="fb-panel">
        <h2>1 · Le tue vignette <small>({panels.length}/{MAX_PANELS})</small></h2>
        {draftMessage && <p className="fb-hint" role="status">{draftMessage}</p>}
        <div className="fb-upload">
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e => addFiles(e.target.files)} />
          <button type="button" className="fb-btn" disabled={panels.length >= MAX_PANELS} onClick={() => fileInputRef.current?.click()}>+ Aggiungi foto</button>
          <button type="button" className="fb-btn" disabled={panels.length >= MAX_PANELS} onClick={() => setShowArchive(true)}>Dall'archivio</button>
        </div>
        <p className="fb-hint">Puoi aggiungere foto in momenti diversi. Ordine di lettura da sinistra a destra e dall'alto in basso.</p>
        {panels.length > 0 && <div className="fb-panel-list">
          {panels.map((p, i) => <article key={p.id} className={"fb-panel-card" + (p.id === active?.id ? " is-active" : "")}>
            <button type="button" className="fb-panel-select" onClick={() => { setActiveId(p.id); setSelectedBubbleId(null); setTailMode(false); }}>
              <img src={p.preview} alt={"Vignetta " + (i + 1)} />
              <span><b>Vignetta {i + 1}</b><small>{p.file.name}</small><small>{p.bubbles.filter(b => b.text.trim()).length} balloon</small></span>
            </button>
            <div className="fb-order">
              <button type="button" onClick={() => movePanel(i, -1)} disabled={i === 0} aria-label="Sposta su">↑</button>
              <button type="button" onClick={() => movePanel(i, 1)} disabled={i === panels.length - 1} aria-label="Sposta giù">↓</button>
              <label className="fb-btn fb-mini">Sostituisci<input type="file" accept="image/*" onChange={e => { replacePanel(p.id, e.target.files?.[0]); e.target.value = ""; }} /></label>
              <button type="button" className="fb-btn fb-danger" onClick={() => removePanel(p.id)}>Elimina</button>
            </div>
          </article>)}
        </div>}
      </section>

      {active && <div className="fb-grid">
        <section className="fb-panel">
          <h2>2 · Modifica vignetta {panels.findIndex(p => p.id === active.id) + 1}</h2>
          <div className="fb-canvas" ref={canvasRef} onClick={onCanvasClick}>
            <img src={active.preview} alt="Vignetta selezionata" draggable={false} />
            <svg className="fb-tailsvg" aria-hidden="true">{bubbles.map(b => <line key={b.id}
              x1={(b.x * 100) + "%"} y1={(b.y * 100) + "%"} x2={(b.tailX * 100) + "%"} y2={(b.tailY * 100) + "%"}
              stroke={b.fill} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={b.type === "thought" ? "0.1 8" : undefined} />)}</svg>
            {bubbles.map(b => <div key={b.id} style={bubbleStyle(b)} onPointerDown={e => startBubbleDrag(e, b)}
              onClick={e => { e.stopPropagation(); setSelectedBubbleId(b.id); }}>{b.text || <span className="fb-empty">Testo…</span>}</div>)}
          </div>
          <p className="fb-hint">Seleziona un balloon e trascinalo sulla foto. Tocca "Posiziona coda" e poi la foto per indicare chi parla.</p>
          <div className="fb-actions">
            <button type="button" className="fb-btn" onClick={addBubble}>+ Balloon</button>
            {selectedBubble && <button type="button" className={"fb-btn" + (tailMode ? " fb-btn-active" : "")} onClick={() => setTailMode(v => !v)}>{tailMode ? "Tocca la punta…" : "Posiziona coda"}</button>}
            {selectedBubble && <button type="button" className="fb-btn fb-danger" onClick={() => removeBubble(selectedBubble.id)}>Elimina balloon</button>}
          </div>
        </section>
        <section className="fb-panel">
          <h2>3 · Balloon selezionato</h2>
          {!selectedBubble && <p className="fb-hint">Aggiungi un balloon o selezionane uno sulla foto.</p>}
          {selectedBubble && <div className="fb-form">
            <label className="fb-label">Tipo</label>
            <select className="fb-input" value={selectedBubble.type} onChange={e => patchBubble(selectedBubble.id, { type: e.target.value })}>{TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
            <label className="fb-label">Testo</label>
            <textarea className="fb-input fb-text" rows={3} maxLength={500} value={selectedBubble.text} placeholder="Scrivi il testo…" onChange={e => patchBubble(selectedBubble.id, { text: e.target.value })} />
            <label className="fb-label">Larghezza: {Math.round(selectedBubble.w * 100)}%</label>
            <input type="range" min=".08" max=".9" step=".01" value={selectedBubble.w} onChange={e => patchBubble(selectedBubble.id, { w: Number(e.target.value) })} />
            <div className="fb-fields">
              <div className="fb-field"><label className="fb-label">Dimensione testo</label><input className="fb-input" type="number" min="12" max="200" value={selectedBubble.fontSize} onChange={e => patchBubble(selectedBubble.id, { fontSize: Number(e.target.value) || 44 })} /></div>
              <div className="fb-field"><label className="fb-label">Sfondo</label><input className="fb-input fb-color" type="color" value={selectedBubble.fill} onChange={e => patchBubble(selectedBubble.id, { fill: e.target.value })} /></div>
              <div className="fb-field"><label className="fb-label">Testo</label><input className="fb-input fb-color" type="color" value={selectedBubble.color} onChange={e => patchBubble(selectedBubble.id, { color: e.target.value })} /></div>
            </div>
          </div>}
        </section>
      </div>}

      <section className="fb-panel">
        <h2>4 · Pagina finale</h2>
        <div className="fb-layouts"><label>Impaginazione <select className="fb-input" value={layout} onChange={e => setLayout(e.target.value)}><option value="grid">Griglia (2 colonne)</option><option value="vertical">Verticale (una colonna)</option><option value="horizontal">Orizzontale (una riga)</option></select></label></div>
        <button type="button" className="fb-btn fb-primary" disabled={!panels.length || status === "drawing"} onClick={generate}>{status === "drawing" ? "Composizione…" : "Genera fumetto completo"}</button>
        {error && <div className="fb-error" role="alert">{error}</div>}
        {resultUrl && status === "done" && <div className="fb-result"><h3>Anteprima fumetto completo</h3><img src={resultUrl} alt="Pagina a fumetti completa" /><button type="button" className="fb-btn fb-primary" onClick={download}>Scarica PNG</button></div>}
        <footer className="fb-footer">Comics Editor · Pillow sul Mac · fino a {MAX_PANELS} vignette</footer>
      </section>

      {showArchive && <ArchivePicker idToken={token} multiSelect onSelect={onArchiveSelect} onClose={() => setShowArchive(false)} />}
      <style>{STYLES}</style>
    </div>
  );
}

const STYLES = `
.fb-wrap{max-width:1180px;margin:auto;display:grid;gap:1rem}
.fb-header{padding-bottom:1rem;border-bottom:1px solid var(--border,#1f2b35)}
.fb-header h1{font:400 clamp(2rem,4vw,3rem)/1.15 var(--serif,Georgia,serif);margin:.25rem 0}
.fb-kicker{color:var(--accent,#3fd0c9);font-size:.68rem;font-weight:700;letter-spacing:.14em;margin:0 0 .4rem}
.fb-muted,.fb-hint{color:var(--ink-dim,#8fa1ac);font-size:.78rem;line-height:1.55}
.fb-panel{min-width:0;padding:1.1rem;border:1px solid var(--border,#1f2b35);border-radius:12px;background:var(--panel,#121a22);color:var(--ink,#e7edf1)}
.fb-panel h2{font-size:1.08rem;margin:0 0 .9rem}.fb-panel h2 small{color:var(--ink-dim,#8fa1ac);font-weight:400}
.fb-upload,.fb-actions,.fb-order{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;margin:.6rem 0}
.fb-upload input[type=file]{max-width:220px;font-size:.75rem}
.fb-btn{padding:.58rem .8rem;border:1px solid var(--border,#33414c);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:.78rem;cursor:pointer}
.fb-btn:disabled{opacity:.4;cursor:not-allowed}.fb-primary{background:var(--accent,#3fd0c9);border-color:var(--accent,#3fd0c9);color:#071212;font-weight:700}
.fb-danger{color:#fca5a5}.fb-mini{position:relative;overflow:hidden}.fb-mini input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}
.fb-panel-list{display:grid;gap:.55rem;margin-top:.8rem}
.fb-panel-card{display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.5rem;border:1px solid var(--border,#26333e);border-radius:9px}
.fb-panel-card.is-active{border-color:var(--accent,#3fd0c9)}
.fb-panel-select{display:flex;align-items:center;gap:.7rem;min-width:0;border:0;background:none;color:inherit;text-align:left;cursor:pointer}
.fb-panel-select img{width:76px;height:64px;object-fit:cover;border-radius:6px;background:#080c10}
.fb-panel-select span{display:grid;gap:.15rem;min-width:0}.fb-panel-select b{font-size:.82rem}.fb-panel-select small{font-size:.68rem;color:var(--ink-dim,#8fa1ac);overflow-wrap:anywhere}
.fb-order{justify-content:flex-end;margin:0}.fb-order>button:not(.fb-btn){width:34px;height:34px;border:1px solid var(--border,#33414c);border-radius:7px;background:transparent;color:inherit;font-size:1rem}.fb-order button:disabled{opacity:.3}
.fb-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,.8fr);gap:1rem;align-items:start}
.fb-canvas{position:relative;display:block;width:100%;overflow:hidden;border:1px solid var(--border,#33414c);border-radius:9px;background:#080c10;cursor:crosshair}
.fb-canvas>img{display:block;width:100%;max-height:650px;object-fit:contain;user-select:none;-webkit-user-drag:none}
.fb-tailsvg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.fb-empty{opacity:.65;font-size:.8em}.fb-form{display:grid;gap:.55rem}
.fb-label{display:block;margin-top:.4rem;color:var(--ink-dim,#9aabb5);font-size:.74rem}
.fb-input{width:100%;padding:.65rem .7rem;border:1px solid var(--border,#33414c);border-radius:7px;background:var(--bg,#0b1015);color:inherit;font:inherit;font-size:.82rem}
.fb-text{resize:vertical}.fb-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55rem}.fb-field{min-width:0}.fb-color{height:40px;padding:.2rem}
.fb-result{display:grid;gap:.7rem;margin-top:1rem}.fb-result img{display:block;max-width:100%;max-height:75vh;object-fit:contain;border:1px solid var(--border,#33414c);border-radius:8px}
.fb-error{margin:.8rem 0;padding:.7rem;border:1px solid #7f1d1d;border-radius:8px;background:#7f1d1d20;color:#fca5a5;font-size:.8rem;overflow-wrap:anywhere}
.fb-footer{margin-top:1rem;color:var(--ink-dim,#8fa1ac);font-size:.68rem}.fb-layouts{max-width:320px;margin-bottom:.8rem}
@media(max-width:700px){.fb-grid{grid-template-columns:1fr}.fb-panel{padding:.8rem}.fb-panel-card{align-items:flex-start}.fb-order{gap:.3rem}.fb-order .fb-btn{padding:.48rem .55rem}.fb-fields{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;
