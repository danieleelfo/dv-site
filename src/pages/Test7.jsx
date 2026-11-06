// ============================================================
// Test7 — AI News Draft: bozza articolo EN/IT/ES + pubblicazione
// ============================================================
// Tre riquadri (en/it/es): Salva rende quella lingua la "master",
// Traduci la rigenera dal master con Ollama (via gateway).
// "Pubblica su AI News" inserisce l'articolo in aiEthics.js e
// fa commit+push su main (con git pull, node --check e rollback).
//
// AUTH: login Google, stesso client/token del gateway (come Improve.jsx).
// ============================================================

import { useEffect, useRef, useState } from "react";

const API = "https://api.danielevillanova.com";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_STORAGE_KEY = "dv_google_id_token";

const LANGS = ["en", "it", "es"];
const LANG_LABELS = { en: "English", it: "Italiano", es: "Español" };
const LANG_FLAGS = { en: "🇬🇧", it: "🇮🇹", es: "🇪🇸" };

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
// PAGINA
// ============================================================

const EMPTY_DRAFT = {
  slug: "",
  date: new Date().toISOString().slice(0, 10),
  readTime: 2,
  sources: "",
  content: {},
  master: null,
};

export default function Test7() {
  const { idToken, email, buttonRef, logout } = useGoogleAuth();

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(""); // lang | "publish" | "load"
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [publishResult, setPublishResult] = useState(null);

  async function api(path, body) {
    setError("");
    setOkMsg("");
    const res = await fetch(API + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken,
      },
      body: JSON.stringify(body),
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

  // Carica la bozza quando c'è il token.
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    setBusy("load");
    fetch(API + "/api/admin/news-draft", {
      headers: { Authorization: "Bearer " + idToken },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        if (cancelled) return;
        setDraft({
          ...EMPTY_DRAFT,
          ...d,
          content: d.content || {},
          date: d.date || EMPTY_DRAFT.date,
        });
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setBusy("");
      });
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  function setContent(lang, patch) {
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

  // Salva una lingua → diventa master.
  async function saveLang(lang) {
    setBusy(lang);
    try {
      const c = draft.content[lang] || {};
      const d = await api("/api/admin/news-draft/save", {
        lang,
        content: { title: c.title || "", dek: c.dek || "", body: c.body || "" },
        slug: draft.slug,
        date: draft.date,
        readTime: draft.readTime,
        sources: draft.sources,
      });
      setDraft((prev) => ({ ...prev, ...d, content: d.content || {} }));
      setOkMsg(LANG_LABELS[lang] + " salvato: ora è la lingua master ★");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  // Rigenera una lingua dal master (Ollama).
  async function translateLang(lang) {
    setBusy(lang);
    try {
      const d = await api("/api/admin/news-draft/translate", { target_lang: lang });
      setDraft((prev) => ({ ...prev, ...d, content: d.content || {} }));
      setOkMsg(LANG_LABELS[lang] + " tradotto dal master (" + (d.master || "en") + ")");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  // Pubblica: articolo in aiEthics.js + commit + push.
  async function publish() {
    if (
      !window.confirm(
        "Pubblicare l'articolo su AI News?\n\nCommit + push su main di dv-site."
      )
    )
      return;
    setBusy("publish");
    setPublishResult(null);
    try {
      const d = await api("/api/admin/news-draft/publish", {
        slug: draft.slug,
        date: draft.date,
        readTime: draft.readTime,
        sources: draft.sources,
      });
      setPublishResult(d);
      setDraft({ ...EMPTY_DRAFT, date: EMPTY_DRAFT.date });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  if (!idToken) {
    return (
      <div className="nd-page">
        <h1>AI News Draft</h1>
        <p className="nd-empty">Accedi con Google per preparare la bozza.</p>
        <div ref={buttonRef} />
      </div>
    );
  }

  return (
    <div className="nd-page">
      <div className="nd-head">
        <div>
          <h1>AI News Draft</h1>
          <p className="nd-sub">
            Scrivi in inglese, salva: diventa master ★. Traduci IT/ES dal master,
            correggi, salva: la lingua corretta diventa il nuovo master.
          </p>
        </div>
        <div className="nd-auth">
          <span>{email}</span>
          <button className="nd-btn" onClick={logout}>Logout</button>
        </div>
      </div>

      {/* META */}
      <section className="nd-meta">
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
            <input
              value={draft.date}
              onChange={(e) => setMeta({ date: e.target.value })}
              placeholder="2026-11-06"
            />
          </label>
          <label>
            readTime (min)
            <input
              type="number"
              min="1"
              max="30"
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
      </section>

      {/* TRE RIQUADRI */}
      <div className="nd-cols">
        {LANGS.map((lang) => {
          const c = draft.content[lang] || { title: "", dek: "", body: "" };
          const isMaster = draft.master === lang;
          return (
            <section
              key={lang}
              className={"nd-col" + (isMaster ? " nd-master" : "")}
            >
              <div className="nd-col-head">
                <h2>
                  {LANG_FLAGS[lang]} {LANG_LABELS[lang]}{" "}
                  {isMaster && <span className="nd-star">★ master</span>}
                </h2>
              </div>
              <input
                placeholder="Title"
                value={c.title}
                onChange={(e) => setContent(lang, { title: e.target.value })}
              />
              <input
                placeholder="Dek (sottotitolo)"
                value={c.dek}
                onChange={(e) => setContent(lang, { dek: e.target.value })}
              />
              <textarea
                className="nd-body"
                placeholder={
                  lang === "en"
                    ? "Body inglese. Paragrafi separati da riga vuota; '## Titolo' per un heading."
                    : "Body (rigenerato dal master con Traduci, poi correggibile)"
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
                  disabled={busy === lang || !draft.master || draft.master === lang}
                  onClick={() => translateLang(lang)}
                  title={
                    draft.master === lang
                      ? "Questa lingua è già il master"
                      : "Rigenera dal master (" + LANG_LABELS[draft.master || "en"] + ")"
                  }
                >
                  Traduci
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {/* PUBBLICA */}
      <div className="nd-publish">
        <button
          className="nd-btn nd-danger"
          disabled={busy === "publish" || !draft.slug || !(draft.content.en || {}).body}
          onClick={publish}
          title={!draft.slug ? "Serve uno slug" : ""}
        >
          {busy === "publish" ? "Pubblicazione…" : "Pubblica su AI News"}
        </button>
        <span className="nd-hint">
          Inserisce l'articolo in aiEthics.js e fa commit + push su main
          (git pull, node --check, rollback se la sintassi fallisce).
        </span>
      </div>

      {error && <div className="nd-error">! {error}</div>}
      {okMsg && <div className="nd-ok">{okMsg}</div>}
      {!loaded && busy === "load" && <p className="nd-empty">Carico la bozza…</p>}

      {publishResult && (
        <div className="nd-ok">
          Pubblicato: articolo #{publishResult.number} “{publishResult.slug}” —
          commit <code>{publishResult.sha}</code>
        </div>
      )}

      <style>{`
        .nd-page { max-width: 1400px; margin: 0 auto; padding: 24px; color: #e5e7eb; min-height: 100vh; background: #0b0e14; }
        .nd-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
        .nd-head h1 { margin: 0 0 6px; }
        .nd-sub { margin: 0; color: #9ca3af; font-size: 13px; max-width: 560px; line-height: 1.5; }
        .nd-auth { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #9ca3af; }
        .nd-meta { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
        .nd-meta-row { display: flex; gap: 12px; flex-wrap: wrap; }
        .nd-meta label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; }
        .nd-meta label:first-child input { min-width: 260px; }
        .nd-meta label:nth-child(2) input { min-width: 130px; }
        .nd-meta label:nth-child(3) input { min-width: 80px; }
        .nd-meta > label { flex: 1; margin-top: 12px; }
        .nd-meta input, .nd-meta textarea, .nd-col input, .nd-col textarea {
          background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12);
          border-radius: 8px; color: #e5e7eb; padding: 8px 10px; font-size: 13px;
          width: 100%; box-sizing: border-box;
        }
        .nd-cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        @media (max-width: 1000px) { .nd-cols { grid-template-columns: 1fr; } }
        .nd-col { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
        .nd-col.nd-master { border-color: rgba(16,185,129,.5); }
        .nd-col-head { display: flex; justify-content: space-between; align-items: center; }
        .nd-col-head h2 { margin: 0; font-size: 15px; }
        .nd-star { color: #34d399; font-size: 11px; margin-left: 6px; }
        .nd-body { min-height: 300px; resize: vertical; line-height: 1.5; }
        .nd-actions { display: flex; gap: 8px; }
        .nd-btn { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #e5e7eb; border-radius: 8px; padding: 7px 14px; font-size: 13px; cursor: pointer; }
        .nd-btn:hover { background: rgba(255,255,255,.14); }
        .nd-btn:disabled { opacity: .5; cursor: not-allowed; }
        .nd-primary { background: #10b981; border-color: #10b981; color: #06281d; font-weight: 700; }
        .nd-danger { background: #6366f1; border-color: #6366f1; color: #fff; font-weight: 700; padding: 12px 22px; }
        .nd-publish { display: flex; align-items: center; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
        .nd-hint { color: #6b7280; font-size: 12px; max-width: 520px; }
        .nd-error { margin-top: 12px; color: #f87171; font-size: 13px; }
        .nd-ok { margin-top: 12px; color: #34d399; font-size: 13px; }
        .nd-empty { color: #6b7280; font-size: 13px; }
        .nd-page code { color: #34d399; }
      `}</style>
    </div>
  );
}
