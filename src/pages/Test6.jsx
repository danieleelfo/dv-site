// ============================================================
// TEST6 — Bar AI Update: gestione tabelle gestionali (admin)
// ============================================================
// Visualizza e modifica Ingredients, RecipeIngredients, Inventory,
// Suppliers e PurchaseOrders del database bardata di Bar AI.
// Quando è approvata diventa BarAIUpdate.jsx con rotta /bar-ai-update.
//
// AUTH: login Google, stesso pattern di Improve.jsx
// (chiave localStorage condivisa dv_google_id_token).
//
// API (via gateway, con Bearer Google ID token):
//   GET    /api/bar-ai/admin/tables/{table}
//   POST   /api/bar-ai/admin/tables/{table}
//   PUT    /api/bar-ai/admin/tables/{table}
//   DELETE /api/bar-ai/admin/tables/{table}?pk=...
//   GET    /api/bar-ai/admin/options
// ============================================================

import { useState, useEffect, useRef } from "react";

const API = "https://api.danielevillanova.com";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_STORAGE_KEY = "dv_google_id_token";

const UNITS = ["ml", "g", "pcs", "pz", "bottle"];
const ORDER_STATUSES = ["pending", "received", "cancelled"];

// ------------------------------------------------------------
// GOOGLE AUTH (identico a Improve.jsx)
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
    cols: [
      { k: "recipe_id", label: "ID", ro: true },
      { k: "product_name", label: "Prodotto", ro: true },
      { k: "ingredient_name", label: "Ingrediente", ro: true },
      { k: "quantity_per_serving", label: "Qtà/porzione", type: "number" },
    ],
  },
  inventory: {
    label: "Magazzino",
    pk: "ingredient_id",
    cols: [
      { k: "ingredient_id", label: "ID", ro: true },
      { k: "name", label: "Ingrediente", ro: true },
      { k: "stock_level", label: "Giacenza", type: "number" },
      { k: "min_threshold", label: "Soglia min.", type: "number" },
      { k: "last_updated", label: "Agg.", ro: true },
    ],
  },
  suppliers: {
    label: "Fornitori",
    pk: "supplier_id",
    cols: [
      { k: "supplier_id", label: "ID", ro: true },
      { k: "name", label: "Nome", type: "text" },
      { k: "contact_name", label: "Contatto", type: "text" },
      { k: "email", label: "Email", type: "text" },
      { k: "phone", label: "Telefono", type: "text" },
      { k: "category", label: "Categoria", type: "text" },
      { k: "lead_time_days", label: "Lead time (gg)", type: "number" },
      { k: "notes", label: "Note", type: "text" },
    ],
  },
  orders: {
    label: "Ordini",
    pk: "order_id",
    cols: [
      { k: "order_id", label: "ID", ro: true },
      { k: "supplier_name", label: "Fornitore", ro: true },
      { k: "supplier_id", label: "Fornitore (id)", type: "select", opts: "suppliers", optValue: "supplier_id", optLabel: "name" },
      { k: "restaurant_id", label: "Ristorante", type: "number" },
      { k: "order_date", label: "Data", type: "date" },
      { k: "status", label: "Status", type: "select", staticOpts: ORDER_STATUSES },
      { k: "total_amount", label: "Totale €", type: "number" },
    ],
  },
};

// ------------------------------------------------------------
// PAGINA
// ------------------------------------------------------------
export default function Test6() {
  const { idToken, email, buttonRef, logout } = useGoogleAuth();

  const [tab, setTab] = useState("ingredients");
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [opts, setOpts] = useState({ products: [], ingredients: [], suppliers: [] });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Select per ricette (product_id / ingredient_id)
  const [recipeSel, setRecipeSel] = useState({ product: "", ingredient: "" });

  // Riga nuova (form aggiunta)
  const [newRow, setNewRow] = useState({});

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
      const hint = res.status === 404
        ? "\n\nL'endpoint admin non è ancora attivo sul gateway: serve il blocco /api/bar-ai/admin in gateway.py e admin_api avviato su porta 8083."
        : "";
      throw new Error(detail || "HTTP " + res.status + hint);
    }
    return d;
  }

  async function load() {
    setLoaded(false);
    setError("");
    try {
      const [t, o] = await Promise.all([
        call("/api/bar-ai/admin/tables/" + tab, "GET"),
        call("/api/bar-ai/admin/options", "GET"),
      ]);
      setRows(t.rows || []);
      setOpts({ products: o.products || [], ingredients: o.ingredients || [], suppliers: o.suppliers || [] });
    } catch (e) {
      setRows([]);
      setError(e.message || String(e));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (!idToken) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken, tab]);

  async function saveRow(row) {
    setError("");
    setNote("");
    setBusy(true);
    try {
      const cfg = TABS[tab];
      const fields = {};
      cfg.cols.forEach((c) => {
        if (!c.ro) fields[c.k] = row[c.k];
      });
      if (tab === "recipes") {
        fields.product_id = recipeSel.product || row.product_id;
        fields.ingredient_id = recipeSel.ingredient || row.ingredient_id;
      }
      await call("/api/bar-ai/admin/tables/" + tab, "PUT", { pk: row[cfg.pk], fields });
      setNote("Salvato ✔");
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(pk) {
    if (!window.confirm("Eliminare la riga " + pk + "?")) return;
    setError("");
    setNote("");
    setBusy(true);
    try {
      await call("/api/bar-ai/admin/tables/" + tab + "?pk=" + pk, "DELETE");
      setNote("Eliminato ✔");
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addRow() {
    setError("");
    setNote("");
    setBusy(true);
    try {
      await call("/api/bar-ai/admin/tables/" + tab, "POST", { fields: newRow });
      setNewRow({});
      setRecipeSel({ product: "", ingredient: "" });
      setNote("Aggiunto ✔");
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function setCell(pk, key, value) {
    setRows((rs) => rs.map((r) => (r[TABS[tab].pk] === pk ? { ...r, [key]: value } : r)));
  }

  // ------------------------------------------------------------
  if (!idToken) {
    return (
      <div className="bau-page">
        <h1>Bar AI — Gestione dati</h1>
        <p>Accedi con Google per gestire ingredienti, ricette, magazzino, fornitori e ordini.</p>
        <div ref={buttonRef} />
        <style>{`
        .bau-page { max-width: 1200px; margin: 0 auto; padding: 24px; color: #e5e7eb; min-height: 100vh; background: #0b0e14; }
        .bau-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
        .bau-auth { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #9ca3af; }
        .bau-tabs { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
        .bau-tab-active { border-color: #10b981; background: rgba(16,185,129,.16); color: #6ee7b7; }
        .bau-btn { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #e5e7eb; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
        .bau-btn:hover { background: rgba(255,255,255,.14); }
        .bau-btn:disabled { opacity: .5; cursor: not-allowed; }
        .bau-primary { background: #10b981; border-color: #10b981; color: #06281d; font-weight: 700; }
        .bau-danger { background: rgba(239,68,68,.16); border-color: rgba(239,68,68,.5); color: #fca5a5; }
        .bau-table-wrap { overflow-x: auto; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; }
        .bau-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .bau-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.1); white-space: nowrap; }
        .bau-table td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: middle; }
        .bau-table tr:hover td { background: rgba(255,255,255,.02); }
        .bau-input, .bau-select { background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12); border-radius: 6px; color: #e5e7eb; padding: 5px 8px; font-size: 13px; min-width: 90px; }
        .bau-input:focus, .bau-select:focus { outline: none; border-color: #10b981; }
        .bau-ro { color: #9ca3af; }
        .bau-id { color: #6ee7b7; }
        .bau-error { margin-top: 12px; color: #f87171; font-size: 13px; white-space: pre-wrap; }
        .bau-note { margin-top: 8px; color: #fbbf24; font-size: 13px; }
        .bau-ok { color: #34d399; font-size: 13px; }
        .bau-empty { color: #6b7280; font-size: 13px; padding: 16px; }
        .bau-addrow { display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-end; padding: 12px; }
        .bau-field { display: flex; flex-direction: column; gap: 4px; }
        .bau-field label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; }
        .bau-cell-actions { display: flex; gap: 4px; }
  `}</style>
      </div>
    );
  }

  const cfg = TABS[tab];

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
            onClick={() => { setTab(key); setError(""); setNote(""); setNewRow({}); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="bau-error">! {error}</div>}
      {note && <div className="bau-ok">{note}</div>}

      {!loaded && <p className="bau-empty">Caricamento…</p>}

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
                    Nessuna riga.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row[cfg.pk]}>
                  {cfg.cols.map((c) => (
                    <td key={c.k}>
                      {c.ro ? (
                        <span className={c.k === cfg.pk ? "bau-id" : "bau-ro"}>
                          {c.k === "last_updated" ? String(row[c.k] || "").slice(0, 19) : String(row[c.k] ?? "")}
                        </span>
                      ) : c.type === "select" ? (
                        <select
                          className="bau-select"
                          value={row[c.k] ?? ""}
                          onChange={(e) => setCell(row[cfg.pk], c.k, e.target.value)}
                        >
                          <option value="">-</option>
                          {(c.opts
                            ? (opts[c.opts] || []).map((o) => ({
                                v: o[c.optValue],
                                l: o[c.optLabel],
                              }))
                            : (c.staticOpts || []).map((s) => ({ v: s, l: s }))
                          ).map((o) => (
                            <option key={o.v} value={o.v}>
                              {o.l}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="bau-input"
                          type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
                          step="any"
                          value={row[c.k] ?? ""}
                          onChange={(e) => setCell(row[cfg.pk], c.k, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="bau-cell-actions">
                      <button className="bau-btn bau-primary" disabled={busy} onClick={() => saveRow(row)}>
                        Salva
                      </button>
                      <button className="bau-btn bau-danger" disabled={busy} onClick={() => removeRow(row[cfg.pk])}>
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* Riga di aggiunta */}
              <tr>
                <td colSpan={cfg.cols.length + 1}>
                  <div className="bau-addrow">
                    {tab === "ingredients" && (
                      <>
                        <div className="bau-field">
                          <label>Nome</label>
                          <input className="bau-input" value={newRow.name || ""} onChange={(e) => setNewRow((r) => ({ ...r, name: e.target.value }))} />
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
                          <select className="bau-select" value={recipeSel.product} onChange={(e) => setRecipeSel((s) => ({ ...s, product: e.target.value }))}>
                            <option value="">- invariato -</option>
                            {opts.products.map((p) => (
                              <option key={p.ProductID} value={p.ProductID}>
                                #{p.ProductID} · {p.Category} (€{p.Price})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="bau-field">
                          <label>Ingrediente</label>
                          <select className="bau-select" value={recipeSel.ingredient} onChange={(e) => setRecipeSel((s) => ({ ...s, ingredient: e.target.value }))}>
                            <option value="">- invariato -</option>
                            {opts.ingredients.map((i) => (
                              <option key={i.ingredient_id} value={i.ingredient_id}>
                                {i.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="bau-field">
                          <label>Qtà/porzione</label>
                          <input className="bau-input" type="number" step="any" value={newRow.quantity_per_serving || ""} onChange={(e) => setNewRow((r) => ({ ...r, quantity_per_serving: e.target.value }))} />
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
                          <input className="bau-input" type="number" step="any" value={newRow.stock_level ?? ""} onChange={(e) => setNewRow((r) => ({ ...r, stock_level: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Soglia min.</label>
                          <input className="bau-input" type="number" step="any" value={newRow.min_threshold ?? ""} onChange={(e) => setNewRow((r) => ({ ...r, min_threshold: e.target.value }))} />
                        </div>
                      </>
                    )}
                    {tab === "suppliers" && (
                      <>
                        <div className="bau-field">
                          <label>Nome</label>
                          <input className="bau-input" value={newRow.name || ""} onChange={(e) => setNewRow((r) => ({ ...r, name: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Contatto</label>
                          <input className="bau-input" value={newRow.contact_name || ""} onChange={(e) => setNewRow((r) => ({ ...r, contact_name: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Email</label>
                          <input className="bau-input" value={newRow.email || ""} onChange={(e) => setNewRow((r) => ({ ...r, email: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Telefono</label>
                          <input className="bau-input" value={newRow.phone || ""} onChange={(e) => setNewRow((r) => ({ ...r, phone: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Categoria</label>
                          <input className="bau-input" value={newRow.category || ""} onChange={(e) => setNewRow((r) => ({ ...r, category: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Lead time (gg)</label>
                          <input className="bau-input" type="number" step="any" value={newRow.lead_time_days ?? ""} onChange={(e) => setNewRow((r) => ({ ...r, lead_time_days: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Note</label>
                          <input className="bau-input" value={newRow.notes || ""} onChange={(e) => setNewRow((r) => ({ ...r, notes: e.target.value }))} />
                        </div>
                      </>
                    )}
                    {tab === "orders" && (
                      <>
                        <div className="bau-field">
                          <label>Fornitore</label>
                          <select className="bau-select" value={newRow.supplier_id || ""} onChange={(e) => setNewRow((r) => ({ ...r, supplier_id: e.target.value }))}>
                            <option value="">- scegli -</option>
                            {opts.suppliers.map((s) => (
                              <option key={s.supplier_id} value={s.supplier_id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="bau-field">
                          <label>Ristorante</label>
                          <input className="bau-input" type="number" step="any" value={newRow.restaurant_id ?? ""} onChange={(e) => setNewRow((r) => ({ ...r, restaurant_id: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Data</label>
                          <input className="bau-input" type="date" value={newRow.order_date || ""} onChange={(e) => setNewRow((r) => ({ ...r, order_date: e.target.value }))} />
                        </div>
                        <div className="bau-field">
                          <label>Status</label>
                          <select className="bau-select" value={newRow.status || "pending"} onChange={(e) => setNewRow((r) => ({ ...r, status: e.target.value }))}>
                            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="bau-field">
                          <label>Totale €</label>
                          <input className="bau-input" type="number" step="any" value={newRow.total_amount ?? ""} onChange={(e) => setNewRow((r) => ({ ...r, total_amount: e.target.value }))} />
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
        Le modifiche vanno direttamente nel database bardata. Attenzione con le
        eliminazioni: le righe referenziate da ricette o magazzino vengono
        bloccate dal database (FK).
      </p>

      <style>{`
        .bau-page { max-width: 1200px; margin: 0 auto; padding: 24px; color: #e5e7eb; min-height: 100vh; background: #0b0e14; }
        .bau-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
        .bau-auth { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #9ca3af; }
        .bau-tabs { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
        .bau-tab-active { border-color: #10b981; background: rgba(16,185,129,.16); color: #6ee7b7; }
        .bau-btn { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #e5e7eb; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
        .bau-btn:hover { background: rgba(255,255,255,.14); }
        .bau-btn:disabled { opacity: .5; cursor: not-allowed; }
        .bau-primary { background: #10b981; border-color: #10b981; color: #06281d; font-weight: 700; }
        .bau-danger { background: rgba(239,68,68,.16); border-color: rgba(239,68,68,.5); color: #fca5a5; }
        .bau-table-wrap { overflow-x: auto; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; }
        .bau-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .bau-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.1); white-space: nowrap; }
        .bau-table td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: middle; }
        .bau-table tr:hover td { background: rgba(255,255,255,.02); }
        .bau-input, .bau-select { background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12); border-radius: 6px; color: #e5e7eb; padding: 5px 8px; font-size: 13px; min-width: 90px; }
        .bau-input:focus, .bau-select:focus { outline: none; border-color: #10b981; }
        .bau-ro { color: #9ca3af; }
        .bau-id { color: #6ee7b7; }
        .bau-error { margin-top: 12px; color: #f87171; font-size: 13px; white-space: pre-wrap; }
        .bau-note { margin-top: 8px; color: #fbbf24; font-size: 13px; }
        .bau-ok { color: #34d399; font-size: 13px; }
        .bau-empty { color: #6b7280; font-size: 13px; padding: 16px; }
        .bau-addrow { display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-end; padding: 12px; }
        .bau-field { display: flex; flex-direction: column; gap: 4px; }
        .bau-field label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; }
        .bau-cell-actions { display: flex; gap: 4px; }
  `}</style>
    </div>
  );
}
