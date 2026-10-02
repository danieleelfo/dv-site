// ============================================================
// PROJECT TEST — Agent Arena / Bot to Bot
// Layout ispirato a Emergence Lab.
//
// Agenti selezionabili:
//   - Night Story (8 generi da prompts/genre_*.txt)
//   - Story Whisper (nessun genere)
//   - Leles (orchestratore)
//   - QE / Emergence (12 ruoli dal DB)
//
// Modalità N partecipanti (2..12), round-robin.
// Ogni partecipante ha il suo LLM.
//
// Dipende SOLO dal gateway (https://api.danielevillanova.com):
//   POST /api/agent-arena/start    -> { run_id }        (Google auth)
//   GET  /api/agent-arena/{run_id} -> { status, turns } (aperto)
//   POST /api/agent-arena/{run_id}/stop                 (Google auth)
//
// AUTH: login Google (Google Identity Services) direttamente in pagina.
// Il GOOGLE_CLIENT_ID deve essere LO STESSO del gateway
// (env GOOGLE_CLIENT_ID) e l'origin del sito deve essere tra le
// "Authorized JavaScript origins" del client OAuth.
// ============================================================

import { useState, useEffect, useRef } from "react";
import bgImage from "../assets/DataInFlames.jpg";

const API = "https://api.danielevillanova.com";

// <-- INSERISCI il tuo Google OAuth Client ID (stesso del gateway)
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const TOKEN_STORAGE_KEY = "arena_google_id_token";

// Deve combaciare con MAX_TOTAL_MESSAGES del gateway.
const MAX_TOTAL_MESSAGES = 120;

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
    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    return isTokenValid(stored) ? stored : null;
  } catch {
    return null;
  }
}

function useGoogleAuth() {
  const [idToken, setIdToken] = useState(readStoredToken);
  const [authError, setAuthError] = useState("");
  const buttonRef = useRef(null);

  const email = idToken ? parseJwt(idToken)?.email || "" : "";

  const logout = () => {
    try {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      if (window.google?.accounts?.id) {
        window.google.accounts.id.disableAutoSelect();
      }
    } catch {
      /* ignore */
    }
    setIdToken(null);
  };

  // Scadenza automatica del token
  useEffect(() => {
    if (!idToken) return;
    const payload = parseJwt(idToken);
    if (!payload?.exp) return;
    const ms = payload.exp * 1000 - Date.now();
    if (ms <= 0) {
      logout();
      return;
    }
    const timer = setTimeout(logout, ms);
    return () => clearTimeout(timer);
  }, [idToken]);

  // Caricamento resiliente SDK Google (stesso approccio della Console)
  useEffect(() => {
    if (idToken) return;

    let cancelled = false;

    function tryInit() {
      if (cancelled) return;

      if (!window.google?.accounts?.id) {
        setTimeout(tryInit, 150);
        return;
      }

      if (!GOOGLE_CLIENT_ID) {
        setAuthError("GOOGLE_CLIENT_ID mancante (VITE_GOOGLE_CLIENT_ID).");
        return;
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          const credential = response?.credential;
          if (!isTokenValid(credential)) return;
          try {
            sessionStorage.setItem(TOKEN_STORAGE_KEY, credential);
          } catch {
            /* ignore */
          }
          setIdToken(credential);
        },
      });

      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "filled_black",
          size: "large",
          text: "signin_with",
          shape: "pill",
        });
      }
    }

    tryInit();

    return () => {
      cancelled = true;
    };
  }, [idToken]);

  return { idToken, email, buttonRef, logout, authError };
}


// ============================================================
// DATI AGENTI
// ============================================================

const AGENTS = [
  { id: "night_story", label: "Night Story", port: 8666, hasCharacters: true },
  { id: "story_whisper", label: "Story Whisper", port: 8088, hasCharacters: false },
  { id: "leles", label: "Leles", port: 8082, hasCharacters: false },
  { id: "qe", label: "QE (Emergence)", port: 8082, hasCharacters: false, hasRoles: true },
];

// Night Story: prompts/genre_*.txt
const NS_CHARACTERS = [
  "horror",
  "drammatica",
  "comico",
  "ose",
  "ricerca",
  "random",
  "amore",
  "culturale",
];

// QE: ruoli Emergence (leles/core/db_init_exp.py)
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

const LLM_MODELS = ["gemma4", "llama3", "mistral", "qwen2.5", "deepseek-r1"];

const CHARACTER_EMOJI = {
  horror: "💀",
  drammatica: "🎭",
  comico: "😂",
  ose: "🔥",
  ricerca: "🔍",
  random: "🎲",
  amore: "❤️",
  culturale: "📚",
};

const ROLE_EMOJI = {
  Planner: "🧭",
  Scientist: "🔬",
  Builder: "🔨",
  Critic: "🧐",
  Observer: "👁️",
  Architect: "📐",
  Developer: "👨‍💻",
  Tester: "🧪",
  Reviewer: "📝",
  Sheriff: "⭐",
  Outlaw: "🤠",
  Explorer: "🧭",
};

const AGENT_EMOJI = {
  night_story: "🌙",
  story_whisper: "🌬️",
  leles: "🏴‍☠️",
  qe: "🌱",
};

const MAX_PARTICIPANTS = 12;
const MIN_PARTICIPANTS = 2;

const DEFAULT_PARTICIPANT = {
  agent: "night_story",
  character: "horror",
  role: "",
  model: "gemma4",
};

const DEFAULT_CFG = {
  participants: [
    { ...DEFAULT_PARTICIPANT },
    { agent: "qe", character: "", role: "Critic", model: "qwen2.5" },
  ],
  world_source: "free",
  world_ref: "",
  topic: "",
  max_turns: 10,
};

// ============================================================
// MAIN
// ============================================================

export default function ProjectTest() {
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [runId, setRunId] = useState(null);
  const [data, setData] = useState({ status: "IDLE", turns: [] });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [notice, setNotice] = useState("");
  const convRef = useRef(null);

  const { idToken, email, buttonRef, logout } = useGoogleAuth();

  const setField = (key, value) =>
    setCfg((current) => ({ ...current, [key]: value }));

  const setParticipant = (idx, key, value) => {
    setCfg((current) => {
      const next = [...current.participants];
      next[idx] = { ...next[idx], [key]: value };
      return { ...current, participants: next };
    });
  };

  const addParticipant = () => {
    setCfg((current) =>
      current.participants.length >= MAX_PARTICIPANTS
        ? current
        : {
            ...current,
            participants: [
              ...current.participants,
              { ...DEFAULT_PARTICIPANT, agent: "leles", character: "", model: "gemma4" },
            ],
          }
    );
  };

  const removeParticipant = (idx) => {
    setCfg((current) =>
      current.participants.length <= MIN_PARTICIPANTS
        ? current
        : {
            ...current,
            participants: current.participants.filter((_, i) => i !== idx),
          }
    );
  };

  const totalMessages = cfg.max_turns * cfg.participants.length;
  const overLimit = totalMessages > MAX_TOTAL_MESSAGES;

  // Messaggio d'errore leggibile da una risposta del gateway.
  const readError = (result, fallback) => {
    const detail = result?.detail;
    if (typeof detail === "string") return detail;
    if (detail) return JSON.stringify(detail);
    return fallback;
  };

  // ---- START ----
  const start = async () => {
    setStartError("");

    if (!idToken) {
      setStartError("Accedi con Google per avviare un esperimento.");
      return;
    }

    if (overLimit) {
      setStartError(
        `Troppi messaggi (${totalMessages}, massimo ${MAX_TOTAL_MESSAGES}). ` +
          "Riduci i giri o i partecipanti."
      );
      return;
    }

    setStarting(true);
    try {
      // DOPO (mappatura retrocompatibile per agent_a e agent_b):
      const p1 = cfg.participants[0] || {};
      const p2 = cfg.participants[1] || {};

      const payload = {
        agent_a: p1.agent,
        agent_b: p2.agent,
        character_a: p1.character || undefined,
        character_b: p2.character || undefined,
        role_a: p1.role || undefined,
        role_b: p2.role || undefined,
        model_a: p1.model,
        model_b: p2.model,
        world_source: cfg.world_source,
        world_ref: cfg.world_ref,
        topic: cfg.topic,
        max_turns: cfg.max_turns,
      };

      // Inizio della funzione start con Auth Google + Payload Multi-Agente
      const response = await fetch(`${API}/api/agent-arena/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(cfg),
      });


      const result = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 403) {
        logout();
        throw new Error(
          response.status === 403
            ? "Account Google non autorizzato."
            : "Sessione scaduta: accedi di nuovo con Google."
        );
      }

      if (!response.ok) throw new Error(readError(result, "Gateway error"));

      if (result.run_id) {
        setRunId(result.run_id);
        setNotice("");
        setData({ status: "RUNNING", turns: [] });
      }
    } catch (error) {
      console.error("Agent Arena start error:", error);
      setStartError(error?.message || "Unable to start experiment");
    } finally {
      setStarting(false);
    }
  };

  // ---- STOP ----
  const stop = async () => {
    if (!runId) return;
    setNotice("");

    if (!idToken) {
      setNotice("Sessione scaduta: accedi di nuovo per fermare il run.");
      return;
    }

    try {
      const response = await fetch(`${API}/api/agent-arena/${runId}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (response.status === 401 || response.status === 403) {
        logout();
        setNotice("Sessione scaduta: accedi di nuovo per fermare il run.");
      }
    } catch (error) {
      console.error("Agent Arena stop error:", error);
      setNotice("Impossibile contattare il gateway per lo stop.");
    }
  };

  // ---- POLLING LIVE ----
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const response = await fetch(`${API}/api/agent-arena/${runId}`);
        const result = await response.json();
        if (!stopped) setData(result);
        if (["COMPLETED", "STOPPED", "ERROR"].includes(result.status)) {
          clearInterval(timer);
          stopped = true;
        }
      } catch (error) {
        console.warn("Agent Arena polling:", error);
      }
    };
    const timer = setInterval(tick, 2000);
    tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runId]);

  // ---- AUTOSCROLL ----
  useEffect(() => {
    if (convRef.current) convRef.current.scrollTop = convRef.current.scrollHeight;
  }, [data.turns.length]);

  // ---- RESET ----
  const reset = () => {
    setRunId(null);
    setStartError("");
    setNotice("");
    setData({ status: "IDLE", turns: [] });
  };

  const running = data.status === "RUNNING";

  // ---- HELPERS ----
  const getTurnIdentity = (turn) => {
    const emoji = turn.character
      ? CHARACTER_EMOJI[turn.character] || "🤖"
      : turn.role
        ? ROLE_EMOJI[turn.role] || "🌱"
        : AGENT_EMOJI[turn.agent] || "🤖";
    const identity =
      turn.character ||
      turn.role ||
      AGENTS.find((agent) => agent.id === turn.agent)?.label ||
      turn.agent ||
      "Agent";
    return { emoji, identity };
  };

  const getAgentLabel = (agentId) =>
    AGENTS.find((agent) => agent.id === agentId)?.label || agentId;

  // ---- RENDER ----
  return (
    <div style={styles.page}>
      <div
        style={{
          ...styles.background,
          backgroundImage: `url(${bgImage})`,
        }}
      />
      <div style={styles.overlay} />
      <div style={styles.content}>
        {!runId ? (
          <>
            {/* HEADER */}
            <div style={styles.header}>
              <div style={styles.eyebrow}>AGENT ARENA</div>
              <h1 style={styles.title}>Bot to Bot</h1>
              <p style={styles.subtitle}>
                Configure 2 to 12 autonomous agents and let them interact
                inside the same world.
              </p>
            </div>

            {/* AGENTS */}
            <div style={styles.participantsStack}>
              {cfg.participants.map((participant, idx) => (
                <AgentPane
                  key={idx}
                  idx={idx}
                  participant={participant}
                  setParticipant={setParticipant}
                  onRemove={() => removeParticipant(idx)}
                  canRemove={cfg.participants.length > MIN_PARTICIPANTS}
                />
              ))}

              {cfg.participants.length < MAX_PARTICIPANTS && (
                <button onClick={addParticipant} style={styles.addButton}>
                  + ADD PARTICIPANT ({cfg.participants.length}/{MAX_PARTICIPANTS})
                </button>
              )}
            </div>

            {/* WORLD */}
            <section style={styles.card}>
              <div style={styles.sectionHeader}>
                <span style={styles.sectionIcon}>🌍</span>
                <div>
                  <div style={styles.sectionTitle}>WORLD</div>
                  <div style={styles.sectionSubtitle}>
                    Define the environment for the experiment
                  </div>
                </div>
              </div>
              <div style={styles.radioRow}>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    checked={cfg.world_source === "free"}
                    onChange={() => setField("world_source", "free")}
                  />
                  <span>Free topic</span>
                </label>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    checked={cfg.world_source === "emergence"}
                    onChange={() => setField("world_source", "emergence")}
                  />
                  <span>Emergence World</span>
                </label>
              </div>
              {cfg.world_source === "free" ? (
                <textarea
                  style={styles.textarea}
                  placeholder="Two characters meet on a ghost ship during a storm..."
                  value={cfg.topic}
                  maxLength={4000}
                  onChange={(event) => setField("topic", event.target.value)}
                />
              ) : (
                <input
                  style={styles.input}
                  type="number"
                  placeholder="World # (Emergence run id)"
                  value={cfg.world_ref}
                  onChange={(event) => setField("world_ref", event.target.value)}
                />
              )}
            </section>

            {/* RUN OPTIONS */}
            <section style={styles.runCard}>
              <div>
                <div style={styles.optionLabel}>MAX TURNS (ROUNDS)</div>
                <select
                  style={styles.smallSelect}
                  value={cfg.max_turns}
                  onChange={(event) =>
                    setField("max_turns", Number(event.target.value))
                  }
                >
                  {[5, 10, 20, 50].map((number) => (
                    <option key={number} value={number}>
                      {number}
                    </option>
                  ))}
                </select>
                <div
                  style={{
                    ...styles.turnsHint,
                    ...(overLimit ? styles.turnsHintError : {}),
                  }}
                >
                  {totalMessages} total messages
                  {overLimit ? ` (max ${MAX_TOTAL_MESSAGES})` : ""}
                </div>
              </div>

              {idToken ? (
                <div style={styles.startColumn}>
                  <button
                    onClick={start}
                    disabled={starting || overLimit}
                    style={{
                      ...styles.startButton,
                      opacity: starting || overLimit ? 0.55 : 1,
                      cursor: starting
                        ? "wait"
                        : overLimit
                          ? "not-allowed"
                          : "pointer",
                    }}
                  >
                    {starting ? "STARTING..." : "▶️ START EXPERIMENT"}
                  </button>
                  <div style={styles.userRow}>
                    <span>{email}</span>
                    <button onClick={logout} style={styles.linkButton}>
                      sign out
                    </button>
                  </div>
                </div>
              ) : (
                <div style={styles.startColumn}>
                  {GOOGLE_CLIENT_ID ? (
                    <div ref={buttonRef} />
                  ) : (
                    <div style={styles.errorText}>
                      GOOGLE_CLIENT_ID non configurato
                    </div>
                  )}
                </div>
              )}
            </section>

            {startError && (
              <div style={styles.errorBox}>{startError}</div>
            )}
          </>
        ) : (
          <>
            <div style={styles.liveHeader}>
              <div>
                <div style={styles.eyebrow}>LIVE RUN</div>
                <h2 style={styles.liveTitle}>
                  {running ? "Experiment in progress" : data.status}
                </h2>
                <div style={styles.runMeta}>run_id: {runId}</div>
              </div>
              <div style={styles.liveActions}>
                {running && (
                  <button onClick={stop} style={styles.stopButton}>
                    ⏹ STOP
                  </button>
                )}
                <button onClick={reset} style={styles.secondaryButton}>
                  New experiment
                </button>
              </div>
            </div>

            {notice && <div style={styles.notice}>{notice}</div>}

            <div ref={convRef} style={styles.conversation}>
              {(data.turns || []).map((turn, i) => {
                const { emoji, identity } = getTurnIdentity(turn);
                return (
                  <div key={i} style={styles.turn}>
                    <div style={styles.turnHeader}>
                      <span style={styles.turnEmoji}>{emoji}</span>
                      <strong>{identity}</strong>
                      <span style={styles.turnModel}>{turn.model}</span>
                    </div>
                    <div style={styles.turnBody}>{turn.content}</div>
                  </div>
                );
              })}
              {running && (data.turns || []).length === 0 && (
                <div style={styles.waiting}>Waiting for first turn…</div>
              )}
            </div>

            {!running && data.status !== "IDLE" && (
              <div style={styles.stoppedBox}>
                Run ended with status: {data.status}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AgentPane({ idx, participant, setParticipant, onRemove, canRemove }) {
  const agent = AGENTS.find((a) => a.id === participant.agent) || AGENTS[0];
  return (
    <section style={styles.card}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionIcon}>{AGENT_EMOJI[participant.agent] || "🤖"}</span>
        <div style={{ flex: 1 }}>
          <div style={styles.sectionTitle}>PARTICIPANT {idx + 1}</div>
        </div>
        {canRemove && (
          <button onClick={onRemove} style={styles.removeBtn}>
            ✕
          </button>
        )}
      </div>
      <Field label="Agent">
        <select
          style={styles.input}
          value={participant.agent}
          onChange={(e) => {
            const next = e.target.value;
            setParticipant(idx, "agent", next);
            const a = AGENTS.find((x) => x.id === next);
            if (a?.hasCharacters) setParticipant(idx, "character", "horror");
            else setParticipant(idx, "character", "");
            if (a?.hasRoles) setParticipant(idx, "role", "Critic");
            else setParticipant(idx, "role", "");
          }}
        >
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      {agent.hasCharacters && (
        <Field label="Character / Genre">
          <select
            style={styles.input}
            value={participant.character}
            onChange={(e) => setParticipant(idx, "character", e.target.value)}
          >
            {NS_CHARACTERS.map((c) => (
              <option key={c} value={c}>
                {CHARACTER_EMOJI[c]} {c}
              </option>
            ))}
          </select>
        </Field>
      )}
      {agent.hasRoles && (
        <Field label="Role">
          <select
            style={styles.input}
            value={participant.role}
            onChange={(e) => setParticipant(idx, "role", e.target.value)}
          >
            {QE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_EMOJI[r]} {r}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="LLM Model">
        <select
          style={styles.input}
          value={participant.model}
          onChange={(e) => setParticipant(idx, "model", e.target.value)}
        >
          {LLM_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function SummaryCard({ label, value, detail }) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value}</div>
      {detail && <div style={styles.summaryDetail}>{detail}</div>}
    </div>
  );
}

const styles = {
  page: {
    position: "relative",
    minHeight: "100vh",
    color: "#e8f1f5",
    paddingTop: "5rem",
    paddingBottom: "3rem",
  },
  background: {
    position: "fixed",
    inset: 0,
    backgroundSize: "cover",
    backgroundPosition: "center",
    opacity: 0.35,
    zIndex: 0,
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background:
      "linear-gradient(180deg, rgba(8,12,18,0.75) 0%, rgba(8,12,18,0.92) 100%)",
    zIndex: 0,
  },
  content: {
    position: "relative",
    zIndex: 1,
    maxWidth: 900,
    margin: "0 auto",
    padding: "0 1rem",
  },
  header: { marginBottom: "1.5rem" },
  eyebrow: {
    fontSize: 11,
    letterSpacing: "0.12em",
    color: "#3fd0c9",
    fontWeight: 600,
  },
  title: { margin: "0.25rem 0", fontSize: "2rem" },
  subtitle: { color: "#8fa1ac", margin: 0 },
  participantsStack: {
    display: "flex",
    flexDirection: "column",
    gap: "0.85rem",
    marginBottom: "1rem",
  },
  card: {
    background: "rgba(18,26,34,0.88)",
    border: "1px solid #1f2b35",
    borderRadius: 12,
    padding: "1rem",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.65rem",
    marginBottom: "0.75rem",
  },
  sectionIcon: { fontSize: 22 },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: "0.08em",
    color: "#8fa1ac",
    fontWeight: 600,
  },
  sectionSubtitle: { fontSize: 12, color: "#6b7c88" },
  radioRow: { display: "flex", gap: "1rem", marginBottom: "0.65rem" },
  radioLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "#c5d4de",
    fontSize: 14,
  },
  textarea: {
    width: "100%",
    minHeight: 90,
    background: "#0b1015",
    border: "1px solid #2a3a48",
    borderRadius: 8,
    color: "#e8f1f5",
    padding: "0.6rem",
    fontSize: 14,
    resize: "vertical",
  },
  input: {
    width: "100%",
    background: "#0b1015",
    border: "1px solid #2a3a48",
    borderRadius: 8,
    color: "#e8f1f5",
    padding: "0.5rem 0.65rem",
    fontSize: 14,
  },
  runCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    background: "rgba(18,26,34,0.88)",
    border: "1px solid #1f2b35",
    borderRadius: 12,
    padding: "1rem",
    marginBottom: "1rem",
    flexWrap: "wrap",
  },
  optionLabel: {
    fontSize: 11,
    letterSpacing: "0.08em",
    color: "#8fa1ac",
    marginBottom: 4,
  },
  smallSelect: {
    background: "#0b1015",
    border: "1px solid #2a3a48",
    borderRadius: 8,
    color: "#e8f1f5",
    padding: "0.4rem 0.55rem",
  },
  turnsHint: { fontSize: 12, color: "#6b7c88", marginTop: 4 },
  turnsHintError: { color: "#ff8f8f" },
  startColumn: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 },
  startButton: {
    background: "linear-gradient(135deg, #1a9e96, #0d6b66)",
    border: "none",
    color: "#e8f1f5",
    borderRadius: 999,
    padding: "0.7rem 1.4rem",
    fontWeight: 600,
    fontSize: 14,
  },
  userRow: { display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "#a8b8c4" },
  linkButton: {
    background: "none",
    border: "none",
    color: "#3fd0c9",
    cursor: "pointer",
    fontSize: 12,
    textDecoration: "underline",
  },
  errorBox: {
    background: "rgba(80,20,20,0.55)",
    border: "1px solid #7a3030",
    borderRadius: 10,
    padding: "0.75rem 1rem",
    color: "#ffb0b0",
    marginBottom: "1rem",
  },
  errorText: { color: "#ff8f8f", fontSize: 13 },
  addButton: {
    background: "transparent",
    border: "1px dashed #3a4a58",
    color: "#a8b8c4",
    borderRadius: 10,
    padding: "0.75rem",
    cursor: "pointer",
    fontSize: 13,
  },
  removeBtn: {
    background: "transparent",
    border: "none",
    color: "#8fa1ac",
    cursor: "pointer",
    fontSize: 16,
  },
  field: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 },
  fieldLabel: { fontSize: 11, color: "#8fa1ac", letterSpacing: "0.06em" },
  liveHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "1rem",
    gap: "1rem",
    flexWrap: "wrap",
  },
  liveTitle: { margin: "0.2rem 0", fontSize: "1.4rem" },
  runMeta: { fontSize: 12, color: "#6b7c88" },
  liveActions: { display: "flex", gap: 8 },
  stopButton: {
    background: "#7a3030",
    border: "none",
    color: "#ffd0d0",
    borderRadius: 999,
    padding: "0.5rem 1rem",
    cursor: "pointer",
  },
  secondaryButton: {
    background: "transparent",
    border: "1px solid #3a4a58",
    color: "#c5d4de",
    borderRadius: 999,
    padding: "0.5rem 1rem",
    cursor: "pointer",
  },
  notice: {
    background: "rgba(40,60,40,0.5)",
    border: "1px solid #3a5a3a",
    borderRadius: 8,
    padding: "0.6rem 0.9rem",
    marginBottom: "0.75rem",
    color: "#b0d0b0",
    fontSize: 13,
  },
  conversation: {
    maxHeight: 480,
    overflowY: "auto",
    background: "rgba(12,18,24,0.9)",
    border: "1px solid #1f2b35",
    borderRadius: 12,
    padding: "0.75rem",
    marginBottom: "1rem",
  },
  turn: {
    marginBottom: "0.85rem",
    paddingBottom: "0.85rem",
    borderBottom: "1px solid #1f2b35",
  },
  turnHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    fontSize: 13,
  },
  turnEmoji: { fontSize: 16 },
  turnModel: { marginLeft: "auto", color: "#6b7c88", fontSize: 11 },
  turnBody: {
    color: "#c5d4de",
    fontSize: 14,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  waiting: { color: "#6b7c88", textAlign: "center", padding: 20 },
  stoppedBox: {
    padding: 14,
    borderRadius: 12,
    border: "1px solid #3a4a55",
    background: "rgba(16,24,30,.9)",
    color: "#9bacb5",
    fontSize: 13,
    textAlign: "center",
  },
};
