// ============================================================
// PROJECT TEST — Agent Arena / Bot to Bot
// Layout ispirato a Emergence Lab.
//
// Agenti selezionabili:
//   - Night Story (8 generi da prompts/genre_*.txt)
//   - Story Whisper (nessun genere)
//   - Leles (orchestratore)
//   - Super-Leles
//   - QE / Emergence (12 ruoli dal DB)
//
// Modalità N partecipanti (2..12), round-robin.
// Ogni partecipante ha il suo LLM.
//
// Dipende SOLO dal gateway (https://api.danielevillanova.com):
//   POST /api/agent-arena/start    -> { run_id }        (Google auth)
//   GET  /api/agent-arena/{run_id} -> { status, turns } (aperto)
//   POST /api/agent-arena/{run_id}/stop                 (Google auth)
//   POST /api/agent-arena/{run_id}/hand                 (Google auth)
//   POST /api/agent-arena/{run_id}/intervene            (Google auth)
//
// RAISE HAND: durante un run l'umano alza la mano; il turno in corso
// finisce, il run va in PAUSED e si può scrivere un messaggio che il
// prossimo bot legge insieme all'ultima risposta. Il GET restituisce
// anche hand_raised. I turni umani arrivano con agent === "human".
//
// AUTH: login Google (Google Identity Services) direttamente in pagina.
// Il GOOGLE_CLIENT_ID deve essere LO STESSO del gateway
// (env GOOGLE_CLIENT_ID) e l'origin del sito deve essere tra le
// "Authorized JavaScript origins" del client OAuth.
// ============================================================

import { useState, useEffect, useRef } from "react";
import bgImage from "../assets/B2B.jpeg";

const API = "https://api.danielevillanova.com";

// <-- INSERISCI il tuo Google OAuth Client ID (stesso del gateway)
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const TOKEN_STORAGE_KEY = "arena_google_id_token";

// Deve combaciare con MAX_TOTAL_MESSAGES del gateway.
const MAX_TOTAL_MESSAGES = 120;

// Deve combaciare con MAX_HUMAN_CHARS del gateway.
const MAX_HUMAN_CHARS = 2000;

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
  { id: "super_leles", label: "Super-Leles", port: 8082, hasCharacters: false },
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

const LLM_MODELS = ["gemma4", "llama3", "mistral", "qwen2.5", "deepseek-r1", "qwen2.5-coder:7b", "gpt-oss:20b"];

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
  super_leles: "🧠",
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
    { agent: "qe", character: "", role: "Planner", model: "mistral" },
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

  // Raise hand
  const [humanText, setHumanText] = useState("");
  const [handBusy, setHandBusy] = useState(false);
  const [handError, setHandError] = useState("");

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
              { ...DEFAULT_PARTICIPANT, agent: "leles", character: "", model: "llama3" },
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

      // Super-Leles viene inviato direttamente come "super_leles".
      // Il gateway lo riconosce come agente separato e gestisce
      // internamente il prefisso "sl " per attivare Super-Leles.
      //
      // NON trasformiamo più:
      //   super_leles -> leles
      //
      // Questo è necessario perché Super-Leles ha una allowlist LLM
      // diversa e può usare anche gpt-oss:20b.
      const arenaCfg = {
        ...cfg,
        participants: cfg.participants.map((participant) => ({
          ...participant,
        })),
      };

      // Inizio della funzione start con Auth Google + Payload Multi-Agente
      const response = await fetch(`${API}/api/agent-arena/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(arenaCfg),
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
        setHumanText("");
        setHandError("");
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

  // ---- RAISE HAND ----
  // Il turno in corso finisce, poi il gateway mette il run in PAUSED.
  const raiseHand = async () => {
    if (!runId || handBusy) return;
    setNotice("");
    setHandError("");

    if (!idToken) {
      setNotice("Sessione scaduta: accedi di nuovo per intervenire.");
      return;
    }

    setHandBusy(true);
    try {
      const response = await fetch(`${API}/api/agent-arena/${runId}/hand`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });

      const result = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 403) {
        logout();
        setNotice("Sessione scaduta: accedi di nuovo per intervenire.");
        return;
      }

      if (!response.ok) throw new Error(readError(result, "Gateway error"));

      setData((current) => ({ ...current, hand_raised: true }));
    } catch (error) {
      console.error("Agent Arena hand error:", error);
      setHandError(error?.message || "Impossibile alzare la mano.");
    } finally {
      setHandBusy(false);
    }
  };

  // ---- INTERVENE ----
  // withText = true  -> invia il messaggio e riprende
  // withText = false -> riprende senza scrivere
  const sendIntervention = async (withText) => {
    if (!runId || handBusy) return;
    setNotice("");
    setHandError("");

    if (!idToken) {
      setNotice("Sessione scaduta: accedi di nuovo per intervenire.");
      return;
    }

    const text = withText ? humanText.trim() : "";

    setHandBusy(true);
    try {
      const response = await fetch(
        `${API}/api/agent-arena/${runId}/intervene`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ text }),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 403) {
        logout();
        setNotice("Sessione scaduta: accedi di nuovo per intervenire.");
        return;
      }

      if (!response.ok) throw new Error(readError(result, "Gateway error"));

      setHumanText("");
      setData((current) => ({
        ...current,
        status: "RUNNING",
        hand_raised: false,
      }));
    } catch (error) {
      console.error("Agent Arena intervene error:", error);
      setHandError(error?.message || "Impossibile inviare l'intervento.");
    } finally {
      setHandBusy(false);
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
    setHumanText("");
    setHandError("");
    setData({ status: "IDLE", turns: [] });
  };

  const running = data.status === "RUNNING";
  const paused = data.status === "PAUSED";
  const active = running || paused;

  // I turni umani non contano nel limite di messaggi dei bot.
  const botTurns = data.turns.filter((turn) => turn.agent !== "human").length;
  const humanTurns = data.turns.length - botTurns;

  // ---- HELPERS ----
  const getTurnIdentity = (turn) => {
    if (turn.agent === "human") {
      return { emoji: "🙋", identity: "You" };
    }
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
                    <>
                      <div ref={buttonRef} />
                      <div style={styles.authHint}>
                        Sign in with Google to start an experiment
                      </div>
                    </>
                  ) : (
                    <div style={styles.authHint}>
                      GOOGLE_CLIENT_ID mancante in ProjectTest.jsx
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* START ERROR (visibile anche prima che esista un run) */}
            {startError && (
              <div style={{ ...styles.errorBox, marginTop: 14 }}>
                <strong>⚠ ERROR</strong>
                <div>{startError}</div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* LIVE HEADER */}
            <div style={styles.liveHeader}>
              <div>
                <div style={styles.eyebrow}>AGENT ARENA</div>
                <h1 style={styles.liveTitle}>Run #{runId}</h1>
                <div style={styles.statusRow}>
                  <span
                    style={{
                      ...styles.statusDot,
                      ...(running
                        ? styles.statusRunning
                        : styles.statusFinished),
                    }}
                  />
                  <span>{data.status}</span>
                  <span style={styles.statusSeparator}>·</span>
                  <span>
                    {botTurns} / {totalMessages} messages
                  </span>
                  {humanTurns > 0 && (
                    <>
                      <span style={styles.statusSeparator}>·</span>
                      <span>{humanTurns} from you</span>
                    </>
                  )}
                </div>
                {notice && <div style={styles.noticeText}>{notice}</div>}
                {handError && !paused && (
                  <div style={styles.noticeText}>{handError}</div>
                )}
              </div>
              <div style={styles.liveActions}>
                {running && (
                  <button
                    onClick={raiseHand}
                    disabled={handBusy || data.hand_raised}
                    style={{
                      ...styles.handButton,
                      opacity: handBusy || data.hand_raised ? 0.6 : 1,
                      cursor:
                        handBusy || data.hand_raised
                          ? "not-allowed"
                          : "pointer",
                    }}
                  >
                    {data.hand_raised ? "✋ HAND RAISED" : "✋ RAISE HAND"}
                  </button>
                )}
                {active && (
                  <button onClick={stop} style={styles.stopButton}>
                    ⏹ STOP
                  </button>
                )}
                <button onClick={reset} style={styles.resetButton}>
                  ↺ NEW EXPERIMENT
                </button>
              </div>
            </div>

            {/* RUN CONFIG SUMMARY */}
            <section style={styles.summaryGrid}>
              {cfg.participants.map((participant, idx) => (
                <SummaryCard
                  key={idx}
                  label={`PARTICIPANT ${idx + 1}`}
                  value={getAgentLabel(participant.agent)}
                  detail={
                    (participant.agent === "night_story" &&
                      participant.character) ||
                    (participant.agent === "qe" && participant.role) ||
                    participant.model
                  }
                />
              ))}
              <SummaryCard
                label="WORLD"
                value={
                  cfg.world_source === "emergence"
                    ? `Emergence #${cfg.world_ref}`
                    : "Free topic"
                }
                detail={
                  cfg.world_source === "free"
                    ? cfg.topic || "No topic"
                    : "Emergence experiment"
                }
              />
              <SummaryCard
                label="ROUNDS"
                value={`${cfg.max_turns} × ${cfg.participants.length}`}
                detail={`${totalMessages} messages max`}
              />
            </section>

            {/* WORLD LIVE */}
            <section style={styles.worldLiveCard}>
              <div style={styles.worldLiveTitle}>🌍 WORLD</div>
              <div style={styles.worldLiveText}>
                {cfg.world_source === "emergence"
                  ? `Emergence World #${cfg.world_ref}`
                  : cfg.topic || "Free topic"}
              </div>
            </section>

            {/* CONVERSATION */}
            <section style={styles.conversationCard}>
              <div style={styles.conversationHeader}>
                <div>
                  <div style={styles.sectionTitle}>LIVE CONVERSATION</div>
                  <div style={styles.sectionSubtitle}>
                    Autonomous agent interaction
                  </div>
                </div>
                {running && <div style={styles.liveBadge}>● LIVE</div>}
                {paused && <div style={styles.liveBadge}>✋ PAUSED</div>}
              </div>
              <div ref={convRef} style={styles.conversation}>
                {data.turns.map((turn, index) => {
                  const { emoji, identity } = getTurnIdentity(turn);
                  const isHuman = turn.agent === "human";
                  const isEven = (turn.idx ?? index) % 2 === 0;
                  return (
                    <div
                      key={turn.id || index}
                      style={{
                        ...styles.messageRow,
                        justifyContent: isHuman
                          ? "center"
                          : isEven
                            ? "flex-start"
                            : "flex-end",
                      }}
                    >
                      <div
                        style={{
                          ...styles.message,
                          ...(isHuman
                            ? styles.messageHuman
                            : isEven
                              ? styles.messageA
                              : styles.messageB),
                        }}
                      >
                        <div style={styles.messageMeta}>
                          <span style={styles.messageIdentity}>
                            {isHuman
                              ? `${emoji} ${identity}`
                              : `${emoji} ${identity} · P${(turn.idx ?? 0) + 1}`}
                          </span>
                          <span style={styles.messageModel}>
                            {isHuman ? "human" : turn.model}
                          </span>
                        </div>
                        <div style={styles.messageText}>{turn.text}</div>
                      </div>
                    </div>
                  );
                })}
                {running && !data.hand_raised && (
                  <div style={styles.thinking}>
                    <span>●</span>
                    <span>●</span>
                    <span>●</span>
                    <em>agents are thinking...</em>
                  </div>
                )}
                {running && data.hand_raised && (
                  <div style={styles.thinking}>
                    <span>✋</span>
                    <em>
                      hand raised — the run pauses when the current turn ends...
                    </em>
                  </div>
                )}
                {data.status === "ERROR" && (
                  <div style={styles.errorBox}>
                    <strong>⚠ ERROR</strong>
                    <div>
                      {data.error ||
                        "Gateway error — check gateway logs."}
                    </div>
                  </div>
                )}
                {!running && data.status === "COMPLETED" && (
                  <div style={styles.completedBox}>✓ Experiment completed</div>
                )}
                {!running && data.status === "STOPPED" && (
                  <div style={styles.stoppedBox}>⏹ Experiment stopped</div>
                )}
              </div>

              {/* HUMAN INTERVENTION (solo con il run in pausa) */}
              {paused && (
                <div style={styles.humanPanel}>
                  <div style={styles.humanTitle}>
                    ✋ RUN PAUSED — YOUR TURN
                  </div>
                  <div style={styles.humanHint}>
                    The next agent reads your message together with the last
                    answer.
                  </div>
                  <textarea
                    style={{ ...styles.textarea, minHeight: 80 }}
                    placeholder="Write something for the next agent..."
                    value={humanText}
                    maxLength={MAX_HUMAN_CHARS}
                    disabled={handBusy}
                    onChange={(event) => setHumanText(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.ctrlKey || event.metaKey) &&
                        humanText.trim()
                      ) {
                        sendIntervention(true);
                      }
                    }}
                  />
                  {handError && (
                    <div style={{ ...styles.noticeText, marginBottom: 10 }}>
                      {handError}
                    </div>
                  )}
                  <div style={styles.humanActions}>
                    <span style={styles.humanCounter}>
                      {humanText.length} / {MAX_HUMAN_CHARS}
                    </span>
                    <button
                      onClick={() => sendIntervention(false)}
                      disabled={handBusy}
                      style={{
                        ...styles.resetButton,
                        opacity: handBusy ? 0.6 : 1,
                        cursor: handBusy ? "wait" : "pointer",
                      }}
                    >
                      RESUME WITHOUT MESSAGE
                    </button>
                    <button
                      onClick={() => sendIntervention(true)}
                      disabled={handBusy || !humanText.trim()}
                      style={{
                        ...styles.handButton,
                        opacity: handBusy || !humanText.trim() ? 0.55 : 1,
                        cursor: handBusy
                          ? "wait"
                          : !humanText.trim()
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      {handBusy ? "SENDING..." : "SEND & RESUME"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// AGENT PANE — singolo partecipante
// ============================================================

function AgentPane({ idx, participant, setParticipant, onRemove, canRemove }) {
  const agent = AGENTS.find((item) => item.id === participant.agent);
  const agentEmoji = AGENT_EMOJI[agent?.id] || "🤖";

  return (
    <section style={styles.agentCard}>
      <div style={styles.agentHeader}>
        <div>
          <div style={styles.agentSide}>PARTICIPANT {idx + 1}</div>
          <div style={styles.agentName}>
            {agentEmoji} {agent?.label || "Agent"}
          </div>
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            style={styles.removeButton}
            title="Remove participant"
          >
            ✕
          </button>
        )}
      </div>

      {/* Agent */}
      <Field label="AGENT">
        <select
          value={participant.agent}
          onChange={(event) => {
            const id = event.target.value;
            const next = AGENTS.find((item) => item.id === id);
            setParticipant(idx, "agent", id);
            setParticipant(
              idx,
              "character",
              next?.hasCharacters ? NS_CHARACTERS[0] : ""
            );
            setParticipant(
              idx,
              "role",
              next?.hasRoles ? QE_ROLES[0] : ""
            );
          }}
          style={styles.select}
        >
          {AGENTS.map((item) => (
            <option key={item.id} value={item.id}>
              {AGENT_EMOJI[item.id] || "🤖"} {item.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Night Story genre */}
      {agent?.hasCharacters && (
        <Field label="GENRE">
          <select
            value={participant.character}
            onChange={(event) =>
              setParticipant(idx, "character", event.target.value)
            }
            style={styles.select}
          >
            {NS_CHARACTERS.map((character) => (
              <option key={character} value={character}>
                {CHARACTER_EMOJI[character] || "🎭"} {character}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* QE role */}
      {agent?.hasRoles && (
        <Field label="EMERGENCE ROLE">
          <select
            value={participant.role}
            onChange={(event) =>
              setParticipant(idx, "role", event.target.value)
            }
            style={styles.select}
          >
            {QE_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_EMOJI[role] || "🌱"} {role}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* LLM */}
      <Field label="LLM">
        <select
          value={participant.model}
          onChange={(event) =>
            setParticipant(idx, "model", event.target.value)
          }
          style={styles.select}
        >
          {LLM_MODELS.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}

// ============================================================
// FIELD
// ============================================================

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

// ============================================================
// SUMMARY CARD
// ============================================================

function SummaryCard({ label, value, detail }) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value}</div>
      <div style={styles.summaryDetail}>{detail}</div>
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = {
  page: {
    minHeight: "100vh",
    position: "relative",
    color: "#e7edf2",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    overflowX: "hidden",
  },

  background: {
    position: "fixed",
    inset: 0,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
    zIndex: 0,
  },

  overlay: {
    position: "fixed",
    inset: 0,
    background:
      "linear-gradient(180deg, rgba(5,10,14,.20) 0%, rgba(7,13,18,.30) 48%, rgba(4,8,12,.40) 100%)",
    zIndex: 1,
  },

  content: {
    position: "relative",
    zIndex: 2,
    width: "min(960px, calc(100% - 32px))",
    margin: "0 auto",
    padding: "48px 0 72px",
  },

  header: {
    textAlign: "center",
    marginBottom: 34,
  },

  eyebrow: {
    fontSize: 11,
    letterSpacing: "3px",
    fontWeight: 700,
    color: "#7f9aaa",
    marginBottom: 9,
    textTransform: "uppercase",
  },

  title: {
    margin: 0,
    fontSize: "clamp(34px, 6vw, 54px)",
    lineHeight: 1,
    fontWeight: 700,
    letterSpacing: "-1.5px",
    color: "#f1f5f7",
  },

  subtitle: {
    maxWidth: 650,
    margin: "16px auto 0",
    color: "#93a3ad",
    fontSize: 15,
    lineHeight: 1.6,
  },

  // Stack verticale di partecipanti (sostituisce agentsGrid A/B)
  participantsStack: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },

  agentCard: {
    minWidth: 0,
    padding: 22,
    borderRadius: 18,
    background:
      "linear-gradient(145deg, rgba(20,29,37,.92), rgba(11,17,23,.92))",
    border: "1px solid #354955",
    boxShadow: "0 18px 50px rgba(0,0,0,.24)",
  },

  agentHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 22,
  },

  agentSide: {
    fontSize: 10,
    letterSpacing: "2px",
    color: "#748994",
    fontWeight: 700,
    marginBottom: 5,
  },

  agentName: {
    fontSize: 20,
    fontWeight: 650,
    color: "#edf2f4",
  },

  removeButton: {
    border: "1px solid #674a4a",
    background: "transparent",
    color: "#e5bebe",
    borderRadius: 999,
    width: 28,
    height: 28,
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1,
  },

  addButton: {
    border: "1px dashed #3a4d58",
    background: "transparent",
    color: "#9bacb5",
    borderRadius: 12,
    padding: "12px",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: ".7px",
    cursor: "pointer",
  },

  field: {
    display: "block",
    marginTop: 15,
  },

  fieldLabel: {
    display: "block",
    fontSize: 10,
    letterSpacing: "1.5px",
    fontWeight: 700,
    color: "#82949e",
    marginBottom: 7,
  },

  select: {
    width: "100%",
    boxSizing: "border-box",
    appearance: "auto",
    background: "#101920",
    color: "#e4ebef",
    border: "1px solid #2d404b",
    borderRadius: 10,
    padding: "11px 12px",
    fontSize: 14,
    outline: "none",
  },

  card: {
    marginTop: 18,
    padding: 22,
    borderRadius: 18,
    background: "rgba(15,23,30,.9)",
    border: "1px solid #273640",
    boxShadow: "0 18px 50px rgba(0,0,0,.2)",
  },

  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
  },

  sectionIcon: {
    width: 38,
    height: 38,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    background: "#17232b",
    border: "1px solid #2b3d47",
    fontSize: 18,
  },

  sectionTitle: {
    fontSize: 12,
    fontWeight: 750,
    letterSpacing: "1.8px",
    color: "#dce5e9",
  },

  sectionSubtitle: {
    marginTop: 3,
    fontSize: 12,
    color: "#71838d",
  },

  radioRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 18,
    marginBottom: 14,
  },

  radioLabel: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    color: "#aebcc4",
    fontSize: 13,
    cursor: "pointer",
  },

  textarea: {
    width: "100%",
    minHeight: 100,
    boxSizing: "border-box",
    resize: "vertical",
    background: "#0d151b",
    color: "#e5ecef",
    border: "1px solid #2b3d47",
    borderRadius: 11,
    padding: 13,
    fontFamily: "inherit",
    fontSize: 14,
    lineHeight: 1.5,
    outline: "none",
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    background: "#0d151b",
    color: "#e5ecef",
    border: "1px solid #2b3d47",
    borderRadius: 11,
    padding: "12px 13px",
    fontFamily: "inherit",
    fontSize: 14,
    outline: "none",
  },

  runCard: {
    marginTop: 18,
    padding: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
    borderRadius: 18,
    background: "rgba(15,23,30,.9)",
    border: "1px solid #273640",
    flexWrap: "wrap",
  },

  optionLabel: {
    fontSize: 10,
    letterSpacing: "1.5px",
    color: "#82949e",
    fontWeight: 700,
    marginBottom: 7,
  },

  turnsHint: {
    marginTop: 6,
    fontSize: 11,
    color: "#71838d",
  },

  turnsHintError: {
    color: "#e5bebe",
  },

  smallSelect: {
    minWidth: 110,
    background: "#101920",
    color: "#e4ebef",
    border: "1px solid #2d404b",
    borderRadius: 9,
    padding: "10px 12px",
    fontSize: 14,
  },

  startButton: {
    border: "1px solid #4a626e",
    background: "linear-gradient(135deg, #263943, #17262f)",
    color: "#eef4f6",
    borderRadius: 999,
    padding: "13px 24px",
    fontSize: 12,
    fontWeight: 750,
    letterSpacing: ".7px",
    boxShadow: "0 8px 25px rgba(0,0,0,.22)",
  },

  startColumn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
  },

  userRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    color: "#71838d",
  },

  linkButton: {
    border: "none",
    background: "transparent",
    color: "#9bacb5",
    fontSize: 11,
    textDecoration: "underline",
    cursor: "pointer",
    padding: 0,
  },

  authHint: {
    fontSize: 11,
    color: "#71838d",
    textAlign: "right",
  },

  noticeText: {
    marginTop: 8,
    fontSize: 12,
    color: "#e5bebe",
  },

  liveHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    marginBottom: 24,
    paddingBottom: 20,
    borderBottom: "1px solid #25343d",
    flexWrap: "wrap",
  },

  liveTitle: {
    margin: 0,
    fontSize: "clamp(28px, 5vw, 42px)",
    color: "#f1f5f7",
    letterSpacing: "-1px",
  },

  statusRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 9,
    color: "#83959f",
    fontSize: 12,
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    display: "inline-block",
  },

  statusRunning: {
    background: "#8aaebc",
    boxShadow: "0 0 10px rgba(138,174,188,.7)",
  },

  statusFinished: {
    background: "#667780",
  },

  statusSeparator: {
    color: "#465862",
  },

  liveActions: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 8,
  },

  stopButton: {
    border: "1px solid #674a4a",
    background: "#241719",
    color: "#e5bebe",
    borderRadius: 999,
    padding: "10px 15px",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  },

  // Raise hand: stesso formato dei bottoni live, tono ambra.
  handButton: {
    border: "1px solid #6b5a3a",
    background: "#241f14",
    color: "#e5d3a8",
    borderRadius: 999,
    padding: "10px 15px",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  },

  resetButton: {
    border: "1px solid #344853",
    background: "#121c23",
    color: "#b6c4ca",
    borderRadius: 999,
    padding: "10px 15px",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 10,
    marginBottom: 14,
  },

  summaryCard: {
    minWidth: 0,
    padding: 14,
    borderRadius: 13,
    background: "rgba(15,23,30,.82)",
    border: "1px solid #25353f",
  },

  summaryLabel: {
    fontSize: 9,
    letterSpacing: "1.5px",
    color: "#71848e",
    fontWeight: 750,
    marginBottom: 7,
  },

  summaryValue: {
    fontSize: 13,
    color: "#dce5e9",
    fontWeight: 650,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  summaryDetail: {
    marginTop: 4,
    fontSize: 11,
    color: "#71838d",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  worldLiveCard: {
    padding: 18,
    marginBottom: 14,
    borderRadius: 16,
    background: "rgba(15,23,30,.88)",
    border: "1px solid #293b45",
  },

  worldLiveTitle: {
    fontSize: 10,
    fontWeight: 750,
    letterSpacing: "1.6px",
    color: "#7e929d",
    marginBottom: 8,
  },

  worldLiveText: {
    color: "#c7d2d7",
    fontSize: 14,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
  },

  conversationCard: {
    borderRadius: 18,
    background: "rgba(11,18,24,.9)",
    border: "1px solid #273640",
    overflow: "hidden",
  },

  conversationHeader: {
    padding: "18px 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid #263640",
  },

  liveBadge: {
    border: "1px solid #38505a",
    background: "#142229",
    color: "#9cb4bd",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 9,
    letterSpacing: "1px",
    fontWeight: 800,
  },

  conversation: {
    maxHeight: "58vh",
    overflowY: "auto",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 13,
  },

  messageRow: {
    display: "flex",
    width: "100%",
  },

  message: {
    maxWidth: "82%",
    padding: "13px 15px",
    borderRadius: 14,
    border: "1px solid #293b45",
    boxShadow: "0 8px 25px rgba(0,0,0,.25)",
  },

  messageA: {
    background:
      "linear-gradient(145deg, rgba(20,29,37,.95), rgba(15,23,30,.95))",
    borderBottomLeftRadius: 4,
  },

  messageB: {
    background:
      "linear-gradient(145deg, rgba(24,34,44,.95), rgba(16,25,32,.95))",
    borderBottomRightRadius: 4,
  },

  // Messaggio umano (raise hand): centrato, tono ambra.
  messageHuman: {
    background:
      "linear-gradient(145deg, rgba(38,32,20,.95), rgba(26,22,14,.95))",
    border: "1px solid #6b5a3a",
  },

  messageMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
  },

  messageIdentity: {
    fontSize: 11,
    fontWeight: 700,
    color: "#9db2bd",
    letterSpacing: ".4px",
  },

  messageModel: {
    fontSize: 10,
    color: "#5f7480",
  },

  messageText: {
    color: "#dbe4e9",
    fontSize: 14,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
  },

  thinking: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "#71838d",
    fontSize: 12,
    padding: "4px 2px",
  },

  // Pannello di intervento umano (run in PAUSED).
  humanPanel: {
    padding: 20,
    borderTop: "1px solid #3d3626",
    background: "rgba(28,24,15,.9)",
  },

  humanTitle: {
    fontSize: 11,
    fontWeight: 750,
    letterSpacing: "1.6px",
    color: "#e5d3a8",
    marginBottom: 5,
  },

  humanHint: {
    fontSize: 12,
    color: "#9c8f6c",
    marginBottom: 12,
  },

  humanActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },

  humanCounter: {
    marginRight: "auto",
    fontSize: 11,
    color: "#7d7358",
  },

  errorBox: {
    padding: 14,
    borderRadius: 12,
    border: "1px solid #5c3a3a",
    background: "rgba(35,16,18,.9)",
    color: "#e5bebe",
    fontSize: 13,
    lineHeight: 1.5,
  },

  completedBox: {
    padding: 14,
    borderRadius: 12,
    border: "1px solid #2f4a3a",
    background: "rgba(14,26,20,.9)",
    color: "#a9d3b8",
    fontSize: 13,
    textAlign: "center",
  },

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
