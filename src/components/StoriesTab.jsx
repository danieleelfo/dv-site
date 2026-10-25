// src/components/StoriesTab.jsx
// TAB STORIES — Story Whisper con testo + audio TTS + illustrazioni.
// Autonomo: per il merge in ImageLab basta copiare questo file e
// aggiungere il tab (nessuna dipendenza da Test4 oltre a idToken).
//
// Flusso:
//   1. POST /api/chat (agent "Story Whisper", prompt "audio e testo …")
//      -> testo della storia + audio_path (TTS)
//   2. POST /api/admin/llm (STATELESS) -> pianificazione N scene in JSON
//   3. POST /api/admin/ollama/unload -> libera la RAM prima delle immagini
//   4. Loop POST /api/image/jobs + polling (pausa 12s tra scene,
//      1 retry per scena) — stessa logica già collaudata in Test2
//   5. POST /api/admin/stories -> persistenza (testo + audio + job_id)
//
// Storico: GET /api/admin/stories (+ dettaglio, audio, DELETE).
// Le immagini delle scene restano in /api/image/history/{job_id}/image.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  API,
  apiJson,
  authBlobUrl,
  buildRepairPrompt,
  buildStoryboardPrompt,
  createImageJob,
  fetchJobStatusWithRetry,
  normalizeScenes,
  parsePlan,
  resultToDataUrl,
  sleep,
  unloadOllama,
  waitForImageResult,
} from "../lib/imageJobs";
const STORY_AGENT = "Story Whisper";
const CHAT_ID_KEY = "dv_story_chat_id";
const MAX_PROMPT_CHARS = 4000;

function getChatId() {
  try {
    const stored = window.localStorage.getItem(CHAT_ID_KEY);
    if (stored) return parseInt(stored, 10);
    const newId = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
    window.localStorage.setItem(CHAT_ID_KEY, String(newId));
    return newId;
  } catch (e) {
    return Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
  }
}

function formatSeconds(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
}

export default function StoriesTab({ idToken }) {
  const [prompt, setPrompt] = useState("");
  const [imageCount, setImageCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");

  // Storia corrente (appena generata o aperta dallo storico).
  const [current, setCurrent] = useState(null);

  // Storico.
  const [stories, setStories] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");

  const objectUrlsRef = useRef([]);

  // Timer dei secondi di elaborazione dell'immagine corrente.
  const [imgStart, setImgStart] = useState(null);
  const [imgElapsed, setImgElapsed] = useState(0);

  // Rilascio degli objectURL quando il tab si smonta.
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.length = 0;
    };
  }, []);

  // Contatore live 1s mentre il Mac genera l'immagine corrente.
  useEffect(() => {
    if (imgStart == null) return;
    const update = () => setImgElapsed(Math.floor((Date.now() - imgStart) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [imgStart]);

  const trackUrl = (url) => {
    objectUrlsRef.current.push(url);
    return url;
  };

  const loadStories = useCallback(async () => {
    if (!idToken) return;
    setListLoading(true);
    setListError("");
    try {
      const data = await apiJson(idToken, "/api/admin/stories", {}, 60000);
      setStories(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setListError(err.message || String(err));
    } finally {
      setListLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  const openStory = useCallback(async (item) => {
    setError("");
    setStage("");
    try {
      const data = await apiJson(
        idToken,
        "/api/admin/stories/" + encodeURIComponent(item.story_id),
        {},
        60000
      );

      const scenes = await Promise.all(
        (data.scenes || []).map(async (scene) => {
          let src = "";
          if (scene.job_id) {
            try {
              src = trackUrl(
                await authBlobUrl(
                  idToken,
                  "/api/image/history/" + encodeURIComponent(scene.job_id) + "/image"
                )
              );
            } catch (e) {
              // Immagine ripulita dalla history: la scena resta senza anteprima.
            }
          }
          return { ...scene, src, status: "Pronta" };
        })
      );

      let audioUrl = "";
      if (data.has_audio) {
        try {
          audioUrl = trackUrl(
            await authBlobUrl(
              idToken,
              "/api/admin/stories/" + encodeURIComponent(item.story_id) + "/audio"
            )
          );
        } catch (e) {
          /* audio non disponibile: la storia resta leggibile */
        }
      }

      setCurrent({
        story_id: item.story_id,
        prompt: data.prompt || item.prompt,
        text: data.text || "",
        audioUrl,
        scenes,
        createdAt: data.created_at,
      });

      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message || String(err));
    }
  }, [idToken]);

  const deleteStory = useCallback(async (item, event) => {
    event.stopPropagation();
    try {
      await apiJson(
        idToken,
        "/api/admin/stories/" + encodeURIComponent(item.story_id),
        { method: "DELETE" },
        60000
      );
      setCurrent((c) => (c && c.story_id === item.story_id ? null : c));
      loadStories();
    } catch (err) {
      setListError(err.message || String(err));
    }
  }, [idToken, loadStories]);

  // Controllo dello stato di un job con retry (rete/Cloudflare instabili).
  // F2: implementazione condivisa in src/lib/imageJobs.js.
  const fetchJobStatus = useCallback(
    (jobId) =>
      fetchJobStatusWithRetry(idToken, jobId, {
        onRetry: (attempt, attempts) =>
          setStage(
            "🔄 Connessione temporaneamente interrotta — nuovo tentativo " +
              attempt + "/" + attempts + "…"
          ),
      }),
    [idToken]
  );

  async function generateStory(event) {
    event.preventDefault();

    if (!idToken || busy) return;
    if (!prompt.trim()) {
      setError("Scrivi l'idea della storia.");
      return;
    }

    setBusy(true);
    setError("");
    setStage("");
    setCurrent(null);

    const chatId = getChatId();
    let storyText = "";
    let audioFilename = "";
    let savedStoryId = "";

    try {
      // ------------------------------------------------------
      // 1. Storia + TTS da Story Whisper (via /api/chat).
      // ------------------------------------------------------
      setStage("🌈 Story Whisper scrive la storia (testo + audio)…");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 310000);
      let storyData;
      try {
        const res = await fetch(`${API}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            agent: STORY_AGENT,
            prompt: "audio e testo " + prompt.trim(),
            chat_id: chatId,
            language: "it",
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        storyData = await res.json();
      } finally {
        clearTimeout(timer);
      }

      storyText = String(storyData.answer || "").trim();
      if (!storyText) throw new Error("Story Whisper non ha risposto.");
      audioFilename = String(storyData.audio_path || storyData.audio || "").trim();

      let audioUrl = "";
      if (audioFilename) {
        audioUrl =
          `${API}/api/chat/tts/` +
          encodeURIComponent(STORY_AGENT) +
          "/" +
          encodeURIComponent(audioFilename);
      }

      setCurrent({
        story_id: null,
        prompt: prompt.trim(),
        text: storyText,
        audioUrl,
        scenes: [],
        createdAt: Date.now() / 1000,
      });

      // Salva subito testo e audio: un errore successivo sulle immagini
      // non deve cancellare la storia dalla Gallery.
      setStage("💾 Salvo subito testo e audio nello storico…");
      const saved = await apiJson(idToken, "/api/admin/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          text: storyText,
          agent: STORY_AGENT,
          audio_filename: audioFilename,
          language: "it",
          scenes: [],
        }),
      });
      savedStoryId = String(saved.story_id || "");
      if (!savedStoryId) throw new Error("La storia è stata generata ma il gateway non ha restituito story_id per salvarla.");
      setCurrent((c) => c ? { ...c, story_id: savedStoryId } : c);
      await loadStories();

      // ------------------------------------------------------
      // 2. Pianificazione scene STATELESS (/api/admin/llm).
      // ------------------------------------------------------
      setStage("🧠 Pianificazione di " + imageCount + " scene…");

      let rawPlan = String((await apiJson(
          idToken,
          "/api/admin/llm",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: buildStoryboardPrompt({
                count: imageCount,
                storyText,
                styleClause: "a consistent family-friendly storybook style. ",
              }),
              model: "qwen2.5",
              keep_alive: 0,
            }),
          },
          180000
        )).answer || "").trim();

      let parsedPlan;
      try {
        parsedPlan = parsePlan(rawPlan);
      } catch (e) {
        setStage("🧠 Correzione del formato della selezione scene…");
        rawPlan = String((await apiJson(
            idToken,
            "/api/admin/llm",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: buildRepairPrompt(imageCount, rawPlan),
                model: "qwen2.5",
                keep_alive: 0,
              }),
            },
            180000
          )).answer || "").trim();
        try {
          parsedPlan = parsePlan(rawPlan);
        } catch (e2) {
          throw new Error("L'LLM non ha prodotto un JSON valido nemmeno dopo la correzione.");
        }
      }

      const scenes = normalizeScenes(parsedPlan, imageCount);

      // ------------------------------------------------------
      // 3. Libero la RAM di Ollama prima del loop immagini.
      // ------------------------------------------------------
      try {
        setStage("🧹 Libero la RAM usata da Ollama prima delle immagini…");
        await unloadOllama(idToken);
      } catch (e) {
        /* non blocca le illustrazioni */
      }

      // ------------------------------------------------------
      // 4. Loop immagini: un job per volta, pausa 12s, 1 retry.
      // ------------------------------------------------------
      const sceneRetried = new Set();
      const doneScenes = [];

      for (let index = 0; index < scenes.length; index += 1) {
        const scene = scenes[index];
        const sceneNumber = index + 1;
        const total = scenes.length;
        let imageStage = "avvio immagine " + sceneNumber + "/" + total;

        setStage("🎨 Immagine " + sceneNumber + "/" + total + ": " + scene.title + " — in coda…");

        try {
          // F3: lo stile "storia per bambini" è applicato anche dal
          // gateway via preset sw_kids, oltre che dal prompt planner.
          const jobId = await createImageJob(idToken, scene.prompt, {
            preset: "sw_kids",
          });

          const sceneStart = Date.now();
          setImgStart(sceneStart);

          imageStage = "controllo stato immagine " + sceneNumber + "/" + total;
          const result = await waitForImageResult(idToken, jobId, {
            fetchStatus: () => fetchJobStatus(jobId),
            onProgress: (status) =>
              setStage(
                "🎨 Immagine " + sceneNumber + "/" + total + " (" + scene.title + "): " +
                (status === "running" || status === "processing" ? "generazione in corso" : "in coda") + "…"
              ),
          });

          imageStage = "download immagine " + sceneNumber + "/" + total;
          const src = resultToDataUrl(result);

          const sceneSeconds = Math.round((Date.now() - sceneStart) / 1000);
          setImgStart(null);
          doneScenes.push({ ...scene, job_id: jobId, src, seconds: sceneSeconds, status: "Pronta" });
          setStage("✅ Immagine " + sceneNumber + "/" + scenes.length + " pronta in " + formatSeconds(sceneSeconds) + ".");
          setCurrent((c) =>
            c ? { ...c, scenes: doneScenes.map((s) => ({ ...s })) } : c
          );

          if (index < scenes.length - 1) {
            setStage("⏳ Pausa 12s prima dell'immagine successiva (libero la RAM del Mac)…");
            await sleep(12000);
          }
        } catch (err) {
          setImgStart(null);
          if (err.status === 401 || err.status === 403) {
            setError(err.message);
            setBusy(false);
            return;
          }
          if (!sceneRetried.has(sceneNumber)) {
            sceneRetried.add(sceneNumber);
            setStage("🔄 Errore di rete sull'immagine " + sceneNumber + "/" + scenes.length + " — attendo 60s e riprovo la scena…");
            await sleep(60000);
            index -= 1;
            continue;
          }
          // Secondo fallimento: la sequenza si ferma, ma testo+audio restano.
          setError(
            "Immagine " + sceneNumber + "/" + scenes.length + " (" + scene.title + "), " +
            imageStage + ": " + (err.message || "errore sconosciuto")
          );
          break;
        }
      }

      // ------------------------------------------------------
      // 5. Aggiorna la storia già salvata con le illustrazioni riuscite.
      // ------------------------------------------------------
      if (savedStoryId) {
        setStage("💾 Aggiorno lo storico con le illustrazioni…");
        try {
          await apiJson(idToken, "/api/admin/stories/" + encodeURIComponent(savedStoryId), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: prompt.trim(),
              text: storyText,
              agent: STORY_AGENT,
              audio_filename: audioFilename,
              language: "it",
              scenes: doneScenes.map((s) => ({
                title: s.title,
                prompt: s.prompt,
                job_id: s.job_id,
                seconds: s.seconds,
              })),
            }),
          });
          await loadStories();
        } catch (err) {
          setError((prev) => (prev ? prev + " · " : "") + "Storia salvata, ma aggiornamento illustrazioni non riuscito: " + (err.message || err));
          await loadStories();
        }
      }

      setStage("✅ Storia completata.");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      setImgStart(null);
    }
  }

  const sceneCount = current?.scenes?.length || 0;

  return (
    <div>
      <section className="il-panel" style={{ marginBottom: "1rem" }}>
        <div className="il-section-heading">
          <div>
            <p className="il-eyebrow">05 / STORIES</p>
            <h2>Storia con testo, audio e illustrazioni</h2>
          </div>
        </div>

        <form onSubmit={generateStory}>
          <label className="il-label" htmlFor="story-prompt">
            Idea della storia
          </label>
          <textarea
            id="story-prompt"
            className="il-input il-prompt"
            placeholder="Es. Un cane con un cappello da pirata che rincorre una palla per i bar di Barcellona…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            maxLength={MAX_PROMPT_CHARS}
            disabled={busy}
          />
          <div className="il-char-count">
            {prompt.length.toLocaleString()} / {MAX_PROMPT_CHARS.toLocaleString()}
          </div>

          <div className="il-form-grid">
            <div>
              <label className="il-label" htmlFor="story-count">
                Illustrazioni
              </label>
              <select
                id="story-count"
                className="il-input"
                value={imageCount}
                onChange={(event) => setImageCount(Number(event.target.value))}
                disabled={busy}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "immagine" : "immagini"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="il-hint">
            Story Whisper scrive la storia e genera l'audio (TTS); le illustrazioni
            vengono pianificate e generate sul Mac una alla volta, con pausa tra le
            scene per liberare la RAM.
          </p>

          {error && (
            <div className="il-error" role="alert">
              {error}
            </div>
          )}

          <div className="il-actions">
            <button
              className="il-button il-primary"
              type="submit"
              disabled={busy || !prompt.trim()}
            >
              {busy ? "Elaborazione…" : "🌈 Crea storia + illustrazioni →"}
            </button>
          </div>

          {busy && stage && (
            <p className="il-hint" style={{ marginTop: ".6rem" }}>{stage}</p>
          )}

          {busy && imgStart != null && (
            <p className="il-hint" style={{ marginTop: ".35rem" }}>⏱ Elaborazione immagine: {formatSeconds(imgElapsed)}</p>
          )}
        </form>
      </section>

      {current && (
        <section className="il-panel" style={{ marginBottom: "1rem" }}>
          <div className="il-section-heading">
            <div>
              <p className="il-eyebrow">RACCONTO</p>
              <h2>{current.prompt}</h2>
            </div>
            <span className="il-history-meta">
              {new Date((current.createdAt || 0) * 1000).toLocaleString("it-IT")}
            </span>
          </div>

          <pre
            className="il-ocr-pre"
            style={{ maxHeight: "none" }}
          >
            {current.text}
          </pre>

          {current.audioUrl && (
            <div style={{ marginTop: ".9rem" }}>
              <label className="il-label">🎧 Audio</label>
              <audio controls src={current.audioUrl} style={{ width: "100%" }} />
            </div>
          )}

          {sceneCount > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <label className="il-label">🖼 Illustrazioni</label>
              <div className="il-history-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                {current.scenes.map((scene, i) => (
                  <figure key={i} style={{ margin: 0 }}>
                    {scene.src ? (
                      <img
                        src={scene.src}
                        alt={"Illustrazione " + (i + 1) + ": " + scene.title}
                        loading="lazy"
                        style={{
                          display: "block",
                          width: "100%",
                          height: "auto",
                          borderRadius: "8px",
                          border: "1px solid var(--border, #1f2b35)",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          padding: "2.4rem 1rem",
                          textAlign: "center",
                          border: "1px dashed var(--border, #1f2b35)",
                          borderRadius: "8px",
                          color: "var(--ink-dim, #8fa1ac)",
                          fontSize: ".8rem",
                        }}
                      >
                        {scene.status || "In attesa"}
                      </div>
                    )}
                    <figcaption
                      style={{
                        marginTop: ".45rem",
                        color: "var(--ink-dim, #8fa1ac)",
                        fontSize: ".75rem",
                      }}
                    >
                      {(i + 1)}/{sceneCount} · {scene.title}{scene.seconds != null ? " · ⏱ " + formatSeconds(scene.seconds) : ""}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="il-panel il-history-panel">
        <div className="il-section-heading">
          <div>
            <p className="il-eyebrow">06 / GALLERY</p>
            <h2>Storico storie</h2>
          </div>
          <button
            className="il-button"
            onClick={loadStories}
            disabled={listLoading}
          >
            {listLoading ? "Carico…" : "↻ Aggiorna"}
          </button>
        </div>

        {listError && (
          <div className="il-error" role="alert">
            {listError}
          </div>
        )}

        {!listLoading && stories.length === 0 && !listError && (
          <p className="il-hint">
            Nessuna storia salvata. Le storie completate vengono conservate qui
            (testo, audio e illustrazioni).
          </p>
        )}

        <div className="il-history-grid">
          {stories.map((item) => (
            <article
              key={item.story_id}
              className="il-history-card"
              style={{ cursor: "pointer" }}
              onClick={() => openStory(item)}
            >
              <p className="il-history-prompt">
                {String(item.prompt || "").length > 140
                  ? String(item.prompt).slice(0, 140) + "…"
                  : item.prompt}
              </p>
              <div className="il-history-meta">
                <span>{new Date((item.created_at || 0) * 1000).toLocaleString("it-IT")}</span>
                {item.has_audio && <span>🎧 audio</span>}
                <span>{item.scene_count} illustraz.</span>
              </div>
              <div className="il-history-actions">
                <button className="il-button">Apri</button>
                <button
                  className="il-button"
                  onClick={(event) => deleteStory(item, event)}
                  title="Elimina la storia"
                >
                  ✕
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

