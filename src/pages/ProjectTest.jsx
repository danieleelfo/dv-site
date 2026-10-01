// ============================================================
// PROJECT TEST — Agent Arena / Bot to Bot
// Layout ispirato a Emergence Lab.
//
// Agenti selezionabili:
//   - Night Story (8 generi)
//   - Story Whisper
//   - Leles
//   - QE / Emergence (12 ruoli)
//
// Ogni lato ha il suo LLM.
//
// Dipende SOLO dal gateway:
//   POST /api/agent-arena/start
//   GET  /api/agent-arena/{run_id}
//   POST /api/agent-arena/{run_id}/stop
// ============================================================

import { useState, useEffect, useRef } from "react";
import bgImage from "../assets/DataInFlames.jpg";

const API = "https://api.danielevillanova.com";

// ============================================================
// DATI AGENTI
// ============================================================

const AGENTS = [
  {
    id: "night_story",
    label: "Night Story",
    port: 8666,
    hasCharacters: true,
  },
  {
    id: "story_whisper",
    label: "Story Whisper",
    port: 8088,
    hasCharacters: false,
  },
  {
    id: "leles",
    label: "Leles",
    port: 8082,
    hasCharacters: false,
  },
  {
    id: "qe",
    label: "QE (Emergence)",
    port: 8082,
    hasCharacters: false,
    hasRoles: true,
  },
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

// QE: ruoli Emergence
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

const LLM_MODELS = [
  "gemma4",
  "llama3",
  "mistral",
  "qwen2.5",
  "deepseek-r1",
];

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
  Tester: 
"🧪",
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

const DEFAULT_CFG = {
  agent_a: "night_story",
  character_a: "horror",
  model_a: "gemma4",

  agent_b: "qe",
  character_b: "",
  role_b: "Critic",
  model_b: "qwen2.5",

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
  const [data, setData] = useState({
    status: "IDLE",
    turns: [],
  });
  const [starting, setStarting] = useState(false);

  const convRef = useRef(null);

  const set = (key, value) => {
    setCfg((current) => ({
      ...current,
      [key]: value,
    }));
  };

  // ==========================================================
  // START
  // ==========================================================

  const start = async () => {
    setStarting(true);

    try {
      const response = await fetch(`${API}/api/agent-arena/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/jsonn",
        },
        body: JSON.stringify(cfg),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.detail || "Gateway error");
      }

      if (result.run_id) {
        setRunId(result.run_id);
        setData({
          status: "RUNNING",
          turns: [],
        });
      }
    } catch (error) {
      console.error("Agent Arena start error:", error);

      setData({
        status: "ERROR",
        turns: [],
        error: error?.message || "Unable to start experiment",
      });
    } finally {
      setStarting(false);
    }
  };

  // ==========================================================

  // STOP
  // ==========================================================

  const stop = async () => {
    if (!runId) return;

    try {
      await fetch(`${API}/api/agent-arena/${runId}/stop`, {
        method: "POST",
      });
    } catch (error) {
      console.error("Agent Arena stop error:", error);
    }
  };

  // ==========================================================
  // POLLING LIVE
  // ==========================================================

  useEffect(() => {
    if (!runId) return;

    let stopped = false;

    const tick = async () => {
      try {
        const response = await fetch(
          `${API}/api/agent-arena/${runId}`
        );

        const result = await response.json();

        if (!stopped) {
          setData(result);
        }

        if (
          ["COMPLETED", "STOPPED", "ERROR"].includes(
            result.status
          )
        ) {
          clearInterval(timer);
          stopped = true;
        }
      } catch (error) {
        // Gateway down: retry at next tick.
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

  // ==========================================================
  // AUTOSCROLL
  // ==========================================================

  useEffect(() => {
    if (convRef.current) {
      convRef.current.scrollTop =
        convRef.current.scrollHeight;
    }
  }, [data.turns.length]);

  // ==========================================================
  // RESET
  // ==========================================================

  const reset = () => {
    setRunId(null);
    setData({
      status: "IDLE",
      turns: [],
    });
  };

  const running = data.status === "RUNNING";

  // ==========================================================
  // HELPERS
  // ==========================================================

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

    return {
      emoji,
      identity,
    };
  };

  const getAgentLabel = (agentId) => {
    return (
      AGENTS.find((agent) => agent.id === agentId)?.label ||
      agentId
    );
  };

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div style={styles.page}>
      {/* Background */}
      <div
        style={{
          ...styles.background,
          backgroundImage: `url(${bgImage})`,
        }}
      />

      {/* Dark overlay */}
      <div style={styles.overlay} />

      {/* Content */}
      <div style={styles.content}>
        {!runId ? (
          <>
            {/* =================================================
                HEADER
            ================================================= */}

            <div style={styles.header}>
              <div style={styles.eyebrow}>
                AGENT ARENA
              </div>

              <h1 style={styles.title}>
                Bot to Bot
              </h1>

              <p style={styles.subtitle}>
                Configure two autonomous agents and let them
                interact inside the same world.
              </p>
            </div>

            {/* =================================================
                AGENTS
            ================================================= */}

            <div style={styles.agentsGrid}>
              <AgentPane
                title="AGENT A"
                side="A"
                cfg={cfg}
                set={set}
                agentKey="agent_a"
   
             characterKey="character_a"
                roleKey="role_a"
                modelKey="model_a"
              />

              <div style={styles.vsContainer}>
                <div style={styles.vsLine} />
                <div style={styles.vs}>VS</div>
                <div style={styles.vsLine} />
              </div>

              <AgentPane
                title="AGENT B"
                side="B"
                cfg={cfg}
                set={set}
                agentKey="agent_b"
                characterKey="character_b"
                roleKey="role_b"
                modelKey="model_b"
              />
            </div>

            {/* =================================================
                WORLD
            ================================================= */}

            <section style={styles.card}>
              <div style={styles.sectionHeader}>
                <span style={styles.sectionIcon}>🌍</span>
                <div>
                  <div style={styles.sectionTitle}>
                    WORLD
                  </div>
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
                    onChange={() =>
                      set("world_source", "free")
                    }
                  />
                  <span>Free topic</span>
                </label>

                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    checked={
                      cfg.world_source === "emergence"
                    }
                    onChange={() =>
                      set("world_source", "emergence")
                   
 }
                  />
                  <span>Emergence World</span>
                </label>
              </div>

              {cfg.world_source === "free" ? (
                <textarea
                  style={styles.textarea}
                  placeholder="Two characters meet on a ghost ship during a storm..."
                  value={cfg.topic}
                  onChange={(event) =>
                    set("topic", event.target.value)
                  }
                />
              ) : (
                <input
                  style={styles.input}
                  type="number"
                  placeholder="World # (Emergence run id)"
                  value={cfg.world_ref}
                  onChange={(event) =>
                    set("world_ref", event.target.value)
                  }
                />
              )}
            </section>

            {/* =================================================
                RUN OPTIONS
            ================================================= */}

            <section style={styles.runCard}>
              <div>
                <div style={styles.optionLabel}>
                  MAX TURNS
                </div>

                <select
                  style={styles.smallSelect}
                  value={cfg.max_turns}
                  onChange={(event) =>
                    set(
                      "max_turns",
                      Number(event.target.value)
                    )
                  }
                >
                  {[5, 10, 20, 50].map((number) => (
                    <option
                      key={number}
                      value={number}
                    >
                      {number}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={start}
                disabled={starting}
                style={{
                  ...styles.startButton,
                  opacity: starting ? 0.65 : 1,
                  cursor: starting
                    ? "wait"
                    : "pointer",
                }}
              >
                {starting
                  ? "STARTING..."
                  : "▶ START EXPERIMENT"}
              </button>
            </section>
          </>
        ) : (
          <>
            {/* =================================================
                LIVE HEADER
            ================================================= */}

            <div style={styles.liveHeader}>
              <div>
                <div style={styles.eyebrow}>
                  AGENT ARENA
                </div>

                <h1 style={styles.liveTitle}>
                  Run #{runId}
                </h1>

                <div style={styles.statusRow}>
                  <span
                    style={{
                      ...styles.statusDot,
                      ...(running
                        ? styles.statusRunning
                        : styles.statusFinished),
                    }}
                  />

                  <span>
                    {data.status}
                  </span>

                  <span style={styles.statusSeparator}>
                    ·
                  </span>

                  <span>
                    {data.turns.length} /{" "}
                    {cfg.max_turns * 2} messages
                  </span>
                </div>
              </div>

              <div style={styles.liveActions}>
                {running && (
                  <button
                    onClick={stop}
                    style={styles.stopButton}
                  >
                    ⏹ STOP
                  </button>
                )}

                <button
                  onClick={reset}
                  style={styles.resetButton}
                >
                  ↺ NEW EXPERIMENT
                </button>
              </div>
            </div>

            {/* =====
============================================
                RUN CONFIG SUMMARY
            ================================================= */}

            <section style={styles.summaryGrid}>
              <SummaryCard
                label="AGENT A"
                value={getAgentLabel(cfg.agent_a)}
                detail={
                  cfg.character_a ||
                  cfg.role_a ||
                  cfg.model_a
                }
              />

              <SummaryCard
                label="AGENT B"
                value={getAgentLabel(cfg.agent_b)}
                detail={
                  cfg.role_b ||
                  cfg.character_b ||
                  cfg.model_b
                }
              />

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
                label="LLM"
                value={`${cfg.model_a} ↔ ${cfg.model_b}`}
                detail={`${cfg.max_turns} turns max`}
              />
            </section>

            {/* =================================================
                WORLD
            ================================================= */}

            <section style={styles.worldLiveCard}>
              <div style={styles.worldLiveTitle}>
                🌍 WORLD
              </div>

              <div style={styles.worldLiveText}>
                {cfg.world_source === "emergence"
                  ? `Emergence World #${cfg.world_ref}`
                  : cfg.topic || "Free topic"}
              </div>
            </section>

            {/* =================================================
      
          CONVERSATION
            ================================================= */}

            <section style={styles.conversationCard}>
              <div style={styles.conversationHeader}>
                <div>
                  <div style={styles.sectionTitle}>
                    LIVE CONVERSATION
                  </div>
                  <div style={styles.sectionSubtitle}>
                    Autonomous agent interaction
                  </div>
                </div>

                {running && (
                  <div style={styles.liveBadge}>
                    ● LIVE
                  </div>
                )}
              </div>

              <div
                ref={convRef}
                style={styles.conversation}
              >
                {data.turns.map((turn, index) => {
                  const { emoji, identity } =
                    getTurnIdentity(turn);

                  const isA =
                    index % 2 === 0;

                  return (
                    <div
                      key={turn.id || index}
                      style={{
                        ...styles.messageRow,
                        justifyContent: isA
                          ? "flex-start"
                          : "flex-end",
                      }}
                    >
                      <div
                        style={{
                          ...styles.message,
                          ...(isA
                            ? styles.messageA
                            : styles.messageB),
                        }}
                      >
                        <div style={styles.messageMeta}>
                          <span
                            style={styles.messageIdentity}
                          >
                            {emoji} {identity}
                          </span>

                          <span style={styles.messageModel}>
                            {turn.model}
                          </span>
                        </div>

                        <div style={styles.messageText}>
                          {turn.text}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {running && (
                  <div style={styles.thinking}>
                    <span>●</span>
                    <span>●</span>
                    <span>●</span>
                    <em>agents are thinking...</em>
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

                {!running &&
                  data.status === "COMPLETED" && (
                    <div style={styles.completedBox}>
                      ✓ Experiment completed
                    </div>
                  )}

                {!running &&
                  data.status === "STOPPED" && (
                    <div style={styles.stoppedBox}>
                      ⏹ Experiment stopped
                    </div>
                  )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// AGENT PANE
// ============================================================

function AgentPane({
  title,
  side,
  cfg,
  set,
  agentKey,
  characterKey,
  roleKey,
  modelKey,
}) {
  const agent = AGENTS.find(
    (item) => item.id === cfg[agentKey]
  );

  const agentEmoji =
    AGENT_EMOJI[agent?.id] || "🤖";

  return (
    <section
      style={{
        ...styles.agentCard,
        ...(side === "A"
          ? styles.agentCardA
          : styles.agentCardB),
      }}
    >
      <div style={styl
es.agentHeader}>
        <div>
          <div style={styles.agentSide}>
            {title}
          </div>

          <div style={styles.agentName}>
            {agentEmoji}{" "}
            {agent?.label || "Agent"}
          </div>
        </div>

        <div style={styles.agentBadge}>
          {side}
        </div>
      </div>

      {/* Agent */}

      <Field label="AGENT">
        <select
          value={cfg[agentKey]}
          onChange={(event) =>
            set(agentKey, event.target.value)
          }
          style={styles.select}
        >
          {AGENTS.map((item) => (
            <option
              key={item.id}
              value={item.id}
            >
              {AGENT_EMOJI[item.id] || "🤖"}{" "}
              {item.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Night Story genre */}

      {agent?.hasCharacters && (
        <Field label="GENRE">
          <select
            value={cfg[characterKey]}
            onChange={(event) =>
              set(
                characterKey,
                event.target.value
              )
            }
            style={styles.select}
          >
            {NS_CHARACTERS.map((character) => (
              <option
                key={character}
                value={character}
              >
                {CHARACTER_EMOJI[character] ||
                  "🎭"}{" "}
                {character}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* QE role */}

      {agent?.hasRoles && (
        <Field label="EMERGENCE ROLE">
          <select
            value={cfg[roleKey]}
            onChange={(event) =>
              set(roleKey, event.target.value)
            }
            style={styles.select}
          >
            {QE_ROLES.map((role) => (
              <option
                key={role}
                value={role}
              >
                {ROLE_EMOJI[role] || "🌱"}{" "}
               
 {role}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* LLM */}

      <Field label="LLM">
        <select
          value={cfg[modelKey]}
          onChange={(event) =>
            set(modelKey, event.target.value)
          }
          style={styles.select}
        >
          {LLM_MODELS.map((model) => (
            <option
              key={model}
              value={model}
            >
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
      <span style={styles.fieldLabel}>
        {label}
      </span>
      {children}
    </label>
  );
}

// ============================================================
// SUMMARY CARD
// ============================================================

function SummaryCard({
  label,
  value,
  detail,
}) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryLabel}>
        {label}
      </div>

      <div style={styles.summaryValue}>
        {value}
      </div>

      <div style={styles.summaryDetail}>
        {detail}
      </div>
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
      "linear-gradient(180deg, rgba(5,10,14,
.82) 0%, rgba(7,13,18,.91) 48%, rgba(4,8,12,.97) 100%)",
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

  agentsGrid: {
    display: "grid",
    gridTemplateColumns:
      "minmax(0, 1fr) 54px minmax(0, 1fr)",
    alignItems: "stretch",
    gap: 12,
  },

  agentCard: {
    minWidth: 0,
    padding: 22,
    borderRadius: 18,
    background:
      "linear-gradient(145deg, rgba(20,29,37,.92), rgba(11,17,23,.92))",
    border: "1px solid #273640",
    boxShadow:
      "0 18px 50px rgba(0,0,0,.24)",
  },

  agentCardA: {
    borderColor: "#354955",
  },

  agentCardB: {
    borderColor: "#354955",
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

  agentBadge: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #3a4d58",
    color: "#aabac3",
    fontSize: 12,
    fontWeight: 700,
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

  vsContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  vsLine: {
    width: 1,
    flex: 1,
    background:
      "linear-gradient(180deg, transparent, #394b56, transparent)",
  },

  vs: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#111a21",
    border: "1px solid #354852",
    color: "#9bacb5",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "1px",
  },

  card: {
    marginTop: 18,
    padding: 22,
    borderRadius: 18,
    background:
      "rgba(15,23,30,.9)",
    border: "1px solid #273640",
    boxShadow:
      "0 18px 50px rgba(0,0,0,.2)",
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
    background: "#0d151b"
,
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
    background:
      "rgba(15,23,30,.9)",
    border: "1px solid #273640",
  },

  optionLabel: {
    fontSize: 10,
    letterSpacing: "1.5px",
    color: "#82949e",
    fontWeight: 700,
    marginBottom: 7,
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
    background:
      "linear-gradient(135deg, #263943, #17262f)",
    color: "#eef4f6",
    borderRadius: 999,
    padding: "13px 24px",
    fontSize: 12,
    fontWeight: 750,
    letterSpacing: ".7px",
    boxShadow:
      "0 8px 25px rgba(0,0,0,.22)",
  },

  liveHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    marginBottom: 24,
    paddingBottom: 20,
    borderBottom: "1px solid #25343d",
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
    boxShadow: "0 0 10px rgba
(138,174,188,.7)",
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
    gridTemplateColumns:
      "repeat(4, minmax(0, 1fr))",
    gap: 10,
    marginBottom: 14,
  },

  summaryCard: {
    minWidth: 0,
    padding: 14,
    borderRadius: 13,
    background:
      "rgba(15,23,30,.82)",
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
    background:
      "rgba(15,23,30,.88)",
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
    background:
      "rgba(11,18,24,.9)",
    border: "1px solid #273640",
    overflow: "hidden",
  },

  conversati
onHeader: {
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
    boxShadow:
      "0 8px 25px rgba(0,0,0,

... [Content truncated]