// ============================================================
// I18N ADMIN — editor dei testi del sito (src/i18n/locales)
// ============================================================
// Ricerca una chiave (percorso puntato, es. "nav.home" o
// "expertise.items.0.title"), modifica il valore in qualsiasi
// lingua, pubblica con commit+push su main (git pull --ff-only
// + JSON indent 2). EN è il riferimento mostrato accanto a ogni
// campo. Le modifiche si accumulano e partono in un solo commit.
//
// AUTH: login Google, stesso client/token del gateway (come Test7).
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";

const API = "https://api.danielevillanova.com";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_STORAGE_KEY = "dv_google_id_token";

const LANGS = ["en", "it", "es", "fr", "ca", "nl"];
const LANG_LABELS = {
  en: "English", it: "Italiano", es: "Español",
  fr: "Français", ca: "Català", nl: "Nederlands",
};
const LANG_FLAGS = {
  en: "🇬🇧", it: "🇮🇹", es: "🇪🇸", fr: "🇫🇷", ca: "🏴", nl: "🇳🇱",
};

// ============================================================
// GOOGLE AUTH (stesso pattern di Test7)
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

// Oggetto → mappa { "percorso.puntato": valoreFoglia }
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const p = prefix ? prefix + "." + k : k;
    if (v && typeof v === "object") flatten(v, p, out);
    else out[p] = v;
  }
  return out;
}

// ============================================================
// PAGINA
// ============================================================

export default function I18nAdmin() {
  const { idToken, email, buttonRef, logout } = useGoogleAuth();

  const [locales, setLocales] = useState(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState("");
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  // gruppi CHIUSI di default: la mappa registra quelli APERTI
  const [openAcc, setOpenAcc] = useState({});

  async function api(path, body) {
    setError("");
    setOkMsg("");
    const res = await fetch(API + path, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "Content-Type": "application/json", Authorization: "Bearer " + idToken }
        : { Authorization: "Bearer " + idToken },
      ...(body ? { body: JSON.stringify(body) } : {}),
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

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    api("/api/admin/i18n")
      .then((d) => !cancelled && setLocales(d.langs || {}))
      .catch((e) => !cancelled && setError(e.message || String(e)));
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  const enFlat = useMemo(() => flatten(locales?.en), [locales]);
  const flatByLang = useMemo(() => {
    const m = {};
    for (const l of LANGS) m[l] = flatten(locales?.[l]);
    return m;
  }, [locales]);

  const paths = useMemo(() => {
    const list = Object.keys(enFlat);
    const f = filter.trim().toLowerCase();
    return (f ? list.filter((p) => p.toLowerCase().includes(f)) : list).sort();
  }, [enFlat, filter]);

  const tree = useMemo(() => {
    const t = {};
    for (const p of Object.keys(enFlat)) {
      const parts = p.split(".");
      const g = parts[0];
      if (!t[g]) t[g] = { direct: [], subs: {} };
      if (parts.length <= 2) t[g].direct.push(p);
      else (t[g].subs[parts[1]] ||= []).push(p);
    }
    return t;
  }, [enFlat]);

  const isDirty = (p) => Object.values(edits).some((o) => p in (o || {}));
  const toggle = (k) => () => setOpenAcc((c) => ({ ...c, [k]: !c[k] }));

  function keyBtn(p, label) {
    return (
      <button
        key={p}
        className={"i18-key" + (p === sel ? " i18-key-on" : "")}
        onClick={() => setSelected(p)}
        title={p}
      >
        {label}
        {isDirty(p) ? <span className="i18-dirty">•</span> : null}
      </button>
    );
  }

  const sel = selected && selected in enFlat ? selected : paths[0] || "";

  function valueFor(lang, path) {
    if (edits[lang] && path in edits[lang]) return edits[lang][path];
    const v = flatByLang[lang][path];
    return v === undefined || v === null ? "" : String(v);
  }

  function setEdit(lang, path, value) {
    setEdits((e) => {
      const next = { ...e, [lang]: { ...(e[lang] || {}), [path]: value } };
      // nessun cambio reale → togli dal registro delle modifiche
      if (next[lang][path] === String(flatByLang[lang][path] ?? "")) {
        delete next[lang][path];
        if (!Object.keys(next[lang]).length) delete next[lang];
      }
      return next;
    });
  }

  const nEdits = Object.values(edits).reduce(
    (n, o) => n + Object.keys(o || {}).length,
    0
  );

  async function publish() {
    if (!nEdits) return;
    if (
      !window.confirm(
        "Pubblicare " + nEdits + " modifica/i i18n?\nCommit + push su main di dv-site."
      )
    )
      return;
    setBusy("publish");
    try {
      const d = await api("/api/admin/i18n/save", { changes: edits });
      setOkMsg(
        "Pubblicato: " + d.sha + " (" + (d.langs || []).join("/").toUpperCase() + ")"
      );
      setEdits({});
      const l = await api("/api/admin/i18n");
      setLocales(l.langs || {});
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  if (!idToken) {
    return (
      <div className="i18-page">
        <h1>I18n Admin</h1>
        <p className="i18-empty">
          Accedi con Google per modificare i testi del sito.
        </p>
        <div ref={buttonRef} />
      </div>
    );
  }

  return (
    <div className="i18-page">
      <div className="i18-head">
        <div>
          <h1>I18n Admin</h1>
          <p className="i18-sub">
            Testi del sito (src/i18n/locales). Seleziona una chiave, modifica le
            lingue che vuoi (EN è il riferimento), poi pubblica: un solo commit
            con tutte le modifiche.
          </p>
        </div>
        <div className="i18-auth">
          <span>{email}</span>
          <button className="i18-btn" onClick={logout}>Logout</button>
        </div>
      </div>

      <div className="i18-toolbar">
        <input
          className="i18-search"
          placeholder="cerca chiave (es. nav.home, ethics, qdb.err)…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="i18-btn i18-primary"
          disabled={busy === "publish" || !nEdits}
          onClick={publish}
          title="Commit + push su main (git pull --ff-only, JSON indent 2)"
        >
          {busy === "publish"
            ? "Pubblicazione…"
            : nEdits
            ? "Pubblica " + nEdits + " modifica" + (nEdits > 1 ? "i" : "")
            : "Pubblica"}
        </button>
      </div>

      {!locales ? (
        <p className="i18-empty">Caricamento…</p>
      ) : (
        <div className="i18-cols">
          <div className="i18-list">
            {paths.length === 0 && (
              <p className="i18-empty">Nessuna chiave trovata.</p>
            )}
            {filter.trim()
              ? paths.map((p) => keyBtn(p, p))
              : Object.keys(tree).sort().map((g) => {
                  const node = tree[g];
                  const gPaths = node.direct.concat(...Object.values(node.subs));
                  const gOpen = !!openAcc[g];
                  return (
                    <div key={g} className="i18-group">
                      <button className="i18-group-btn" onClick={toggle(g)}>
                        <span className="i18-arrow">{gOpen ? "▾" : "▸"}</span>
                        {g}
                        <span className="i18-count">{gPaths.length}</span>
                        {gPaths.some(isDirty) ? (
                          <span className="i18-dirty">•</span>
                        ) : null}
                      </button>
                      {gOpen && (
                        <div className="i18-group-body">
                          {node.direct.map((p) =>
                            keyBtn(p, p === g ? p : p.slice(g.length + 1))
                          )}
                          {Object.keys(node.subs).sort().map((s) => {
                            const sk = g + "." + s;
                            const spaths = node.subs[s];
                            const sOpen = !!openAcc[sk];
                            return (
                              <div key={sk} className="i18-sub">
                                <button className="i18-sub-btn" onClick={toggle(sk)}>
                                  <span className="i18-arrow">
                                    {sOpen ? "▾" : "▸"}
                                  </span>
                                  {s}
                                  <span className="i18-count">{spaths.length}</span>
                                  {spaths.some(isDirty) ? (
                                    <span className="i18-dirty">•</span>
                                  ) : null}
                                </button>
                                {sOpen &&
                                  spaths.map((p) =>
                                    keyBtn(p, p.slice(sk.length + 1))
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
          </div>

          <div className="i18-editor">
            {sel ? (
              <>
                <div className="i18-selkey">{sel}</div>
                {LANGS.map((l) => {
                  const val = valueFor(l, sel);
                  const ref = String(enFlat[sel] ?? "");
                  const dirty = !!(edits[l] && sel in edits[l]);
                  const long = ref.length > 80 || val.length > 80;
                  return (
                    <div key={l} className="i18-row">
                      <label className="i18-lang">
                        {LANG_FLAGS[l]} {LANG_LABELS[l]}
                        {l === "en" && <span className="i18-ref">riferimento</span>}
                      </label>
                      {long ? (
                        <textarea
                          rows={3}
                          value={val}
                          onChange={(e) => setEdit(l, sel, e.target.value)}
                        />
                      ) : (
                        <input
                          value={val}
                          onChange={(e) => setEdit(l, sel, e.target.value)}
                        />
                      )}
                      <div className="i18-refval" title="Valore EN di riferimento">
                        {l !== "en" && "EN: " + (ref || "(vuoto)")}
                      </div>
                      {dirty && <span className="i18-dirty-badge">modificato</span>}
                    </div>
                  );
                })}
              </>
            ) : (
              <p className="i18-empty">Seleziona una chiave a sinistra.</p>
            )}
          </div>
        </div>
      )}

      {error && <div className="i18-error">! {error}</div>}
      {okMsg && <div className="i18-ok">{okMsg}</div>}

      <style>{`
        .i18-page { max-width: 1400px; margin: 0 auto; padding: 24px; color: #e5e7eb; min-height: 100vh; background: #0b0e14; }
        .i18-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
        .i18-head h1 { margin: 0 0 6px; }
        .i18-sub { margin: 0; color: #9ca3af; font-size: 13px; max-width: 620px; line-height: 1.5; }
        .i18-auth { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #9ca3af; }
        .i18-toolbar { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
        .i18-search { flex: 1; min-width: 240px; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: #e5e7eb; padding: 10px 12px; font-size: 13px; }
        .i18-cols { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
        @media (max-width: 900px) { .i18-cols { grid-template-columns: 1fr; } }
        .i18-list { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 8px; max-height: 72vh; overflow: auto; }
        .i18-key { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: none; border-radius: 8px; color: #b8c6d4; padding: 7px 10px; font-size: 12.5px; cursor: pointer; font-family: ui-monospace, monospace; }
        .i18-key:hover { background: rgba(255,255,255,.06); }
        .i18-key-on { background: rgba(16,185,129,.15); color: #fff; }
        .i18-dirty { color: #f59e0b; }
        .i18-editor { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
        .i18-selkey { font-family: ui-monospace, monospace; font-size: 14px; color: #5eead4; }
        .i18-row { display: flex; flex-direction: column; gap: 4px; position: relative; }
        .i18-lang { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; }
        .i18-ref { margin-left: 8px; color: #34d399; text-transform: none; letter-spacing: 0; }
        .i18-row input, .i18-row textarea { background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: #e5e7eb; padding: 8px 10px; font-size: 13px; width: 100%; box-sizing: border-box; resize: vertical; line-height: 1.5; }
        .i18-refval { font-size: 11.5px; color: #6b7280; min-height: 14px; }
        .i18-dirty-badge { position: absolute; top: 0; right: 0; font-size: 10.5px; color: #f59e0b; }
        .i18-btn { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #e5e7eb; border-radius: 8px; padding: 7px 14px; font-size: 13px; cursor: pointer; }
        .i18-btn:hover { background: rgba(255,255,255,.14); }
        .i18-btn:disabled { opacity: .5; cursor: not-allowed; }
        .i18-primary { background: #10b981; border-color: #10b981; color: #06281d; font-weight: 700; }
        .i18-error { margin-top: 12px; color: #f87171; font-size: 13px; }
        .i18-ok { margin-top: 12px; color: #34d399; font-size: 13px; }
        .i18-empty { color: #6b7280; font-size: 13px; }
        .i18-group { margin: 2px 0; }
        .i18-group-btn { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: rgba(255,255,255,.05); border: none; border-radius: 8px; color: #e5e7eb; padding: 7px 10px; font-size: 12px; cursor: pointer; font-family: ui-monospace, monospace; font-weight: 700; }
        .i18-group-btn:hover { background: rgba(255,255,255,.1); }
        .i18-sub-btn { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: none; border: none; border-radius: 6px; color: #9db3c2; padding: 5px 10px 5px 24px; font-size: 11.5px; cursor: pointer; font-family: ui-monospace, monospace; }
        .i18-sub-btn:hover { background: rgba(255,255,255,.06); }
        .i18-count { color: #6b7280; font-weight: 400; }
        .i18-arrow { width: 12px; text-align: center; color: #6b7280; }
        .i18-group-body .i18-key { padding-left: 36px; }
      `}</style>
    </div>
  );
}
