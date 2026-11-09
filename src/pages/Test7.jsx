// ============================================================
// Test7 — News Admin: bozza/revisione articoli AI News
// ============================================================
// Selettore "news#": nuovo articolo o uno esistente → popola i
// tre box EN/IT/ES (title, dek, body). Salva rende quella lingua
// la "master", Traduci la rigenera dal master con Ollama.
// Selettore lingua (6) per l'ANTEPRIMA sotto: replica il rendering
// della pagina AI News (fallback EN come il sito).
// Immagine opzionale (upload → public/news/). Pubblica fa
// insert (nuovo) o update (esistente) con commit+push su main.
//
// AUTH: login Google, stesso client/token del gateway (come Improve.jsx).
// ============================================================

import { useEffect, useRef, useState } from "react";

const API = "https://api.danielevillanova.com";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_STORAGE_KEY = "dv_google_id_token";

const ALL_LANGS = ["en", "it", "es", "fr", "ca", "nl"];
const LANG_LABELS = {
  en: "English", it: "Italiano", es: "Español",
  fr: "Français", ca: "Català", nl: "Nederlands",
};
const LANG_FLAGS = {
  en: "🇬🇧", it: "🇮🇹", es: "🇪🇸", fr: "🇫🇷", ca: "🏴", nl: "🇳🇱",
};

// ============================================================
// GOOGLE AUTH (stesso pattern di Improve.jsx)
// ============================================================

function parseJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isTokenValid(token) {
  const payload = token ? parseJwt(token) : null;
  return !!payload?.exp && payload.exp * 1000 > Date.now() + 5000;
}

function readStoredToken() {
  try {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    return isTokenValid(stored) ? stored : null;
  } catch {
    return null;
  }
}

function useGoogleAuth() {
  const [idToken, setIdToken] = useState(readStoredToken);
  const buttonRef = useRef(null);

  useEffect(() => {
    function onStorage(e) {
      if (e.key !== TOKEN_STORAGE_KEY) return;
      setIdToken(e.newValue && isTokenValid(e.newValue) ? e.newValue : null);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function onCredential(resp) {
    const token = resp?.credential;
    if (!token) return;
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      /* ignore */
    }
    setIdToken(token);
  }

  useEffect(() => {
    if (idToken) return;
    let cancelled = false;
    let attempts = 0;

    function tryInit() {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        if (++attempts > 80) return;
        setTimeout(tryInit, 150);
        return;
      }
      if (!GOOGLE_CLIENT_ID) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onCredential,
      });
      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "filled_black",
          size: "medium",
          shape: "pill",
        });
      }
    }

    tryInit();
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  const email = idToken ? parseJwt(idToken)?.email || "" : "";

  const logout = () => {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.google?.accounts?.id?.disableAutoSelect?.();
    } catch {
      /* ignore */
    }
    setIdToken(null);
  };

  return { idToken, email, buttonRef, logout };
}

// ============================================================
// HELPERS
// ============================================================

// Testo del box → blocchi (stesse regole del gateway: "## " = h3, "- " = list)
function textToBlocks(text) {
  const blocks = [];
  for (const para of (text || "").split(/\n\n+/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.startsWith("## ")) {
      blocks.push({ type: "h3", text: p.slice(3).trim() });
      continue;
    }
    const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length && lines.every((l) => l.startsWith("- "))) {
      blocks.push({ type: "list", items: lines.map((l) => l.slice(2).trim()) });
      continue;
    }
    blocks.push({ type: "p", text: lines.join(" ") });
  }
  return blocks;
}

function parseSourcesText(text) {
  return (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("|");
      return i === -1
        ? { label: line, url: "" }
        : { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() };
    });
}

const EMPTY_DRAFT = {
  number: null,
  slug: "",
  date: new Date().toISOString().slice(0, 10),
  readTime: 2,
  sources: "",
  image: null,
  content: {},
  master: null,
};

// ============================================================
// PAGINA
// ============================================================

export default function Test7() {
  const { idToken, email, buttonRef, logout } = useGoogleAuth();

  const [articles, setArticles] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [previewLang, setPreviewLang] = useState("en");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [publishResult, setPublishResult] = useState(null);
  const [checkReport, setCheckReport] = useState(null);

  async function api(path, body, method) {
    setError("");
    setOkMsg("");
    const res = await fetch(API + path, {
      method: method || (body ? "POST" : "GET"),
      headers: { Authorization: "Bearer " + idToken },
      ...(body ? { headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken }, body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail =
        typeof data.detail === "string"
          ? data.detail
          : data.detail
          ? JSON.stringify(data.detail)
          : "HTTP " + res.status;
      throw new Error(detail);
    }
    return data;
  }

  // Carica lista articoli + bozza quando c'è il token.
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    Promise.all([
      api("/api/admin/news-draft/articles"),
      api("/api/admin/news-draft"),
    ])
      .then(([list, d]) => {
        if (cancelled) return;
        setArticles(list.articles || []);
        setDraft((prev) => ({ ...prev, ...d, content: d.content || {} }));
      })
      .catch((e) => !cancelled && setError(e.message || String(e)));
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  function setContent(lang, patch) {
    setCheckReport(null);
    setDraft((d) => ({
      ...d,
      content: {
        ...d.content,
        [lang]: { title: "", dek: "", body: "", ...(d.content[lang] || {}), ...patch },
      },
    }));
  }

  function setMeta(patch) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  // Selettore news#: 0 = nuovo, altrimenti carica l'articolo esistente.
  async function pickArticle(ev) {
    const number = parseInt(ev.target.value, 10);
    setPublishResult(null);
    setCheckReport(null);
    if (!number) {
      setDraft({ ...EMPTY_DRAFT, date: EMPTY_DRAFT.date });
      return;
    }
    setBusy("load");
    try {
      const a = await api(`/api/admin/news-draft/article/${number}`);
      setDraft({
        ...EMPTY_DRAFT,
        number: a.number,
        slug: a.slug,
        date: a.date,
        readTime: a.readTime,
        sources: a.sources || "",
        image: a.image || null,
        content: a.content || {},
        master: "en",
      });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  async function saveLang(lang) {
    setBusy(lang);
    try {
      const c = draft.content[lang] || {};
      const d = await api("/api/admin/news-draft/save", {
        lang,
        content: { title: c.title || "", dek: c.dek || "", body: c.body || "" },
        number: draft.number,
        slug: draft.slug,
        date: draft.date,
        readTime: draft.readTime,
        sources: draft.sources,
        image: draft.image,
      });
      setDraft((prev) => ({ ...prev, ...d, content: d.content || {} }));
      setOkMsg(LANG_LABELS[lang] + " salvato: ora è la lingua master ★");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  async function translateLang(lang, field) {
    const key = field ? "field:" + lang + ":" + field : lang;
    setBusy(key);
    try {
      const d = await api(
        "/api/admin/news-draft/translate",
        field ? { target_lang: lang, field } : { target_lang: lang }
      );
      setDraft((prev) => ({ ...prev, ...d, content: d.content || {} }));
      setOkMsg(
        field
          ? LANG_LABELS[lang] + " · " + (field === "title" ? "titolo" : "dek") +
            " ritradotto dal master (" + LANG_LABELS[d.master || "en"] + ")"
          : LANG_LABELS[lang] + " tradotto dal master (" + LANG_LABELS[d.master || "en"] + ")"
      );
      setCheckReport(null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  // Controllo contenuti deterministico vs master EN (nessun LLM):
  // campi vuoti, lunghezze, struttura blocchi, marker di prompt, nomi inventati.
  async function checkContents() {
    setBusy("check");
    setError("");
    setOkMsg("");
    try {
      const content = {};
      for (const l of ALL_LANGS) {
        const c = draft.content[l];
        if (c) content[l] = { title: c.title || "", dek: c.dek || "", body: c.body || "" };
      }
      const r = await api("/api/admin/news-draft/check", { content });
      setCheckReport(r.report || {});
      if (r.ok) setOkMsg("Controllo contenuti: nessun problema nelle lingue tradotte.");
      else setError("Controllo contenuti: problemi trovati, vedi il report sotto.");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  async function translateAll() {
    const master = draft.master || "en";
    if (
      !window.confirm(
        "Tradurre dal master (" + LANG_LABELS[master] + ") in tutte le altre 5 lingue con Ollama?\nPuò metterci qualche minuto."
      )
    )
      return;
    setBusy("translateall");
    try {
      const d = await api("/api/admin/news-draft/translate-all", {});
      setDraft((prev) => ({ ...prev, ...d, content: d.content || {} }));
      const langs = Object.keys(d.content || {})
        .filter((l) => (d.content[l] || {}).body)
        .map((l) => LANG_FLAGS[l] + " " + l.toUpperCase());
      setOkMsg("Tradotte tutte le lingue: " + langs.join(" "));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  async function uploadImage(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setBusy("image");
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(API + "/api/admin/news-draft/image", {
        method: "POST",
        headers: { Authorization: "Bearer " + idToken },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "HTTP " + res.status);
      setDraft((d) => ({ ...d, image: { src: data.src, caption: d.image?.caption || "" } }));
      setOkMsg("Immagine caricata: " + data.src + " (committata alla pubblicazione)");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
      ev.target.value = "";
    }
  }

  async function publish() {
    const what = draft.number
      ? "Aggiornare l'articolo #" + draft.number + " su AI News?"
      : "Pubblicare il nuovo articolo su AI News?";
    if (!window.confirm(what + "\n\nCommit + push su main di dv-site.")) return;
    setBusy("publish");
    setPublishResult(null);
    try {
      const d = await api("/api/admin/news-draft/publish", {
        number: draft.number,
        slug: draft.slug,
        date: draft.date,
        readTime: draft.readTime,
        sources: draft.sources,
        image: draft.image,
      });
      setPublishResult(d);
      setDraft({ ...EMPTY_DRAFT, date: EMPTY_DRAFT.date });
      // refresh lista (nuovo numero disponibile)
      api("/api/admin/news-draft/articles").then((l) => setArticles(l.articles || [])).catch(() => {});
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  if (!idToken) {
    return (
      <div className="nd-page">
        <h1>News Admin</h1>
        <p className="nd-empty">Accedi con Google per gestire gli articoli AI News.</p>
        <div ref={buttonRef} />
      </div>
    );
  }

  // --- Contenuto per l'anteprima nella lingua selezionata ---
  const masterLang = draft.master || "en";
  const previewContent = (() => {
    const c = draft.content;
    if (previewLang === "en" || previewLang === "it" || previewLang === "es") {
      return c[previewLang] || (previewLang !== "en" && c.en) || { title: "", dek: "", body: "" };
    }
    // fr/ca/nl: se c'è la traduzione la mostra, altrimenti fallback EN (come il sito)
    return c[previewLang] || c.en || { title: "", dek: "", body: "" };
  })();
  const previewFallback =
    !draft.content[previewLang] && previewLang !== "en" && !!draft.content.en;

  const enBody = (draft.content.en || {}).body || "";

  return (
    <div className="nd-page">
      <div className="nd-head">
        <div>
          <h1>News Admin</h1>
          <p className="nd-sub">
            Seleziona un articolo: i box si popolano. Salva rende quella lingua la
            master ★, Traduci rigenera dal master. L'anteprima sotto segue la
            lingua scelta (fallback EN come sul sito).
          </p>
        </div>
        <div className="nd-auth">
          <span>{email}</span>
          <button className="nd-btn" onClick={logout}>Logout</button>
        </div>
      </div>

      {/* SELETTORI */}
      <section className="nd-meta">
        <div className="nd-meta-row">
          <label>
            news#
            <select value={draft.number || 0} onChange={pickArticle} disabled={busy === "load"}>
              <option value={0}>＋ Nuovo articolo</option>
              {articles.map((a) => (
                <option key={a.number} value={a.number}>
                  #{a.number} — {a.slug} ({a.date})
                </option>
              ))}
            </select>
          </label>
          <label>
            anteprima lang
            <select value={previewLang} onChange={(e) => setPreviewLang(e.target.value)}>
              {ALL_LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_FLAGS[l]} {LANG_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="nd-btn"
            disabled={busy === previewLang || !draft.content[masterLang]?.body || previewLang === masterLang}
            onClick={() => translateLang(previewLang)}
            title={"Rigenera " + LANG_LABELS[previewLang] + " dal master (" + LANG_LABELS[masterLang] + ")"}
          >
            Traduci anteprima
          </button>
        </div>

        <div className="nd-meta-row">
          <label>
            slug
            <input
              value={draft.slug}
              onChange={(e) => setMeta({ slug: e.target.value })}
              placeholder="es. ai-finds-the-flaws"
            />
          </label>
          <label>
            date
            <input value={draft.date} onChange={(e) => setMeta({ date: e.target.value })} />
          </label>
          <label>
            readTime (min)
            <input
              type="number" min="1" max="30"
              value={draft.readTime}
              onChange={(e) => setMeta({ readTime: parseInt(e.target.value, 10) || 2 })}
            />
          </label>
        </div>

        <label>
          sources — una per riga, formato: Etichetta | URL
          <textarea
            rows="3"
            value={draft.sources}
            onChange={(e) => setMeta({ sources: e.target.value })}
            placeholder={"SecurityWeek - ... | https://..."}
          />
        </label>

        {/* IMMAGINE (opzionale) */}
        <div className="nd-imgrow">
          <label className="nd-imglabel">
            immagine news (opzionale)
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} disabled={busy === "image"} />
          </label>
          {draft.image && (
            <>
              <img className="nd-thumb" src={draft.image.src} alt="" />
              <input
                className="nd-caption"
                placeholder="Caption"
                value={draft.image.caption || ""}
                onChange={(e) => setDraft((d) => ({ ...d, image: { ...d.image, caption: e.target.value } }))}
              />
              <button className="nd-btn" onClick={() => setMeta({ image: null })}>Rimuovi</button>
            </>
          )}
        </div>
      </section>

      {/* TRE BOX EN / IT / ES */}
      <div className="nd-cols">
        {ALL_LANGS.map((lang) => {
          const c = draft.content[lang] || { title: "", dek: "", body: "" };
          const isMaster = masterLang === lang;
          return (
            <section key={lang} className={"nd-col" + (isMaster ? " nd-master" : "")}>
              <div className="nd-col-head">
                <h2>
                  {LANG_FLAGS[lang]} {LANG_LABELS[lang]}{" "}
                  {isMaster && <span className="nd-star">★ master</span>}
                </h2>
              </div>
              <div className="nd-fieldrow">
                <input
                  placeholder="Title"
                  value={c.title}
                  onChange={(e) => setContent(lang, { title: e.target.value })}
                />
                {!isMaster && (
                  <button
                    className="nd-mini"
                    disabled={!!busy || !draft.content[masterLang]?.body}
                    onClick={() => translateLang(lang, "title")}
                    title={"Ritraduci SOLO il titolo dal master (" + LANG_LABELS[masterLang] + ")"}
                  >
                    {busy === "field:" + lang + ":title" ? "…" : "↻"}
                  </button>
                )}
              </div>
              <div className="nd-fieldrow">
                <input
                  placeholder="Dek (sottotitolo)"
                  value={c.dek}
                  onChange={(e) => setContent(lang, { dek: e.target.value })}
                />
                {!isMaster && (
                  <button
                    className="nd-mini"
                    disabled={!!busy || !draft.content[masterLang]?.body}
                    onClick={() => translateLang(lang, "dek")}
                    title={"Ritraduci SOLO il dek dal master (" + LANG_LABELS[masterLang] + ")"}
                  >
                    {busy === "field:" + lang + ":dek" ? "…" : "↻"}
                  </button>
                )}
              </div>
              <textarea
                className="nd-body"
                placeholder={
                  lang === "en"
                    ? "Body inglese. Paragrafi separati da riga vuota; '## Titolo' = heading; '- voce' = lista."
                    : "Rigenerato dal master con Traduci, poi correggibile"
                }
                value={c.body}
                onChange={(e) => setContent(lang, { body: e.target.value })}
              />
              <div className="nd-actions">
                <button
                  className="nd-btn nd-primary"
                  disabled={busy === lang || (!c.title && !c.dek && !c.body)}
                  onClick={() => saveLang(lang)}
                >
                  {busy === lang ? "…" : "Salva" + (isMaster ? " ★" : "")}
                </button>
                <button
                  className="nd-btn"
                  disabled={busy === lang || !draft.content[masterLang]?.body || lang === masterLang}
                  onClick={() => translateLang(lang)}
                  title={lang === masterLang ? "Questa lingua è già il master" : "Rigenera dal master (" + LANG_LABELS[masterLang] + ")"}
                >
                  Traduci
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {/* TRADUCI TUTTE LE LINGUE (fr/ca/nl incluse) */}
      <div className="nd-translateall">
        <button
          className="nd-btn"
          disabled={busy === "translateall" || !draft.content[masterLang]?.body}
          onClick={translateAll}
          title={"Rigenera dal master (" + LANG_LABELS[masterLang] + ") tutte le lingue con Ollama"}
        >
          {busy === "translateall" ? "Traduzione in corso…" : "Traduci tutte le lingue (5)"}
        </button>
        <button
          className="nd-btn"
          disabled={!!busy || !draft.content[masterLang]?.body}
          onClick={checkContents}
          title="Controllo deterministico vs master EN: campi vuoti, lunghezze, struttura blocchi, marker di prompt, nomi/sigle inventati"
        >
          {busy === "check" ? "Controllo…" : "Controlla contenuti"}
        </button>
        <span className="nd-langchips">
          {ALL_LANGS.map((l) => {
            const has = !!(draft.content[l] || {}).body;
            return (
              <span
                key={l}
                className={
                  "nd-chip" +
                  (l === masterLang ? " nd-chip-master" : has ? " nd-chip-on" : "") +
                  (checkReport && checkReport[l] && checkReport[l].length ? " nd-chip-bad" : "")
                }
              >
                {LANG_FLAGS[l]} {l.toUpperCase()}
                {l === masterLang ? "★" : has ? "✓" : "–"}
              </span>
            );
          })}
        </span>
      </div>

      {/* REPORT CONTROLLO CONTENUTI (deterministico, vs master EN) */}
      {checkReport && (
        <section className="nd-checkreport">
          <h3>Controllo contenuti · vs {LANG_FLAGS[masterLang]} {LANG_LABELS[masterLang]} master</h3>
          {Object.keys(checkReport).length === 0 ? (
            <p className="nd-checkok">Nessun problema rilevato nelle lingue tradotte.</p>
          ) : (
            ALL_LANGS.filter((l) => checkReport[l] && checkReport[l].length).map((l) => (
              <div key={l} className="nd-checklang">
                <b>{LANG_FLAGS[l]} {LANG_LABELS[l]}</b>
                <ul>
                  {checkReport[l].map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              </div>
            ))
          )}
        </section>
      )}

      {/* ANTEPRIMA (rendering stile AI News) */}
      <section className="nd-previewbox">
        <div className="nd-previewhead">
          <h2>Anteprima · {LANG_FLAGS[previewLang]} {LANG_LABELS[previewLang]}</h2>
          {previewFallback && (
            <span className="nd-fallback">fallback EN (non ancora tradotto)</span>
          )}
        </div>
        <div className="nd-preview">
          <div className="nd-pv-kicker">
            NEWS {draft.number ? "#" + draft.number : "#nuovo"}
          </div>
          <h1 className="nd-pv-title">{previewContent.title || "(titolo)"}</h1>
          <div className="nd-pv-meta">
            {draft.date} · {draft.readTime} min read · AI Ethics
          </div>
          <p className="nd-pv-dek">{previewContent.dek || "(dek)"}</p>
          {draft.image && (
            <figure className="nd-pv-img">
              <img src={draft.image.src} alt="" />
              {draft.image.caption && <figcaption>{draft.image.caption}</figcaption>}
            </figure>
          )}
          <div className="nd-pv-body">
            {textToBlocks(previewContent.body).map((b, i) =>
              b.type === "h3" ? (
                <h3 key={i}>{b.text}</h3>
              ) : b.type === "list" ? (
                <ul key={i}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
              ) : (
                <p key={i}>{b.text}</p>
              )
            )}
          </div>
          {(draft.sources || "").trim() && (
            <>
              <h3 className="nd-pv-srctitle">Sources</h3>
              <ul className="nd-pv-sources">
                {parseSourcesText(draft.sources).map((s, i) => (
                  <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a> : s.label}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      {/* PUBBLICA */}
      <div className="nd-publish">
        <button
          className="nd-btn nd-danger"
          disabled={busy === "publish" || !draft.slug || !enBody.trim()}
          onClick={publish}
          title={!draft.slug ? "Serve uno slug" : "Commit + push su main"}
        >
          {busy === "publish"
            ? "Pubblicazione…"
            : draft.number
            ? "Aggiorna articolo #" + draft.number
            : "Pubblica su AI News"}
        </button>
        <span className="nd-hint">
          {draft.number
            ? "Update in place dell'articolo esistente (le altre lingue restano)."
            : "Insert in testa ad ARTICLES, commit + push su main (git pull, node --check, rollback)."}
        </span>
      </div>

      {error && <div className="nd-error">! {error}</div>}
      {okMsg && <div className="nd-ok">{okMsg}</div>}

      {publishResult && (
        <div className="nd-ok">
          {publishResult.mode === "update" ? "Aggiornato" : "Pubblicato"}: articolo
          #{publishResult.number} “{publishResult.slug}” — commit <code>{publishResult.sha}</code>
        </div>
      )}

      <style>{`
        .nd-page { max-width: 1400px; margin: 0 auto; padding: 24px; color: #e5e7eb; min-height: 100vh; background: #0b0e14; }
        .nd-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
        .nd-head h1 { margin: 0 0 6px; }
        .nd-sub { margin: 0; color: #9ca3af; font-size: 13px; max-width: 620px; line-height: 1.5; }
        .nd-auth { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #9ca3af; }
        .nd-meta { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 12px; }
        .nd-meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
        .nd-meta label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; }
        .nd-meta select { min-width: 240px; }
        .nd-meta input, .nd-meta textarea, .nd-meta select, .nd-col input, .nd-col textarea {
          background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12);
          border-radius: 8px; color: #e5e7eb; padding: 8px 10px; font-size: 13px;
          width: 100%; box-sizing: border-box;
        }
        .nd-meta > label { flex: 1; }
        .nd-imgrow { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .nd-imglabel { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; display: flex; flex-direction: column; gap: 4px; }
        .nd-thumb { height: 48px; border-radius: 6px; border: 1px solid rgba(255,255,255,.15); }
        .nd-caption { flex: 1; min-width: 180px; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: #e5e7eb; padding: 8px 10px; font-size: 13px; }
        .nd-cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        @media (max-width: 1000px) { .nd-cols { grid-template-columns: 1fr; } }
        .nd-col { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
        .nd-col.nd-master { border-color: rgba(16,185,129,.5); }
        .nd-col-head h2 { margin: 0; font-size: 15px; }
        .nd-star { color: #34d399; font-size: 11px; margin-left: 6px; }
        .nd-body { min-height: 260px; resize: vertical; line-height: 1.5; }
        .nd-actions { display: flex; gap: 8px; }
        .nd-btn { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #e5e7eb; border-radius: 8px; padding: 7px 14px; font-size: 13px; cursor: pointer; }
        .nd-btn:hover { background: rgba(255,255,255,.14); }
        .nd-btn:disabled { opacity: .5; cursor: not-allowed; }
        .nd-primary { background: #10b981; border-color: #10b981; color: #06281d; font-weight: 700; }
        .nd-danger { background: #6366f1; border-color: #6366f1; color: #fff; font-weight: 700; padding: 12px 22px; }
        .nd-translateall { display: flex; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
        .nd-langchips { display: flex; gap: 6px; flex-wrap: wrap; }
        .nd-chip { font-size: 11.5px; padding: 4px 9px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12); color: #6b7280; background: rgba(0,0,0,.25); }
        .nd-chip-on { color: #34d399; border-color: rgba(52,211,153,.4); }
        .nd-chip-master { color: #5eead4; border-color: rgba(94,234,212,.5); }
        .nd-fieldrow { display: flex; gap: 6px; align-items: stretch; }
        .nd-fieldrow input { flex: 1; }
        .nd-mini { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #e5e7eb; border-radius: 8px; padding: 0 10px; font-size: 14px; cursor: pointer; }
        .nd-mini:hover { background: rgba(255,255,255,.16); }
        .nd-mini:disabled { opacity: .5; cursor: not-allowed; }
        .nd-chip-bad { color: #f87171 !important; border-color: rgba(248,113,113,.5) !important; }
        .nd-checkreport { margin-top: 14px; background: rgba(248,113,113,.06); border: 1px solid rgba(248,113,113,.25); border-radius: 12px; padding: 14px 16px; }
        .nd-checkreport h3 { margin: 0 0 10px; font-size: 14px; color: #fca5a5; }
        .nd-checkok { color: #34d399; font-size: 13px; margin: 0; }
        .nd-checklang { margin-bottom: 10px; font-size: 13px; color: #e5e7eb; }
        .nd-checklang b { display: block; margin-bottom: 4px; }
        .nd-checklang ul { margin: 0; padding-left: 20px; }
        .nd-checklang li { color: #fca5a5; margin-bottom: 3px; font-size: 12.5px; line-height: 1.45; }
        .nd-previewbox { margin-top: 20px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; overflow: hidden; }
        .nd-previewhead { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: rgba(255,255,255,.03); }
        .nd-previewhead h2 { margin: 0; font-size: 14px; }
        .nd-fallback { color: #f59e0b; font-size: 12px; }
        .nd-preview { max-width: 700px; margin: 0 auto; padding: 32px 20px 40px; background: #0b1015; color: #e8edf2; }
        .nd-pv-kicker { font-family: monospace; font-size: 12px; letter-spacing: .18em; color: #5eead4; text-transform: uppercase; }
        .nd-pv-title { font-size: clamp(26px, 4vw, 36px); line-height: 1.15; font-weight: 800; margin: 12px 0; color: #fff; }
        .nd-pv-meta { font-size: 13px; color: #75879a; margin-bottom: 18px; }
        .nd-pv-dek { font-size: 17px; line-height: 1.6; color: #b8c6d4; font-weight: 500; margin: 0 0 26px; }
        .nd-pv-img { margin: 0 0 26px; }
        .nd-pv-img img { width: 100%; border-radius: 12px; border: 1px solid #1e2a36; }
        .nd-pv-img figcaption { font-size: 12.5px; color: #75879a; margin-top: 8px; }
        .nd-pv-body p { font-size: 16px; line-height: 1.75; color: #c8d3de; margin: 0 0 20px; }
        .nd-pv-body h3 { font-size: 21px; color: #fff; font-weight: 700; margin: 30px 0 14px; }
        .nd-pv-body ul { margin: 0 0 22px; padding-left: 22px; }
        .nd-pv-body li { font-size: 15.5px; line-height: 1.7; color: #c8d3de; margin-bottom: 10px; }
        .nd-pv-srctitle { font-size: 18px; color: #fff; font-weight: 700; margin: 34px 0 14px; border-top: 1px solid #1e2a36; padding-top: 24px; }
        .nd-pv-sources { margin: 0; padding-left: 22px; }
        .nd-pv-sources li { font-size: 13.5px; line-height: 1.6; color: #8ea0b3; margin-bottom: 8px; }
        .nd-pv-sources a { color: #5eead4; text-decoration: none; }
        .nd-pv-sources a:hover { text-decoration: underline; }
        .nd-publish { display: flex; align-items: center; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
        .nd-hint { color: #6b7280; font-size: 12px; max-width: 560px; }
        .nd-error { margin-top: 12px; color: #f87171; font-size: 13px; }
        .nd-ok { margin-top: 12px; color: #34d399; font-size: 13px; }
        .nd-empty { color: #6b7280; font-size: 13px; }
        .nd-page code { color: #34d399; }
      `}</style>
    </div>
  );
}
