// src/components/ArchivePicker.jsx
// Picker riutilizzabile per selezionare immagini dall'archivio principale GraDV.
// Carica miniature paginando lato server; alla selezione restituisce un File
// originale al componente chiamante. Non modifica mai il database.

import { useCallback, useEffect, useState } from "react";

const API = "https://api.danielevillanova.com";
const PAGE_SIZE = 24;

async function readJson(response) {
  const text = await response.text().catch(() => "");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Risposta non JSON dal gateway (HTTP " + response.status + "): " +
      (text.slice(0, 120) || "corpo vuoto")
    );
  }
  if (!response.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : "HTTP " + response.status);
  }
  return data;
}

function formatDate(value) {
  if (!value) return "—";
  const text = String(value);
  const date = new Date(text.includes("T") ? text : text.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ArchivePicker({ idToken, onSelect, onClose, multiSelect = false }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [thumbs, setThumbs] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState(null);\n  const [selectedIds, setSelectedIds] = useState([]);\n  const [selectedRows, setSelectedRows] = useState({});
  const [error, setError] = useState("");

  const revokeThumbs = useCallback((map) => {
    Object.values(map || {}).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const loadArchive = useCallback(async (targetPage = 1, targetQuery = "") => {
    if (!idToken) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        page_size: String(PAGE_SIZE),
      });
      if (targetQuery.trim()) params.set("q", targetQuery.trim());

      const response = await fetch(`${API}/api/gradv/archive?${params}`, {
        headers: { Authorization: "Bearer " + idToken },
      });
      const data = await readJson(response);
      const rows = Array.isArray(data.items) ? data.items : [];
      setItems(rows);
      setTotal(Number(data.total || 0));
      setPages(Math.max(1, Number(data.pages || 1)));
      setPage(Number(data.page || targetPage));

      const nextThumbs = {};
      await Promise.all(rows.map(async (item) => {
        try {
          const imageResponse = await fetch(
            `${API}/api/gradv/archive/${item.id}/image?thumbnail=true`,
            { headers: { Authorization: "Bearer " + idToken } }
          );
          if (!imageResponse.ok) throw new Error("HTTP " + imageResponse.status);
          nextThumbs[item.id] = URL.createObjectURL(await imageResponse.blob());
        } catch {
          // Una miniatura non disponibile non blocca il picker.
        }
      }));
      setThumbs((old) => {
        revokeThumbs(old);
        return nextThumbs;
      });
    } catch (err) {
      setError(err.message || String(err));
      setItems([]);
      setTotal(0);
      setPages(1);
      setThumbs((old) => {
        revokeThumbs(old);
        return {};
      });
    } finally {
      setLoading(false);
    }
  }, [idToken, revokeThumbs]);

  useEffect(() => {
    loadArchive(1, "");
  }, [loadArchive]);

  useEffect(() => () => revokeThumbs(thumbs), [thumbs, revokeThumbs]);

  function toggleSelected(id) {\n    const item = items.find(row => row.id === id);\n    setSelectedIds(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);\n    setSelectedRows(old => { const next = { ...old }; if (next[id]) delete next[id]; else if (item) next[id] = item; return next; });\n  }\n\n  async function addSelected() {\n    if (!selectedIds.length || selectingId !== null) return;\n    setSelectingId(-1);\n    setError(\"\");\n    try {\n      const selectedItems = selectedIds.map(id => selectedRows[id]).filter(Boolean);\n      const files = await Promise.all(selectedItems.map(async item => {\n        const response = await fetch(\`${API}/api/gradv/archive/${item.id}/image\`, { headers: { Authorization: \"Bearer \" + idToken } });\n        if (!response.ok) throw new Error(\"Impossibile scaricare l'immagine #\" + item.id);\n        const blob = await response.blob();\n        const mime = blob.type || \"image/png\";\n        const extension = mime.includes(\"jpeg\") || mime.includes(\"jpg\") ? \"jpg\" : \"png\";\n        return new File([blob], \`gradv-${item.id}.${extension}\`, { type: mime });\n      }));\n      onSelect(files, selectedItems);\n    } catch (err) {\n      setError(err.message || String(err));\n      setSelectingId(null);\n    }\n  }\n\n  async function selectImage(item) {
    if (selectingId !== null) return;
    setSelectingId(item.id);
    setError("");
    try {
      const response = await fetch(`${API}/api/gradv/archive/${item.id}/image`, {
        headers: { Authorization: "Bearer " + idToken },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Impossibile scaricare l'immagine (HTTP " + response.status + ")");
      }
      const blob = await response.blob();
      const mime = blob.type || "image/png";
      const extension = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
      const file = new File([blob], `gradv-${item.id}.${extension}`, { type: mime });
      onSelect(file, item);
    } catch (err) {
      setError(err.message || String(err));
      setSelectingId(null);
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    setQuery(searchInput);
    loadArchive(1, searchInput);
  }

  return (
    <div className="ap-overlay" role="presentation" onClick={onClose}>
      <section className="ap-modal" role="dialog" aria-modal="true"
        aria-label="Seleziona una foto dall'archivio GraDV"
        onClick={(event) => event.stopPropagation()}>
        <header className="ap-header">
          <div>
            <p className="ap-eyebrow">GRADV · ARCHIVIO PRINCIPALE</p>
            <h2>Dall'archivio</h2>
            <p className="ap-sub">{total.toLocaleString()} immagini · seleziona una foto per usarla nei fumetti</p>
          </div>
          <button type="button" className="ap-close" onClick={onClose} disabled={selectingId !== null}>✕</button>
        </header>

        <form className="ap-search" onSubmit={submitSearch}>
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Cerca nel prompt…" aria-label="Cerca nel prompt" />
          <button className="ap-btn ap-primary" type="submit" disabled={loading || selectingId !== null}>Cerca</button>
          {query && (
            <button className="ap-btn" type="button" disabled={loading || selectingId !== null}
              onClick={() => { setSearchInput(""); setQuery(""); loadArchive(1, ""); }}>
              Reset
            </button>
          )}
          <span className="ap-count">{PAGE_SIZE} per pagina</span>
        </form>

        {error && <div className="ap-error" role="alert">{error}</div>}
        {selectingId !== null && (
          <div className="ap-selecting">Scarico l'originale #{selectingId}…</div>
        )}
        {loading && <div className="ap-loading">Caricamento archivio…</div>}
        {!loading && items.length === 0 && !error && <p className="ap-empty">Nessuna immagine trovata.</p>}

        <div className="ap-grid">
          {items.map((item) => (
            <button type="button" key={item.id} className={"ap-card" + (selectedIds.includes(item.id) ? " ap-card-selected" : "")}
              onClick={() => multiSelect ? toggleSelected(item.id) : selectImage(item)} disabled={selectingId !== null}
              title={item.prompt || "Immagine #" + item.id}>
              <span className="ap-thumb">
                {thumbs[item.id] ? <img src={thumbs[item.id]} alt={item.prompt || "GraDV #" + item.id} /> : "…"}
              </span>
              <span className="ap-meta"><b>#{item.id}</b><span>{item.width} × {item.height}</span>{multiSelect && <span className="ap-check">{selectedIds.includes(item.id) ? "✓" : "＋"}</span>}</span>
              <span className="ap-prompt">{item.prompt || "Prompt non disponibile"}</span>
              <small>{formatDate(item.created_at)}</small>
            </button>
          ))}
        </div>

        {multiSelect && <div className=\"ap-footer-actions\"><span>{selectedIds.length} selezionate</span><button type=\"button\" className=\"ap-btn ap-primary\" disabled={!selectedIds.length || selectingId !== null} onClick={addSelected}>{selectingId === -1 ? \"Scarico…\" : \"Aggiungi selezionate\"}</button></div>}\n\n        {pages > 1 && (
          <nav className="ap-pagination" aria-label="Paginazione archivio">
            <button type="button" className="ap-btn" disabled={page <= 1 || loading || selectingId !== null}
              onClick={() => loadArchive(page - 1, query)}>← Precedente</button>
            <span>Pagina <b>{page}</b> di <b>{pages}</b></span>
            <button type="button" className="ap-btn" disabled={page >= pages || loading || selectingId !== null}
              onClick={() => loadArchive(page + 1, query)}>Successiva →</button>
          </nav>
        )}
      </section>

      <style>{ARCHIVE_PICKER_STYLES}</style>
    </div>
  );
}

const ARCHIVE_PICKER_STYLES = `
.ap-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(3,7,11,.88);backdrop-filter:blur(8px)}
.ap-modal{display:flex;flex-direction:column;gap:.85rem;width:min(1120px,100%);max-height:94vh;overflow:auto;padding:1.1rem;border:1px solid var(--border,#1f2b35);border-radius:14px;background:var(--panel,#121a22);color:var(--ink,#e7edf1);box-shadow:0 24px 90px #0009}
.ap-header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}
.ap-header h2{margin:.2rem 0;font-size:1.3rem}
.ap-eyebrow{margin:0;color:var(--accent,#3fd0c9);font-size:.68rem;font-weight:700;letter-spacing:.13em}
.ap-sub{margin:0;color:var(--ink-dim,#8fa1ac);font-size:.78rem}
.ap-close{width:36px;height:36px;border:1px solid var(--border,#1f2b35);border-radius:8px;background:transparent;color:inherit;font-size:1rem;cursor:pointer}
.ap-search{display:flex;align-items:center;flex-wrap:wrap;gap:.55rem}
.ap-search input{flex:1;min-width:180px;padding:.65rem .75rem;border:1px solid var(--border,#1f2b35);border-radius:7px;background:var(--bg,#0b1015);color:inherit;font:inherit;font-size:.84rem}
.ap-btn{padding:.55rem .8rem;border:1px solid var(--border,#1f2b35);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:.78rem;cursor:pointer}
.ap-btn:hover:not(:disabled),.ap-card:hover:not(:disabled){border-color:var(--accent,#3fd0c9)}.ap-card-selected{border-color:var(--accent,#3fd0c9);box-shadow:0 0 0 2px #3fd0c944}.ap-check{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:1px solid var(--accent,#3fd0c9);border-radius:50%;color:var(--accent,#3fd0c9);font-weight:700}.ap-footer-actions{display:flex;align-items:center;justify-content:space-between;gap:.7rem;padding:.6rem 0;color:var(--ink-dim,#8fa1ac);font-size:.78rem}
.ap-btn:disabled,.ap-card:disabled{opacity:.45;cursor:wait}
.ap-primary{background:var(--accent,#3fd0c9);border-color:var(--accent,#3fd0c9);color:#071212;font-weight:700}
.ap-count{margin-left:auto;color:var(--ink-dim,#8fa1ac);font-size:.72rem}
.ap-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:.7rem}
.ap-card{display:flex;flex-direction:column;min-width:0;padding:0;overflow:hidden;border:1px solid var(--border,#1f2b35);border-radius:9px;background:var(--bg-alt,#0f151c);color:inherit;text-align:left;cursor:pointer}
.ap-thumb{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#080c10;color:var(--ink-dim,#8fa1ac)}
.ap-thumb img{width:100%;height:100%;object-fit:contain}
.ap-meta{display:flex;justify-content:space-between;gap:.4rem;padding:.55rem .6rem .1rem;color:var(--ink-dim,#8fa1ac);font-size:.7rem}
.ap-meta b{color:var(--accent,#3fd0c9)}
.ap-prompt{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.3em;margin:.25rem .6rem 0;color:var(--ink,#e7edf1);font-size:.72rem;line-height:1.35;overflow-wrap:anywhere}
.ap-card small{padding:.3rem .6rem .55rem;color:var(--ink-dim,#8fa1ac);font-size:.64rem}
.ap-pagination{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:.8rem;padding-top:.25rem;color:var(--ink-dim,#8fa1ac);font-size:.76rem}
.ap-loading,.ap-empty,.ap-selecting{padding:1.3rem;text-align:center;color:var(--ink-dim,#8fa1ac);font-size:.82rem}
.ap-selecting{border:1px solid #3fd0c966;border-radius:8px;color:var(--accent,#3fd0c9)}
.ap-error{padding:.7rem .8rem;border:1px solid #7f1d1d;border-radius:8px;background:#7f1d1d20;color:#fca5a5;font-size:.8rem;overflow-wrap:anywhere}
@media(max-width:560px){.ap-overlay{padding:.35rem}.ap-modal{padding:.75rem;max-height:97vh}.ap-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}.ap-count{width:100%;margin:0}.ap-search input{min-width:0}}
`;
