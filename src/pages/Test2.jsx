// ============================================================
// TEST2 — API Contracts (contratti API del gateway)
// Pagina statica di documentazione: nessuna chiamata al backend
// oltre alla verifica del login Google. Nessuna modifica backend.
// Dati allineati a gateway.py / git_admin.py (17 ottobre 2026).
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_STORAGE_KEY = "leles_admin_id_token";
const ALLOWED_EMAILS = ["dannybydanny@hotmail.com", "salatinodenise@gmail.com"];

function parseJwt(token) {
  try {
    const raw = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(raw).split("").map((c) =>
      "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")));
  } catch { return null; }
}
function validToken(token) {
  const p = token ? parseJwt(token) : null;
  return !!p?.exp && p.exp * 1000 > Date.now() + 5000;
}
function storedToken() {
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    return validToken(token) ? token : null;
  } catch { return null; }
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
        buttonRef.current.innerHTML = "";
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

// ------------------------------------------------------------
// DATI: contratti API (fonte: gateway.py + git_admin.py)
// ------------------------------------------------------------
const GROUPS = [
  {
    id: "chat", label: "Chat", icon: "◈",
    note: "Dialogo con gli agenti pubblici. Nessuna autenticazione.",
    endpoints: [
      {
        method: "POST", path: "/api/chat", auth: false,
        summary: "Chat testuale con un agente pubblico.",
        request: 'Content-Type: application/json\n\n{\n  "agent": "Lele I | Bar_AI demo | Story Whisper | Night Story",\n  "prompt": "...",\n  "chat_id": 1010101010,\n  "language": "en"\n}',
        response: '{ ...risposta JSON dell'agente... }',
        notes: "Il gateway inoltra su 127.0.0.1:{porta}/ask del rispettivo agente.",
      },
      {
        method: "POST", path: "/api/chat/audio", auth: false,
        summary: "Chat vocale (multipart): audio + agente.",
        request: 'Content-Type: multipart/form-data\n\naudio:      <file webm/ogg>\nagent:      "Story Whisper" | "Night Story"\nchat_id:    1010101010\nlanguage:   "en"',
        response: '{ ...trascrizione + risposta... }',
        notes: "Solo Story Whisper (8088) e Night Story (8666) hanno input audio.",
      },
      {
        method: "GET", path: "/api/chat/tts/{agent}/{filename}", auth: false,
        summary: "Scarica un audio TTS generato da un agente.",
        request: "—",
        response: "audio/ogg (stream)",
      },
    ],
  },
  {
    id: "barai", label: "Bar AI", icon: "◍",
    note: "Assistente ristorazione + proxy admin.",
    endpoints: [
      {
        method: "POST", path: "/api/bar-ai/ask", auth: false,
        summary: "Domanda a Bar AI.",
        request: '{\n  "question": "...",\n  "plan": "Basic",\n  "restaurant_id": 1,\n  "user_id": "default"\n}',
        response: '{ ...risposta Bar AI... }',
        notes: "Proxy verso Bar AI su porta 8081.",
      },
      {
        method: "GET", path: "/api/bar-ai/summary", auth: false,
        summary: "Statistiche/riepilogo ristorante.",
        request: "—",
        response: '{ ...summary... }',
      },
      {
        method: "ANY", path: "/api/bar-ai/admin/{path}", auth: false,
        summary: "Proxy all'admin API del gestionale bar (CRUD tabelle).",
        request: "GET | POST | PUT | DELETE — inoltrato com'è",
        response: "{ ...risposta admin_api... }",
        notes: "Proxy verso admin_api su porta 8083 (usato da Test6).",
      },
    ],
  },
  {
    id: "admin", label: "Admin Chat", icon: "⌘",
    note: "Canale privato con Lele Admin.",
    endpoints: [
      {
        method: "POST", path: "/api/admin/chat", auth: true,
        summary: "Chat con Lele Admin (orchestratore).",
        request: '{\n  "prompt": "...",\n  "chat_id": 1010101010,\n  "language": "en"\n}',
        response: "{ ...risposta Lele Admin... }",
        notes: "Se l'email è in ADMIN_USER_CHAT_IDS, il chat_id Telegram è risolto lato server.",
      },
    ],
  },
  {
    id: "arena", label: "Agent Arena", icon: "◎",
    note: "Run bot-to-bot con polling (B2B.jsx / Improve).",
    endpoints: [
      {
        method: "POST", path: "/api/agent-arena/start", auth: true,
        summary: "Avvia un run Arena.",
        request: '{\n  "participants": [{ "agent", "character", "role", "model" }],\n  "world_source": "free",\n  "world_ref": "",\n  "topic": "",\n  "max_turns": 10\n}',
        response: '{ "run_id", "status", ... }',
        notes: "Tetti anti-abuso: max 50 turni, 600 messaggi, 3 run attivi.",
      },
      {
        method: "GET", path: "/api/agent-arena/{run_id}", auth: true,
        summary: "Stato e messaggi del run (polling).",
        request: "—",
        response: '{ "status", "messages", ... }',
      },
      {
        method: "POST", path: "/api/agent-arena/{run_id}/stop", auth: true,
        summary: "Ferma il run.",
        request: "—", response: '{ "ok", ... }',
      },
      {
        method: "POST", path: "/api/agent-arena/{run_id}/hand", auth: true,
        summary: "Pausa: mano alzata, attesa intervento umano (timeout 600s).",
        request: "—", response: '{ "ok", ... }',
      },
      {
        method: "POST", path: "/api/agent-arena/{run_id}/intervene", auth: true,
        summary: "Intervento umano nel run.",
        request: '{ "text": "...", ... }',
        response: '{ "ok", ... }',
        notes: "Max 2000 caratteri, 20 interventi per run.",
      },
    ],
  },
  {
    id: "image", label: "Image Lab", icon: "▣",
    note: "Generazione Z-Image-Turbo via coda job asincrona.",
    endpoints: [
      {
        method: "GET", path: "/api/image/health", auth: true,
        summary: "Stato della coda e del modello.",
        request: "—", response: '{ ...stato... }',
      },
      {
        method: "POST", path: "/api/image/jobs", auth: true,
        summary: "Txt2img: crea un job di generazione (202).",
        request: '{\n  "prompt": "...",\n  "width": 512,  "height": 512,\n  "steps": 8,\n  "seed": -1\n}',
        response: '{ "job_id", "status": "QUEUED", "message" }',
        notes: "Dimensioni consentite 512/768/1024. Seed ≤ 2^31-1. Un job per email.",
      },
      {
        method: "GET", path: "/api/image/jobs/{job_id}", auth: true,
        summary: "Stato del job (polling).",
        request: "—",
        response: '{ "job_id", "status", "message", "error" }',
      },
      {
        method: "GET", path: "/api/image/jobs/{job_id}/result", auth: true,
        summary: "Risultato del job completato.",
        request: "—",
        response: '{ "image_base64", "seed", "width", "height" }',
      },
      {
        method: "POST", path: "/api/image/img2img", auth: true,
        summary: "Img2img: modifica una foto caricata (multipart, 202).",
        request: 'Content-Type: multipart/form-data\n\nimage:     <file immagine, max 15 MB>\nprompt:    "descrizione della modifica"\nstrength:  0.65   (0 < s ≤ 1)\nwidth:     512\nheight:    512\nsteps:     8\nseed:      -1',
        response: '{ "job_id", "status": "QUEUED", "message" }',
        notes: "Polling identico a txt2img. Richiede direct_img2img su Gradio 7860.",
      },
      {
        method: "GET", path: "/api/image/history", auth: true,
        summary: "Metadati delle generazioni salvate (ultime 100).",
        request: "—",
        response: '[{ "job_id", "prompt", "width", "height", "steps", "seed", "mode?", "strength?" }, ...]',
      },
      {
        method: "GET", path: "/api/image/history/{job_id}/image", auth: true,
        summary: "PNG di una generazione in history.",
        request: "—",
        response: "image/png (FileResponse)",
      },
    ],
  },
  {
    id: "vision", label: "Vision / OCR", icon: "◉",
    note: "OCR con agente JCS per i fogli di presenza.",
    endpoints: [
      {
        method: "POST", path: "/api/vision/ocr", auth: true,
        summary: "OCR di un'immagine + interpretazione JCS se è un timesheet.",
        request: '{\n  "image_base64": "..."   // max 10 MB\n}',
        response: '{\n  "text": "...OCR...",\n  "is_jcs": true|false,\n  "jcs": "Jai Ca sheet\\n\\n...interpretazione..."\n}',
        notes: "Modello Ollama VISION_OCR_MODEL (default qwen2.5vl), lock 1 richiesta. Il prefisso \"Jai Ca sheet\" indica che l'agente JCS è scattato.",
      },
    ],
  },
  {
    id: "improve", label: "Improve", icon: "✎",
    note: "Editor file con revisione AI.",
    endpoints: [
      {
        method: "GET", path: "/api/improve/files", auth: true,
        summary: "Elenco file del repository.",
        request: "—", response: '[{ ...file... }, ...]',
      },
      {
        method: "GET", path: "/api/improve/file", auth: true,
        summary: "Contenuto di un file.",
        request: '?path=...', response: '{ ...contenuto... }',
      },
      {
        method: "POST", path: "/api/improve/save", auth: true,
        summary: "Salvataggio file.",
        request: '{ ...path + contenuto... }', response: '{ "ok", ... }',
      },
    ],
  },
  {
    id: "git", label: "Git Admin", icon: "⑂",
    note: "Operazioni Git con preview + conferma (git_admin.py).",
    endpoints: [
      {
        method: "GET", path: "/api/git/admin/status", auth: true,
        summary: "Stato repo (branch, ahead/behind, working tree).",
        request: '?project=leles|bar_ai|lele|lele_story_whisper|lele_night_story|dv_site',
        response: '{ "branch", "ahead", "behind", "dirty", "last_commit", ... }',
      },
      {
        method: "GET", path: "/api/git/admin/diff", auth: true,
        summary: "Diff per scope.",
        request: '?project=...&scope=working|staged|incoming|outgoing',
        response: '{ "summary", "files", "diff", "truncated" }',
      },
      {
        method: "POST", path: "/api/git/admin/preview", auth: true,
        summary: "Anteprima monouso di un'operazione (TTL 5 min).",
        request: '{ "project", "action": "commit|push|pull|force_pull", "message"? }',
        response: '{ "preview_id", "summary", "warnings", "safe", "confirmation_phrase", ... }',
      },
      {
        method: "POST", path: "/api/git/admin/execute", auth: true,
        summary: "Esegue l'operazione confermata.",
        request: '{ "project", "action", "message?", "confirmation_phrase", "preview_id" }',
        response: '{ "ok", "message" }',
        notes: "Richiede GIT_ADMIN_ALLOW_WRITE=1 (e GIT_ADMIN_ALLOW_FORCE=1 per il pull forzato).",
      },
    ],
  },
];

const PORTS = [
  { port: "9090", name: "gateway.py", detail: "API gateway pubblico (uvicorn)" },
  { port: "8080", name: "Lele I", detail: "agente pubblico" },
  { port: "8081", name: "Bar_AI", detail: "assistente ristorazione" },
  { port: "8082", name: "Leles", detail: "orchestratore / Lele Admin" },
  { port: "8083", name: "admin_api", detail: "CRUD tabelle bar (Test6)" },
  { port: "8088", name: "Story Whisper", detail: "storie per bambini" },
  { port: "8666", name: "Night Story", detail: "storie per adulti" },
  { port: "7860", name: "Gradio Z-Image-Turbo", detail: "direct_generate · direct_img2img" },
  { port: "7999", name: "model_server", detail: "backend del modello immagine" },
  { port: "11434", name: "Ollama", detail: "VISION_OCR_MODEL (qwen2.5vl)" },
  { port: "5432", name: "PostgreSQL", detail: "log e persistenza" },
];

function methodClass(m) {
  return { GET: "get", POST: "post", ANY: "any" }[m] || "any";
}

export default function Test2() {
  const auth = useGoogleAuth();
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [copied, setCopied] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUPS
      .filter((g) => activeGroup === "all" || g.id === activeGroup)
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter((e) =>
          !q || e.path.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [query, activeGroup]);

  async function copyCurl(ep) {
    const curl = "curl -X " + ep.method + " https://api.danielevillanova.com" + ep.path +
      (ep.auth ? " \\\n  -H 'Authorization: Bearer <google_id_token>'" : "");
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(ep.method + " " + ep.path);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {}
  }

  if (!auth.token || !auth.allowed) {
    return (
      <main className="api-page"><ApiStyles />
        <section className="api-login panel">
          <p className="eyebrow">D. VILLANOVA · DEVELOPER TOOLS</p>
          <h1>API Contracts</h1>
          <p className="muted">Riferimento dei contratti API del gateway. Accesso riservato.</p>
          {!auth.token
            ? <div ref={auth.buttonRef} className="google-slot" />
            : <>
                <p className="error-text">Account non autorizzato: {auth.email || "email non disponibile"}</p>
                <button className="btn" onClick={auth.logout}>Logout / cambia account</button>
              </>}
        </section>
      </main>
    );
  }

  return (
    <main className="api-page"><ApiStyles />
      <header className="api-topbar">
        <div>
          <p className="eyebrow">D. VILLANOVA · DEVELOPER TOOLS</p>
          <h1>API Contracts <span className="version-tag">{GROUPS.reduce((n, g) => n + g.endpoints.length, 0)} ENDPOINT</span></h1>
        </div>
        <div className="user-tools">
          <input className="search-input" type="search" placeholder="Cerca rotta o descrizione…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="user-email">{auth.email}</span>
          <button className="btn btn-quiet" onClick={auth.logout}>Logout</button>
        </div>
      </header>

      <section className="panel ports-strip">
        <p className="eyebrow">ARCHITETTURA · PORTE LOCALI (MAC)</p>
        <div className="ports-grid">
          {PORTS.map((p) => (
            <div className="port-chip" key={p.port}>
              <strong>:{p.port}</strong>
              <span>{p.name}</span>
              <small>{p.detail}</small>
            </div>
          ))}
        </div>
      </section>

      <nav className="group-tabs">
        <button className={"group-tab" + (activeGroup === "all" ? " active" : "")}
          onClick={() => setActiveGroup("all")}>Tutti</button>
        {GROUPS.map((g) => (
          <button key={g.id} className={"group-tab" + (activeGroup === g.id ? " active" : "")}
            onClick={() => setActiveGroup(g.id)}>{g.icon} {g.label}</button>
        ))}
      </nav>

      {filtered.map((g) => (
        <section key={g.id} className="panel group-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{g.icon} {g.label.toUpperCase()}</p>
              <h2>{g.endpoints.length} endpoint</h2>
            </div>
            <p className="muted small-copy">{g.note}</p>
          </div>
          {g.endpoints.map((ep) => (
            <article className="endpoint" key={ep.method + ep.path}>
              <div className="endpoint-head">
                <span className={"method m-" + methodClass(ep.method)}>{ep.method}</span>
                <code className="endpoint-path">{ep.path}</code>
                {ep.auth
                  ? <span className="auth-pill" title="Authorization: Bearer <google_id_token>">🔒 Bearer</span>
                  : <span className="auth-pill open">pubblico</span>}
                <button className="btn btn-quiet btn-copy" onClick={() => copyCurl(ep)}>
                  {copied === ep.method + " " + ep.path ? "✓ copiato" : "copia curl"}
                </button>
              </div>
              <p className="endpoint-summary">{ep.summary}</p>
              <div className="endpoint-detail">
                <div><label>Request</label><pre>{ep.request}</pre></div>
                <div><label>Response</label><pre>{ep.response}</pre></div>
              </div>
              {ep.notes && <p className="endpoint-notes">◆ {ep.notes}</p>}
            </article>
          ))}
        </section>
      ))}

      <footer className="api-footer muted">
        <span>Fonte: gateway.py + git_admin.py · aggiornato 17 ottobre 2026</span>
        <span>Pagina statica: nessuna dipendenza dal backend</span>
      </footer>
    </main>
  );
}

function ApiStyles() {
  return <style>{`
    .api-page{--bg:#080d13;--panel:#101923;--line:#243241;--text:#e6edf3;--muted:#91a0b1;--teal:#62e6cf;--amber:#ffca75;min-height:100vh;background:radial-gradient(ellipse at 15% -15%,#12303a 0,transparent 38%),var(--bg);color:var(--text);padding:26px clamp(14px,3vw,42px) 54px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
    .api-page *{box-sizing:border-box}.api-page button,.api-page input{font:inherit}.api-page button{cursor:pointer}
    .eyebrow{font-size:10px;letter-spacing:.17em;font-weight:800;color:var(--teal);margin:0 0 7px}
    .muted{color:var(--muted)}.small-copy{font-size:12px;line-height:1.6;margin:0}
    .api-topbar{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;max-width:1500px;margin:0 auto 22px;flex-wrap:wrap}
    .api-topbar h1{font-size:clamp(22px,3vw,30px);margin:0;letter-spacing:-.04em}
    .version-tag{font-size:9px;letter-spacing:.12em;border:1px solid #38564f;border-radius:5px;padding:4px 6px;color:var(--teal);vertical-align:middle;margin-left:5px}
    .user-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .search-input{background:#0a1119;color:var(--text);border:1px solid #304153;border-radius:8px;padding:9px 12px;outline:none;font-size:12px;min-width:230px}
    .search-input:focus{border-color:#5ddcc7}
    .user-email{font-size:12px;color:var(--muted)}
    .panel{background:linear-gradient(145deg,rgba(18,29,40,.97),rgba(12,20,29,.97));border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 34px #00000012}
    .btn{border:1px solid #344557;background:#172431;color:var(--text);border-radius:9px;padding:8px 12px;font-size:12px;font-weight:700;transition:.15s}
    .btn:hover{border-color:#5a7c8d}.btn-quiet{background:transparent;border-color:#2a3948;color:#b5c2d0}
    .ports-strip{max-width:1500px;margin:0 auto 16px;padding:16px 18px}
    .ports-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
    .port-chip{display:flex;flex-direction:column;gap:2px;border:1px solid #263442;border-radius:9px;padding:9px 11px;background:#0b131b}
    .port-chip strong{color:var(--teal);font:11px ui-monospace,monospace}
    .port-chip span{font-size:11px;font-weight:600}
    .port-chip small{font-size:10px;color:#74869a}
    .group-tabs{display:flex;gap:8px;flex-wrap:wrap;max-width:1500px;margin:0 auto 16px}
    .group-tab{border:1px solid #273847;background:#0b141d;color:#9babb9;border-radius:99px;padding:8px 14px;font-size:11px;font-weight:600}
    .group-tab:hover{border-color:#4d827b}
    .group-tab.active{border-color:#3f9b8d;background:#12302f;color:var(--teal)}
    .group-section{max-width:1500px;margin:0 auto 18px;padding:20px 21px}
    .section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px;flex-wrap:wrap}
    .section-heading h2{font-size:16px;margin:0;letter-spacing:-.02em}
    .endpoint{border:1px solid #22303e;border-radius:12px;padding:14px 15px;margin-bottom:10px;background:#0c141d}
    .endpoint:last-child{margin-bottom:0}
    .endpoint-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .method{font:700 10px ui-monospace,monospace;border-radius:5px;padding:4px 7px;letter-spacing:.05em}
    .m-get{background:#123430;color:#7fe3c0}.m-post{background:#26304a;color:#9db4ff}.m-any{background:#3a2c1c;color:#ffca75}
    .endpoint-path{font:12px ui-monospace,monospace;color:#dbe6ef;overflow-wrap:anywhere}
    .auth-pill{font-size:9px;letter-spacing:.08em;border:1px solid #34455a;border-radius:99px;padding:4px 8px;color:#9eacba}
    .auth-pill.open{border-color:#285e4c;color:#8ce4bd}
    .btn-copy{margin-left:auto;font-size:10px;padding:5px 9px}
    .endpoint-summary{font-size:12px;margin:9px 0 0;color:#c3cdd8}
    .endpoint-detail{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:11px}
    .endpoint-detail label{display:block;font-size:10px;letter-spacing:.1em;color:var(--muted);font-weight:700;margin-bottom:5px}
    .endpoint-detail pre{margin:0;background:#080e14;border:1px solid #1e2a36;border-radius:8px;padding:11px;color:#a8bdcc;font:10.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto}
    .endpoint-notes{font-size:11px;color:#8fa4b4;margin:10px 0 0}
    .endpoint-notes span{color:var(--teal)}
    .api-footer{max-width:1500px;margin:0 auto;display:flex;justify-content:space-between;gap:12px;font-size:10px;flex-wrap:wrap}
    .api-login{max-width:450px;margin:9vh auto;padding:36px;text-align:center}
    .api-login h1{font-size:32px;margin:0 0 12px}
    .api-login>p:not(.eyebrow){font-size:13px;line-height:1.7}
    .google-slot{display:flex;justify-content:center;margin:24px 0}
    .error-text{color:#ff9a9e}
    @media(max-width:720px){.endpoint-detail{grid-template-columns:1fr}.btn-copy{margin-left:0}.search-input{min-width:140px}}
  `}</style>;
}
