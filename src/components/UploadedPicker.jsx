// src/components/UploadedPicker.jsx
// Picker locale per la libreria "Uploaded" (IndexedDB, per account).
// Alla conferma restituisce File veri, nello stesso ordine di selezione,
// pronti per essere aggiunti come pannelli. Non tocca il database.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getUploadedImage, listUploadedImages } from "../utils/comicsDraft.js";

export default function UploadedPicker({ owner, maxSelect = 12, onSelect, onClose }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [urls, setUrls] = useState({});
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const urlsRef = useRef({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listUploadedImages(owner);
        const next = {};
        await Promise.all(rows.map(async row => {
          const record = await getUploadedImage(row.id, owner).catch(() => null);
          if (record?.blob) next[row.id] = URL.createObjectURL(record.blob);
        }));
        if (cancelled) { Object.values(next).forEach(url => URL.revokeObjectURL(url)); return; }
        urlsRef.current = next;
        setItems(rows);
        setUrls(next);
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      Object.values(urlsRef.current).forEach(url => URL.revokeObjectURL(url));
      urlsRef.current = {};
    };
  }, [owner]);

  function toggle(id) {
    setError("");
    if (selected.includes(id)) { setSelected(selected.filter(x => x !== id)); return; }
    if (selected.length >= maxSelect) { setError(t("uploadedPicker.maxSelect", { max: maxSelect })); return; }
    setSelected([...selected, id]);
  }

  async function confirm() {
    if (!selected.length) return;
    setBusy(true);
    setError("");
    try {
      const files = [];
      for (const id of selected) {
        const record = await getUploadedImage(id, owner);
        if (!record?.blob) throw new Error(t("uploadedPicker.unavailable", { id }));
        files.push(record.blob instanceof File ? record.blob : new File([record.blob], record.name || "image", {
          type: record.type || record.blob.type || "image/png",
          lastModified: record.lastModified || Date.now(),
        }));
      }
      onSelect(files);
    } catch (err) {
      setError(err.message || String(err));
      setBusy(false);
    }
  }

  return (
    <div className="up-overlay" role="presentation" onClick={busy ? undefined : onClose}>
      <section className="up-modal" role="dialog" aria-modal="true" aria-label={t("uploadedPicker.dialogLabel")} onClick={e => e.stopPropagation()}>
        <header className="up-header">
          <div>
            <p className="up-eyebrow">{t("uploadedPicker.eyebrow")}</p>
            <h2>{t("uploadedPicker.title")}</h2>
            <p className="up-sub">{t("uploadedPicker.subtitle")}</p>
          </div>
          <button type="button" className="up-btn" onClick={onClose} disabled={busy}>✕</button>
        </header>
        {error && <div className="up-error" role="alert">{error}</div>}
        {loading && <p className="up-sub">{t("uploadedPicker.loading")}</p>}
        {!loading && !items.length && <p className="up-sub">{t("uploadedPicker.empty")}</p>}
        <div className="up-grid">
          {items.map(item => {
            const order = selected.indexOf(item.id);
            return <button type="button" key={item.id} className={"up-card" + (order >= 0 ? " is-on" : "")} onClick={() => toggle(item.id)} disabled={busy}>
              <span className="up-thumb">{urls[item.id] ? <img src={urls[item.id]} alt={item.name} /> : "…"}</span>
              {order >= 0 && <span className="up-badge">{order + 1}</span>}
              <small>{item.name}</small>
            </button>;
          })}
        </div>
        <footer className="up-footer">
          <span className="up-sub">{t("uploadedPicker.selected", { count: selected.length, max: maxSelect })}</span>
          <button type="button" className="up-btn up-primary" onClick={confirm} disabled={!selected.length || busy}>{busy ? t("uploadedPicker.adding") : t("uploadedPicker.add")}</button>
        </footer>
      </section>
      <style>{STYLES}</style>
    </div>
  );
}

const STYLES = `
.up-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(3,7,11,.88);backdrop-filter:blur(8px)}
.up-modal{display:flex;flex-direction:column;gap:.85rem;width:min(900px,100%);max-height:94vh;overflow:auto;padding:1.1rem;border:1px solid var(--border,#1f2b35);border-radius:14px;background:var(--panel,#121a22);color:var(--ink,#e7edf1);box-shadow:0 24px 90px #0009}
.up-header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}
.up-header h2{margin:.2rem 0;font-size:1.3rem}
.up-eyebrow{margin:0;color:var(--accent,#3fd0c9);font-size:.68rem;font-weight:700;letter-spacing:.13em}
.up-sub{margin:0;color:var(--ink-dim,#8fa1ac);font-size:.78rem}
.up-error{padding:.55rem .7rem;border:1px solid #7a2e2e;border-radius:7px;background:#2a1515;color:#ffb4b4;font-size:.78rem}
.up-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:.6rem}
.up-card{position:relative;display:flex;flex-direction:column;gap:.3rem;min-width:0;padding:.35rem;border:1px solid var(--border,#1f2b35);border-radius:9px;background:var(--bg-alt,#0f151c);color:inherit;text-align:left;cursor:pointer}
.up-card.is-on{border-color:var(--accent,#3fd0c9);box-shadow:0 0 0 1px var(--accent,#3fd0c9)}
.up-card:disabled{opacity:.6;cursor:not-allowed}
.up-thumb{display:grid;place-items:center;aspect-ratio:1;overflow:hidden;border-radius:6px;background:var(--bg,#0b1015)}
.up-thumb img{width:100%;height:100%;object-fit:cover}
.up-card small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-dim,#8fa1ac);font-size:.66rem}
.up-badge{position:absolute;top:.55rem;right:.55rem;display:grid;place-items:center;min-width:22px;height:22px;padding:0 .3rem;border-radius:11px;background:var(--accent,#3fd0c9);color:#071212;font-size:.72rem;font-weight:700}
.up-footer{display:flex;align-items:center;justify-content:space-between;gap:.8rem;position:sticky;bottom:0;padding-top:.4rem;background:var(--panel,#121a22)}
.up-btn{padding:.58rem .8rem;border:1px solid var(--border,#33414c);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:.78rem;cursor:pointer}
.up-btn:disabled{opacity:.4;cursor:not-allowed}
.up-primary{background:var(--accent,#3fd0c9);border-color:var(--accent,#3fd0c9);color:#071212;font-weight:700}
`;
