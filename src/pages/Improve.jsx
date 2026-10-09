// ============================================================
// IMPROVE - miglioramento file del repo Leles via Agent Arena
// ============================================================
// Terzo flusso di improve, gestito dal sito: scegli il file .py del
// repo Leles, da 1 a 6 bot (ruoli Emergence + Super-Leles) e fino a
// 3 iterazioni. Il file diventa il topic dell'Arena, i bot discutono,
// e a run COMPLETED si puo salvare <file>.improved.py (mai l'originale,
// stessa regola di improver_agent.py).
//
// Dipende dal gateway (https://api.danielevillanova.com):
//   GET  /api/improve/files            -> { files: [{path, size}] }
//   GET  /api/improve/file?path=...    -> { content }
//   POST /api/improve/save             -> { saved_path }
//   + Agent Arena: start / GET {run_id} / stop
//
// Contratto del gateway (verificato su gateway.py):
//   - stato SEMPRE MAIUSCOLO: STARTING | RUNNING | PAUSED | COMPLETED | STOPPED | ERROR
//   - ogni turno ha il campo "text" (non "message")
//   - GET {run_id} restituisce anche "error"
//   - start accetta "improve": true (topic fisso su ogni turno + chat isolate)
//
// AUTH: login Google, stesso client del gateway (come HomeTest4).
// ============================================================

import { useState, useEffect, useRef } from "react";

const API = "https://api.danielevillanova.com";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_STORAGE_KEY = "dv_google_id_token";

// Ruoli Emergence (stessi di HomeTest4 / core/db_init_exp.py).
const QE_ROLES = [
  "Planner",
  "Scientist",
  "Builder",
  "Critic",
  "Observer",
  "Architect",
  "Developer",
  "Tester",
  "Reviewer",
  "Sheriff",
  "Outlaw",
  "Explorer",
];

// Modelli ammessi dal gateway: ruoli normali = 5 base;
// Super-Leles anche qwen-coder e gpt-oss.
const ROLE_MODELS = ["gemma4", "llama3", "mistral", "qwen2.5", "deepseek-r1"];
const SL_MODELS = [
  "gemma4",
  "llama3",
  "mistral",
  "qwen2.5",
  "deepseek-r1",
  "qwen2.5-coder:7b",
  "gpt-oss:20b",
];

const MAX_BOTS = 6;
const MAX_ITERATIONS = 3;

// Il gateway rifiuta file oltre 40.000 caratteri (_IMPROVE_MAX_CHARS).
const MAX_FILE_BYTES = 40000;

const ACTIVE_STATUSES = ["STARTING", "RUNNING", "PAUSED"];
const FINISHED_STATUSES = ["COMPLETED", "STOPPED", "ERROR"];

// Regola di grounding condivisa. Nel gateway, con improve=true, il topic
// viene rimandato a OGNI bot: queste regole valgono per tutti i turni.
const IMPROVE_GROUNDING =
  "REGOLE FERREE:\n" +
  "- Usa SOLO nomi (funzioni, variabili, classi, import) che esistono gia nel file.\n" +
  "- Se proponi qualcosa di NUOVO marcalo esplicitamente come NUOVO e spiega perche serve.\n" +
  "- NON aggiungere funzioni, main(), esempi, path di prova o codice eseguito a livello di modulo " +
  "se non esistono gia nel file o non sono richiesti.\n" +
  "- Mantieni invariati firme pubbliche, import e comportamento, salvo bug dimostrabile.\n" +
  "- Se un fix richiede un altro file, dillo invece di indovinare cosa contiene.\n" +
  "- Rispondi in modo tecnico e neutro, senza dialetto o personaggi.\n";

function buildTopic(filePath, content, request) {
  const req =
    (request || "").trim() ||
    "Migliora il file: correggi bug, migliora leggibilita e prestazioni dove chiaramente giustificato.";
  return (
    "Sei un ingegnere Python. Il tuo compito e migliorare il file seguente del repo Leles.\n\n" +
    IMPROVE_GROUNDING +
    "\n=== RICHIESTA UTENTE ===\n" +
    req +
    "\n\n=== FILE: " +
    filePath +
    " ===\n" +
    "```python\n" +
    content +
    "\n" +
    "```" +
    "\n\n" +
    "Spiega in poche righe cosa cambi e perche. " +
    "Poi chiudi SEMPRE la risposta con la versione MIGLIORATA COMPLETA del file in un unico " +
    "blocco ```python (file intero, non un diff o un estratto). " +
    "Se ricevi la proposta di un altro bot, correggila e riproponi il file completo."
  );
}

// Estrae il blocco ```python piu grande da un messaggio (il file completo
// e quasi sempre il blocco piu lungo, anche se c'e uno snippet dopo).
function extractLastCode(text) {
  if (!text) return null;
  const rx = /```(?:python|py)?[ \t]*\r?\n([\s\S]*?)```/gi;
  let best = null;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const code = m[1].trim();
    if (code && (!best || code.length >= best.length)) best = code;
  }
  return best;
}

// Il gateway usa "text"; "message" resta come fallback difensivo.
function turnText(t) {
  return (t && (t.text ?? t.message)) || "";
}

// ============================================================
// GOOGLE AUTH
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

  // Sync login tra pagine/tab: se un'altra pagina fa login/logout,
  // l'evento "storage" ci arriva subito e aggiorniamo lo stato.
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

// ============================================================
// PAGINA
// ============================================================

export default function Improve() {
  const { idToken, email, buttonRef, logout } = useGoogleAuth();

  const [files, setFiles] = useState([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [cfg, setCfg] = useState({
    file: "",
    request: "",
    saveImproved: true,
    iterations: 3,
    participants: [
      { id: 0, kind: "role", role: "Developer", model: "gemma4" },
    ],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState("");
  const [runError, setRunError] = useState("");
  const [turns, setTurns] = useState([]);
  const [savedPath, setSavedPath] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [finalCode, setFinalCode] = useState("");
  const [copied, setCopied] = useState(false);

  const savedRef = useRef(false);
  const pollRef = useRef(null);
  // Snapshot di cio che e stato lanciato: se cambi file o checkbox mentre
  // il run gira, il salvataggio resta coerente con il run.
  const runFileRef = useRef("");
  const runSaveRef = useRef(true);

  const isRunning = ACTIVE_STATUSES.includes(status);

  // Carica la lista file quando c'e il token.
  useEffect(() => {
    if (!idToken) return;
    fetch(API + "/api/improve/files", {
      headers: { Authorization: "Bearer " + idToken },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        setFiles(d.files || []);
        setFilesLoaded(true);
      })
      .catch(() => {
        setFiles([]);
        setFilesLoaded(true);
      });
  }, [idToken]);

  // Polling del run (si ferma da solo a run finito).
  useEffect(() => {
    if (!runId || !idToken) return;

    async function tick() {
      try {
        const r = await fetch(API + "/api/agent-arena/" + runId, {
          headers: { Authorization: "Bearer " + idToken },
        });
        if (r.status === 404) {
          // ARENA_RUNS vive in memoria: un riavvio del gateway lo azzera.
          setRunError(
            "Run non trovato sul gateway (riavviato?). I turni salvati sono in emergence.arena_turns."
          );
          setStatus("ERROR");
          clearInterval(pollRef.current);
          return;
        }
        if (!r.ok) return;
        const d = await r.json();
        const st = String(d.status || "").toUpperCase();
        setTurns(d.turns || []);
        setRunError(d.error || "");
        setStatus(st);
        if (FINISHED_STATUSES.includes(st)) clearInterval(pollRef.current);
      } catch {
        /* transient */
      }
    }

    tick();
    pollRef.current = setInterval(tick, 2500);
    return () => clearInterval(pollRef.current);
  }, [runId, idToken]);

  // Run COMPLETED: prende il codice dall'ultimo bot che ne ha prodotto
  // uno e lo salva (se richiesto). Con ERROR/STOPPED non salva niente.
  useEffect(() => {
    if (!runId || status !== "COMPLETED" || savedRef.current) return;
    savedRef.current = true;

    const code = [...turns]
      .reverse()
      .filter((t) => t.agent !== "human")
      .map((t) => extractLastCode(turnText(t)))
      .find(Boolean);

    if (!code) {
      setSaveNote(
        "Nessun blocco ```python trovato nelle risposte: niente da salvare."
      );
      return;
    }

    setFinalCode(code);

    if (!runSaveRef.current || !runFileRef.current) return;

    fetch(API + "/api/improve/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken,
      },
      body: JSON.stringify({ path: runFileRef.current, code }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.detail || "HTTP " + r.status);
        return d;
      })
      .then((d) => setSavedPath(d.saved_path || ""))
      .catch((e) => setSaveNote("Salvataggio non riuscito: " + e.message));
  }, [status, turns, runId, idToken]);

  function setField(name, value) {
    setCfg((c) => ({ ...c, [name]: value }));
  }

  function updateParticipant(idx, patch) {
    setCfg((c) => ({
      ...c,
      participants: c.participants.map((p, i) =>
        i === idx ? { ...p, ...patch } : p
      ),
    }));
  }

  function addBot() {
    setCfg((c) =>
      c.participants.length >= MAX_BOTS
        ? c
        : {
            ...c,
            participants: [
              ...c.participants,
              {
                id: Date.now(),
                kind: "role",
                role: "Reviewer",
                model: "mistral",
              },
            ],
          }
    );
  }

  function removeBot(idx) {
    setCfg((c) => ({
      ...c,
      participants: c.participants.filter((_, i) => i !== idx),
    }));
  }

  async function startRun() {
    setError("");
    setRunError("");
    setSavedPath("");
    setSaveNote("");
    setFinalCode("");
    setCopied(false);
    savedRef.current = false;

    if (!cfg.file) {
      setError("Scegli un file da migliorare.");
      return;
    }
    if (!cfg.participants.length) {
      setError("Scegli almeno un bot.");
      return;
    }

    setBusy(true);
    try {
      const fr = await fetch(
        API + "/api/improve/file?path=" + encodeURIComponent(cfg.file),
        { headers: { Authorization: "Bearer " + idToken } }
      );
      if (!fr.ok) {
        const d = await fr.json().catch(() => ({}));
        throw new Error(d.detail || "Impossibile leggere il file.");
      }
      const fd = await fr.json();

      const participants = cfg.participants.map((p) =>
        p.kind === "sl"
          ? { agent: "super_leles", model: p.model }
          : { agent: "qe", role: p.role, model: p.model }
      );
      const body = {
        participants,
        topic: buildTopic(cfg.file, fd.content, cfg.request),
        max_turns: cfg.iterations,
        world_source: "free",
        improve: true,
      };

      const r = await fetch(API + "/api/agent-arena/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + idToken,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const detail =
          typeof d.detail === "string"
            ? d.detail
            : d.detail
            ? JSON.stringify(d.detail)
            : "";
        throw new Error(detail || "Avvio run fallito (HTTP " + r.status + ").");
      }
      const d = await r.json();

      runFileRef.current = cfg.file;
      runSaveRef.current = cfg.saveImproved;

      setTurns([]);
      setStatus("STARTING");
      setRunId(d.run_id);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stopRun() {
    if (!runId) return;
    try {
      await fetch(API + "/api/agent-arena/" + runId + "/stop", {
        method: "POST",
        headers: { Authorization: "Bearer " + idToken },
      });
    } catch {
      /* ignore */
    }
  }

  async function copyFinalCode() {
    try {
      await navigator.clipboard.writeText(finalCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  // Nasconde i .improved.py gia generati: non sono sorgenti da migliorare.
  const visibleFiles = files
    .filter((f) => !f.path.endsWith(".improved.py"))
    .filter(
      (f) =>
        !fileFilter ||
        f.path.toLowerCase().includes(fileFilter.toLowerCase())
    );

  if (!idToken) {
    return (
      <div className="imp-page">
        <h1>Improve</h1>
        <p>Accedi con Google per usare l'improve dei file Leles.</p>
        <div ref={buttonRef} />
      </div>
    );
  }

  return (
    <div className="imp-page">
      <div className="imp-head">
        <h1>Improve Leles</h1>
        <div className="imp-auth">
          <span>{email}</span>
          <button onClick={logout} className="imp-btn">Logout</button>
        </div>
      </div>

      <div className="imp-cols">
        {/* ---------- CONFIG ---------- */}
        <div className="imp-col">
          <label className="imp-label">File da migliorare</label>
          <input
            className="imp-input"
            placeholder="filtra (es. scripts/)"
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
          />
          {!filesLoaded && (
            <p className="imp-empty">Caricamento lista file...</p>
          )}
          {filesLoaded && !files.length && (
            <p className="imp-error">
              Nessun file trovato. Il gateway deve essere la versione
              nuova: riavvialo (Telegram: restart gateway) e ricarica
              la pagina.
            </p>
          )}
          <select
            className="imp-select"
            value={cfg.file}
            onChange={(e) => setField("file", e.target.value)}
            size={8}
          >
            {!cfg.file && <option value="">- scegli un file .py -</option>}
            {visibleFiles.map((f) => (
              <option
                key={f.path}
                value={f.path}
                disabled={f.size > MAX_FILE_BYTES}
              >
                {f.path} ({Math.round(f.size / 1024)} KB)
                {f.size > MAX_FILE_BYTES ? " - troppo grande" : ""}
              </option>
            ))}
          </select>
          {cfg.file && (
            <p className="imp-file-chosen">
              File selezionato: <code>{cfg.file}</code>
            </p>
          )}

          <label className="imp-label">Richiesta (opzionale)</label>
          <textarea
            className="imp-input"
            rows={3}
            placeholder="es. fix del bug X, estrai funzione Y..."
            value={cfg.request}
            onChange={(e) => setField("request", e.target.value)}
          />

          <label className="imp-label">
            {"Bot (1-" + MAX_BOTS + ", ruoli Emergence + Super-Leles)"}
          </label>
          <p className="imp-hint">
            Il codice salvato e quello dell'ultimo bot: mettilo per ultimo
            (es. Developer o Reviewer).
          </p>
          {cfg.participants.map((p, idx) => (
            <div key={p.id} className="imp-bot-row">
              <select
                className="imp-select"
                value={p.kind === "sl" ? "__sl__" : p.role}
                onChange={(e) =>
                  e.target.value === "__sl__"
                    ? updateParticipant(idx, {
                        kind: "sl",
                        model: "gemma4",
                      })
                    : updateParticipant(idx, {
                        kind: "role",
                        role: e.target.value,
                        model: ROLE_MODELS.includes(p.model)
                          ? p.model
                          : "gemma4",
                      })
                }
              >
                {QE_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
                <option value="__sl__">Super-Leles</option>
              </select>
              <select
                className="imp-select"
                value={p.model}
                onChange={(e) => updateParticipant(idx, { model: e.target.value })}
              >
                {(p.kind === "sl" ? SL_MODELS : ROLE_MODELS).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button className="imp-btn imp-x" onClick={() => removeBot(idx)}>
                X
              </button>
            </div>
          ))}
          {cfg.participants.length < MAX_BOTS && (
            <button className="imp-btn" onClick={addBot}>
              + Aggiungi bot
            </button>
          )}

          <label className="imp-label">Iterazioni (1-{MAX_ITERATIONS})</label>
          <select
            className="imp-select"
            value={cfg.iterations}
            onChange={(e) => setField("iterations", parseInt(e.target.value, 10))}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>

          <label className="imp-check">
            <input
              type="checkbox"
              checked={cfg.saveImproved}
              onChange={(e) => setField("saveImproved", e.target.checked)}
            />
            Salva <code>{"{file}.improved.py"}</code> a run completato
          </label>

          <div className="imp-actions">
            <button
              className="imp-btn imp-primary"
              disabled={busy || isRunning}
              onClick={startRun}
            >
              {busy ? "..." : "Avvia Improve"}
            </button>
            {isRunning && (
              <button className="imp-btn imp-danger" onClick={stopRun}>
                Stop
              </button>
            )}
          </div>

          {error && <div className="imp-error">! {error}</div>}
          {runId && (
            <div className="imp-runinfo">
              Run: <code>{String(runId).slice(0, 8)}</code> · Stato:{" "}
              <b>{status || "..."}</b>
              {runError && <div className="imp-error">! {runError}</div>}
              {savedPath && (
                <div className="imp-saved">
                  Salvato: <code>{savedPath}</code>
                </div>
              )}
              {saveNote && <div className="imp-note">{saveNote}</div>}
              {finalCode && (
                <button className="imp-btn imp-copy" onClick={copyFinalCode}>
                  {copied ? "Copiato" : "Copia codice finale"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ---------- TRANSCRIPT ---------- */}
        <div className="imp-col imp-transcript">
          <h2>Discussione</h2>
          {!turns.length && (
            <p className="imp-empty">
              {isRunning
                ? "In attesa del primo messaggio..."
                : "Nessun run attivo."}
            </p>
          )}
          {turns.map((t, i) => (
            <div key={t.id ?? i} className="imp-turn">
              <div className="imp-turn-head">
                <b>
                  {t.agent === "super_leles"
                    ? "Super-Leles"
                    : t.agent === "human"
                    ? "Tu"
                    : t.role || t.agent}
                </b>
                {t.model && <span className="imp-dim"> · {t.model}</span>}
                {t.turn && <span className="imp-dim"> · giro {t.turn}</span>}
              </div>
              <pre className="imp-msg">{turnText(t) || "(messaggio vuoto)"}</pre>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .imp-page { max-width: 1200px; margin: 0 auto; padding: 24px; color: #e5e7eb; min-height: 100vh; background: #0b0e14; }
        .imp-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
        .imp-auth { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #9ca3af; }
        .imp-cols { display: grid; grid-template-columns: 380px 1fr; gap: 20px; }
        @media (max-width: 900px) { .imp-cols { grid-template-columns: 1fr; } }
        .imp-col { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 16px; }
        .imp-label { display: block; margin: 14px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; }
        .imp-hint { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
        .imp-input, .imp-select { width: 100%; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: #e5e7eb; padding: 8px 10px; font-size: 13px; margin-bottom: 4px; }
        .imp-bot-row { display: flex; gap: 6px; margin-bottom: 6px; }
        .imp-bot-row .imp-select { margin-bottom: 0; flex: 1; }
        .imp-x { flex: 0; }
        .imp-btn { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #e5e7eb; border-radius: 8px; padding: 7px 14px; font-size: 13px; cursor: pointer; }
        .imp-btn:hover { background: rgba(255,255,255,.14); }
        .imp-btn:disabled { opacity: .5; cursor: not-allowed; }
        .imp-primary { background: #10b981; border-color: #10b981; color: #06281d; font-weight: 700; }
        .imp-danger { background: #ef4444; border-color: #ef4444; color: #fff; }
        .imp-copy { margin-top: 10px; }
        .imp-check { display: flex; gap: 8px; align-items: center; margin: 12px 0; font-size: 13px; }
        .imp-actions { display: flex; gap: 10px; margin-top: 10px; }
        .imp-error { margin-top: 12px; color: #f87171; font-size: 13px; }
        .imp-note { margin-top: 8px; color: #fbbf24; font-size: 13px; }
        .imp-runinfo { margin-top: 12px; font-size: 13px; color: #9ca3af; }
        .imp-saved { margin-top: 6px; color: #34d399; }
        .imp-transcript { max-height: 80vh; overflow-y: auto; }
        .imp-turn { margin-bottom: 14px; border-left: 2px solid #10b981; padding-left: 12px; }
        .imp-turn-head { font-size: 12px; color: #9ca3af; margin-bottom: 4px; }
        .imp-dim { color: #6b7280; }
        .imp-msg { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; background: rgba(0,0,0,.3); border-radius: 8px; padding: 10px; margin: 0; line-height: 1.5; }
        .imp-empty { color: #6b7280; font-size: 13px; }
        .imp-file-chosen { color: #34d399; font-size: 13px; margin-top: 6px; }
        .imp-page code { color: #34d399; }
      `}</style>
    </div>
  );
}
