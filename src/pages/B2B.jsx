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
import { useTranslation } from "react-i18next";

const API = "https://api.danielevillanova.com";

// <-- INSERISCI il tuo Google OAuth Client ID (stesso del gateway)
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const TOKEN_STORAGE_KEY = "dv_google_id_token";

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
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    return isTokenValid(stored) ? stored : null;
  } catch {
    return null;
  }
}

function useGoogleAuth() {
  const [idToken, setIdToken] = useState(readStoredToken);
  const { t } = useTranslation();

  // Sync login tra pagine/tab: se un'altra pagina fa login/logout,
  // l'evento "storage" ci arriva subito e aggiorniamo lo stato.
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== TOKEN_STORAGE_KEY) return;
      setIdToken(e.newValue && isTokenValid(e.newValue) ? e.newValue : null);
    }
    function onSync() {
      setIdToken(readStoredToken());
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("dv-token-sync", onSync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("dv-token-sync", onSync);
    };
  }, []);
  const [authError, setAuthError] = useState("");
  const buttonRef = useRef(null);

  const email = idToken ? parseJwt(idToken)?.email || "" : "";

  const logout = () => {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      if (window.google?.accounts?.id) {
        window.google.accounts.id.disableAutoSelect();
      }
    } catch {
      /* ignore */
    }
    setIdToken(null);
    window.dispatchEvent(new Event("dv-token-sync"));
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
        setAuthError(t("b2b.clientIdMissingEnv"));
        return;
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          const credential = response?.credential;
          if (!isTokenValid(credential)) return;
          try {
            localStorage.setItem(TOKEN_STORAGE_KEY, credential);
          } catch {
            /* ignore */
          }
          setIdToken(credential);
          window.dispatchEvent(new Event("dv-token-sync"));
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

function ArenaTab({ setTab }) {
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
  const { t } = useTranslation();

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
      setStartError(t("b2b.loginRequired"));
      return;
    }

    if (overLimit) {
      setStartError(t("b2b.tooMany", { total: totalMessages, max: MAX_TOTAL_MESSAGES }));
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
            ? t("b2b.unauthorized")
            : t("b2b.sessionExpired")
        );
      }

      if (!response.ok) throw new Error(readError(result, t("b2b.gatewayError")));

      if (result.run_id) {
        setRunId(result.run_id);
        setNotice("");
        setHumanText("");
        setHandError("");
        setData({ status: "RUNNING", turns: [] });
      }
    } catch (error) {
      console.error("Agent Arena start error:", error);
      setStartError(error?.message || t("b2b.startFailed"));
    } finally {
      setStarting(false);
    }
  };

  // ---- STOP ----
  const stop = async () => {
    if (!runId) return;
    setNotice("");

    if (!idToken) {
      setNotice(t("b2b.sessionExpiredStop"));
      return;
    }

    try {
      const response = await fetch(`${API}/api/agent-arena/${runId}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (response.status === 401 || response.status === 403) {
        logout();
        setNotice(t("b2b.sessionExpiredStop"));
      }
    } catch (error) {
      console.error("Agent Arena stop error:", error);
      setNotice(t("b2b.stopFailed"));
    }
  };

  // ---- RAISE HAND ----
  // Il turno in corso finisce, poi il gateway mette il run in PAUSED.
  const raiseHand = async () => {
    if (!runId || handBusy) return;
    setNotice("");
    setHandError("");

    if (!idToken) {
      setNotice(t("b2b.sessionExpiredHand"));
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
        setNotice(t("b2b.sessionExpiredHand"));
        return;
      }

      if (!response.ok) throw new Error(readError(result, t("b2b.gatewayError")));

      setData((current) => ({ ...current, hand_raised: true }));
    } catch (error) {
      console.error("Agent Arena hand error:", error);
      setHandError(error?.message || t("b2b.handFailed"));
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
      setNotice(t("b2b.sessionExpiredHand"));
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
        setNotice(t("b2b.sessionExpiredHand"));
        return;
      }

      if (!response.ok) throw new Error(readError(result, t("b2b.gatewayError")));

      setHumanText("");
      setData((current) => ({
        ...current,
        status: "RUNNING",
        hand_raised: false,
      }));
    } catch (error) {
      console.error("Agent Arena intervene error:", error);
      setHandError(error?.message || t("b2b.interveneFailed"));
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
      return { emoji: "🙋", identity: t("b2b.you") };
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
      t("b2b.agent");
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <h1 style={{ ...styles.title, margin: 0 }}>Bot to Bot</h1>
                <button
                  style={imgStyles.tabBtn}
                  onClick={() => setTab && setTab("img")}
                >
                  B2BImg →
                </button>
              </div>
              <p style={styles.subtitle}>
                {t("b2b.subtitle")}
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
                  {t("b2b.addParticipant", { current: cfg.participants.length, max: MAX_PARTICIPANTS })}
                </button>
              )}
            </div>

            {/* WORLD */}
            <section style={styles.card}>
              <div style={styles.sectionHeader}>
                <span style={styles.sectionIcon}>🌍</span>
                <div>
                  <div style={styles.sectionTitle}>{t("b2b.world")}</div>
                  <div style={styles.sectionSubtitle}>
                    {t("b2b.worldIntro")}
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
                  <span>{t("b2b.freeTopic")}</span>
                </label>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    checked={cfg.world_source === "emergence"}
                    onChange={() => setField("world_source", "emergence")}
                  />
                  <span>{t("b2b.emergenceWorld")}</span>
                </label>
              </div>
              {cfg.world_source === "free" ? (
                <textarea
                  style={styles.textarea}
                  placeholder={t("b2b.topicPlaceholder")}
                  value={cfg.topic}
                  maxLength={4000}
                  onChange={(event) => setField("topic", event.target.value)}
                />
              ) : (
                <input
                  style={styles.input}
                  type="number"
                  placeholder={t("b2b.worldRefPlaceholder")}
                  value={cfg.world_ref}
                  onChange={(event) => setField("world_ref", event.target.value)}
                />
              )}
            </section>

            {/* RUN OPTIONS */}
            <section style={styles.runCard}>
              <div>
                <div style={styles.optionLabel}>{t("b2b.maxTurns")}</div>
                <select
                  style={styles.smallSelect}
                  value={cfg.max_turns}
                  onChange={(event) =>
                    setField("max_turns", Number(event.target.value))
                  }
                >
                  {[1, 2, 3, 5, 10, 13, 20].map((number) => (
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
                  {totalMessages} {t("b2b.totalMessages")}
                  {overLimit ? ` (${t("b2b.maxShort")} ${MAX_TOTAL_MESSAGES})` : ""}
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
                    {starting ? t("b2b.starting") : t("b2b.startExperiment")}
                  </button>
                  <div style={styles.userRow}>
                    <span>{email}</span>
                    <button onClick={logout} style={styles.linkButton}>
                      {t("b2b.signOut")}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={styles.startColumn}>
                  {GOOGLE_CLIENT_ID ? (
                    <>
                      <div ref={buttonRef} />
                      <div style={styles.authHint}>
                        {t("b2b.authHint")}
                      </div>
                    </>
                  ) : (
                    <div style={styles.authHint}>
                      {t("b2b.clientIdMissing")}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* START ERROR (visibile anche prima che esista un run) */}
            {startError && (
              <div style={{ ...styles.errorBox, marginTop: 14 }}>
                <strong>{t("b2b.error")}</strong>
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
                    {botTurns} / {totalMessages} {t("b2b.messages")}
                  </span>
                  {humanTurns > 0 && (
                    <>
                      <span style={styles.statusSeparator}>·</span>
                      <span>{t("b2b.fromYou", { count: humanTurns })}</span>
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
                    {data.hand_raised ? t("b2b.handRaised") : t("b2b.raiseHand")}
                  </button>
                )}
                {active && (
                  <button onClick={stop} style={styles.stopButton}>
                    {t("b2b.stop")}
                  </button>
                )}
                <button onClick={reset} style={styles.resetButton}>
                  {t("b2b.newExperiment")}
                </button>
              </div>
            </div>

            {/* RUN CONFIG SUMMARY */}
            <section style={styles.summaryGrid}>
              {cfg.participants.map((participant, idx) => (
                <SummaryCard
                  key={idx}
                  label={t("b2b.participant", { n: idx + 1 })}
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
                label={t("b2b.worldLabel")}
                value={
                  cfg.world_source === "emergence"
                    ? `Emergence #${cfg.world_ref}`
                    : t("b2b.freeTopic")
                }
                detail={
                  cfg.world_source === "free"
                    ? cfg.topic || t("b2b.noTopic")
                    : t("b2b.emergenceExperiment")
                }
              />
              <SummaryCard
                label={t("b2b.rounds")}
                value={`${cfg.max_turns} × ${cfg.participants.length}`}
                detail={`${totalMessages} ${t("b2b.messagesMax")}`}
              />
            </section>

            {/* WORLD LIVE */}
            <section style={styles.worldLiveCard}>
              <div style={styles.worldLiveTitle}>🌍 {t("b2b.worldLabel")}</div>
              <div style={styles.worldLiveText}>
                {cfg.world_source === "emergence"
                  ? t("b2b.emergenceWorldRef", { ref: cfg.world_ref })
                  : cfg.topic || t("b2b.freeTopic")}
              </div>
            </section>

            {/* CONVERSATION */}
            <section style={styles.conversationCard}>
              <div style={styles.conversationHeader}>
                <div>
                  <div style={styles.sectionTitle}>{t("b2b.liveConversation")}</div>
                  <div style={styles.sectionSubtitle}>
                    {t("b2b.liveIntro")}
                  </div>
                </div>
                {running && <div style={styles.liveBadge}>{t("b2b.live")}</div>}
                {paused && <div style={styles.liveBadge}>{t("b2b.pausedBadge")}</div>}
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
                            {isHuman ? t("b2b.human") : turn.model}
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
                    <em>{t("b2b.thinking")}</em>
                  </div>
                )}
                {running && data.hand_raised && (
                  <div style={styles.thinking}>
                    <span>✋</span>
                    <em>
                      {t("b2b.handRaisedInfo")}
                    </em>
                  </div>
                )}
                {data.status === "ERROR" && (
                  <div style={styles.errorBox}>
                    <strong>{t("b2b.error")}</strong>
                    <div>
                      {data.error ||
                        t("b2b.gatewayLogs")}
                    </div>
                  </div>
                )}
                {!running && data.status === "COMPLETED" && (
                  <div style={styles.completedBox}>{t("b2b.completed")}</div>
                )}
                {!running && data.status === "STOPPED" && (
                  <div style={styles.stoppedBox}>{t("b2b.stopped")}</div>
                )}
              </div>

              {/* HUMAN INTERVENTION (solo con il run in pausa) */}
              {paused && (
                <div style={styles.humanPanel}>
                  <div style={styles.humanTitle}>
                    {t("b2b.runPaused")}
                  </div>
                  <div style={styles.humanHint}>
                    {t("b2b.pausedHint")}
                  </div>
                  <textarea
                    style={{ ...styles.textarea, minHeight: 80 }}
                    placeholder={t("b2b.interventionPlaceholder")}
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
                      {t("b2b.resumeNoMessage")}
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
                      {handBusy ? t("b2b.sending") : t("b2b.sendResume")}
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
  const { t } = useTranslation();
  const agent = AGENTS.find((item) => item.id === participant.agent);
  const agentEmoji = AGENT_EMOJI[agent?.id] || "🤖";

  return (
    <section style={styles.agentCard}>
      <div style={styles.agentHeader}>
        <div>
          <div style={styles.agentSide}>{t("b2b.participant", { n: idx + 1 })}</div>
          <div style={styles.agentName}>
            {agentEmoji} {agent?.label || t("b2b.agent")}
          </div>
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            style={styles.removeButton}
            title={t("b2b.removeParticipant")}
          >
            ✕
          </button>
        )}
      </div>

      {/* Agent */}
      <Field label={t("b2b.agentLabel")}>
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
        <Field label={t("b2b.genreLabel")}>
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
        <Field label={t("b2b.emergenceRoleLabel")}>
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


// ============================================================
// B2BIMG — 12 bot img2img sulla stessa immagine di partenza
// ============================================================
// V1: ogni bot riceve l'IMMAGINE INIZIALE e produce la sua variante
// con il proprio prompt di modifica, steps e "temperatura"
// (strength: 0.15 fedele -> 0.95 libera). Il run e' SEQUENZIALE:
// il gateway accetta un solo job img2img per utente, quindi un bot
// alla volta. La risoluzione e' globale, uguale per tutti i bot.
// Prossima versione: ogni bot passa il suo output al successivo.
//
// API (esistenti, nessuna modifica al gateway):
//   POST /api/image/img2img (multipart: image, prompt, strength,
//        width, height, steps, seed) -> { job_id }
//   GET  /api/image/jobs/{id}  -> { status, error? }
//   GET  /api/image/jobs/{id}/result -> { image_base64, seed }
// ============================================================

const IMG_STEPS = [1, 3, 4, 5, 6, 7, 8, 9, 12, 15];

// Stessa griglia di GRADIO_FORMATS (ImageLab / app Gradio).
const IMG_FORMATS = {
  512: [["512 × 512 (1:1)", 512, 512], ["640 × 384 (5:3)", 640, 384], ["384 × 640 (3:5)", 384, 640], ["512 × 384 (4:3)", 512, 384], ["384 × 512 (3:4)", 384, 512], ["640 × 368 (16:9)", 640, 368], ["368 × 640 (9:16)", 368, 640]],
  768: [["768 × 768 (1:1)", 768, 768], ["960 × 576 (5:3)", 960, 576], ["576 × 960 (3:5)", 576, 960], ["768 × 576 (4:3)", 768, 576], ["576 × 768 (3:4)", 576, 768], ["960 × 544 (16:9)", 960, 544], ["544 × 960 (9:16)", 544, 960]],
  1024: [["1024 × 1024 (1:1)", 1024, 1024], ["1280 × 768 (5:3)", 1280, 768], ["768 × 1280 (3:5)", 768, 1280], ["1024 × 768 (4:3)", 1024, 768], ["768 × 1024 (3:4)", 768, 1024], ["1280 × 720 (16:9)", 1280, 720], ["720 × 1280 (9:16)", 720, 1280], ["1024 × 576 (16:9)", 1024, 576], ["576 × 1024 (9:16)", 576, 1024]],
  1280: [["1280 × 1280 (1:1)", 1280, 1280], ["1536 × 1024 (3:2)", 1536, 1024], ["1024 × 1536 (2:3)", 1024, 1536], ["1536 × 864 (16:9)", 1536, 864], ["864 × 1536 (9:16)", 864, 1536]],
};

function makeImgBot(i) {
  return {
    id: i,
    on: true,
    prompt: "",
    temp: 0.65,
    steps: 4,
    seed: Math.floor(Math.random() * 2147483647),
    status: "idle", // idle | waiting | running | done | error
    img: "",
    error: "",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function B2BImgTab({ setTab }) {
  const { idToken, email, buttonRef, logout } = useGoogleAuth();

  const [imgFile, setImgFile] = useState(null);
  const [imgPreview, setImgPreview] = useState("");
  const [size, setSize] = useState(512);
  const [formatIdx, setFormatIdx] = useState(0);
  const [bots, setBots] = useState(() =>
    Array.from({ length: 12 }, (_, i) => makeImgBot(i))
  );
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const stopRef = useRef(false);

  const formats = IMG_FORMATS[size] || IMG_FORMATS[512];
  const dims = formats[Math.min(formatIdx, formats.length - 1)].slice(1);

  const setBot = (id, patch) =>
    setBots((cur) => cur.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  function pickFile(file) {
    setNotice("");
    if (!file) {
      setImgFile(null);
      setImgPreview("");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setNotice("Il file non e' un'immagine.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setNotice("Immagine troppo grande (max 15 MB).");
      return;
    }
    setImgFile(file);
    setImgPreview(URL.createObjectURL(file));
  }

  async function runBot(bot) {
    setBot(bot.id, { status: "running", error: "" });
    const headers = { Authorization: "Bearer " + idToken };
    try {
      const fd = new FormData();
      fd.append("image", imgFile);
      fd.append(
        "prompt",
        bot.prompt.trim() || "enhance this image, keep the composition"
      );
      fd.append("strength", String(bot.temp));
      fd.append("width", String(dims[0]));
      fd.append("height", String(dims[1]));
      fd.append("steps", String(bot.steps));
      fd.append("seed", String(bot.seed));

      const res = await fetch(API + "/api/image/img2img", {
        method: "POST",
        headers,
        body: fd,
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
      if (!data.job_id) throw new Error("Nessun job_id dal gateway.");

      for (;;) {
        if (stopRef.current) throw new Error("__STOP__");
        await sleep(3000);
        const st = await fetch(
          API + "/api/image/jobs/" + encodeURIComponent(data.job_id),
          { headers }
        ).then((r) => r.json());
        const s = String(st.status || "").toLowerCase();
        if (["completed", "complete", "succeeded", "success"].includes(s)) break;
        if (["failed", "error", "cancelled", "canceled"].includes(s)) {
          throw new Error(st.error || "Generazione fallita.");
        }
      }

      const result = await fetch(
        API + "/api/image/jobs/" + encodeURIComponent(data.job_id) + "/result",
        { headers }
      ).then((r) => r.json());
      if (!result.image_base64) throw new Error("Risultato senza immagine.");
      const b64 = String(result.image_base64).replace(
        /^data:image\/png;base64,/i,
        ""
      );
      setBot(bot.id, { status: "done", img: "data:image/png;base64," + b64 });
    } catch (e) {
      if (String(e.message) === "__STOP__") {
        setBot(bot.id, { status: "idle" });
        throw e;
      }
      setBot(bot.id, { status: "error", error: e.message || String(e) });
    }
  }

  async function runAll() {
    if (!imgFile) {
      setNotice("Carica prima un'immagine di partenza.");
      return;
    }
    const active = bots.filter((b) => b.on);
    if (!active.length) {
      setNotice("Attiva almeno un bot.");
      return;
    }
    stopRef.current = false;
    setRunning(true);
    setNotice("");
    setBots((cur) => cur.map((b) => (b.on ? { ...b, status: "waiting" } : b)));
    for (const bot of active) {
      if (stopRef.current) break;
      try {
        await runBot(bot);
      } catch (e) {
        if (String(e.message) === "__STOP__") break;
      }
    }
    setRunning(false);
  }

  async function runOne(bot) {
    if (!imgFile || running) return;
    stopRef.current = false;
    setRunning(true);
    setNotice("");
    try {
      await runBot(bot);
    } catch (e) {
      /* stato già scritto in runBot */
    }
    setRunning(false);
  }

  if (!idToken) {
    return (
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <div style={styles.eyebrow}>B2B IMG</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h1 style={imgStyles.imgTitle}>B2BImg</h1>
          <button
            style={imgStyles.tabBtn}
            onClick={() => setTab && setTab("arena")}
          >
            ← Bot to Bot
          </button>
        </div>
        <p style={imgStyles.imgSub}>
          Accedi con Google per modificare un'immagine con 12 bot img2img.
        </p>
        <div style={{ marginTop: 20 }}>
          <div ref={buttonRef} style={{ display: "inline-block" }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={imgStyles.imgHead}>
        <div style={styles.eyebrow}>B2B IMG</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h1 style={imgStyles.imgTitle}>B2BImg</h1>
          <button
            style={imgStyles.tabBtn}
            onClick={() => setTab && setTab("arena")}
          >
            ← Bot to Bot
          </button>
        </div>
        <p style={imgStyles.imgSub}>
          Un'immagine di partenza, 12 bot: ognuno produce la sua variante con il
          proprio prompt di modifica, steps e temperatura (strength). Il run è
          sequenziale, un job per volta sul Mac. Risoluzione uguale per tutti.
        </p>
      </div>

      <section style={imgStyles.inputCard}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionIcon}>🖼️</span>
          <div>
            <div style={styles.sectionTitle}>IMMAGINE + RISOLUZIONE (GLOBALI)</div>
            <div style={styles.sectionSubtitle}>
              La stessa immagine e la stessa risoluzione per tutti i bot.
            </div>
          </div>
        </div>
        <input
          type="file"
          accept="image/*"
          disabled={running}
          onChange={(e) => pickFile(e.target.files && e.target.files[0])}
        />
        {imgPreview && (
          <img style={imgStyles.preview} src={imgPreview} alt="immagine di partenza" />
        )}
        <div style={imgStyles.resRow}>
          <label>
            <div style={imgStyles.paramLabel}>RISOLUZIONE</div>
            <select
              style={imgStyles.resSelect}
              value={size}
              disabled={running}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setFormatIdx(0);
              }}
            >
              {Object.keys(IMG_FORMATS).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            <div style={imgStyles.paramLabel}>FORMATO</div>
            <select
              style={imgStyles.resSelect}
              value={formatIdx}
              disabled={running}
              onChange={(e) => setFormatIdx(Number(e.target.value))}
            >
              {formats.map((f, i) => (
                <option key={f[0]} value={i}>{f[0]}</option>
              ))}
            </select>
          </label>
          <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            {!running ? (
              <button
                style={imgStyles.runBtn}
                onClick={runAll}
                disabled={!imgFile}
              >
                ▶ Genera ({bots.filter((b) => b.on).length} bot)
              </button>
            ) : (
              <button
                style={imgStyles.stopBtn}
                onClick={() => {
                  stopRef.current = true;
                }}
              >
                ■ Stop
              </button>
            )}
            <div style={styles.userRow}>
              <span>{email}</span>
              <button style={styles.linkButton} onClick={logout}>Logout</button>
            </div>
          </div>
        </div>
      </section>

      {notice && <div style={imgStyles.errorBox}>{notice}</div>}

      <div style={imgStyles.botGrid}>
        {bots.map((bot) => (
          <section key={bot.id} style={imgStyles.botCard}>
            <div style={imgStyles.botHeader}>
              <span style={imgStyles.botName}>🤖 Bot {bot.id + 1}</span>
              <label style={{ display: "flex", gap: 5, fontSize: 11, color: "#9bacb5", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={bot.on}
                  disabled={running}
                  onChange={(e) => setBot(bot.id, { on: e.target.checked })}
                />
                on
              </label>
            </div>
            <textarea
              style={imgStyles.botPrompt}
              placeholder="prompt di modifica (es. rendilo notturno, pioggia)"
              value={bot.prompt}
              disabled={running}
              onChange={(e) => setBot(bot.id, { prompt: e.target.value })}
            />
            <div style={imgStyles.paramRow}>
              <span style={imgStyles.paramLabel}>TEMP</span>
              <input
                type="range"
                min="0.15"
                max="0.95"
                step="0.05"
                value={bot.temp}
                style={imgStyles.range}
                disabled={running}
                onChange={(e) => setBot(bot.id, { temp: Number(e.target.value) })}
              />
              <span style={{ fontSize: 11, color: "#9db2bd", minWidth: 32 }}>
                {bot.temp.toFixed(2)}
              </span>
            </div>
            <div style={imgStyles.paramRow}>
              <span style={imgStyles.paramLabel}>STEPS</span>
              <select
                style={imgStyles.smallNum}
                value={bot.steps}
                disabled={running}
                onChange={(e) => setBot(bot.id, { steps: Number(e.target.value) })}
              >
                {IMG_STEPS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <span style={{ ...imgStyles.paramLabel, marginLeft: 6 }}>SEED</span>
              <input
                type="number"
                style={imgStyles.smallNum}
                value={bot.seed}
                disabled={running}
                onChange={(e) => setBot(bot.id, { seed: Number(e.target.value) })}
              />
              <button
                style={imgStyles.smallBtn}
                disabled={running}
                title="seed casuale"
                onClick={() =>
                  setBot(bot.id, { seed: Math.floor(Math.random() * 2147483647) })
                }
              >
                🎲
              </button>
            </div>
            <div
              style={{
                ...imgStyles.statusLine,
                ...(bot.status === "running" || bot.status === "waiting"
                  ? imgStyles.statusRun
                  : bot.status === "done"
                    ? imgStyles.statusDone
                    : bot.status === "error"
                      ? imgStyles.statusErr
                      : {}),
              }}
            >
              {bot.status === "idle" && "—"}
              {bot.status === "waiting" && "in coda…"}
              {bot.status === "running" && "generando…"}
              {bot.status === "done" && "fatto ✓"}
              {bot.status === "error" && bot.error}
            </div>
            {bot.img && (
              <>
                <img style={imgStyles.botImg} src={bot.img} alt={"Bot " + (bot.id + 1)} />
                <a
                  style={{ ...imgStyles.miniBtn, display: "inline-block", marginTop: 8, textDecoration: "none" }}
                  href={bot.img}
                  download={`b2b-bot-${bot.id + 1}.png`}
                >
                  ↓ Scarica PNG
                </a>
              </>
            )}
            <div style={{ marginTop: 10 }}>
              <button
                style={imgStyles.miniBtn}
                disabled={running || !imgFile}
                onClick={() => runOne(bot)}
              >
                ▶ solo questo
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// WRAPPER CON TAB — Arena e B2BImg restano entrambi montati
// (cosi' un run arena in corso continua anche nell'altro tab).
// Login/logout sincronizzati via evento "dv-token-sync".
// ============================================================

export default function B2B() {
  const [tab, setTab] = useState("arena");

  return (
    <div style={styles.page}>
      <div
        style={{
          ...styles.background,
          backgroundImage: "url(" + bgImage + ")",
        }}
      />
      <div style={styles.overlay} />
      <div style={styles.content}>
        <div style={{ display: tab === "arena" ? "block" : "none" }}>
          <ArenaTab setTab={setTab} />
        </div>
        <div style={{ display: tab === "img" ? "block" : "none" }}>
          <B2BImgTab setTab={setTab} />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// STILI B2BIMG
// ============================================================

const imgStyles = {
  tabBar: {
    display: "flex",
    gap: 8,
    marginBottom: 24,
    paddingBottom: 14,
    borderBottom: "1px solid #25343d",
  },
  tabBtn: {
    border: "1px solid #344853",
    background: "#121c23",
    color: "#9bacb5",
    borderRadius: 999,
    padding: "10px 18px",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: ".7px",
    cursor: "pointer",
  },
  tabBtnActive: {
    border: "1px solid #4a626e",
    background: "linear-gradient(135deg, #263943, #17262f)",
    color: "#eef4f6",
    borderRadius: 999,
    padding: "10px 18px",
    fontSize: 12,
    fontWeight: 750,
    letterSpacing: ".7px",
    cursor: "pointer",
  },
  imgHead: {
    textAlign: "center",
    marginBottom: 26,
  },
  imgTitle: {
    margin: 0,
    fontSize: "clamp(28px, 5vw, 42px)",
    color: "#f1f5f7",
    letterSpacing: "-1px",
  },
  imgSub: {
    marginTop: 10,
    color: "#93a3ad",
    fontSize: 14,
    lineHeight: 1.6,
    maxWidth: 640,
    marginLeft: "auto",
    marginRight: "auto",
  },
  inputCard: {
    marginTop: 6,
    padding: 22,
    borderRadius: 18,
    background: "rgba(15,23,30,.9)",
    border: "1px solid #273640",
  },
  resRow: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    marginTop: 16,
    alignItems: "flex-end",
  },
  resSelect: {
    background: "#101920",
    color: "#e4ebef",
    border: "1px solid #2d404b",
    borderRadius: 9,
    padding: "10px 12px",
    fontSize: 14,
  },
  preview: {
    maxHeight: 200,
    maxWidth: "100%",
    borderRadius: 10,
    border: "1px solid #293b45",
    display: "block",
    marginTop: 12,
  },
  botGrid: {
    marginTop: 18,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
    gap: 12,
  },
  botCard: {
    minWidth: 0,
    padding: 16,
    borderRadius: 14,
    background: "linear-gradient(145deg, rgba(20,29,37,.92), rgba(11,17,23,.92))",
    border: "1px solid #354955",
  },
  botHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  botName: {
    fontSize: 13,
    fontWeight: 700,
    color: "#edf2f4",
  },
  botPrompt: {
    width: "100%",
    boxSizing: "border-box",
    minHeight: 48,
    resize: "vertical",
    background: "#0d151b",
    color: "#e5ecef",
    border: "1px solid #2b3d47",
    borderRadius: 9,
    padding: 8,
    fontFamily: "inherit",
    fontSize: 12.5,
    lineHeight: 1.4,
    outline: "none",
  },
  paramRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    marginTop: 10,
  },
  paramLabel: {
    fontSize: 9,
    letterSpacing: "1.2px",
    fontWeight: 700,
    color: "#82949e",
  },
  smallNum: {
    width: 90,
    background: "#101920",
    color: "#e4ebef",
    border: "1px solid #2d404b",
    borderRadius: 8,
    padding: "7px 8px",
    fontSize: 12,
  },
  smallBtn: {
    border: "1px solid #344853",
    background: "#121c23",
    color: "#b6c4ca",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 11,
    cursor: "pointer",
  },
  range: {
    flex: 1,
    accentColor: "#3fd0c9",
  },
  statusLine: {
    marginTop: 8,
    fontSize: 11,
    color: "#71838d",
    minHeight: 15,
  },
  statusRun: { color: "#8aaebc" },
  statusDone: { color: "#7fd3a8" },
  statusErr: { color: "#e5a0a0", overflowWrap: "anywhere" },
  botImg: {
    width: "100%",
    borderRadius: 10,
    border: "1px solid #293b45",
    marginTop: 10,
    display: "block",
  },
  runBtn: {
    border: "1px solid #4a626e",
    background: "linear-gradient(135deg, #263943, #17262f)",
    color: "#eef4f6",
    borderRadius: 999,
    padding: "12px 22px",
    fontSize: 12,
    fontWeight: 750,
    letterSpacing: ".7px",
    cursor: "pointer",
  },
  stopBtn: {
    border: "1px solid #674a4a",
    background: "#241719",
    color: "#e5bebe",
    borderRadius: 999,
    padding: "12px 22px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  miniBtn: {
    border: "1px solid #344853",
    background: "#121c23",
    color: "#b6c4ca",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  },
  errorBox: {
    padding: 14,
    borderRadius: 12,
    border: "1px solid #5c3a3a",
    background: "rgba(35,16,18,.9)",
    color: "#e5bebe",
    fontSize: 13,
    marginTop: 14,
  },
};
