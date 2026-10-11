// ============================================================
// TEST3 — Bar AI Admin: gestione tabelle gestionali (CRUD)
// ============================================================
// Evoluzione di Test6: errori parlanti, righe sporche evidenziate,
// select prodotto/ingrediente nelle righe Ricette, skeleton di
// caricamento, contatore righe, focus automatico dopo aggiunta.
//
// AUTH: login Google, pattern condiviso con Improve.jsx
// (chiave localStorage dv_google_id_token).
//
// API (via gateway, con Bearer Google ID token):
//   GET    /api/bar-ai/admin/tables/{table}
//   POST   /api/bar-ai/admin/tables/{table}
//   PUT    /api/bar-ai/admin/tables/{table}
//   DELETE /api/bar-ai/admin/tables/{table}?pk=...
//   GET    /api/bar-ai/admin/options
//
// Finché la rotta admin non è attiva sul gateway la pagina resta
// in modalità "read-only fallback": spiega cosa manca invece di
// mostrare solo "Not Found".
// ============================================================

import { useState, useEffect, useRef } from "react";

const API = "https://api.danielevillanova.com";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_STORAGE_KEY = "dv_google_id_token";

const UNITS = ["ml", "g", "pcs", "pz", "bottle"];

// ------------------------------------------------------------
// GOOGLE AUTH (pattern condiviso con Improve.jsx)
// ------------------------------------------------------------
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

  useEffect(() => {
    function onStorage(e) {
      if (e.key !== TOKEN_STORAGE_KEY) return;
      setIdToken(e.newValue && isTokenValid(e.newValue) ? e.newValue : null);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const buttonRef = useRef(null);

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

// ------------------------------------------------------------
// DEFINIZIONE TABELLE
// ------------------------------------------------------------
const TABS = {
  ingredients: {
    label: "Ingredienti",
    pk: "ingredient_id",
    singular: "ingrediente",
    cols: [
      { k: "ingredient_id", label: "ID", ro: true },
      { k: "name", label: "Nome", type: "text" },
      { k: "unit", label: "Unità", type: "select", opts: UNITS },
      { k: "bottle_size_ml", label: "Bottiglia (ml)", type: "number" },
    ],
  },
  recipes: {
    label: "Ricette",
    pk: "recipe_id",
    singular: "ricetta",
    cols: [
      { k: "recipe_id", label: "ID", ro: true },
      { k: "product_id", label: "Prodotto", type: "optselect", optKey: "products", optLabel: (p) => "#" + p.ProductID + " · " + p.Category },
      { k: "ingredient_id", label: "Ingrediente", type: "optselect", optKey: "ingredients", optLabel: (i) => i.name },
      { k: "quantity_per_serving", label: "Qtà/porzione", type: "number" },
    ],
  },
  inventory: {
    label: "Magazzino",
    pk: "ingredient_id",
    singular: "voce di magazzino",
    cols: [
      { k: "ingredient_id", label: "ID", ro: true },
      { k: "name", label: "Ingrediente", ro: true },
      { k: "stock_level", label: "Giacenza", type: "number" },
      { k: "min_threshold", label: "Soglia min.", type: "number" },
      { k: "last_updated", label: "Agg.", ro: true, short: true },
    ],
  },
};

// ------------------------------------------------------------
// PAGINA
// ------------------------------------------------------------
export default function Test3() {
  const { idToken, email, buttonRef, logout } = useGoogleAuth();

  const [tab, setTab] = useState("ingredients");
  const [rows, setRows] = useState([]);
  const [originals, setOriginals] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [opts, setOpts] = useState({ products: [], ingredients: [] });
  const [error, setError] = useState("");
  const [warn, setWarn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingPk, setSavingPk] = useState(null);

  const [recipeSel, setRecipeSel] = useState({});
  const [newRow, setNewRow] = useState({});
  const firstAddRef = useRef(null);

  // ---------- API con errori parlanti ----------
  function describeError(status, detail) {
    if (status === 401) return "🔒 Sessione scaduta: rifai il login Google (Logout → accedi di nuovo).";
    if (status === 403) return "⛔ Accesso negato: l'email non è in ADMIN_ALLOWED_EMAIL sul gateway.";
    if (status === 404)
      return "🔌 Rotta admin non attiva sul gateway (o servizio backend fermo).\nPer attivarla serve il blocco /api/bar-ai/admin in gateway.py e il router admin in main.py (porta 8081). Nel frattempo puoi leggere i dati dalla pagina del bar via /ask.";
    if (status === 502) return "⚠️ Backend Bar AI non raggiungibile sulla 8081: controlla che main.py giri (restart bar_ai dalla console).";
    if (status === 400 && /foreign key|violat/i.test(detail || ""))
      return "❌ Il database rifiuta l'operazione: la riga è referenziata da altre tabelle (FK). Elimina prima le righe collegate.";
    if (status === 429) return "🐌 Troppe richieste: attendi qualche istante e riprova.";
    return "Errore " + status + (detail ? ": " + detail : "");
  }

  async function call(path, method, body) {
    const res = await fetch(API + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail || "");
      const err = new Error(describeError(res.status, detail));
      err.friendly = true;
      err.status = res.status;
      throw err;
    }
    return d;
  }

  // ---------- Caricamento ----------
  async function load() {
    setLoaded(false);
    setError("");
    setWarn("");
    try {
      const [t, o] = await Promise.all([
        call("/api/bar-ai/admin/tables/" + tab, "GET"),
        call("/api/bar-ai/admin/options", "GET"),
      ]);
      setRows(t.rows || []);
      setOriginals(Object.fromEntries((t.rows || []).map((r) => [r[TABS[tab].pk], r])));
      setOpts({ products: o.products || [], ingredients: o.ingredients || [] });
    } catch (e) {
      setRows([]);
      setOriginals({});
      if (e.status === 404) setError(e.message);
      else setError(e.friendly ? e.message : "Errore di rete o backend non raggiungibile: " + (e.message || e));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (!idToken) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken, tab]);

  // ---------- Righe sporche ----------
  function isDirty(row) {
    const pk = row[TABS[tab].pk];
    const orig = originals[pk];
    if (!orig) return false;
    return TABS[tab].cols.some((c) => {
      if (c.ro) return false;
      if (tab === "recipes" && (c.k === "product_id" || c.k === "ingredient_id")) {
        return recipeSel[pk] !== undefined && recipeSel[pk] !== "";
      }
      return String(row[c.k] ?? "") !== String(orig[c.k] ?? "");
    });
  }

  const dirtyCount = rows.filter(isDirty).length;

  function switchTab(next) {
    if (dirtyCount > 0) {
      const ok = window.confirm(
        "Hai " + dirtyCount + " rig" + (dirtyCount === 1 ? "a" : "he") + " modificata" + (dirtyCount === 1 ? "" : "e") + " non salvata" + (dirtyCount === 1 ? "" : "e") + " in \"" + TABS[tab].label + "\".\nCambiare tab senza salvare perderà le modificazioni. Continuare?"
      );
      if (!ok) return;
    }
    setRecipeSel({});
    setNewRow({});
    setNote("");
    setWarn("");
    setTab(next);
  }

  // ---------- Scrittura ----------
  async function saveRow(row) {
    const pk = row[TABS[tab].pk];
    setError("");
    setNote("");
    setSavingPk(pk);
    try {
      const cfg = TABS[tab];
      const fields = {};
      cfg.cols.forEach((c) => {
        if (c.ro) return;
        if (tab === "recipes" && (c.k === "product_id" || c.k === "ingredient_id")) {
          if (recipeSel[pk]) fields[c.k] = recipeSel[pk];
        } else {
          fields[c.k] = row[c.k];
        }
      });
      await call("/api/bar-ai/admin/tables/" + tab, "PUT", { pk, fields });
      setNote("Salvato ✔");
      setRecipeSel((s) => { const n = { ...s }; delete n[pk]; return n; });
      await load();
    } catch (e) {
      setError(e.friendly ? e.message : "Salvataggio fallito: " + (e.message || e));
    } finally {
      setSavingPk(null);
    }
  }

  async function removeRow(row) {
    const pk = row[TABS[tab].pk];
    const name = row.name || row.ingredient_name || row.recipe_id;
    if (!window.confirm("Eliminare \"" + name + "\" (riga " + pk + ")?\nSe la riga è referenziata da altre tabelle il DB la bloccherà.")) return;
    setError("");
    setNote("");
    setSavingPk(pk);
    try {
      await call("/api/bar-ai/admin/tables/" + tab + "?pk=" + pk, "DELETE");
      setNote("Eliminato ✔");
      await load();
    } catch (e) {
      setError(e.friendly ? e.message : "Eliminazione fallita: " + (e.message || e));
    } finally {
      setSavingPk(null);
    }
  }

  async function addRow() {
    setError("");
    setNote("");
    setBusy(true);
    try {
      const fields = {};
      Object.entries(newRow).forEach(([k, v]) => {
        if (v !== "" && v !== undefined) fields[k] = v;
      });
      if (Object.keys(fields).length === 0) {
        setError("Compila almeno un campo prima di aggiungere.");
        return;
      }
      await call("/api/bar-ai/admin/tables/" + tab, "POST", { fields });
      setNewRow({});
      setNote("Aggiunto ✔");
      await load();
      if (firstAddRef.current) firstAddRef.current.focus();
    } catch (e) {
      setError(e.friendly ? e.message : "Aggiunta fallita: " + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  function setCell(pk, key, value) {
    setRows((rs) => rs.map((r) => (r[TABS[tab].pk] === pk ? { ...r, [key]: value } : r)));
  }

  function setRecipeOpt(pk, key, value) {
    setRecipeSel((s) => ({ ...s, [pk]: { ...(s[pk] || {}), [key]: value } }));
  }

  // ---------- Login gate ----------
  if (!idToken) {
    return (
      <div className="bau-page">
        <h1>Bar AI — Gestione dati</h1>
        <p>Accedi con Google per gestire ingredienti, ricette e magazzino.</p>
        <div ref={buttonRef} />
        <style>{`
        .bau-page { max-width: 1200px; margin: 0 auto; padding: 24px; color: #e5e7eb; min-height: 100vh; background: #0b0e14; }
        .bau-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; flex-wrap: wrap; gap: 10px; }
        .bau-auth { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #9ca3af; }
        .bau-tabs { display: flex; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
        .bau-tab-active { border-color: #10b981; background: rgba(16,185,129,.16); color: #6ee7b7; }
        .bau-count { color: #6b7280; font-size: 12px; margin-bottom: 12px; }
        .bau-btn { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #e5e7eb; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
        .bau-btn:hover { background: rgba(255,255,255,.14); }
        .bau-btn:disabled { opacity: .5; cursor: not-allowed; }
        .bau-primary { background: #10b981; border-color: #10b981; color: #06281d; font-weight: 700; }
        .bau-primary:hover { background: #34d399; }
        .bau-danger { background: rgba(239,68,68,.16); border-color: rgba(239,68,68,.5); color: #fca5a5; }
        .bau-danger:hover { background: rgba(239,68,68,.28); }
        .bau-table-wrap { overflow-x: auto; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; }
        .bau-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .bau-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.1); white-space: nowrap; }
        .bau-table td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: middle; }
        .bau-table tr:hover td { background: rgba(255,255,255,.02); }
        .bau-tr-dirty td { background: rgba(251,191,36,.06); }
        .bau-tr-dirty:hover td { background: rgba(251,191,36,.1); }
        .bau-tr-saving td { opacity: .55; }
        .bau-input, .bau-select { background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12); border-radius: 6px; color: #e5e7eb; padding: 5px 8px; font-size: 13px; min-width: 90px; max-width: 220px; }
        .bau-input:focus, .bau-select:focus { outline: none; border-color: #10b981; }
        .bau-ro { color: #9ca3af; white-space: nowrap; }
        .bau-id { color: #6ee7b7; }
        .bau-error { margin-top: 12px; background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.3); border-radius: 10px; padding: 10px 14px; color: #f87171; font-size: 13px; white-space: pre-wrap; }
        .bau-warn { margin-top: 12px; background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.3); border-radius: 10px; padding: 10px 14px; color: #fbbf24; font-size: 13px; white-space: pre-wrap; }
        .bau-note { margin-top: 8px; color: #fbbf24; font-size: 13px; }
        .bau-ok { color: #34d399; font-size: 13px; }
        .bau-empty { color: #6b7280; font-size: 13px; padding: 16px; }
        .bau-addrow { display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-end; padding: 12px; }
        .bau-field { display: flex; flex-direction: column; gap: 4px; }
        .bau-field label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; }
        .bau-cell-actions { display: flex; gap: 4px; white-space: nowrap; }
        .bau-skel { height: 14px; border-radius: 6px; background: linear-gradient(90deg, rgba(255,255,255,.05) 25%, rgba(255,255,255,.12) 50%, rgba(255,255,255,.05) 75%); background-size: 200% 100%; animation: bau-shimmer 1.4s infinite; }
        @keyframes bau-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .bau-dirty-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #fbbf24; margin-left: 6px; }
  `}</style>
      </div>
    );
  }

  const cfg = TABS[tab];

  // ---------- Skeleton ----------
  const SkeletonRows = () => (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i}>
          {cfg.cols.map((c) => (
            <td key={c.k}>
              <div className="bau-skel" style={{ width: 60 + ((i * 37) % 80) }} />
            </td>
          ))}
          <td><div className="bau-skel" style={{ width: 90 }} /></td>
        </tr>
      ))}
    </>
  );

  return (
    <div className="bau-page">
      <div className="bau-head">
        <h1>Bar AI — Gestione dati</h1>
        <div className="bau-auth">
          <span>{email}</span>
          <button onClick={logout} className="bau-btn">Logout</button>
        </div>
      </div>

      <div className="bau-tabs">
        {Object.entries(TABS).map(([key, t]) => (
          <button
            key={key}
            className={"bau-btn " + (tab === key ? "bau-tab-active" : "")}
            onClick={() => switchTab(key)}
          >
            {t.label}
            {tab === key && dirtyCount > 0 && <span className="bau-dirty-dot" title={dirtyCount + " modifiche non salvate"} />}
          </button>
        ))}
      </div>

      {loaded && rows.length > 0 && (
        <p className="bau-count">
          {rows.length} {rows.length === 1 ? cfg.singular : (cfg.singular === "voce di magazzino" ? "voci di magazzino" : cfg.singular + "i")}
          {dirtyCount > 0 && " · " + dirtyCount + " con modifiche non salvate"}
        </p>
      )}

      {error && <div className="bau-error">{error}</div>}
      {warn && <div className="bau-warn">{warn}</div>}
      {note && <div className="bau-ok">{note}</div>}

      {/* Skeleton durante il caricamento */}
      {!loaded && (
        <div className="bau-table-wrap">
          <table className="bau-table">
            <thead>
              <tr>
                {cfg.cols.map((c) => <th key={c.k}>{c.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody><SkeletonRows /></tbody>
          </table>
        </div>
      )}

      {loaded && (
        <div className="bau-table-wrap">
          <table className="bau-table">
            <thead>
              <tr>
                {cfg.cols.map((c) => (
                  <th key={c.k}>{c.label}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cfg.cols.length + 1} className="bau-empty">
                    Nessuna riga. Aggiungine una dal form in basso.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const pk = row[cfg.pk];
                const dirty = isDirty(row);
                const saving = savingPk === pk;
                return (
                  <tr key={pk} className={(dirty ? "bau-tr-dirty " : "") + (saving ? "bau-tr-saving" : "")}>
                    {cfg.cols.map((c) => (
                      <td key={c.k}>
                        {c.ro ? (
                          <span className={c.k === cfg.pk ? "bau-id" : "bau-ro"}>
                            {c.short ? String(row[c.k] || "").replace("T", " ").slice(0, 16) : String(row[c.k] ?? "")}
                          </span>
                        ) : c.type === "optselect" ? (
                          <select
                            className="bau-select"
                            value={recipeSel[pk]?.[c.k] || row[c.k]}
                            onChange={(e) => setRecipeOpt(pk, c.k, e.target.value)}
                          >
                            {(opts[c.optKey] || []).map((o) => (
                              <option key={o.ProductID || o.ingredient_id} value={o.ProductID || o.ingredient_id}>
                                {c.optLabel(o)}
                              </option>
                            ))}
                          </select>
                        ) : c.type === "select" ? (
                          <select
                            className="bau-select"
                            value={row[c.k] ?? ""}
                            onChange={(e) => setCell(pk, c.k, e.target.value)}
                          >
                            {c.opts.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                        ) : (
                          <input
                            className="bau-input"
                            type={c.type === "number" ? "number" : "text"}
                            step="any"
                            value={row[c.k] ?? ""}
                            onChange={(e) => setCell(pk, c.k, e.target.value)}
                          />
                        )}
                      </td>
                    ))}
                    <td>
                      <div className="bau-cell-actions">
                        <button
                          className="bau-btn bau-primary"
                          disabled={busy || saving || (!dirty && !(recipeSel[pk]))}
                          onClick={() => saveRow(row)}
                          title={dirty || recipeSel[pk] ? "Salva le modifiche di questa riga" : "Nessuna modifica da salvare"}
                        >
                          {saving ? "…" : "Salva"}
                        </button>
                        <button className="bau-btn bau-danger" disabled={busy || saving} onClick={() => removeRow(row)}>
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Riga di aggiunta */}
              <tr>
                <td colSpan={cfg.cols.length + 1}>
                  <div className="bau-addrow">
                    {tab === "ingredients" && (
                      <>
                        <div className="bau-field">
                          <label>Nome</label>
                          <input ref={firstAddRef} className="bau-input" value={newRow.name || ""} onChange={(e) => setNewRow((r) => ({ ...r, name: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Unità</label>
                          <select className="bau-select" value={newRow.unit || "ml"} onChange={(e) => setNewRow((r) => ({ ...r, unit: e.target.value }))}>
                            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                        <div className="bau-field">
                          <label>Bottiglia (ml)</label>
                          <input className="bau-input" type="number" step="any" value={newRow.bottle_size_ml ?? ""} onChange={(e) => setNewRow((r) => ({ ...r, bottle_size_ml: e.target.value }))} />
                        </div>
                      </>
                    )}
                    {tab === "recipes" && (
                      <>
                        <div className="bau-field">
                          <label>Prodotto</label>
                          <select className="bau-select" value={newRow.product_id || ""} onChange={(e) => setNewRow((r) => ({ ...r, product_id: e.target.value }))}>
                            <option value="">- scegli -</option>
                            {opts.products.map((p) => (
                              <option key={p.ProductID} value={p.ProductID}>
                                #{p.ProductID} · {p.Category} (€{p.Price})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="bau-field">
                          <label>Ingrediente</label>
                          <select className="bau-select" value={newRow.ingredient_id || ""} onChange={(e) => setNewRow((r) => ({ ...r, ingredient_id: e.target.value }))}>
                            <option value="">- scegli -</option>
                            {opts.ingredients.map((i) => (
                              <option key={i.ingredient_id} value={i.ingredient_id}>
                                {i.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="bau-field">
                          <label>Qtà/porzione</label>
                          <input ref={firstAddRef} className="bau-input" type="number" step="any" value={newRow.quantity_per_serving || ""} onChange={(e) => setNewRow((r) => ({ ...r, quantity_per_serving: e.target.value }))} />
                        </div>
                      </>
                    )}
                    {tab === "inventory" && (
                      <>
                        <div className="bau-field">
                          <label>Ingrediente</label>
                          <select className="bau-select" value={newRow.ingredient_id || ""} onChange={(e) => setNewRow((r) => ({ ...r, ingredient_id: e.target.value }))}>
                            <option value="">- scegli -</option>
                            {opts.ingredients.map((i) => (
                              <option key={i.ingredient_id} value={i.ingredient_id}>
                                {i.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="bau-field">
                          <label>Giacenza</label>
                          <input ref={firstAddRef} className="bau-input" type="number" step="any" value={newRow.stock_level ?? ""} onChange={(e) => setNewRow((r) => ({ ...r, stock_level: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Soglia min.</label>
                          <input className="bau-input" type="number" step="any" value={newRow.min_threshold ?? ""} onChange={(e) => setNewRow((r) => ({ ...r, min_threshold: e.target.value }))} />
                        </div>
                      </>
                    )}
                    <button className="bau-btn bau-primary" disabled={busy} onClick={addRow}>
                      + Aggiungi
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="bau-note">
        Le modifiche vanno direttamente nel database bardata. Le righe evidenziate in ambra hanno modifiche non salvate;
        le eliminazioni bloccate dal database indicano righe referenziate da altre tabelle (FK).
      </p>

      <style>{`
        .bau-page { max-width: 1200px; margin: 0 auto; padding: 24px; color: #e5e7eb; min-height: 100vh; background: #0b0e14; }
        .bau-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; flex-wrap: wrap; gap: 10px; }
        .bau-auth { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #9ca3af; }
        .bau-tabs { display: flex; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
        .bau-tab-active { border-color: #10b981; background: rgba(16,185,129,.16); color: #6ee7b7; }
        .bau-count { color: #6b7280; font-size: 12px; margin-bottom: 12px; }
        .bau-btn { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #e5e7eb; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
        .bau-btn:hover { background: rgba(255,255,255,.14); }
        .bau-btn:disabled { opacity: .5; cursor: not-allowed; }
        .bau-primary { background: #10b981; border-color: #10b981; color: #06281d; font-weight: 700; }
        .bau-primary:hover { background: #34d399; }
        .bau-danger { background: rgba(239,68,68,.16); border-color: rgba(239,68,68,.5); color: #fca5a5; }
        .bau-danger:hover { background: rgba(239,68,68,.28); }
        .bau-table-wrap { overflow-x: auto; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; }
        .bau-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .bau-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.1); white-space: nowrap; }
        .bau-table td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: middle; }
        .bau-table tr:hover td { background: rgba(255,255,255,.02); }
        .bau-tr-dirty td { background: rgba(251,191,36,.06); }
        .bau-tr-dirty:hover td { background: rgba(251,191,36,.1); }
        .bau-tr-saving td { opacity: .55; }
        .bau-input, .bau-select { background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12); border-radius: 6px; color: #e5e7eb; padding: 5px 8px; font-size: 13px; min-width: 90px; max-width: 220px; }
        .bau-input:focus, .bau-select:focus { outline: none; border-color: #10b981; }
        .bau-ro { color: #9ca3af; white-space: nowrap; }
        .bau-id { color: #6ee7b7; }
        .bau-error { margin-top: 12px; background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.3); border-radius: 10px; padding: 10px 14px; color: #f87171; font-size: 13px; white-space: pre-wrap; }
        .bau-warn { margin-top: 12px; background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.3); border-radius: 10px; padding: 10px 14px; color: #fbbf24; font-size: 13px; white-space: pre-wrap; }
        .bau-note { margin-top: 8px; color: #fbbf24; font-size: 13px; }
        .bau-ok { color: #34d399; font-size: 13px; }
        .bau-empty { color: #6b7280; font-size: 13px; padding: 16px; }
        .bau-addrow { display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-end; padding: 12px; }
        .bau-field { display: flex; flex-direction: column; gap: 4px; }
        .bau-field label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; }
        .bau-cell-actions { display: flex; gap: 4px; white-space: nowrap; }
        .bau-skel { height: 14px; border-radius: 6px; background: linear-gradient(90deg, rgba(255,255,255,.05) 25%, rgba(255,255,255,.12) 50%, rgba(255,255,255,.05) 75%); background-size: 200% 100%; animation: bau-shimmer 1.4s infinite; }
        @keyframes bau-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .bau-dirty-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #fbbf24; margin-left: 6px; }
  `}</style>
    </div>
  );
}
