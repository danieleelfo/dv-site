// ============================================================
// QUERYDB — DB Browser (read-only) per i database PostgreSQL locali
// (Leles, Emergence, ...). Stile Git Admin: login Google, anteprime
// tabelle, ultime attivita'. NESSUNA scrittura: solo SELECT dal backend.
// Frontend preparato per l'API /api/db/* del gateway (backend: query_db.py).
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n/i18n";

const API = "https://api.danielevillanova.com";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_STORAGE_KEY = "leles_admin_id_token";
const ALLOWED_EMAILS = [
  "dannybydanny@hotmail.com",
  "salatinodenise@gmail.com",
];

// Aree/browse disponibili. Il backend (query_db.py) decidera' l'elenco tabelle.
const AREAS = [
  { id: "leles", label: "Leles", detail: "qdb.area.leles" },
  { id: "emergence", label: "Emergence", detail: "qdb.area.emergence" },
];

const PAGE_SIZE = 50;

// Gruppi del pannello UTENTI: ogni nome finisce nel primo gruppo i cui token
// matchano (parole intere, non sottostringhe), altrimenti in "Altri".
const USER_GROUPS = [
  { id: "status", label: "qdb.g.status", keys: ["status", "sistema", "os", "ram", "sys", "cpu", "disk", "mem"] },
  { id: "airflow", label: "qdb.g.airflow", keys: ["airflow", "dag", "dags"] },
  { id: "logs", label: "qdb.g.logs", keys: ["log", "logs"] },
  { id: "git", label: "qdb.g.git", keys: ["git", "github"] },
  { id: "users", label: "qdb.g.users", keys: ["user", "utente"] },
  { id: "other", label: "qdb.g.other", keys: [] },
];
function userGroupOf(name) {
  const tokens = String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const g of USER_GROUPS) {
    if (g.id === "other") continue;
    if (tokens.some((t) => g.keys.includes(t))) return g;
  }
  return USER_GROUPS[USER_GROUPS.length - 1];
}

function parseJwt(token) {
  try {
    const raw = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(raw).split("").map((c) =>
      "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")));
  } catch {
    return null;
  }
}
function validToken(token) {
  const p = token ? parseJwt(token) : null;
  return !!p?.exp && p.exp * 1000 > Date.now() + 5000;
}
function storedToken() {
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    return validToken(token) ? token : null;
  } catch {
    return null;
  }
}
function useGoogleAuth() {
  const [token, setToken] = useState(storedToken);
  const buttonRef = useRef(null);
  const payload = token ? parseJwt(token) : null;
  const email = (payload?.email || "").toLowerCase();
  const allowed = ALLOWED_EMAILS.includes(email);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === TOKEN_STORAGE_KEY) setToken(e.newValue && validToken(e.newValue) ? e.newValue : null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (token) return;
    let cancelled = false;
    let attempts = 0;
    const init = () => {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        if (++attempts < 80) window.setTimeout(init, 150);
        return;
      }
      if (!GOOGLE_CLIENT_ID) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          if (!response?.credential) return;
          try { localStorage.setItem(TOKEN_STORAGE_KEY, response.credential); } catch {}
          setToken(response.credential);
        },
      });
      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "filled_black", size: "large", shape: "pill", text: "signin_with",
        });
      }
    };
    init();
    return () => { cancelled = true; };
  }, [token]);

  const logout = () => {
    try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch {}
    window.google?.accounts?.id?.disableAutoSelect?.();
    setToken(null);
  };
  return { token, email, allowed, buttonRef, logout };
}

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
function cellText(value) {
  if (value == null) return "—";
  const s = asText(value);
  return s.length > 120 ? s.slice(0, 117) + "..." : s;
}

export default function QueryDb() {
  const { t } = useTranslation();
  const auth = useGoogleAuth();
  const [area, setArea] = useState("leles");
  const [status, setStatus] = useState(null);
  const [table, setTable] = useState("");
  const [page, setPage] = useState(0);
  const [tableData, setTableData] = useState(null);
  const [fUser, setFUser] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [usersInfo, setUsersInfo] = useState(null);
  const [usersOff, setUsersOff] = useState(null);
  const [uSearch, setUSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const areaInfo = useMemo(() => AREAS.find((a) => a.id === area) || AREAS[0], [area]);

  const api = useCallback(async (path) => {
    if (!auth.token) throw new Error(i18n.t("qdb.err.session"));
    const response = await fetch(API + path, {
      headers: { Authorization: "Bearer " + auth.token },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(i18n.t("qdb.err.endpoint"));
      }
      const detail = typeof data.detail === "string" ? data.detail : data.message;
      throw new Error(detail || i18n.t("qdb.err.http", { n: response.status }));
    }
    return data;
  }, [auth.token]);

  const loadStatus = useCallback(async (selectedArea = area) => {
    setBusy("status");
    setError("");
    try {
      const data = await api("/api/db/status?area=" + encodeURIComponent(selectedArea));
      setStatus(data);
    } catch (e) {
      setError(e.message || String(e));
      setStatus(null);
    } finally {
      setBusy("");
    }
  }, [api, area]);

  const loadUsers = useCallback(async (selectedArea, selectedTable) => {
    try {
      const data = await api(
        "/api/db/users?area=" + encodeURIComponent(selectedArea) +
        "&table=" + encodeURIComponent(selectedTable)
      );
      setUsersInfo(data);
    } catch {
      setUsersInfo(null); // niente pannello utenti
    }
  }, [api]);

  const loadTable = useCallback(async (selectedArea, selectedTable, selectedPage, off) => {
    setBusy("table");
    setError("");
    try {
      // Checkbox utenti: "off" e' la lista dei nomi esclusi (null = tutti).
      const excluded = off !== undefined && off !== null ? off : (usersOff || []);
      let usersQ = "";
      if (usersInfo?.column && excluded.length) {
        const keep = usersInfo.users.map((u) => String(u.name)).filter((n) => !excluded.includes(n));
        usersQ = "&users=" + encodeURIComponent(keep.join(","));
      }
      const data = await api(
        "/api/db/table?area=" + encodeURIComponent(selectedArea) +
        "&table=" + encodeURIComponent(selectedTable) +
        "&page=" + selectedPage +
        usersQ +
        (fUser ? "&user=" + encodeURIComponent(fUser) : "") +
        (fFrom ? "&date_from=" + fFrom : "") +
        (fTo ? "&date_to=" + fTo : "")
      );
      setTableData(data);
    } catch (e) {
      setError(e.message || String(e));
      setTableData(null);
    } finally {
      setBusy("");
    }
  }, [api, usersInfo, usersOff]);

  useEffect(() => {
    if (auth.token && auth.allowed) loadStatus(area);
  }, [auth.token, auth.allowed, area, loadStatus]);

  function openTable(name) {
    setTable(name);
    setPage(0);
    setTableData(null);
    setFUser("");
    setFFrom("");
    setFTo("");
    setUsersInfo(null);
    setUsersOff(null);
    setUSearch("");
    loadTable(area, name, 0, null);
    loadUsers(area, name);
  }

  function toggleUser(name) {
    const cur = usersOff || [];
    const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
    setUsersOff(next);
    setPage(0);
    loadTable(area, table, 0, next);
  }

  function toggleAllUsers(on) {
    const next = on ? null : (usersInfo?.users || []).map((u) => String(u.name));
    setUsersOff(next);
    setPage(0);
    loadTable(area, table, 0, next);
  }

  function toggleGroupUsers(names, on) {
    const cur = usersOff || [];
    let next = on ? cur.filter((n) => !names.includes(n)) : [...new Set([...cur, ...names])];
    const valid = new Set((usersInfo?.users || []).map((u) => String(u.name)));
    next = next.filter((n) => valid.has(n));
    next = next.length ? next : null;
    setUsersOff(next);
    setPage(0);
    loadTable(area, table, 0, next);
  }

  function copyCsv() {
    if (!tableData?.columns || !tableData?.rows) return;
    const esc = (v) => {
      const s = asText(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [
      tableData.columns.map(esc).join(","),
      ...tableData.rows.map((r) => (Array.isArray(r) ? r : Object.values(r)).map(esc).join(",")),
    ].join("\n");
    try { navigator.clipboard?.writeText(csv); } catch {}
  }

  if (!auth.token || !auth.allowed) {
    return (
      <main className="qdb-page">
        <QdbStyles />
        <section className="qdb-login panel">
          <div className="brand-mark"><DbIcon /></div>
          <p className="eyebrow">D. VILLANOVA · DEVELOPER TOOLS</p>
          <h1>QueryDB</h1>
          <p className="muted">{t("qdb.loginSub")}</p>
          {!auth.token ? <div ref={auth.buttonRef} className="google-slot" /> : (
            <>
              <p className="error-text">{t("qdb.unauthorized", { email: auth.email || t("qdb.emailMissing") })}</p>
              <button className="btn" onClick={auth.logout}>{t("qdb.logoutSwitch")}</button>
            </>
          )}
        </section>
      </main>
    );
  }

  const tables = status?.tables || [];
  const recent = status?.recent || [];

  return (
    <main className="qdb-page">
      <QdbStyles />
      <header className="qdb-topbar">
        <div className="qdb-brand">
          <div className="brand-mark small"><DbIcon /></div>
          <div>
            <p className="eyebrow">D. VILLANOVA · DATABASE TOOLS</p>
            <h1>QueryDB <span className="version-tag">READ-ONLY</span></h1>
          </div>
        </div>
        <div className="user-tools">
          <span className="readonly-pill" title={t("qdb.readonlyTitle")}>◆ {t("qdb.readonly")}</span>
          <span className="user-email">{auth.email}</span>
          <button className="btn btn-quiet" onClick={auth.logout}>{t("qdb.logout")}</button>
        </div>
      </header>

      <section className="area-strip panel">
        <div className="area-picker">
          <label htmlFor="qdb-area">{t("qdb.area")}</label>
          <select id="qdb-area" value={area} onChange={(e) => { setArea(e.target.value); setStatus(null); setTable(""); setTableData(null); }}>
            {AREAS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <span className="area-detail">{t(areaInfo.detail)}</span>
        </div>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => { loadStatus(area); if (table) loadTable(area, table, page); }}>
          {busy ? t("qdb.wait") : "↻ " + t("qdb.refresh")}
        </button>
      </section>

      {error && <div className="alert alert-error"><strong>{t("qdb.warning")}</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}

      <section className="qdb-grid">
        <div className="panel tables-panel">
          <div className="section-heading">
            <div><p className="eyebrow">{t("qdb.tablesEyebrow")}</p><h2>{t("qdb.mainTables")} · {areaInfo.label}</h2></div>
            <span className="status-pill"><i />{status ? t("qdb.nTables", { n: tables.length }) : t("qdb.waiting")}</span>
          </div>
          {busy === "status" && <p className="muted small-copy">{t("qdb.loading")}</p>}
          {!busy && !status && <p className="muted small-copy">{t("qdb.noData")}</p>}
          {tables.length > 0 && (
            <div className="table-list">
              {tables.map((tb) => (
                <button key={tb.name} className={"table-row" + (table === tb.name ? " active" : "")} onClick={() => openTable(tb.name)}>
                  <code>{tb.name}</code>
                  <span className="table-meta">{tb.rows != null ? t("qdb.nRows", { n: tb.rows.toLocaleString("it-IT") }) : ""}{tb.detail ? " · " + tb.detail : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel recent-panel">
          <div className="section-heading">
            <div><p className="eyebrow">{t("qdb.activityEyebrow")}</p><h2>{t("qdb.recent")}</h2></div>
          </div>
          {recent.length === 0 ? (
            <p className="muted small-copy">{status ? t("qdb.noRecent") : t("qdb.waitingBackend")}</p>
          ) : (
            <div className="recent-list">
              {recent.map((r, i) => (
                <div className="recent-row" key={i}>
                  <span className="recent-what">{r.what || r.label || asText(r)}</span>
                  <span className="recent-when">{r.when || r.at || ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {table && (
        <section className="panel preview-panel">
          <div className="section-heading">
            <div><p className="eyebrow">{t("qdb.previewEyebrow")}</p><h2><code>{table}</code> · {t("qdb.page", { n: page + 1 })}{tableData?.order ? <span className="order-badge" title={t("qdb.serverOrder")}>{tableData.order}</span> : null}</h2></div>
            {(tableData?.filterable?.user_col || tableData?.filterable?.time_col) && (
              <div className="filter-bar">
                {tableData?.filterable?.user_col && (
                  <input className="text-input filter-input" type="text" placeholder={t("qdb.filterBy", { col: tableData.filterable.user_col })} value={fUser} onChange={(e) => setFUser(e.target.value)} />
                )}
                {tableData?.filterable?.time_col && (
                  <>
                    <input className="text-input filter-input" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} title={t("qdb.from")} />
                    <input className="text-input filter-input" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} title={t("qdb.to")} />
                  </>
                )}
                <button className="btn btn-primary" disabled={busy === "table"} onClick={() => { setPage(0); loadTable(area, table, 0); }}>{t("qdb.apply")}</button>
                {(fUser || fFrom || fTo) && <button className="btn btn-quiet" onClick={() => { setFUser(""); setFFrom(""); setFTo(""); setUsersOff(null); setPage(0); loadTable(area, table, 0, null); }}>{t("qdb.reset")}</button>}
              </div>
            )}
            <div className="btn-row">
              <button className="btn" onClick={copyCsv} disabled={!tableData}>{t("qdb.copyCsv")}</button>
              <button className="btn" disabled={page === 0 || busy === "table"} onClick={() => { const p = page - 1; setPage(p); loadTable(area, table, p); }}>{t("qdb.prev")}</button>
              <button className="btn" disabled={!tableData || (tableData.rows || []).length < PAGE_SIZE || busy === "table"} onClick={() => { const p = page + 1; setPage(p); loadTable(area, table, p); }}>{t("qdb.next")}</button>
            </div>
          </div>
          {usersInfo?.users?.length > 0 && (
            <div className="user-panel">
              <div className="user-panel-head">
                <span className="user-panel-title">{t("qdb.usersTitle", { col: usersInfo.column, n: usersInfo.users.length })}</span>
                <button className="btn btn-quiet" onClick={() => toggleAllUsers(true)}>{t("qdb.all")}</button>
                <button className="btn btn-quiet" onClick={() => toggleAllUsers(false)}>{t("qdb.none")}</button>
                <input className="text-input filter-input" type="text" placeholder={t("qdb.searchUser")} value={uSearch} onChange={(e) => setUSearch(e.target.value)} />
                <span className="muted small-copy">{usersOff && usersOff.length ? t("qdb.visibleOf", { n: usersInfo.users.length - usersOff.length, m: usersInfo.users.length }) : t("qdb.allVisible")}</span>
              </div>
              <div className="user-checks">
                {(() => {
                  const filtered = usersInfo.users.filter((u) => !uSearch || String(u.name).toLowerCase().includes(uSearch.toLowerCase()));
                  const buckets = [];
                  for (const g of USER_GROUPS) {
                    const items = filtered.filter((u) => userGroupOf(u.name).id === g.id);
                    if (items.length) buckets.push({ g, items });
                  }
                  return buckets.map(({ g, items }) => (
                    <div key={g.id} className="user-group">
                      <div className="user-group-head">
                        <span className="user-group-title">{t(g.label)} · {items.length}</span>
                        <button className="btn btn-quiet" onClick={() => toggleGroupUsers(items.map((u) => String(u.name)), true)}>on</button>
                        <button className="btn btn-quiet" onClick={() => toggleGroupUsers(items.map((u) => String(u.name)), false)}>off</button>
                      </div>
                      <div className="user-group-items">
                        {items.map((u) => {
                          const name = String(u.name);
                          const checked = !usersOff || !usersOff.includes(name);
                          return (
                            <label key={name} className={"user-check" + (checked ? "" : " off")}>
                              <input type="checkbox" checked={checked} onChange={() => toggleUser(name)} />
                              <span className="uc-name">{name === "" ? t("qdb.emptyName") : name}</span>
                              <span className="uc-count">{u.count.toLocaleString("it-IT")}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
          {busy === "table" && <p className="muted small-copy">{t("qdb.loadingRows")}</p>}
          {tableData?.columns?.length > 0 && (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>{tableData.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {(tableData.rows || []).map((r, ri) => {
                    const cells = Array.isArray(r) ? r : tableData.columns.map((c) => (typeof r === "object" ? r[c] : r));
                    return <tr key={ri}>{cells.map((cell, ci) => <td key={ci} title={asText(cell)}>{cellText(cell)}</td>)}</tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!busy && tableData && (tableData.rows || []).length === 0 && <p className="muted small-copy">{t("qdb.noRows")}</p>}
        </section>
      )}

      <section className="panel guard-panel">
        <div className="guard-icon">◆</div>
        <div>
          <h3>{t("qdb.guardTitle")}</h3>
          <ul>
            <li>{t("qdb.guard1")}</li>
            <li>{t("qdb.guard2")}</li>
            <li>{t("qdb.guard3")}</li>
            <li>{t("qdb.guard4")}</li>
          </ul>
        </div>
      </section>
    </main>
  );
}

function DbIcon() {
  return <svg viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="11" rx="14" ry="5.5" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M6 11v18c0 3 6.3 5.5 14 5.5s14-2.5 14-5.5V11" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M6 20c0 3 6.3 5.5 14 5.5S34 23 34 20" fill="none" stroke="currentColor" strokeWidth="2.2"/></svg>;
}
function QdbStyles() {
  return <style>{`
    .qdb-page{--bg:#080d13;--panel:#101923;--line:#243241;--text:#e6edf3;--muted:#91a0b1;--teal:#62e6cf;min-height:100vh;background:radial-gradient(ellipse at 15% -15%,#12303a 0,transparent 38%),var(--bg);color:var(--text);padding:26px clamp(14px,3vw,42px) 54px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
    .qdb-page *{box-sizing:border-box}.qdb-page button,.qdb-page select{font:inherit}.qdb-page button{cursor:pointer}.qdb-page button:disabled{opacity:.5;cursor:not-allowed}
    .qdb-topbar{display:flex;justify-content:space-between;align-items:center;gap:20px;max-width:1500px;margin:0 auto 25px}.qdb-brand{display:flex;align-items:center;gap:13px}
    .brand-mark{width:58px;height:58px;border:1px solid #2e655f;border-radius:17px;background:linear-gradient(145deg,#153d3c,#101c28);color:var(--teal);display:grid;place-items:center}.brand-mark svg{width:34px;height:34px}.brand-mark.small{width:44px;height:44px;border-radius:13px}.brand-mark.small svg{width:28px;height:28px}
    .eyebrow{font-size:10px;letter-spacing:.17em;font-weight:800;color:var(--teal);margin:0 0 7px}.qdb-brand h1{font-size:clamp(22px,3vw,30px);margin:0;letter-spacing:-.04em}.version-tag{font-size:9px;letter-spacing:.12em;border:1px solid #38564f;border-radius:5px;padding:4px 6px;color:var(--teal);vertical-align:middle;margin-left:5px}
    .user-tools{display:flex;align-items:center;gap:12px}.user-email{font-size:12px;color:var(--muted)}
    .readonly-pill{font-size:10px;letter-spacing:.1em;color:var(--teal);border:1px solid #2e655f;border-radius:999px;padding:5px 10px}
    .panel{background:linear-gradient(145deg,rgba(18,29,40,.97),rgba(12,20,29,.97));border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 34px #00000012;padding:21px}
    .area-strip{max-width:1500px;margin:0 auto 18px;display:flex;justify-content:space-between;align-items:center;gap:18px}
    .area-picker{display:grid;grid-template-columns:auto minmax(180px,260px);align-items:center;gap:5px 14px;flex:1}
    .area-picker label{font-size:11px;color:var(--muted);font-weight:700}.area-picker select{background:#0a1119;color:var(--text);border:1px solid #304153;border-radius:8px;padding:10px 12px;outline:none}
    .area-detail{grid-column:2;color:#77889b;font-size:11px}
    .btn{border:1px solid #344557;background:#172431;color:var(--text);border-radius:9px;padding:9px 13px;font-size:12px;font-weight:700;transition:.15s}.btn:hover:not(:disabled){border-color:#5a7c8d;background:#203242}.btn-primary{background:var(--teal);border-color:var(--teal);color:#08201e}.btn-primary:hover:not(:disabled){background:#8af3e2}.btn-quiet{background:transparent;border-color:#2a3948;color:#b5c2d0}
    .alert{max-width:1500px;margin:0 auto 16px;border-radius:10px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start;font-size:12px}.alert span{flex:1;white-space:pre-wrap}.alert button{background:transparent;color:inherit;border:0;font-size:18px}.alert-error{border:1px solid #71363d;background:#351c23;color:#ffc3c6}
    .qdb-grid{max-width:1500px;margin:0 auto 18px;display:grid;grid-template-columns:1fr 1fr;gap:18px}
    .section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:19px}.section-heading h2{font-size:17px;margin:0;letter-spacing:-.025em}.section-heading h2 code{font-family:inherit;color:var(--teal)}.section-heading .eyebrow{margin-bottom:6px}
    .muted{color:var(--muted)}.small-copy{font-size:12px;line-height:1.6}
    .status-pill{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;border:1px solid #314050;border-radius:99px;padding:6px 9px;font-size:10px;color:#9eacba}.status-pill i{width:6px;height:6px;background:#8a9aab;border-radius:50%}
    .table-list{display:flex;flex-direction:column;max-height:420px;overflow:auto}
    .table-row{display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:left;background:#0b141d;border:1px solid #273847;border-radius:9px;color:var(--text);padding:10px 12px;margin-bottom:6px}
    .table-row:hover:not(:disabled){border-color:#3f9b8d;background:#12302f}.table-row.active{border-color:var(--teal);background:#143330}
    .table-row code{overflow-wrap:anywhere;color:#cbd7e1;font-size:12px}.table-meta{font-size:10.5px;color:#74869a;white-space:nowrap}
    .recent-list{display:flex;flex-direction:column;max-height:420px;overflow:auto}
    .recent-row{display:flex;justify-content:space-between;gap:12px;padding:10px 2px;border-bottom:1px solid #202e3b;font-size:12px}
    .recent-what{overflow-wrap:anywhere}.recent-when{color:#74869a;font-size:10.5px;white-space:nowrap}
    .preview-panel{max-width:1500px;margin:0 auto 18px}
    .btn-row{display:flex;gap:8px;flex-wrap:wrap}
    .order-badge{display:inline-block;margin-left:9px;font-size:9.5px;color:var(--teal);border:1px solid #38564f;border-radius:5px;padding:3px 6px;vertical-align:middle;font-family:ui-monospace,Menlo,monospace}
    .filter-bar{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px}
    .filter-input{width:auto;min-width:150px;padding:8px 10px;font-size:11px}
    .text-input{background:#0a1119;color:var(--text);border:1px solid #304153;border-radius:8px;padding:11px 12px;outline:none;font-size:12px}
    .data-table-wrap{overflow:auto;max-height:480px;border:1px solid #202e3a;border-radius:0 0 10px 10px}
    .data-table{border-collapse:collapse;width:100%;font-size:11.5px}
    .data-table th{position:sticky;top:0;background:#0d1720;color:var(--teal);text-align:left;padding:9px 12px;border-bottom:1px solid #273644;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
    .data-table td{padding:8px 12px;border-bottom:1px solid #1c2a36;overflow-wrap:anywhere;max-width:340px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#c3d0db}
    .user-panel{max-width:1500px;margin:0 auto 14px;border:1px solid var(--line);border-radius:12px;padding:13px 15px;background:#0b141d}
    .user-panel-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .user-panel-title{font-size:10px;letter-spacing:.12em;font-weight:800;color:var(--teal)}
    .user-checks{display:flex;flex-wrap:wrap;gap:6px;max-height:190px;overflow:auto}
    .user-check{display:inline-flex;align-items:center;gap:7px;border:1px solid #273847;border-radius:8px;padding:5px 9px;font-size:11px;cursor:pointer;background:#0d1720;color:var(--text)}
    .user-check:hover{border-color:#3f9b8d}.user-check.off{opacity:.5;border-style:dashed}
    .user-checks{display:block}
    .user-group{display:flex;flex-direction:column;gap:5px;margin-bottom:9px}
    .user-group-head{display:flex;align-items:center;gap:6px}
    .user-group-title{font-size:10px;font-weight:800;letter-spacing:.08em;color:#7fd4c8}
    .user-group-items{display:flex;flex-wrap:wrap;gap:6px}
    .uc-name{max-width:240px;overflow-wrap:anywhere}.uc-count{color:#74869a;font-size:10px}
    .guard-panel{max-width:1500px;margin:0 auto;display:flex;gap:15px;align-items:flex-start}
    .guard-icon{font-size:28px;color:var(--teal);border:1px solid #2b5d57;background:#15312f;border-radius:10px;padding:7px 12px}
    .guard-panel h3{margin:2px 0 10px;font-size:14px}.guard-panel ul{padding-left:17px;margin:0;color:#91a1b1;font-size:11px;line-height:1.9}
    .qdb-login{max-width:450px;margin:9vh auto;padding:36px;text-align:center}.qdb-login .brand-mark{margin:0 auto 20px}.qdb-login h1{font-size:32px;margin:0 0 12px}.qdb-login>p:not(.eyebrow){font-size:13px;line-height:1.7}.google-slot{display:flex;justify-content:center;margin:24px 0}.error-text{color:#ff9a9e}
    @media(max-width:1000px){.qdb-grid{grid-template-columns:1fr}}
    @media(max-width:620px){.qdb-page{padding:16px 11px 34px}.user-email{display:none}.area-strip{flex-direction:column;align-items:stretch}.area-picker{grid-template-columns:1fr}.area-detail{grid-column:1}}
  `}</style>;
}
