// src/components/ImgHist.jsx
// ImgHist — archivio completo GraDV (history.db) dentro Image Lab.
// Sostituisce la vecchia history a 100 job del gateway (IMAGE_HISTORY_MAX):
// qui si vede TUTTO il catalogo, paginato lato server, con ricerca sul prompt.
// API protette: GET /api/gradv/archive e GET /api/gradv/archive/{id}/image.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteUploadedImage, getUploadedImage, listUploadedImages, saveUploadedImage } from "../utils/comicsDraft.js";

const API = "https://api.danielevillanova.com";
const PAGE_SIZE = 24;

async function readJson(response) {
  const text = await response.text().catch(() => "");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Mostra status + corpo: cosi' si vede se e' HTML del tunnel o altro.
    throw new Error(
      "Risposta non JSON dal gateway (HTTP " +
        response.status +
        "): " +
        (text.slice(0, 120) || "corpo vuoto")
    );
  }
  if (!response.ok) {
    const detail =
      data && typeof data.detail === "string"
        ? data.detail
        : "HTTP " + response.status;
    throw new Error(detail);
  }
  return data;
}

function formatDate(value, locale) {
  if (!value) return "—";
  const text = String(value);
  const date = new Date(text.includes("T") ? text : text.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale || undefined);
}

export default function ImgHist({ idToken, owner = "", onReuse }) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState("created");
  const [uploaded, setUploaded] = useState([]);
  const [uploadedUrls, setUploadedUrls] = useState({});
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [thumbs, setThumbs] = useState({});
  const [selected, setSelected] = useState(null);
  const [fullImage, setFullImage] = useState("");
  const [view, setView] = useState("thumbs");


  const loadUploaded = useCallback(async () => {
    if (!owner) return;
    setUploadError("");
    try {
      const rows = await listUploadedImages(owner);
      setUploaded(rows);
      const next = {};
      await Promise.all(rows.map(async item => {
        try {
          const record = await getUploadedImage(item.id, owner);
          if (record?.blob) next[item.id] = URL.createObjectURL(record.blob);
        } catch {}
      }));
      setUploadedUrls(old => {
        Object.values(old).forEach(url => URL.revokeObjectURL(url));
        return next;
      });
    } catch (err) {
      setUploadError(err.message || String(err));
    }
  }, [owner, t]);

  useEffect(() => {
    if (section === "uploaded") loadUploaded();
  }, [section, loadUploaded]);

  useEffect(() => () => {
    Object.values(uploadedUrls).forEach(url => URL.revokeObjectURL(url));
  }, [uploadedUrls]);

  async function importUploads(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !owner) return;
    const accepted = files.filter(file => file.type.startsWith("image/") && file.size <= 15 * 1024 * 1024);
    if (accepted.length !== files.length) setUploadError(t("imgHist.uploadLimitError"));
    setUploadBusy(true);
    try {
      for (const file of accepted) await saveUploadedImage(owner, file);
      await loadUploaded();
    } catch (err) {
      setUploadError(err.message || String(err));
    } finally {
      setUploadBusy(false);
    }
  }

  async function removeUploaded(item) {
    if (!window.confirm(t("imgHist.deleteUploadedConfirm"))) return;
    try {
      await deleteUploadedImage(item.id, owner);
      await loadUploaded();
    } catch (err) {
      setUploadError(err.message || String(err));
    }
  }

  const revokeThumbs = useCallback((map) => {
    Object.values(map || {}).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const closeImage = useCallback(() => {
    setSelected(null);
    setFullImage((old) => {
      if (old) URL.revokeObjectURL(old);
      return "";
    });
  }, []);

  const loadArchive = useCallback(
    async (targetPage = 1, targetQuery = "") => {
      if (!idToken) return;

      setLoading(true);
      setError("");
      closeImage();

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
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total || 0));
        setPages(Math.max(1, Number(data.pages || 1)));
        setPage(Number(data.page || targetPage));

        const nextThumbs = {};
        await Promise.all(
          (data.items || []).map(async (item) => {
            try {
              const imageResponse = await fetch(
                `${API}/api/gradv/archive/${item.id}/image?thumbnail=true`,
                { headers: { Authorization: "Bearer " + idToken } }
              );
              if (!imageResponse.ok) throw new Error("HTTP " + imageResponse.status);
              nextThumbs[item.id] = URL.createObjectURL(await imageResponse.blob());
            } catch {
              // Una miniatura fallita non blocca la galleria.
            }
          })
        );
        setThumbs((old) => {
          revokeThumbs(old);
          return nextThumbs;
        });
      } catch (err) {
        setError(err.message || String(err));
        setItems([]);
        setTotal(0);
        setPages(1);
      } finally {
        setLoading(false);
      }
    },
    [idToken, closeImage, revokeThumbs]
  );

  useEffect(() => {
    if (idToken) loadArchive(1, "");
  }, [idToken, loadArchive]);

  useEffect(() => () => revokeThumbs(thumbs), [thumbs, revokeThumbs]);

  async function openImage(item) {
    setSelected(item);
    setFullImage((old) => {
      if (old) URL.revokeObjectURL(old);
      return "";
    });

    try {
      const response = await fetch(
        `${API}/api/gradv/archive/${item.id}/image`,
        { headers: { Authorization: "Bearer " + idToken } }
      );
      if (!response.ok) throw new Error("HTTP " + response.status);
      setFullImage(URL.createObjectURL(await response.blob()));
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    setQuery(searchInput);
    loadArchive(1, searchInput);
  }

  function reuseParams(item) {
    if (onReuse) onReuse(item);
    closeImage();
  }

  return (
    <section className="il-panel il-history-panel">
      <style>{IMGHIST_STYLES}</style>

      <div className="ilh-tabs">
        <button type="button" className={"ilh-toggle-btn" + (section === "created" ? " ilh-on" : "")} onClick={() => setSection("created")}>{t("imgHist.createdImages")}</button>
        <button type="button" className={"ilh-toggle-btn" + (section === "uploaded" ? " ilh-on" : "")} onClick={() => setSection("uploaded")}>{t("imgHist.uploadedImages", { count: uploaded.length })}</button>
      </div>
      {section === "created" && <>
      <div className="il-section-heading">
        <div>
          <p className="il-eyebrow">{t("imgHist.archiveEyebrow")}</p>
          <h2>{t("imgHist.archiveTitle")}</h2>
        </div>
        <button
          className="il-button"
          onClick={() => loadArchive(page, query)}
          disabled={loading}
        >
          {loading ? t("imgHist.loading") : t("imgHist.refresh")}
        </button>
      </div>

      <form className="ilh-search" onSubmit={submitSearch}>
        <input
          className="il-input"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("imgHist.searchPlaceholder")}
          aria-label={t("imgHist.searchAria")}
        />
        <button className="il-button il-primary" type="submit" disabled={loading}>
          Cerca
        </button>
        {query && (
          <button
            className="il-button"
            type="button"
            onClick={() => {
              setSearchInput("");
              setQuery("");
              loadArchive(1, "");
            }}
          >
            Reset
          </button>
        )}
        <span className="ilh-toggle">
          <button
            type="button"
            className={"ilh-toggle-btn" + (view === "thumbs" ? " ilh-on" : "")}
            onClick={() => setView("thumbs")}
          >
            Anteprime
          </button>
          <button
            type="button"
            className={"ilh-toggle-btn" + (view === "text" ? " ilh-on" : "")}
            onClick={() => setView("text")}
          >
            Solo testo
          </button>
        </span>
        <span className="il-page-info">
          {total.toLocaleString(i18n.language || undefined)} {t("imgHist.images")} · {PAGE_SIZE} {t("imgHist.perPage")}
        </span>
      </form>

      {error && (
        <div className="il-error" role="alert">
          {error}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <p className="il-hint">{t("imgHist.noImagesFound")}</p>
      )}

      {view === "thumbs" ? (
      <div className="ilh-grid">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="ilh-card"
            onClick={() => openImage(item)}
            title={item.prompt || t("imgHist.imageFallback", { id: item.id })}
          >
            <span className="ilh-thumb">
              {thumbs[item.id] ? (
                <img
                  src={thumbs[item.id]}
                  alt={item.prompt || "GraDV #" + item.id}
                  loading="lazy"
                />
              ) : (
                "…"
              )}
            </span>
            <span className="ilh-card-meta">
              <strong>#{item.id}</strong>
              <span>{item.width} × {item.height}</span>
            </span>
            <span className="ilh-card-prompt">
              {String(item.prompt || "").length > 140
                ? String(item.prompt).slice(0, 140) + "…"
                : item.prompt || "Prompt non disponibile"}
            </span>
            <small>{formatDate(item.created_at)}</small>
          </button>
        ))}
      </div>

      ) : (
        <ul className="ilh-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="ilh-list-row"
                onClick={() => openImage(item)}
              >
                <span className="ilh-list-id">#{item.id}</span>
                <span className="ilh-list-prompt">
                  {item.prompt || "Prompt non disponibile"}
                </span>
                <span className="ilh-list-meta">
                  {item.width} × {item.height} · seed {item.seed ?? "—"} ·{" "}
                  {formatDate(item.created_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="il-pagination">
          <button
            className="il-page-btn"
            onClick={() => loadArchive(page - 1, query)}
            disabled={page <= 1 || loading}
          >
            ←
          </button>
          <span className="il-page-info">
            Pagina {page} di {pages}
          </span>
          <select
            value={Math.floor((page - 1) / 10)}
            onChange={(event) =>
              loadArchive(Number(event.target.value) * 10 + 1, query)
            }
            disabled={loading || pages <= 10}
            title={t("imgHist.jumpPageBlock")}
            style={{
              padding: ".35rem .5rem",
              border: "1px solid var(--border, #1f2b35)",
              borderRadius: "6px",
              background: "var(--bg, #0b1015)",
              color: "var(--ink, #e7edf1)",
              fontSize: ".78rem",
            }}
          >
            {Array.from({ length: Math.ceil(pages / 10) }, (_, g) => {
              const start = g * 10 + 1;
              const end = Math.min((g + 1) * 10, pages);
              return (
                <option key={g} value={g}>
                  Pagine {start}–{end}
                </option>
              );
            })}
          </select>
          <button
            className="il-page-btn"
            onClick={() => loadArchive(page + 1, query)}
            disabled={page >= pages || loading}
          >
            →
          </button>
        </div>
      )}

      {selected && (
        <div className="il-history-overlay" onClick={closeImage}>
          <div
            className="il-history-modal"
            onClick={(event) => event.stopPropagation()}
          >
            {fullImage ? (
              <img
                className="il-generated-image"
                src={fullImage}
                alt={selected.prompt}
              />
            ) : (
              <p className="il-hint">{t("imgHist.loadingOriginal")}</p>
            )}
            <div className="il-history-modal-meta">
              <span>#{selected.id}</span>
              <span>{selected.width} × {selected.height}</span>
              <span>Seed: {selected.seed ?? "—"}</span>
              <span>{selected.steps ?? "—"} step</span>
              <span>{formatDate(selected.created_at)}</span>
            </div>
            <div className="il-actions">
              {fullImage && (
                <a
                  className="il-button il-primary"
                  href={fullImage}
                  download={"gradv-" + selected.id + ".png"}
                >
                  Scarica PNG
                </a>
              )}
              <button className="il-button" onClick={() => reuseParams(selected)}>
                Riusa parametri
              </button>
              <button className="il-button" onClick={closeImage}>
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}
      </>}
      {section === "uploaded" && (
        <>
          <div className="il-section-heading">
            <div><p className="il-eyebrow">{t("imgHist.uploadEyebrow")}</p><h2>{t("imgHist.uploadTitle")}</h2></div>
            <label className="il-button il-primary">{uploadBusy ? t("imgHist.saving") : t("imgHist.uploadImages")}<input type="file" accept="image/*" multiple onChange={importUploads} disabled={uploadBusy} style={{display:"none"}} /></label>
          </div>
          <p className="il-hint">{t("imgHist.uploadDescription")}</p>
          {uploadError && <div className="il-error" role="alert">{uploadError}</div>}
          {!uploaded.length && !uploadBusy && <p className="il-hint">{t("imgHist.noUploadedImages")}</p>}
          <div className="ilh-grid">
            {uploaded.map(item => <article className="ilh-card" key={item.id}>
              <span className="ilh-thumb">{uploadedUrls[item.id] ? <img src={uploadedUrls[item.id]} alt={item.name}/> : "…"}</span>
              <span className="ilh-card-meta"><strong>{item.name}</strong><span>{Math.round(item.size/1024)} KB</span></span>
              <small>{new Date(item.createdAt).toLocaleString(i18n.language || undefined)}</small>
              <div className="il-actions"><button type="button" className="il-button" onClick={() => removeUploaded(item)}>{t("imgHist.delete")}</button></div>
            </article>)}
          </div>
        </>
      )}
    </section>
  );
}

const IMGHIST_STYLES = `
.ilh-tabs{display:flex;gap:.5rem;margin-bottom:1rem}.ilh-search{display:flex;align-items:center;flex-wrap:wrap;gap:.6rem;margin-bottom:1rem}
.ilh-search .il-input{max-width:320px}
.ilh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.8rem}
.ilh-card{display:flex;flex-direction:column;min-width:0;padding:0;border:1px solid var(--border,#1f2b35);border-radius:9px;background:var(--bg-alt,#0f151c);color:inherit;text-align:left;cursor:pointer}
.ilh-card:hover{border-color:var(--accent,#3fd0c9)}
.ilh-thumb{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:9px 9px 0 0;background:#080c10;color:var(--ink-dim,#8fa1ac)}
.ilh-thumb img{width:100%;height:100%;object-fit:contain}
.ilh-card-meta{display:flex;justify-content:space-between;gap:.5rem;padding:.6rem .7rem .1rem;font-size:.74rem;color:var(--ink-dim,#8fa1ac)}
.ilh-card-meta strong{color:var(--accent,#3fd0c9)}
.ilh-card-prompt{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.4em;margin:.3rem .7rem 0;font-size:.76rem;line-height:1.35;color:var(--ink,#e7edf1);overflow-wrap:anywhere}
.ilh-card small{padding:.35rem .7rem .7rem;color:var(--ink-dim,#8fa1ac);font-size:.66rem}
.ilh-toggle{display:inline-flex;gap:.35rem;margin-left:auto}
.ilh-toggle-btn{padding:.35rem .8rem;border:1px solid var(--border,#1f2b35);border-radius:7px;background:transparent;color:var(--ink-dim,#8fa1ac);cursor:pointer;font-size:.75rem}
.ilh-toggle-btn.ilh-on{background:var(--accent,#3fd0c9);color:#06232a;border-color:transparent;font-weight:600}
.ilh-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.35rem}
.ilh-list-row{display:grid;grid-template-columns:70px 1fr auto;gap:.8rem;align-items:baseline;width:100%;padding:.55rem .7rem;border:1px solid var(--border,#1f2b35);border-radius:8px;background:var(--bg-alt,#0f151c);color:inherit;text-align:left;cursor:pointer;font-size:.8rem}
.ilh-list-row:hover{border-color:var(--accent,#3fd0c9)}
.ilh-list-id{color:var(--accent,#3fd0c9);font-weight:600}
.ilh-list-prompt{color:var(--ink,#e7edf1);overflow-wrap:anywhere}
.ilh-list-meta{color:var(--ink-dim,#8fa1ac);font-size:.7rem;white-space:nowrap}
@media (max-width:640px){.ilh-list-row{grid-template-columns:56px 1fr}.ilh-list-meta{grid-column:1/-1;text-align:right;white-space:normal}}
`;
