// ============================================================
// IMAGE JOBS — modulo condiviso per i job immagine del gateway
// (F2: estratto da Test2.jsx e StoriesTab.jsx per eliminare la
// duplicazione. Un'unica implementazione di: fetch admin con
// Bearer token, creazione job /api/image/jobs, polling con retry,
// prompt di pianificazione/correzione scene, normalizzazione.)
//
// Nessuna dipendenza da React: solo funzioni pure/async.
// ============================================================

export const API = "https://api.danielevillanova.com";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------
// Fetch admin generica con Bearer token (già usata come
// adminJson in Test2 e apiJson in StoriesTab).
// ------------------------------------------------------------
export async function apiJson(idToken, path, init = {}, timeoutMs = 310000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${idToken}` },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      const err = new Error(
        res.status === 401
          ? "Sessione scaduta, effettua di nuovo il login."
          : "Accesso non autorizzato per questo account Google. 🏴‍☠️"
      );
      err.status = res.status;
      throw err;
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const data = await res.json();
        if (typeof data.detail === "string") detail = data.detail;
        else if (data.detail) detail = JSON.stringify(data.detail);
      } catch (e) {
        /* formato inatteso: manteniamo il messaggio base */
      }
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Timeout: il server non ha risposto in tempo. 😵‍💫");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Blob con auth header -> objectURL (per <audio> e <img> privati).
export async function authBlobUrl(idToken, path, timeoutMs = 60000) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

// ------------------------------------------------------------
// Estrazione JSON dalla risposta dell'LLM
// (Ollama a volte aggiunge prefazioni o code fence).
// ------------------------------------------------------------
export function extractJsonObject(text) {
  const source = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const first = source.indexOf("{");
  if (first < 0) return "";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = first; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(first, i + 1);
    }
  }
  return "";
}

export function parsePlan(text) {
  const jsonText = extractJsonObject(text);
  if (!jsonText) throw new Error("Non trovo un oggetto JSON completo nella risposta dell'LLM.");
  return JSON.parse(jsonText);
}

const bibleText = (value, max = 900) => String(value || "").trim().slice(0, max);
const bibleList = (value, mapper) =>
  (Array.isArray(value) ? value : []).slice(0, 30).map(mapper).filter(Boolean);

export function normalizeStoryBible(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Story Bible non valida.");
  }
  return {
    summary: bibleText(value.summary, 1800),
    ending: bibleText(value.ending, 1000),
    characters: bibleList(value.characters, (item) => {
      if (!item || typeof item !== "object") return null;
      const name = bibleText(item.name, 100);
      if (!name) return null;
      return {
        name,
        role: bibleText(item.role, 180),
        appearance: bibleText(item.appearance, 500),
        clothing: bibleText(item.clothing, 300),
        traits: bibleText(item.traits, 240),
      };
    }),
    locations: bibleList(value.locations, (item) => {
      if (!item || typeof item !== "object") return null;
      const name = bibleText(item.name, 120);
      return name ? { name, description: bibleText(item.description, 300) } : null;
    }),
    props: bibleList(value.props, (item) => {
      if (!item || typeof item !== "object") return null;
      const name = bibleText(item.name, 120);
      return name ? { name, description: bibleText(item.description, 300), owner: bibleText(item.owner, 100) } : null;
    }),
    timeline: bibleList(value.timeline, (item, index) => {
      if (!item || typeof item !== "object") return null;
      const event = bibleText(item.event, 350);
      return event ? { order: Number(item.order) || index + 1, event, consequence: bibleText(item.consequence, 220) } : null;
    }),
    facts: bibleList(value.facts, (item) => bibleText(item, 260)),
  };
}

export function buildStoryBiblePrompt(storyText) {
  return (
    "You are a continuity editor. Extract a factual STORY BIBLE from the supplied story. " +
    "Do not invent facts, relationships, appearances, clothing, locations, objects or events. " +
    "Use empty strings or empty arrays when the story does not specify something. " +
    "Keep the exact chronology and ending; distinguish explicit facts from unknown details. " +
    'Return only JSON: {"summary":"...","ending":"...","characters":[{"name":"...","role":"...","appearance":"...","clothing":"...","traits":"..."}],"locations":[{"name":"...","description":"..."}],"props":[{"name":"...","description":"...","owner":"..."}],"timeline":[{"order":1,"event":"...","consequence":"..."}],"facts":["..."]}. ' +
    "Include every recurring named character, recurring location and plot-critical object. " +
    "\n\nSTORY:\n" + String(storyText || "").slice(0, 20000)
  );
}

export function buildStoryboardPrompt({
  count,
  storyText,
  artDirection = "",
  styleExtra = "",
  styleClause = "a consistent style. ",
}) {
  return (
    "You are a storyboard planner for an illustrated story. Select exactly " + count +
    " distinct scenes in chronological order, spread across the story from opening to ending. " +
    "Each scene must depict a real, visually distinct moment. " +
    'Return ONLY JSON: {"style":"shared character and art direction bible","scenes":[{"title":"Short label","prompt":"Detailed English image prompt"}]}. ' +
    "Each prompt must be a complete standalone image prompt. Repeat exact recurring character descriptions and clothing. " +
    "Do not invent events. " + styleClause + artDirection + styleExtra +
    "\n\nSTORY:\n" + String(storyText || "").slice(0, 12000)
  );
}

export function buildRepairPrompt(count, rawPlan, style = "", storyBible = null) {
  const schema = '{"style":"shared style block or empty string","scenes":[{"title":"Short label","prompt":"Detailed English image prompt"}]}';
  return (
    "Repair the response into valid JSON only. Preserve all intended events and do not invent, remove, merge or reorder scenes. " +
    "Return exactly " + count + " scenes using this schema: " + schema + ". " +
    "Preserve the shared style block; if a fixed style is supplied, use it unchanged: " + String(style || "") + ". " +
    "Keep every prompt standalone and preserve character appearance, clothing, objects and chronology. " +
    "\nSTORY BIBLE:\n" + JSON.stringify(storyBible || {}) +
    "\nTEXT TO REPAIR:\n" + String(rawPlan || "").slice(0, 14000)
  );
}

export function buildStoryboardBatchPrompt({
  total,
  from,
  to,
  storyText,
  style = "",
  storyBible = null,
  prevScenes = [],
  artDirection = "",
  styleExtra = "",
  styleClause = "a consistent style. ",
}) {
  const count = to - from + 1;
  const coverage =
    "Focus only on the chronological story segment for scenes " + from + "-" + to +
    " of " + total + " (roughly " +
    Math.round(((from - 1) / total) * 100) + "% to " +
    Math.round((to / total) * 100) + "% of the story). ";
  const previous = prevScenes.length
    ? "PREVIOUS SCENES — continue after these events; do not repeat or contradict them:\n" +
      prevScenes.map((scene, i) =>
        (i + 1) + ". " + scene.title + ": " + String(scene.prompt || "").slice(0, 320)
      ).join("\n") + "\n"
    : "";
  const bibleRules = storyBible
    ? "Use the STORY BIBLE as the canonical source for character identity, appearance, clothing, relationships, locations, props and event order. "
    : "No extracted Story Bible is available. Derive character and continuity facts only from explicit statements in the full story; do not invent missing details. ";
  const bibleBlock = storyBible ? JSON.stringify(storyBible) : "Not available; use the full story as source of truth.";
  const schema = style
    ? '{"scenes":[{"title":"Short label","prompt":"Detailed English image prompt"}]}'
    : '{"style":"A shared art-direction and character appearance block","scenes":[{"title":"Short label","prompt":"Detailed English image prompt"}]}';
  return (
    "You are a precise storyboard director. Plan exactly " + count +
    " visually distinct scenes in chronological order. Do not summarize the whole story in every scene. " +
    coverage +
    bibleRules +
    "Never change a character's appearance or clothes unless an explicit event in the story justifies the change. " +
    "Keep important objects with their established owner and do not move characters to a location before the story takes them there. " +
    "Each scene must depict one actual moment from the story, not an invented transition or an event from another part. " +
    previous +
    "STORY BIBLE:\n" + bibleBlock + "\n" +
    (style
      ? "FIXED VISUAL STYLE — reproduce this exact block at the start of every prompt, without changing it: " + style + "\n"
      : "Create one concise shared style block defining recurring character appearance and visual direction.\n") +
    "Return only JSON in this schema: " + schema + ". " +
    "The scenes array must contain exactly " + count + " objects. " +
    "Every prompt must be a complete standalone English image prompt (60-120 words) and repeat the canonical descriptions of all characters visible in that scene, their exact clothing, setting, time/weather, action, mood, lighting and camera framing. " +
    "Use names consistently. Avoid pronouns alone for visual identity. " +
    "Style requirements: " + styleClause + artDirection + styleExtra +
    "No text or lettering in images. Unless explicitly requested, exactly ONE moment in ONE frame, never a grid, collage or comic page. " +
    "\n\nFULL STORY:\n" + String(storyText || "").slice(0, 20000)
  );
}

export function normalizeScenes(parsedPlan, imageCount, sharedStyle = "") {
  const plannedScenes = Array.isArray(parsedPlan)
    ? parsedPlan
    : parsedPlan?.scenes || parsedPlan?.illustrations || parsedPlan?.images;

  if (!Array.isArray(plannedScenes) || plannedScenes.length !== imageCount) {
    throw new Error("L'LLM deve restituire esattamente " + imageCount + " scene.");
  }

  const planStyle =
    !Array.isArray(parsedPlan) && typeof parsedPlan?.style === "string"
      ? parsedPlan.style.trim()
      : "";
  const effectiveStyle = sharedStyle || planStyle || "";
  const fallbackTitles = ["Inizio", "Sviluppo", "Finale", "Epilogo"];
  const scenes = plannedScenes.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error("Scena " + (index + 1) + " non valida.");
    }
    const title = String(item.title || item.scene || fallbackTitles[index] || ("Scena " + (index + 1))).trim();
    let prompt = String(item.prompt || item.image_prompt || "").trim();
    if (effectiveStyle && !prompt.startsWith(effectiveStyle)) prompt = effectiveStyle + " " + prompt;
    return { title, prompt };
  });

  if (scenes.some((scene) =>
    !scene.title || scene.prompt.length < 35 ||
    /^error\b|^nessuna risposta ricevuta/i.test(scene.prompt)
  )) {
    throw new Error("Uno o più prompt delle scene sono vuoti o non validi.");
  }
  return scenes;
}

function localSceneWarnings(scenes) {
  const warnings = [];
  const seen = new Map();
  const seenPrompts = new Map();
  scenes.forEach((scene, index) => {
    const key = String(scene.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (key && seen.has(key)) warnings.push("Titolo duplicato nelle scene " + (seen.get(key) + 1) + " e " + (index + 1) + ".");
    else if (key) seen.set(key, index);
    const promptKey = String(scene.prompt || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (promptKey && seenPrompts.has(promptKey)) warnings.push("Prompt duplicato nelle scene " + (seenPrompts.get(promptKey) + 1) + " e " + (index + 1) + ".");
    else if (promptKey) seenPrompts.set(promptKey, index);
  });
  return warnings;
}

export function buildConsistencyPrompt(storyText, storyBible, scenes) {
  return (
    "You are a strict story continuity and faithfulness editor. Compare every planned scene with the FULL STORY and STORY BIBLE. " +
    "Find only material problems: invented events, wrong chronology, duplicate moments, inconsistent character appearance/clothing, wrong location, missing or misassigned plot-critical objects, or contradictions. " +
    "Return JSON only: {\"corrections\":[{\"index\":1,\"prompt\":\"complete corrected standalone English image prompt\",\"reason\":\"short explanation\"}],\"warnings\":[\"...\" ]}. " +
    "Indexes are 1-based. Include a correction only when a scene is materially wrong. " +
    "A corrected prompt must remain a single-frame visual scene, be independently usable, retain the established visual style, and describe only an event that actually occurs. " +
    "Do not rewrite correct scenes. Do not add events, characters or props. Do not alter the story ending. " +
    "\nSTORY BIBLE:\n" + JSON.stringify(storyBible || {}) +
    "\nFULL STORY:\n" + String(storyText || "").slice(0, 20000) +
    "\nPLANNED SCENES:\n" + JSON.stringify(scenes.map((scene, i) => ({
      index: i + 1, title: scene.title, prompt: scene.prompt,
    })))
  );
}

export function applyConsistencyResult(scenes, result, sharedStyle = "") {
  if (!result || typeof result !== "object" || !Array.isArray(result.corrections)) {
    throw new Error("Risposta consistency checker non valida.");
  }
  const corrected = scenes.map((scene) => ({ ...scene }));
  const used = new Set();
  for (const item of result.corrections) {
    const index = Number(item?.index) - 1;
    const prompt = String(item?.prompt || "").trim();
    if (!Number.isInteger(index) || index < 0 || index >= corrected.length || used.has(index)) continue;
    if (prompt.length < 50 || prompt.length > 2400) continue;
    const finalPrompt = sharedStyle && !prompt.startsWith(sharedStyle) ? sharedStyle + " " + prompt : prompt;
    corrected[index] = { ...corrected[index], prompt: finalPrompt };
    used.add(index);
  }
  return {
    scenes: corrected,
    warnings: (Array.isArray(result.warnings) ? result.warnings : [])
      .map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12),
    correctedCount: used.size,
  };
}

// Crea un job img2img: stessa coda IMAGE_JOBS del txt2img, ma parte da
// un'immagine di riferimento (es. la foto di un personaggio). Il polling
// e' identico a createImageJob (waitForImageResult).
export async function createImg2ImgJob(idToken, imageBlob, prompt, { width, height, steps, seed, strength }) {
  const body = new FormData();
  body.append("image", imageBlob, "reference.png");
  body.append("prompt", prompt);
  body.append("strength", String(strength));
  body.append("width", String(width));
  body.append("height", String(height));
  body.append("steps", String(steps));
  if (seed != null) body.append("seed", String(seed));
  const res = await fetch(`${API}/api/image/img2img`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    body,
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error(res.status === 401 ? "Sessione scaduta: rientra e riprova." : "Accesso non autorizzato (admin)."), { status: res.status });
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch (e) { /* corpo non JSON */ }
    throw new Error(detail);
  }
  const data = await res.json();
  const jobId = data.job_id || data.id;
  if (!jobId) throw new Error("Il gateway non ha restituito job_id per img2img.");
  return jobId;
}

export async function createImageJob(idToken, prompt, opts = {}) {
  const { width = 512, height = 512, steps = 8, seed = -1, preset = "" } = opts;
  const body = { prompt, width, height, steps, seed };
  if (preset) body.preset = preset;
  const created = await apiJson(idToken, "/api/image/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const jobId = created.job_id;
  if (!jobId) throw new Error("Il gateway non ha restituito job_id.");
  return jobId;
}

// Controllo dello stato di un job con retry (rete/Cloudflare instabili).
// onRetry(attempt, attempts) viene chiamato prima di ogni nuova attesa.
export async function fetchJobStatusWithRetry(
  idToken,
  jobId,
  { attempts = 4, timeoutMs = 45000, onRetry } = {}
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await apiJson(
        idToken,
        "/api/image/jobs/" + encodeURIComponent(jobId),
        {},
        timeoutMs
      );
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw err;
      if (/^HTTP \d+/.test(err.message || "")) throw err;
      lastError = err;
      if (attempt < attempts) {
        if (onRetry) onRetry(attempt + 1, attempts);
        await sleep(attempt * 2500);
      }
    }
  }
  throw new Error(
    "Gateway non raggiungibile dopo " + attempts + " tentativi: " +
      (lastError?.message || "errore di rete")
  );
}

// Polling del job fino a risultato (o timeoutMs). Ritorna il JSON
// del /result. onProgress(status, elapsed) a ogni stato intermedio.
export async function waitForImageResult(
  idToken,
  jobId,
  { pollMs = 5000, timeoutMs = 600000, fetchStatus, onProgress } = {}
) {
  const getStatus =
    fetchStatus || ((jid) => fetchJobStatusWithRetry(idToken, jid));
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const job = await getStatus(jobId);
    const status = String(job.status || "").toLowerCase();
    const elapsed = Math.round((Date.now() - t0) / 1000);
    if (["completed", "complete", "succeeded", "success"].includes(status)) {
      return await apiJson(
        idToken,
        "/api/image/jobs/" + encodeURIComponent(jobId) + "/result"
      );
    }
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(job.error || job.message || "Generazione non riuscita.");
    }
    if (onProgress) onProgress(status, elapsed);
  }
  throw new Error("Timeout o risultato senza immagine.");
}

// result -> data URL pronta per <img>.
export function resultToDataUrl(result) {
  if (!result?.image_base64) throw new Error("Timeout o risultato senza immagine.");
  const b64 = String(result.image_base64).replace(/^data:image\/[^;]+;base64,/i, "");
  return "data:image/png;base64," + b64;
}

// Chiamata LLM stateless condivisa: il prompt va dritto a Ollama via gateway.
// keepAlive=0 di default così il planner non lascia il modello in RAM quando
// non serve più (il chiamante può passare keepAlive>0 per tenerlo caldo).
async function callLlmStateless(idToken, prompt, model, timeoutMs = 310000, keepAlive = 45) {
  const data = await apiJson(idToken, "/api/admin/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model, keep_alive: keepAlive, format: "json" }),
  }, timeoutMs);
  return data.answer || "";
}

// Priorità: Mistral come default, Qwen e Llama come fallback leggeri e disponibili.
export const PLANNER_FALLBACK_MODELS = ["qwen2.5", "llama3", "mistral"];

export async function planStoryScenes({
  idToken,
  storyText,
  imageCount,
  artDirection = "",
  styleExtra = "",
  styleClause,
  model,
  fallbackModels = PLANNER_FALLBACK_MODELS,
  onStatus = () => {},
  timeoutMs = 180000,
  storyBible: suppliedBible = null,
  buildBible = false,
  consistencyCheck = false,
  returnMetadata = false,
}) {
  const models = [...new Set([model || "mistral", ...fallbackModels])].filter(Boolean);
  const plannedScenes = [];
  const triedModels = [];
  let sharedStyle = "";
  let storyBible = suppliedBible ? normalizeStoryBible(suppliedBible) : null;
  const bibleWarnings = [];
  let activeModel = models[0] || "mistral";

  if (buildBible && !storyBible) {
    for (const m of models) {
      onStatus({ kind: "bible", model: m });
      try {
        const raw = await callLlmStateless(idToken, buildStoryBiblePrompt(storyText), m, timeoutMs, 45);
        storyBible = normalizeStoryBible(parsePlan(raw));
        activeModel = m;
        break;
      } catch (err) {
      }
    }
    if (!storyBible) {
      // Degradazione controllata: la storia continua a essere illustrabile,
      // ma il warning rende esplicito che la Bible non è stata estratta.
      storyBible = normalizeStoryBible({
        summary: String(storyText || "").slice(0, 1800),
        facts: ["Story Bible automatica non disponibile: usare esclusivamente i fatti espliciti del testo integrale."],
      });
      bibleWarnings.push("Story Bible automatica non generata; continuità ricavata dal testo originale.");
      onStatus({ kind: "warning", message: "Story Bible non generata; uso il testo originale come fonte." });
    }
  }

  const BATCH_SIZE = 3;
  for (let from = 0; from < imageCount; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE, imageCount);
    const batchCount = to - from;
    const previousScenes = plannedScenes.slice(-6).map((scene) => ({
      title: scene.title,
      prompt: scene.prompt,
    }));
    let acceptedScenes = null;
    let lastError = null;

    for (const m of models) {
      if (!triedModels.includes(m)) triedModels.push(m);
      for (let attempt = 0; attempt < 2 && !acceptedScenes; attempt++) {
        onStatus({ kind: "batch", from: from + 1, to, total: imageCount, model: m, attempt });
        const prompt = buildStoryboardBatchPrompt({
          total: imageCount,
          from: from + 1,
          to,
          storyText,
          style: sharedStyle,
          storyBible,
          prevScenes: previousScenes,
          artDirection,
          styleExtra,
          styleClause,
        });
        let raw = "";
        try {
          raw = await callLlmStateless(idToken, prompt, m, timeoutMs, 45);
          const parsed = parsePlan(raw);
          const scenes = normalizeScenes(parsed, batchCount, sharedStyle);
          if (!sharedStyle && parsed && typeof parsed.style === "string") sharedStyle = parsed.style.trim();
          acceptedScenes = scenes;
          activeModel = m;
          break;
        } catch (err) {
          lastError = err;
        }

        if (!raw.trim()) continue;

        // Una sola riparazione mirata per risposta non valida; JSON mode evita
        // la maggior parte dei casi e non sprechiamo chiamate su ogni batch.
        onStatus({ kind: "repair", from: from + 1, to, total: imageCount, model: m, attempt: 1 });
        try {
          const repairedRaw = await callLlmStateless(
            idToken,
            buildRepairPrompt(batchCount, raw, sharedStyle, storyBible),
            m,
            timeoutMs,
            45
          );
          const repairedPlan = parsePlan(repairedRaw);
          const scenes = normalizeScenes(repairedPlan, batchCount, sharedStyle);
          if (!sharedStyle && repairedPlan && typeof repairedPlan.style === "string") {
            sharedStyle = repairedPlan.style.trim();
          }
          acceptedScenes = scenes;
          activeModel = m;
        } catch (repairError) {
          lastError = repairError;
        }
      }
      if (acceptedScenes) break;
    }

    if (!acceptedScenes) {
      throw new Error(
        "Pianificazione scene " + (from + 1) + "-" + to +
        " non riuscita. Modelli provati: " + triedModels.join(", ") +
        ". " + (lastError?.message || "")
      );
    }
    plannedScenes.push(...acceptedScenes);
  }

  let scenes = plannedScenes.slice(0, imageCount);
  let warnings = [...bibleWarnings, ...localSceneWarnings(scenes)];

  if (consistencyCheck && scenes.length) {
    onStatus({ kind: "consistency", model: activeModel });
    try {
      const raw = await callLlmStateless(
        idToken,
        buildConsistencyPrompt(storyText, storyBible, scenes),
        activeModel,
        timeoutMs,
        45
      );
      const checked = applyConsistencyResult(scenes, parsePlan(raw), sharedStyle);
      scenes = checked.scenes;
      warnings = [...warnings, ...checked.warnings];
      onStatus({
        kind: "consistency_done",
        corrected: checked.correctedCount,
        warnings: checked.warnings.length,
      });
    } catch (err) {
      warnings.push("Controllo finale di coerenza non completato: " + String(err?.message || err).slice(0, 180));
      onStatus({ kind: "warning", message: "Controllo finale non disponibile; scene mantenute senza modifiche." });
    }
  }

  if (returnMetadata) {
    return {
      scenes,
      storyBible,
      warnings,
      plannerModel: activeModel,
      sharedStyle,
    };
  }
  return scenes;
}

// Libera la RAM di Ollama prima del loop immagini (keep_alive=0).
// Non blocca le illustrazioni se fallisce: il chiamante fa try/catch.
export async function unloadOllama(idToken) {
  await apiJson(idToken, "/api/admin/ollama/unload", { method: "POST" }, 30000);
}


