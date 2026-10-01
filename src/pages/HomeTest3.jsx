// ============================================================
// LAB TEST 3 — arena bot-to-bot LATO BROWSER
// Usa SOLO le API pubbliche già esistenti:
//   POST https://api.danielevillanova.com/api/chat
// Agenti: Night Story, Story Whisper, Lele I
// Nessuna modifica a gateway.py / lele_api.py richiesta.
// Il loop A→B→A… gira nel browser (se chiudi il tab si ferma).
// Rotta: /test3  (ProjectTest/agent-arena resta su /test6)
// ============================================================

import { useState, useEffect, useRef } from "react";

const API = "https://api.danielevillanova.com";

// Nomi esatti come in gateway.AGENTS e Console.jsx
const AGENTS = [
  { id: "Night Story", label: "Night Story", emoji: "🌙", hasGenre: true },
  { id: "Story Whisper", label: "Story Whisper", emoji: "🌬️", hasGenre: false },
  { id: "Lele I", label: "Lele I", emoji: "🏴‍☠️", hasGenre: false },
];

// Generi NS (file prompts/genre_*.txt) — finché gateway non passa "character",
// li iniettiamo nel prompt come istruzione di stile.
const NS_GENRES = [
  "horror", "drammatica", "comico", "ose",
  "ricerca", "random", "amore", "culturale",
];

const GENRE_EMOJI = {
  horror: "💀", drammatica: "🎭", comico: "😂", ose: "🔥",
  ricerca: "🔍", random: "🎲", amore: "❤️", culturale: "📚",
};

const DEFAULT_CFG = {
  agent_a: "Night Story",
  genre_a: "horror",
  agent_b: "Story Whisper",
  genre_b: "",
  topic: "Due personaggi si incontrano su una nave fantasma durante una tempesta...",
  max_turns: 6,
  language: "it",
};

function randomChatId() {
  return Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
}

async function callAgent({ agent, prompt, chatId, language }) {
  const res = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent,
      prompt,
      chat_id: chatId,
      language,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${agent}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return (
    data.answer ||
    data.error ||
    (typeof data.detail === "string" ? data.detail : null) ||
    JSON.stringify(data)
  );
}

function buildPrompt({ agent, genre, topic, history, isFirst }) {
  const genreHint =
    agent === "Night Story" && genre
      ? `[Stile/genere richiesto: ${genre}.] `
      : "";

  if (isFirst) {
    return (
      genreHint +
      `Sei in una conversazione improvvisata con un altro agente. ` +
      `Scenario: ${topic}\n\n` +
      `Inizia tu. Rispondi in modo naturale, restando nel personaggio. ` +
      `Non menzionare di essere un'IA.`
    );
  }

  const last = history[history.length - 1];
  return (
    genreHint +
    `Continua la conversazione. L'altro ha appena detto:\n\n"${last.text}"\n\n` +
    `Rispondi in modo naturale, restando nel personaggio. ` +
    `Non menzionare di essere un'IA. Scenario di partenza: ${topic}`
  );
}

export default function HomeTest3() {
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [turns, setTurns] = useState([]);
  const [status, setStatus] = useState("IDLE"); // IDLE | RUNNING | STOPPED | ERROR | COMPLETED
  const [error, setError] = useState("");
  const convRef = useRef(null);
  const stopRef = useRef(false);
  const chatA = useRef(randomChatId());
  const chatB = useRef(randomChatId());

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  useEffect(() => {
    if (convRef.current) {
      convRef.current.scrollTop = convRef.current.scrollHeight;
    }
  }, [turns.length]);

  const stop = () => {
    stopRef.current = true;
    setStatus((s) => (s === "RUNNING" ? "STOPPED" : s));
  };

  const reset = () => {
    stopRef.current = true;
    setTurns([]);
    setStatus("IDLE");
    setError("");
    chatA.current = randomChatId();
    chatB.current = randomChatId();
  };

  const start = async () => {
    stopRef.current = false;
    setTurns([]);
    setError("");
    setStatus("RUNNING");

    const history = [];
    let nextIsA = true;

    try {
      for (let i = 0; i < cfg.max_turns * 2; i++) {
        if (stopRef.current) {
          setStatus("STOPPED");
          return;
        }

        const isA = nextIsA;
        const agent = isA ? cfg.agent_a : cfg.agent_b;
        const genre = isA ? cfg.genre_a : cfg.genre_b;
        const chatId = isA ? chatA.current : chatB.current;
        const isFirst = history.length === 0;

        const prompt = buildPrompt({
          agent,
          genre,
          topic: cfg.topic,
          history,
          isFirst,
        });

        const text = await callAgent({
          agent,
          prompt,
          chatId,
          language: cfg.language,
        });

        if (stopRef.current) {
          setStatus("STOPPED");
          return;
        }

        const turn = {
          id: `${Date.now()}-${i}`,
          agent,
          genre: agent === "Night Story" ? genre : null,
          text,
          side: isA ? "A" : "B",
        };
        history.push(turn);
        setTurns([...history]);
        nextIsA = !nextIsA;
      }
      setStatus("COMPLETED");
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setStatus("ERROR");
    }
  };

  const running = status === "RUNNING";

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "1rem",
        fontFamily: "sans-serif",
        color: "#e0e8ec",
      }}
    >
      <h2 style={{ marginBottom: "0.25rem" }}>
        🧪 Lab Test 3 — Bot to Bot (client)
      </h2>
      <p style={{ color: "#8fa1ac", fontSize: "0.9rem", marginTop: 0 }}>
        Usa <code>/api/chat</code> pubblico. Nessun patch gateway. Loop nel
        browser. Leles/QE non disponibili (admin only).
      </p>

      {/* ============ CONFIG ============ */}
      {status === "IDLE" && (
        <>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <AgentPane
              title="AGENT A"
              cfg={cfg}
              set={set}
              agentKey="agent_a"
              genreKey="genre_a"
            />
            <div
              style={{
                alignSelf: "center",
                fontWeight: "bold",
                fontSize: "1.4rem",
              }}
            >
              VS
            </div>
            <AgentPane
              title="AGENT B"
              cfg={cfg}
              set={set}
              agentKey="agent_b"
              genreKey="genre_b"
            />
          </div>

          <fieldset style={{ marginTop: "1rem", borderColor: "#1f2b35" }}>
            <legend>🌍 Scenario</legend>
            <textarea
              style={{
                width: "100%",
                minHeight: 70,
                background: "#121a22",
                color: "#e0e8ec",
                border: "1px solid #1f2b35",
                borderRadius: 6,
                padding: "0.5rem",
              }}
              value={cfg.topic}
              onChange={(e) => set("topic", e.target.value)}
            />
          </fieldset>

          <div
            style={{
              marginTop: "1rem",
              display: "flex",
              gap: "1rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label>
              Max turni (per lato){" "}
              <select
                value={cfg.max_turns}
                onChange={(e) => set("max_turns", +e.target.value)}
                style={{
                  background: "#121a22",
                  color: "#e0e8ec",
                  border: "1px solid #1f2b35",
                }}
              >
                {[3, 4, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lingua{" "}
              <select
                value={cfg.language}
                onChange={(e) => set("language", e.target.value)}
                style={{
                  background: "#121a22",
                  color: "#e0e8ec",
                  border: "1px solid #1f2b35",
                }}
              >
                {["it", "en", "es", "fr"].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={start}
              style={{
                padding: ".5rem 1.5rem",
                fontWeight: "bold",
                background: "#3fd0c9",
                color: "#0b1015",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              ▶ START
            </button>
          </div>
        </>
      )}

      {/* ============ LIVE ============ */}
      {status !== "IDLE" && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            <div>
              <strong>status:</strong> <em>{status}</em> — {turns.length}{" "}
              messaggi / {cfg.max_turns * 2}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {running && (
                <button onClick={stop} style={btnSecondary}>
                  ⏹ STOP
                </button>
              )}
              <button onClick={reset} style={btnSecondary}>
                ↺ Nuovo esperimento
              </button>
            </div>
          </div>

          <div
            style={{
              border: "1px dashed #5c6b74",
              padding: ".5rem",
              margin: ".75rem 0",
              borderRadius: 6,
            }}
          >
            <strong>SCENARIO</strong>
            <p style={{ whiteSpace: "pre-wrap", margin: ".25rem 0 0" }}>
              {cfg.topic}
            </p>
            <p style={{ color: "#8fa1ac", fontSize: "0.85rem", margin: ".25rem 0 0" }}>
              {cfg.agent_a}
              {cfg.agent_a === "Night Story" && cfg.genre_a
                ? ` (${cfg.genre_a})`
                : ""}{" "}
              vs {cfg.agent_b}
              {cfg.agent_b === "Night Story" && cfg.genre_b
                ? ` (${cfg.genre_b})`
                : ""}
            </p>
          </div>

          {error && (
            <strong style={{ color: "#ff6b6b", display: "block", marginBottom: "0.5rem" }}>
              {error}
            </strong>
          )}

          <div
            ref={convRef}
            style={{
              maxHeight: "55vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: ".75rem",
            }}
          >
            {turns.map((t) => {
              const meta = AGENTS.find((a) => a.id === t.agent);
              const emoji = t.genre
                ? GENRE_EMOJI[t.genre] || meta?.emoji || "🤖"
                : meta?.emoji || "🤖";
              const who = t.genre ? `${t.agent} · ${t.genre}` : t.agent;
              return (
                <div
                  key={t.id}
                  style={{
                    borderLeft: `4px solid ${t.side === "A" ? "#3fd0c9" : "#6b8afd"}`,
                    padding: ".5rem .75rem",
                    background: "#121a22",
                    borderRadius: 4,
                  }}
                >
                  <strong>
                    {emoji} {who}
                  </strong>
                  <p style={{ whiteSpace: "pre-wrap", margin: ".25rem 0 0" }}>
                    {t.text}
                  </p>
                </div>
              );
            })}
            {running && (
              <em style={{ color: "#8fa1ac" }}>… in corso</em>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AgentPane({ title, cfg, set, agentKey, genreKey }) {
  const agent = AGENTS.find((a) => a.id === cfg[agentKey]);
  return (
    <fieldset style={{ flex: 1, minWidth: 260, borderColor: "#1f2b35" }}>
      <legend>{title}</legend>

      <label style={{ display: "block" }}>
        Agent
        <select
          value={cfg[agentKey]}
          onChange={(e) => {
            set(agentKey, e.target.value);
            // reset genre se non è NS
            if (e.target.value !== "Night Story") set(genreKey, "");
            else if (!cfg[genreKey]) set(genreKey, "horror");
          }}
          style={{
            width: "100%",
            background: "#121a22",
            color: "#e0e8ec",
            border: "1px solid #1f2b35",
          }}
        >
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.emoji} {a.label}
            </option>
          ))}
        </select>
      </label>

      {agent?.hasGenre && (
        <label style={{ display: "block", marginTop: ".5rem" }}>
          Genere (hint nel prompt)
          <select
            value={cfg[genreKey] || "horror"}
            onChange={(e) => set(genreKey, e.target.value)}
            style={{
              width: "100%",
              background: "#121a22",
              color: "#e0e8ec",
              border: "1px solid #1f2b35",
            }}
          >
            {NS_GENRES.map((g) => (
              <option key={g} value={g}>
                {GENRE_EMOJI[g]} {g}
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  );
}

const btnSecondary = {
  padding: ".4rem .9rem",
  background: "#121a22",
  color: "#3fd0c9",
  border: "1px solid #3fd0c9",
  borderRadius: 6,
  cursor: "pointer",
};
