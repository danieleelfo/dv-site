// ============================================================
// LAB TEST 2 — pagina completa bot-to-bot per dv-site
// Agenti selezionabili: Night Story (8 character), Story Whisper,
// Leles. Ogni lato ha il suo LLM tra i 5 modelli.
// Da incollare come nuova pagina (es. src/pages/LabTest2.jsx)
// + una rotta "/lab-test2" nel router. Nessuna modifica a Console.jsx.
//
// Dipende SOLO dal gateway (https://api.danielevillanova.com):
//   POST /api/agent-arena/start   → {run_id}
//   GET  /api/agent-arena/{run_id} → {status, turns: [{id, agent, character, model, text}]}
//   POST /api/agent-arena/{run_id}/stop
// (il piccolo patch del gateway per il routing per agente è in fondo al file)
// ============================================================

import { useState, useEffect, useRef } from "react";

const API = "https://api.danielevillanova.com";

// ---- dati agenti (gli stessi nomi usati lato gateway/DB) ----
const AGENTS = [
  { id: "night_story", label: "Night Story", port: 8666, hasCharacters: true },
  { id: "story_whisper", label: "Story Whisper", port: 8088, hasCharacters: false },
  { id: "leles", label: "Leles", port: 8082, hasCharacters: false },
];

const NS_CHARACTERS = [
  "pirate", "wizard", "knight", "scientist", "ghost",
  "detective", "child", "alien",
]; // <-- sostituisci con i nomi ESATTI degli 8 character di NS (quelli dei bottoni /character)

const LLM_MODELS = ["gemma4", "llama3", "mistral", "qwen2.5", "deepseek-r1"];

const CHARACTER_EMOJI = {
  pirate: "🏴‍☠️", wizard: "🧙", knight: "⚔️", scientist: "🔬",
  ghost: "👻", detective: "🕵️", child: "🧒", alien: "👽",
};
const AGENT_EMOJI = { night_story: "🌙", story_whisper: "🌬️", leles: "🏴‍☠️" };

const DEFAULT_CFG = {
  agent_a: "night_story", character_a: "pirate", model_a: "gemma4",
  agent_b: "night_story", character_b: "wizard", model_b: "qwen2.5",
  world_source: "free",        // 'free' | 'emergence'
  world_ref: "",               // run id Emergence se world_source = 'emergence'
  topic: "",
  max_turns: 10,
};

export default function LabTest2() {
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [runId, setRunId] = useState(null);
  const [data, setData] = useState({ status: "IDLE", turns: [] });
  const [starting, setStarting] = useState(false);
  const convRef = useRef(null);

  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));

  // ---- START ----
  const start = async () => {
    setStarting(true);
    try {
      const r = await fetch(`${API}/api/agent-arena/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }).then(r => r.json());
      if (r.run_id) setRunId(r.run_id);
    } finally {
      setStarting(false);
    }
  };

  // ---- STOP ----
  const stop = async () => {
    if (!runId) return;
    await fetch(`${API}/api/agent-arena/${runId}/stop`, { method: "POST" });
  };

  // ---- POLLING live ----
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const d = await fetch(`${API}/api/agent-arena/${runId}`).then(r => r.json());
        if (!stopped) setData(d);
        if (["COMPLETED", "STOPPED", "ERROR"].includes(d.status)) {
          clearInterval(t); stopped = true;
        }
      } catch { /* gateway giù: ritenta al prossimo tick */ }
    };
    const t = setInterval(tick, 2000);
    tick();
    return () => { stopped = true; clearInterval(t); };
  }, [runId]);

  // autoscroll conversazione
  useEffect(() => {
    if (convRef.current) convRef.current.scrollTop = convRef.current.scrollHeight;
  }, [data.turns.length]);

  const reset = () => { setRunId(null); setData({ status: "IDLE", turns: [] }); };
  const running = data.status === "RUNNING";

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1rem", fontFamily: "sans-serif" }}>

      <h2>🧪 Lab Test 2 — Bot to Bot</h2>

      {/* ============ CONFIGURAZIONE ============ */}
      {!runId && (
        <>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <AgentPane
              title="AGENT A"
              cfg={cfg} set={set}
              agentKey="agent_a" characterKey="character_a" modelKey="model_a"
            />
            <div style={{ alignSelf: "center", fontWeight: "bold", fontSize: "1.4rem" }}>VS</div>
            <AgentPane
              title="AGENT B"
              cfg={cfg} set={set}
              agentKey="agent_b" characterKey="character_b" modelKey="model_b"
            />
          </div>

          {/* ---- WORLD ---- */}
          <fieldset style={{ marginTop: "1rem" }}>
            <legend>🌍 WORLD</legend>
            <label style={{ marginRight: "1rem" }}>
              <input type="radio" checked={cfg.world_source === "free"}
                onChange={() => set("world_source", "free")} /> Free topic
            </label>
            <label>
              <input type="radio" checked={cfg.world_source === "emergence"}
                onChange={() => set("world_source", "emergence")} /> Emergence World
            </label>
            {cfg.world_source === "free" ? (
              <textarea
                style={{ width: "100%", marginTop: ".5rem", minHeight: 70 }}
                placeholder="Due personaggi si incontrano su una nave fantasma durante una tempesta..."
                value={cfg.topic}
                onChange={e => set("topic", e.target.value)}
              />
            ) : (
              <input
                style={{ marginTop: ".5rem" }}
                type="number" placeholder="World # (run id Emergence)"
                value={cfg.world_ref}
                onChange={e => set("world_ref", e.target.value)}
              />
            )}
          </fieldset>

          <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", alignItems: "center" }}>
            <label>
              Max turns{" "}
              <select value={cfg.max_turns} onChange={e => set("max_turns", +e.target.value)}>
                {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button
              onClick={start} disabled={starting}
              style={{ padding: ".5rem 1.5rem", fontWeight: "bold" }}>
              ▶ START
            </button>
          </div>
        </>
      )}

      {/* ============ CONVERSAZIONE LIVE ============ */}
      {runId && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>Run #{runId}</strong> — status: <em>{data.status}</em>
              {" "}({data.turns.length} messaggi / {cfg.max_turns * 2})
            </div>
            <div>
              {running && <button onClick={stop}>⏹ STOP</button>}
              {" "}
              <button onClick={reset}>↺ Nuovo esperimento</button>
            </div>
          </div>

          {/* box world */}
          <div style={{ border: "1px dashed #999", padding: ".5rem", margin: ".75rem 0", borderRadius: 6 }}>
            <strong>WORLD</strong>
            <p style={{ whiteSpace: "pre-wrap", margin: ".25rem 0 0" }}>
              {cfg.world_source === "emergence" ? `Emergence World #${cfg.world_ref}` : cfg.topic}
            </p>
          </div>

          <div ref={convRef}
            style={{ maxHeight: "55vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: ".75rem" }}>
            {data.turns.map(t => {
              const emoji = t.character
                ? (CHARACTER_EMOJI[t.character] || "🤖")
                : (AGENT_EMOJI[t.agent] || "🤖");
              const who = t.character || t.agent;
              return (
                <div key={t.id}
                  style={{
                    borderLeft: "4px solid #6b8afd",
                    padding: ".5rem .75rem", background: "#f8f8f8", borderRadius: 4,
                  }}>
                  <strong>{emoji} {who} · {t.model}</strong>
                  <p style={{ whiteSpace: "pre-wrap", margin: ".25rem 0 0" }}>{t.text}</p>
                </div>
              );
            })}
            {running && <em style={{ color: "#888" }}>… in corso</em>}
            {data.status === "ERROR" && (
              <strong style={{ color: "#c00" }}>Errore — vedi i log del gateway</strong>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Pannello singolo agente (usato per A e B)
// ============================================================
function AgentPane({ title, cfg, set, agentKey, characterKey, modelKey }) {
  const agent = AGENTS.find(a => a.id === cfg[agentKey]);
  return (
    <fieldset style={{ flex: 1, minWidth: 260 }}>
      <legend>{title}</legend>

      <label style={{ display: "block" }}>Agent
        <select value={cfg[agentKey]} onChange={e => set(agentKey, e.target.value)}
          style={{ width: "100%" }}>
          {AGENTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </label>

      {/* Character: solo per Night Story */}
      {agent.hasCharacters && (
        <label style={{ display: "block", marginTop: ".5rem" }}>Character
          <select value={cfg[characterKey]} onChange={e => set(characterKey, e.target.value)}
            style={{ width: "100%" }}>
            {NS_CHARACTERS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}

      <label style={{ display: "block", marginTop: ".5rem" }}>LLM
        <select value={cfg[modelKey]} onChange={e => set(modelKey, e.target.value)}
          style={{ width: "100%" }}>
          {LLM_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
    </fieldset>
  );
}

/* ============================================================
   ROTTA (router del dv-site, es. App.jsx):

   import LabTest2 from "./pages/LabTest2";
   ...
   <Route path="/lab-test2" element={<LabTest2 />} />
   e aggiungi la voce "Lab Test 2" nel menu accanto a Console.
   ============================================================ */


/* ============================================================
   PATCH GATEWAY (gateway.py) — routing per agente.
   Il loop di agent-arena (canvas gateway-agent-arena) non chiama
   più solo NS: risolve la porta dall'agente scelto.

   AGENT_PORTS = {
       "night_story":  8666,   # /ask  (usa anche character, se passato)
       "story_whisper": 8088,   # /ask  (ignora character)
       "leles":         8082,   # /ask  (ignora character)
   }

   // dentro run_conversation:
   const port = AGENT_PORTS[cfg[f"agent_{who.lower()}"]]
   url = f"http://127.0.0.1:{port}/ask"
   payload = {"message": last_msg, "chat_id": chat[who]}
   char = cfg.get(f"character_{who.lower()}")
   if char and cfg[f"agent_{who.lower()}"] == "night_story":
       payload["character"] = char
   if cfg.get(f"model_{who.lower()}"):
       payload["model"] = cfg[f"model_{who.lower()}"]
   # NB: model funziona subito su NS dopo la patch; su SW/Leles,
   # se il campo non esiste FastAPI lo ignora senza errori →
   # finché non patchi anche loro, lì il modello resta quello di default.

   // inoltre: salvare agent_a/agent_b nel config JSONB della run
   // e far restituire al GET anche metadata->>'character' come campo
   // "character" di ogni turno (serve per l'emoji lato frontend).
   ============================================================ */
