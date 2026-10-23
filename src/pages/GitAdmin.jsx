// ============================================================
// TEST2 — Git Admin Console (recuperata da feat/git-admin-test6)
// Frontend prepared for the authenticated Git Admin API.
// No git operation is executed without preview + explicit confirmation.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const API = "https://api.danielevillanova.com";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_STORAGE_KEY = "leles_admin_id_token";
const ALLOWED_EMAILS = [
  "dannybydanny@hotmail.com",
  "salatinodenise@gmail.com",
];

const REPOS = [
  { id: "leles", label: "Leles", detail: "Core · FastAPI / Telegram" },
  { id: "bar_ai", label: "Bar AI", detail: "Backend gestionale" },
  { id: "lele", label: "Lelé", detail: "Pirate Lele" },
  { id: "lele_story_whisper", label: "Story Whisper", detail: "Storie per bambini" },
  { id: "lele_night_story", label: "Night Story", detail: "Storie per adulti" },
  { id: "dv_site", label: "DV Site / Gateway", detail: "React · API gateway" },
  { id: "gradv", label: "GraDV", detail: "Image lab · Z-Image-Turbo / Gradio" },
];

const DIFF_SCOPES = [
  { id: "working", label: "Working tree", help: "Modifiche non in stage" },
  { id: "staged", label: "Staged", help: "Pronte per il commit" },
  { id: "incoming", label: "In arrivo", help: "Commit remoti non ancora locali" },
  { id: "outgoing", label: "In uscita", help: "Commit locali non ancora remoti" },
];

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

function shortSha(value) {
  return value ? String(value).slice(0, 8) : "—";
}
function asText(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export default function Test2() {
  const auth = useGoogleAuth();
  const { t } = useTranslation();
  const [project, setProject] = useState("leles");
  const [scope, setScope] = useState("working");
  const [status, setStatus] = useState(null);
  const [diff, setDiff] = useState(null);
  const [activity, setActivity] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState("");
  const [preview, setPreview] = useState(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const repo = useMemo(() => REPOS.find((r) => r.id === project) || REPOS[0], [project]);

  const api = useCallback(async (path, options = {}) => {
    if (!auth.token) throw new Error(t("git.sessionMissing"));
    const response = await fetch(API + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + auth.token,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof data.detail === "string" ? data.detail : data.message;
      if (response.status === 404) {
        throw new Error(t("git.endpointMissing"));
      }
      throw new Error(detail || t("git.requestFailed", { status: response.status }));
    }
    return data;
  }, [auth.token]);

  const loadStatus = useCallback(async (selectedProject = project) => {
    setBusy("status");
    setError("");
    setNotice("");
    try {
      const data = await api(`/api/git/admin/status?project=${encodeURIComponent(selectedProject)}`);
      setStatus(data);
      setActivity((old) => [{ at: new Date().toLocaleTimeString(), text: t("git.actStatus", { project: selectedProject }), kind: "info" }, ...old].slice(0, 8));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }, [api, project]);

  const loadDiff = useCallback(async (selectedProject = project, selectedScope = scope) => {
    setBusy("diff");
    setError("");
    setNotice("");
    try {
      const data = await api(`/api/git/admin/diff?project=${encodeURIComponent(selectedProject)}&scope=${encodeURIComponent(selectedScope)}`);
      setDiff(data);
    } catch (e) {
      setError(e.message || String(e));
      setDiff(null);
    } finally {
      setBusy("");
    }
  }, [api, project, scope]);

  useEffect(() => {
    if (auth.token && auth.allowed) loadStatus(project);
  }, [auth.token, auth.allowed, project, loadStatus]);

  useEffect(() => {
    if (auth.token && auth.allowed) loadDiff(project, scope);
  }, [auth.token, auth.allowed, project, scope, loadDiff]);

  async function prepareAction(kind) {
    setError("");
    setNotice("");
    setPreview(null);
    setConfirmText("");
    setAction(kind);
    setBusy("preview");
    try {
      const data = await api("/api/git/admin/preview", {
        method: "POST",
        body: JSON.stringify({
          project,
          action: kind,
          message: kind === "commit" ? commitMessage.trim() : undefined,
        }),
      });
      setPreview(data);
      setActivity((old) => [{ at: new Date().toLocaleTimeString(), text: t("git.actPreview", { kind, repo: repo.label }), kind: "info" }, ...old].slice(0, 8));
    } catch (e) {
      setError(e.message || String(e));
      setAction("");
    } finally {
      setBusy("");
    }
  }

  async function executeAction() {
    if (!preview) return;
    const required = preview.confirmation_phrase || `CONFERMA ${action.toUpperCase()}`;
    if (confirmText.trim() !== required) {
      setError(t("git.typeExact", { phrase: required }));
      return;
    }
    setBusy("execute");
    setError("");
    setNotice("");
    try {
      const result = await api("/api/git/admin/execute", {
        method: "POST",
        body: JSON.stringify({
          project,
          action,
          message: action === "commit" ? commitMessage.trim() : undefined,
          confirmation_phrase: confirmText.trim(),
          preview_id: preview.preview_id,
        }),
      });
      setNotice(result.message || t("git.actionDone", { action }));
      setActivity((old) => [{ at: new Date().toLocaleTimeString(), text: t("git.actDone", { action: action.toUpperCase(), repo: repo.label }), kind: "ok" }, ...old].slice(0, 8));
      setPreview(null);
      setAction("");
      setConfirmText("");
      await loadStatus(project);
      await loadDiff(project, scope);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy("");
    }
  }

  if (!auth.token || !auth.allowed) {
    return (
      <main className="git-page">
        <GitStyles />
        <section className="git-login panel">
          <div className="brand-mark"><GitIcon /></div>
          <p className="eyebrow">D. VILLANOVA · DEVELOPER TOOLS</p>
          <h1>Git Admin</h1>
          <p className="muted">{t("git.loginIntro")}</p>
          {!auth.token ? <div ref={auth.buttonRef} className="google-slot" /> : (
            <>
              <p className="error-text">{t("git.unauthorized", { email: auth.email || t("git.noEmail") })}</p>
              <button className="btn" onClick={auth.logout}>{t("git.logoutSwitch")}</button>
            </>
          )}
          <p className="tiny muted">{t("git.authNote")}</p>
        </section>
      </main>
    );
  }

  const ahead = status?.ahead ?? status?.ahead_by;
  const behind = status?.behind ?? status?.behind_by;
  const branch = status?.branch || status?.current_branch || "—";
  const commit = status?.last_commit || status?.head || {};
  const dirty = status?.dirty ?? status?.working_tree_dirty;
  const diffText = asText(diff?.diff ?? diff?.patch ?? diff?.output ?? diff?.files ?? diff);

  return (
    <main className="git-page">
      <GitStyles />
      <header className="git-topbar">
        <div className="git-brand"><div className="brand-mark small"><GitIcon /></div><div><p className="eyebrow">D. VILLANOVA · REPOSITORY TOOLS</p><h1>Git Admin <span className="version-tag">PREVIEW</span></h1></div></div>
        <div className="user-tools"><span className="user-email">{auth.email}</span><button className="btn btn-quiet" onClick={auth.logout}>{t("git.logout")}</button></div>
      </header>

      <section className="repo-strip panel">
        <div className="repo-picker">
          <label htmlFor="git-project">Repository</label>
          <select id="git-project" value={project} onChange={(e) => { setProject(e.target.value); setStatus(null); setDiff(null); setPreview(null); }}>
            {REPOS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <span className="repo-detail">{t("git.repoDetail." + repo.id)}</span>
        </div>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => { loadStatus(project); loadDiff(project, scope); }}>
          {busy ? t("git.wait") : t("git.refresh")}
        </button>
      </section>

      {error && <div className="alert alert-error"><strong>{t("git.warning")}</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
      {notice && <div className="alert alert-success"><strong>✓</strong><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}

      <section className="stat-grid">
        <Stat label="Branch" value={branch} detail={status?.upstream || status?.tracking || t("git.statBranchDetail")} icon="⑂" />
        <Stat label={t("git.localCommit")} value={shortSha(typeof commit === "string" ? commit : commit.sha || commit.hash || status?.head_sha)} detail={typeof commit === "object" ? (commit.message || commit.subject || "HEAD") : "HEAD"} icon="●" />
        <Stat label={t("git.toPush")} value={ahead == null ? "—" : ahead} detail={t("git.toPushDetail")} icon="↑" tone={Number(ahead) > 0 ? "amber" : ""} />
        <Stat label={t("git.toPull")} value={behind == null ? "—" : behind} detail={t("git.toPullDetail")} icon="↓" tone={Number(behind) > 0 ? "blue" : ""} />
      </section>

      <section className="main-grid">
        <div className="panel overview-panel">
          <div className="section-heading"><div><p className="eyebrow">REPOSITORY OVERVIEW</p><h2>{t("git.repoStatus")}</h2></div><span className={`status-pill ${dirty === true ? "is-dirty" : dirty === false ? "is-clean" : ""}`}><i />{dirty === true ? t("git.dirty") : dirty === false ? t("git.clean") : status ? t("git.statusAvailable") : t("git.waiting")}</span></div>
          <div className="status-lines">
            <StatusLine label="Working tree" value={status?.working_tree || status?.worktree || (dirty === false ? t("git.cleanShort") : dirty === true ? t("git.modified") : t("git.notDetected"))} />
            <StatusLine label="Staging area" value={status?.staged_summary || status?.staged || "—"} />
            <StatusLine label="Remote" value={status?.remote || status?.upstream || "—"} />
            <StatusLine label={t("git.lastCommit")} value={typeof commit === "object" ? (commit.message || commit.subject || "—") : (status?.last_commit_message || "—")} />
          </div>
          <div className="button-row">
            <button className="btn" disabled={!!busy} onClick={() => loadDiff(project, "working")}>Diff working tree</button>
            <button className="btn" disabled={!!busy} onClick={() => loadDiff(project, "staged")}>Diff staged</button>
          </div>
        </div>

        <div className="panel actions-panel">
          <div className="section-heading"><div><p className="eyebrow">CONTROLLED OPERATIONS</p><h2>{t("git.operations")}</h2></div><span className="lock-icon">⌑</span></div>
          <p className="muted small-copy">{t("git.opsIntro")}</p>
          <label className="field-label" htmlFor="commit-message">{t("git.commitMessage")}</label>
          <input id="commit-message" className="text-input" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} placeholder={t("git.commitPlaceholder")} maxLength={180} />
          <div className="action-grid">
            <button className="action-btn" disabled={!!busy} onClick={() => prepareAction("commit")}><b>＋</b><span><strong>Commit</strong><small>{t("git.commitSub")}</small></span></button>
            <button className="action-btn" disabled={!!busy} onClick={() => prepareAction("push")}><b>↑</b><span><strong>Push</strong><small>{t("git.pushSub")}</small></span></button>
            <button className="action-btn" disabled={!!busy} onClick={() => prepareAction("pull")}><b>↓</b><span><strong>Pull</strong><small>{t("git.pullSub")}</small></span></button>
            <button className="action-btn action-danger" disabled={!!busy} onClick={() => prepareAction("force_pull")}><b>!</b><span><strong>{t("git.forcePull")}</strong><small>{t("git.forceSub")}</small></span></button>
          </div>
          <p className="safety-note"><span>◆</span> {t("git.safetyNote")}</p>
        </div>
      </section>

      <section className="panel diff-panel">
        <div className="section-heading diff-heading"><div><p className="eyebrow">CHANGE INSPECTOR</p><h2>{t("git.diffs")}</h2><p className="muted small-copy">{t("git.diffsIntro")}</p></div><button className="btn btn-quiet" onClick={() => setShowRaw((v) => !v)}>{showRaw ? t("git.viewNormal") : t("git.viewText")}</button></div>
        <div className="scope-tabs">
          {DIFF_SCOPES.map((s) => <button key={s.id} className={scope === s.id ? "scope-tab active" : "scope-tab"} onClick={() => setScope(s.id)}><strong>{t("git.scope." + s.id)}</strong><small>{t("git.scopeHelp." + s.id)}</small></button>)}
        </div>
        <div className="diff-toolbar"><span>{diff?.summary || diff?.title || `t("git.scopeFallback", { repo: repo.label, scope: t("git.scope." + scope) })`}</span><button className="btn btn-quiet" disabled={!!busy} onClick={() => loadDiff(project, scope)}>{t("git.refreshDiff")}</button></div>
        {diff?.files?.length > 0 && !showRaw && (
          <div className="file-list">
            {diff.files.map((f, i) => <div className="file-row" key={f.path || f.filename || i}><span className="file-symbol">{String(f.status || "M").slice(0,1).toUpperCase()}</span><code>{f.path || f.filename || String(f)}</code><span className="file-stats"><em>+{f.additions ?? 0}</em><i>−{f.deletions ?? 0}</i></span></div>)}
          </div>
        )}
        <pre className={`diff-code ${showRaw ? "raw" : ""}`}>{diffText || (busy === "diff" ? t("git.loadingDiff") : t("git.noDiff"))}</pre>
      </section>

      <section className="bottom-grid">
        <div className="panel">
          <div className="section-heading"><div><p className="eyebrow">RECENT ACTIVITY</p><h2>{t("git.activity")}</h2></div></div>
          {activity.length ? <div className="activity-list">{activity.map((a, i) => <div className="activity-row" key={i}><span className={`activity-dot ${a.kind}`} /><span>{a.text}</span><time>{a.at}</time></div>)}</div> : <p className="muted small-copy">{t("git.noActivity")}</p>}
        </div>
        <div className="panel guard-panel"><div className="guard-icon">⌑</div><div><h3>{t("git.safetyRules")}</h3><ul><li>{t("git.rule1")}</li><li>{t("git.rule2")}</li><li>{t("git.rule3")}</li><li>{t("git.rule4")}</li></ul></div></div>
      </section>

      {preview && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && busy !== "execute") { setPreview(null); setAction(""); } }}>
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="modal-top"><span className={`modal-icon ${action === "force_pull" ? "danger" : ""}`}>{action === "force_pull" ? "!" : "⌑"}</span><button className="icon-button" onClick={() => { setPreview(null); setAction(""); }} disabled={busy === "execute"}>×</button></div>
            <p className="eyebrow">{t("git.opEyebrow", { repo: repo.label.toUpperCase() })}</p>
            <h2 id="confirm-title">{t("git.confirm", { action: action === "force_pull" ? t("git.forcePull").toLowerCase() : action })}</h2>
            <p className="muted">{preview.summary || preview.message || t("git.checkPreview")}</p>
            {preview.warnings?.length > 0 && <div className="warning-list">{preview.warnings.map((w, i) => <p key={i}>⚠ {typeof w === "string" ? w : asText(w)}</p>)}</div>}
            {preview.files?.length > 0 && <div className="preview-files">{preview.files.map((f, i) => <div key={f.path || f.filename || i}><code>{f.path || f.filename || asText(f)}</code><span>{f.status || ""}</span></div>)}</div>}
            {(preview.diff || preview.output || preview.details) && <pre className="preview-output">{asText(preview.diff || preview.output || preview.details)}</pre>}
            {preview.safe === false && <div className="alert alert-error"><strong>{t("git.blocked")}</strong><span>{preview.block_reason || t("git.unsafe")}</span></div>}
            <label className="field-label" htmlFor="confirm-phrase">{t("git.typePhrase")} <code>{preview.confirmation_phrase || `CONFERMA ${action.toUpperCase()}`}</code></label>
            <input id="confirm-phrase" className="text-input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={t("git.phrasePlaceholder")} autoComplete="off" />
            <div className="modal-actions"><button className="btn btn-quiet" disabled={busy === "execute"} onClick={() => { setPreview(null); setAction(""); }}>{t("git.cancel")}</button><button className={`btn ${action === "force_pull" ? "btn-danger" : "btn-primary"}`} disabled={busy === "execute" || preview.safe === false || confirmText.trim() !== (preview.confirmation_phrase || `CONFERMA ${action.toUpperCase()}`)} onClick={executeAction}>{busy === "execute" ? t("git.executing") : t("git.confirmRun")}</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, detail, icon, tone = "" }) {
  return <div className="panel stat-card"><div className="stat-top"><span>{label}</span><i>{icon}</i></div><strong className={tone}>{value}</strong><small>{detail}</small></div>;
}
function StatusLine({ label, value }) {
  return <div className="status-line"><span>{label}</span><strong>{String(value ?? "—")}</strong></div>;
}
function GitIcon() {
  return <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4 36 20 20 36 4 20Z" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M15 13v14m0-7h10m0 0v-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><circle cx="15" cy="12" r="3" fill="currentColor"/><circle cx="15" cy="28" r="3" fill="currentColor"/><circle cx="25" cy="12" r="3" fill="currentColor"/><circle cx="25" cy="20" r="3" fill="currentColor"/></svg>;
}
function GitStyles() {
  return <style>{`
    .git-page{--bg:#080d13;--panel:#101923;--line:#243241;--text:#e6edf3;--muted:#91a0b1;--teal:#62e6cf;--blue:#78b7ff;--amber:#ffca75;min-height:100vh;background:radial-gradient(ellipse at 15% -15%,#12303a 0,transparent 38%),var(--bg);color:var(--text);padding:26px clamp(14px,3vw,42px) 54px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
    .git-page *{box-sizing:border-box}.git-page button,.git-page input,.git-page select{font:inherit}.git-page button{cursor:pointer}.git-page button:disabled{opacity:.5;cursor:not-allowed}
    .git-topbar{display:flex;justify-content:space-between;align-items:center;gap:20px;max-width:1500px;margin:0 auto 25px}.git-brand{display:flex;align-items:center;gap:13px}.brand-mark{width:58px;height:58px;border:1px solid #2e655f;border-radius:17px;background:linear-gradient(145deg,#153d3c,#101c28);color:var(--teal);display:grid;place-items:center}.brand-mark svg{width:34px;height:34px}.brand-mark.small{width:44px;height:44px;border-radius:13px}.brand-mark.small svg{width:28px;height:28px}
    .eyebrow{font-size:10px;letter-spacing:.17em;font-weight:800;color:var(--teal);margin:0 0 7px}.git-brand h1{font-size:clamp(22px,3vw,30px);margin:0;letter-spacing:-.04em}.version-tag{font-size:9px;letter-spacing:.12em;border:1px solid #38564f;border-radius:5px;padding:4px 6px;color:var(--teal);vertical-align:middle;margin-left:5px}.user-tools{display:flex;align-items:center;gap:12px}.user-email{font-size:12px;color:var(--muted)}
    .panel{background:linear-gradient(145deg,rgba(18,29,40,.97),rgba(12,20,29,.97));border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 34px #00000012}.repo-strip{max-width:1500px;margin:0 auto 18px;padding:15px 18px;display:flex;justify-content:space-between;align-items:center;gap:18px}.repo-picker{display:grid;grid-template-columns:auto minmax(180px,260px);align-items:center;gap:5px 14px;flex:1}.repo-picker label,.field-label{font-size:11px;color:var(--muted);font-weight:700}.repo-picker select{background:#0a1119;color:var(--text);border:1px solid #304153;border-radius:8px;padding:10px 12px;outline:none}.repo-detail{grid-column:2;color:#77889b;font-size:11px}
    .btn{border:1px solid #344557;background:#172431;color:var(--text);border-radius:9px;padding:9px 13px;font-size:12px;font-weight:700;transition:.15s}.btn:hover:not(:disabled){border-color:#5a7c8d;background:#203242}.btn-primary{background:var(--teal);border-color:var(--teal);color:#08201e}.btn-primary:hover:not(:disabled){background:#8af3e2}.btn-quiet{background:transparent;border-color:#2a3948;color:#b5c2d0}.btn-danger{background:#b93d48;border-color:#db5d68;color:white}.alert{max-width:1500px;margin:0 auto 16px;border-radius:10px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start;font-size:12px}.alert span{flex:1;white-space:pre-wrap}.alert button{background:transparent;color:inherit;border:0;font-size:18px}.alert-error{border:1px solid #71363d;background:#351c23;color:#ffc3c6}.alert-success{border:1px solid #24634e;background:#102c26;color:#a8f4d8}
    .stat-grid{max-width:1500px;margin:0 auto 18px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}.stat-card{padding:16px 18px;min-width:0}.stat-top{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:11px}.stat-top i{font-style:normal;color:var(--teal);font-size:19px}.stat-card>strong{display:block;font-size:clamp(22px,2.5vw,30px);letter-spacing:-.04em;margin:10px 0 5px;overflow-wrap:anywhere}.stat-card>small{display:block;font-size:11px;color:#74869a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stat-card .amber{color:var(--amber)}.stat-card .blue{color:var(--blue)}
    .main-grid{max-width:1500px;margin:0 auto 18px;display:grid;grid-template-columns:1fr 1.1fr;gap:18px}.overview-panel,.actions-panel,.diff-panel,.bottom-grid>.panel{padding:21px}.section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:19px}.section-heading h2{font-size:17px;margin:0;letter-spacing:-.025em}.section-heading .eyebrow{margin-bottom:6px}.muted{color:var(--muted)}.small-copy{font-size:12px;line-height:1.6}.status-pill{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;border:1px solid #314050;border-radius:99px;padding:6px 9px;font-size:10px;color:#9eacba}.status-pill i{width:6px;height:6px;background:#8a9aab;border-radius:50%}.status-pill.is-clean{border-color:#285e4c;color:#8ce4bd}.status-pill.is-clean i{background:#5cdda8}.status-pill.is-dirty{border-color:#73572d;color:#ffd18a}.status-pill.is-dirty i{background:#ffc56c}
    .status-lines{border-top:1px solid #263442}.status-line{display:flex;justify-content:space-between;gap:15px;padding:12px 0;border-bottom:1px solid #202e3b;font-size:11px}.status-line span{color:#8797a8;flex:0 0 110px}.status-line strong{text-align:right;font-weight:600;overflow-wrap:anywhere}.button-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.actions-panel .section-heading{margin-bottom:7px}.lock-icon{font-size:23px;color:var(--teal)}.actions-panel .small-copy{margin:0 0 15px}.field-label{display:block;margin:14px 0 7px}.text-input{width:100%;background:#0a1119;color:var(--text);border:1px solid #304153;border-radius:8px;padding:11px 12px;outline:none;font-size:12px}.text-input:focus,.repo-picker select:focus{border-color:#5ddcc7;box-shadow:0 0 0 2px #5ddcc71c}.action-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}.action-btn{display:flex;align-items:center;gap:11px;text-align:left;border:1px solid #2c3e4f;background:#111e29;border-radius:10px;color:var(--text);padding:13px 12px;min-width:0}.action-btn:hover:not(:disabled){border-color:#4d827b;background:#152a32}.action-btn>b{font-size:22px;color:var(--teal);width:28px;text-align:center;font-weight:500}.action-btn span{display:flex;flex-direction:column;gap:4px;min-width:0}.action-btn strong{font-size:12px}.action-btn small{font-size:10px;color:#8a9bad;line-height:1.4}.action-btn.action-danger{border-color:#53363a}.action-btn.action-danger>b{color:#ff8c91}.action-btn.action-danger:hover:not(:disabled){border-color:#a74d56;background:#291d25}.safety-note{font-size:10px;color:#8fa4b4;margin:14px 0 0}.safety-note span{color:var(--teal);margin-right:7px}
    .diff-panel{max-width:1500px;margin:0 auto 18px}.diff-heading{align-items:center}.diff-heading .small-copy{margin:6px 0 0}.scope-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.scope-tab{background:#0b141d;border:1px solid #273847;border-radius:9px;padding:10px;text-align:left;color:#9babb9;display:flex;flex-direction:column;gap:5px}.scope-tab strong{font-size:11px;color:#d8e1e9}.scope-tab small{font-size:10px;line-height:1.4}.scope-tab.active{border-color:#3f9b8d;background:#12302f;box-shadow:inset 0 0 0 1px #28685e}.scope-tab.active strong{color:var(--teal)}.diff-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:17px;padding:11px 0;border-bottom:1px solid #273644;font-size:11px;color:#9eafbe}.diff-code{margin:0;max-height:380px;overflow:auto;background:#080e14;border:1px solid #202e3a;border-radius:0 0 10px 10px;padding:15px;color:#a8bdcc;font:11px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.diff-code.raw{max-height:520px}.file-list{border:1px solid #202e3a;border-bottom:0;background:#0b131b}.file-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid #1c2a36;font-size:11px}.file-symbol{display:grid;place-items:center;width:20px;height:20px;border-radius:5px;background:#1d3438;color:var(--teal);font-size:9px}.file-row code{flex:1;overflow-wrap:anywhere;color:#cbd7e1}.file-stats{display:flex;gap:8px;font:10px ui-monospace,monospace}.file-stats em{color:#65dba5;font-style:normal}.file-stats i{color:#ff8888;font-style:normal}
    .bottom-grid{max-width:1500px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:18px}.bottom-grid .section-heading{margin-bottom:13px}.activity-list{display:flex;flex-direction:column}.activity-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #202e3b;font-size:11px}.activity-dot{width:7px;height:7px;border-radius:50%;background:#91a0b1;flex-shrink:0}.activity-dot.ok{background:#5cdda8}.activity-row span:nth-child(2){flex:1}.activity-row time{font-size:10px;color:#74869a}.guard-panel{display:flex;gap:15px;align-items:flex-start}.guard-icon{font-size:28px;color:var(--teal);border:1px solid #2b5d57;background:#15312f;border-radius:10px;padding:7px 12px}.guard-panel h3{margin:2px 0 10px;font-size:14px}.guard-panel ul{padding-left:17px;margin:0;color:#91a1b1;font-size:11px;line-height:1.9}
    .git-login{max-width:450px;margin:9vh auto;padding:36px;text-align:center}.git-login .brand-mark{margin:0 auto 20px}.git-login h1{font-size:32px;margin:0 0 12px}.git-login>p:not(.eyebrow){font-size:13px;line-height:1.7}.google-slot{display:flex;justify-content:center;margin:24px 0}.git-login .tiny{font-size:10px!important}.error-text{color:#ff9a9e}
    .modal-backdrop{position:fixed;inset:0;background:#02060bd9;backdrop-filter:blur(8px);z-index:9999;display:grid;place-items:center;padding:16px;overflow:auto}.confirm-modal{width:min(650px,100%);max-height:92vh;overflow:auto;border:1px solid #3a4b5a;border-radius:18px;background:#101923;box-shadow:0 30px 100px #000b;padding:24px}.modal-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.modal-icon{width:42px;height:42px;border:1px solid #316b60;background:#143330;color:var(--teal);border-radius:12px;display:grid;place-items:center;font-size:22px}.modal-icon.danger{border-color:#8c444a;background:#3b2027;color:#ff9ca0}.icon-button{border:0;background:transparent;color:#a6b4c2;font-size:25px}.confirm-modal h2{font-size:24px;margin:0 0 10px;text-transform:capitalize}.confirm-modal>p:not(.eyebrow){font-size:12px;line-height:1.65}.warning-list{padding:8px 12px;border:1px solid #6c502d;background:#30271b;border-radius:9px;color:#ffd38d;font-size:11px}.preview-files{margin:12px 0;border:1px solid #293948;border-radius:8px;overflow:hidden}.preview-files>div{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border-bottom:1px solid #24323e;font-size:11px}.preview-files code{overflow-wrap:anywhere}.preview-output{max-height:180px;overflow:auto;white-space:pre-wrap;background:#080e14;border:1px solid #24323e;border-radius:8px;padding:12px;color:#a8bdcc;font:10px/1.6 ui-monospace,monospace}.confirm-modal .field-label{line-height:1.8}.confirm-modal .field-label code{color:var(--amber);background:#30271b;padding:3px 5px;border-radius:4px}.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
    @media(max-width:1000px){.main-grid{grid-template-columns:1fr}.stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.bottom-grid{grid-template-columns:1fr}}
    @media(max-width:620px){.git-page{padding:16px 11px 34px}.git-topbar{align-items:flex-start}.git-brand{gap:9px}.brand-mark.small{width:37px;height:37px}.brand-mark.small svg{width:24px}.user-email{display:none}.repo-strip{align-items:stretch;flex-direction:column}.repo-picker{grid-template-columns:1fr}.repo-detail{grid-column:1}.stat-grid{gap:8px}.stat-card{padding:13px}.stat-card>small{white-space:normal}.scope-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.action-grid{grid-template-columns:1fr}.overview-panel,.actions-panel,.diff-panel,.bottom-grid>.panel{padding:15px}.section-heading{flex-direction:column}.diff-heading{align-items:flex-start}.confirm-modal{padding:18px}.modal-actions{flex-direction:column-reverse}.modal-actions .btn{width:100%}}
  `}</style>;
}