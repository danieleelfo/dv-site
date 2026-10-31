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

// ------------------------------------------------------------
// Prompt di pianificazione scene (storyboard planner).
//   artDirection: direzione artistica obbligatoria (kids/genre).
//   styleExtra:   indicazioni di stile libere dell'utente.
//   styleClause:  frase sullo stile nel testo base
//                 (default generico; StoriesTab passa "family-friendly").
// ------------------------------------------------------------
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
    'Return ONLY a valid JSON object, no markdown, no prose, no code fences, in this exact schema: ' +
    '{"style":"A shared art-direction block of 25-45 words pinning the recurring visual style and the physical appearance of every recurring character (age, look, hair, clothing), identical in all scenes","scenes":[{"title":"Short label","prompt":"Detailed English image prompt"}]}. ' +
    "The scenes array must contain exactly " + count + " objects. " +
    "Each prompt must be a complete standalone image prompt of 60-120 words: describe the recurring characters exactly as in the style block, then the setting (place, time of day, weather), the action of this moment, the mood, the lighting, and the camera framing (wide shot, medium shot, close-up). " +
    "Repeat the full character descriptions in every prompt so each image can be generated independently and the characters stay identical across scenes. " +
    "Keep character appearance, clothing, age, and art direction consistent across prompts. Each prompt must follow " +
    styleClause + artDirection + styleExtra +
    "No text or lettering in images. Do not invent events. " +
    "Unless the art direction explicitly requires a multi-panel strip, each image must depict exactly ONE moment in ONE single frame: never a grid, a collage, a comic page, or a stack of multiple images. " +
    "\n\nSTORY:\n" + String(storyText || "").slice(0, 12000)
  );
}

// Prompt di riparazione quando il primo piano non è JSON valido.
export function buildRepairPrompt(count, rawPlan) {
  return (
    "Convert the text below into valid JSON only. Do not add or remove scenes. " +
    'Use exactly this schema: {"scenes":[{"title":"Short label","prompt":"Detailed English image prompt"}]}. ' +
    "There must be exactly " + count + " scenes. Preserve the intended scene details. No markdown or commentary.\n\nTEXT TO CONVERT:\n" +
    String(rawPlan || "").slice(0, 14000)
  );
}

// Prompt di pianificazione A LOTTI: con 8 scene una sola chiamata qwen2.5
// supera i ~100s di Cloudflare (errore "Failed to fetch"): ogni lotto deve
// restare corto e il blocco di stile condiviso viene riportato dai lotti
// successivi così i personaggi restano identici tra le scene.
export function buildStoryboardBatchPrompt({
  total,
  from,
  to,
  storyText,
  style = "",
  prevTitles = [],
  artDirection = "",
  styleExtra = "",
  styleClause = "a consistent style. ",
}) {
  const count = to - from + 1;
  const coverage =
    "Focus on the part of the story between roughly " +
    Math.round(((from - 1) / total) * 100) + "% and " +
    Math.round((to / total) * 100) + "% of the text, from opening to ending. ";
  const context = prevTitles.length
    ? "Scenes already planned (do not repeat them, continue the story forward): " +
      prevTitles.map((t, i) => i + 1 + ". " + t).join("; ") + ". "
    : "";
  const schema = style
    ? '{"scenes":[{"title":"Short label","prompt":"Detailed English image prompt"}]}'
    : '{"style":"A shared art-direction block of 25-45 words pinning the recurring visual style and the physical appearance of every recurring character (age, look, hair, clothing), identical in all scenes","scenes":[{"title":"Short label","prompt":"Detailed English image prompt"}]}';

  return (
    "You are a storyboard planner for an illustrated story. The full storyboard has " + total +
    " scenes in chronological order. Plan ONLY scenes " + from + " to " + to +
    " — exactly " + count + " scenes of the " + total + ", in order. " +
    coverage + context +
    (style
      ? "The visual style is already fixed. Reuse EXACTLY this shared style block as the opening of every scene prompt, unchanged: \"" + style + "\". Return only the scenes array. "
      : "You also define the shared art-direction style block. ") +
    'Return ONLY a valid JSON object, no markdown, no prose, no code fences, in this exact schema: ' + schema + ". " +
    "The scenes array must contain exactly " + count + " objects. " +
    "Each prompt must be a complete standalone image prompt of 60-120 words: describe the recurring characters exactly as defined in the style block, then the setting (place, time of day, weather), the action of this moment, the mood, the lighting, and the camera framing (wide shot, medium shot, close-up). " +
    "Repeat the full character descriptions in every prompt so each image can be generated independently and the characters stay identical across scenes. " +
    "Keep character appearance, clothing, age, and art direction consistent across prompts. Each prompt must follow " +
    styleClause + artDirection + styleExtra +
    "No text or lettering in images. Do not invent events. " +
    "Unless the art direction explicitly requires a multi-panel strip, each image must depict exactly ONE moment in ONE single frame: never a grid, a collage, a comic page, or a stack of multiple images. " +
    "\n\nSTORY:\n" + String(storyText || "").slice(0, 12000)
  );
}

// Normalizza il piano in scene {title, prompt} validando il minimo
// indispensabile. Usato da entrambi i flussi dopo parsePlan/repair.
export function normalizeScenes(parsedPlan, imageCount) {
  const plannedScenes = Array.isArray(parsedPlan)
    ? parsedPlan
    : parsedPlan.scenes || parsedPlan.illustrations || parsedPlan.images;

  if (!Array.isArray(plannedScenes) || plannedScenes.length < imageCount) {
    throw new Error("L'LLM ha restituito meno di " + imageCount + " scene con prompt separati.");
  }

  // Blocco di stile condiviso: se il planner lo restituisce, viene
  // anteposto a ogni prompt di scena così tutte le immagini condividono
  // mondo, personaggi e direzione artistica.
  const planStyle =
    !Array.isArray(parsedPlan) && typeof parsedPlan?.style === "string"
      ? parsedPlan.style.trim()
      : "";

  const fallbackTitles = ["Inizio", "Sviluppo", "Finale", "Epilogo"];
  const scenes = plannedScenes.slice(0, imageCount).map((item, index) => ({
    title: String(item.title || item.scene || fallbackTitles[index]).trim(),
    prompt: (
      (planStyle ? planStyle + " " : "") +
      String(item.prompt || item.image_prompt || "").trim()
    ).trim(),
  }));

  if (
    scenes.some(
      (s) => !s.prompt || /^error\b|^nessuna risposta ricevuta/i.test(s.prompt)
    )
  ) {
    throw new Error("Uno o più prompt delle scene sono vuoti o non validi.");
  }

  return scenes;
}

// ------------------------------------------------------------
// Job immagine sul gateway.
// ------------------------------------------------------------
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
async function callLlmStateless(idToken, prompt, model, timeoutMs = 310000, keepAlive = 0) {
  const data = await apiJson(idToken, "/api/admin/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model, keep_alive: keepAlive }),
  }, timeoutMs);
  return data.answer || "";
}

// Modelli usati come fallback quando il planner principale non produce un
// JSON valido (es. gemma4 va in timeout sulle scene 7-12).
export const PLANNER_FALLBACK_MODELS = ["mistral", "qwen2.5"];

// Pianificazione delle scene di una storia, condivisa da LeleAdmin e ImgLab.
// - A lotti di 3 scene per chiamata (con 12 scene una chiamata unica supera
//   i ~100s di Cloudflare e la run muore prima delle immagini).
// - Per ogni lotto prova max 2 modelli (primario + fallback) e, per modello,
//   fino a 2 chiamate con 2 repair JSON ciascuna.
// - onStatus({kind: "batch"|"repair", from, to, total, model}) per la UI.
// Ritorna l'array di scene normalizzate (slice a imageCount).
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
}) {
  const models = [...new Set([model, ...fallbackModels])].filter(Boolean);
  const BATCH_SIZE = 3;
  const plannedScenes = [];
  const triedModels = [];
  let sharedStyle = "";
  for (let from = 0; from < imageCount; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE, imageCount);
    const batchCount = to - from;
    const prevTitles = plannedScenes.map((s) => s.title);
    let batchError = null;
    for (const m of models) {
      if (!triedModels.includes(m)) triedModels.push(m);
      for (let attempt = 0; attempt < 2; attempt++) {
        onStatus({ kind: "batch", from: from + 1, to, total: imageCount, model: m, attempt });
        const prompt = buildStoryboardBatchPrompt({
          total: imageCount,
          from: from + 1,
          to,
          storyText,
          style: sharedStyle,
          prevTitles,
          artDirection,
          styleExtra,
          styleClause,
        });
        let raw = "";
        let parsedPlan = null;
        try {
          raw = await callLlmStateless(idToken, prompt, m, timeoutMs);
          parsedPlan = parsePlan(raw);
        } catch (err) {
          parsedPlan = null;
        }
        if (parsedPlan && Array.isArray(parsedPlan.scenes) && parsedPlan.scenes.length) {
          const scenes = normalizeScenes(parsedPlan, batchCount);
          if (!sharedStyle && parsedPlan.style) sharedStyle = parsedPlan.style;
          plannedScenes.push(...scenes);
          batchError = null;
          break;
        }
        // Repair JSON: max 2 tentativi per chiamata.
        let repaired = false;
        for (let r = 0; r < 2; r++) {
          onStatus({ kind: "repair", from: from + 1, to, total: imageCount, model: m, attempt: r + 1 });
          try {
            const repairPrompt = buildRepairPrompt(batchCount, raw);
            raw = await callLlmStateless(idToken, repairPrompt, m, timeoutMs);
            const reparsed = parsePlan(raw);
            if (reparsed && Array.isArray(reparsed.scenes) && reparsed.scenes.length) {
              const scenes = normalizeScenes(reparsed, batchCount);
              if (!sharedStyle && reparsed.style) sharedStyle = reparsed.style;
              plannedScenes.push(...scenes);
              repaired = true;
              batchError = null;
              break;
            }
          } catch (err) {
            // passa al repair successivo / modello successivo
          }
        }
        if (repaired) break;
        batchError = new Error(`Ollama non ha prodotto un JSON valido per le scene ${from + 1}-${to} con il modello ${m}.`);
      }
      if (!batchError) break;
    }
    if (batchError) {
      throw new Error(`Ollama non ha prodotto un JSON valido per le scene ${from + 1}-${to} (modelli provati: ${triedModels.join(", ")}).`);
    }
  }
  return plannedScenes.slice(0, imageCount);
}

// Libera la RAM di Ollama prima del loop immagini (keep_alive=0).
// Non blocca le illustrazioni se fallisce: il chiamante fa try/catch.
export async function unloadOllama(idToken) {
  await apiJson(idToken, "/api/admin/ollama/unload", { method: "POST" }, 30000);
}


