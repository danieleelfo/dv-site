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
  createImageJob,
  fetchJobStatusWithRetry,
  planStoryScenes,
  resultToDataUrl,
  sleep,
  unloadOllama,
  waitForImageResult,
} from "../lib/imageJobs";
const STORY_AGENT = "Story Whisper";
const STRIP_MODES = [
    ["", "—"],
    ["2", "2 · affiancate"],
    ["3", "3 · in colonna"],
    ["4", "4 · griglia 2x2"],
  ];

  // Art direction per la fumettatura deliberata: 2 pannelli affiancati,
  // 3 in colonna, 4 in griglia 2x2 (ordine di lettura orizzontale).
  const stripClause = (mode) =>
    mode === "2"
      ? "Each image must be rendered as a comic strip of exactly 2 side-by-side panels with clear panel borders, showing two consecutive micro-moments of this scene, read from left to right. "
      : mode === "3"
        ? "Each image must be rendered as a vertical comic strip of exactly 3 stacked panels with clear panel borders, telling three consecutive micro-moments of this scene from top to bottom. "
        : mode === "4"
          ? "Each image must be rendered as a 2x2 comic grid of exactly 4 panels with clear panel borders, read in horizontal order (top-left, top-right, bottom-left, bottom-right), showing four consecutive micro-moments of this scene. "
          : "";
const CHAT_ID_KEY = "dv_story_chat_id";
const MAX_PROMPT_CHARS = 4000;

// Ricette di stile rapide per la rigenerazione V2+: chip che riempiono
// l'input di stile extra (etichetta IT, prompt EN per il planner).
const REG_STYLE_PRESETS = [
  ["💧 Acquerello", "soft watercolor illustration"],
  ["✏️ Matita colorata", "colored pencil drawing"],
  ["🐱 Cartoon manga", "clean cartoon manga style"],
  ["📷 Fotorealistico", "photorealistic, cinematic lighting"],
];

// Preset di stile base del gateway (F3, lato server):
// - sw_kids: cartoon storybook per bambini (Story Whisper)
// - ns_free: illustrazione artistica per pubblici adulti (Night Story)
// La rigenerazione segue per default l'agente della storia, ma il
// selettore permette di cambiarlo per testare i comportamenti.
const NS_AGENT = "Night Story";
const storyPreset = (agent) => (agent === NS_AGENT ? "ns_free" : "sw_kids");
const PRESET_CLAUSES = {
  sw_kids: "a consistent family-friendly storybook style. ",
  ns_free: "a consistent artistic illustration style for mature audiences. ",
};

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
  // Opzioni del box Audio di LeleAdmin, portate qui: agente (anche
  // Night Story), TTS opzionale, filtro kids, genere NS, stile extra
  // e modello planner della CREAZIONE (prima era fisso qwen2.5).
  const [storyAgent, setStoryAgent] = useState(STORY_AGENT);
  const [wantsTts, setWantsTts] = useState(true);
  const [storyKids, setStoryKids] = useState(true);
  const [storyGenre, setStoryGenre] = useState("Random");
  const [storyStyle, setStoryStyle] = useState("");
  const [storyModel, setStoryModel] = useState("qwen2.5");
  // Fumettatura deliberata: 2 pannelli affiancati, 3 in colonna,
  // 4 in griglia 2x2 (nata dal "bug figo" di mistral).
  const [storyStrip, setStoryStrip] = useState("");
  // Rigenerazione illustrazioni come nuova versione della stessa storia.
  const [regModel, setRegModel] = useState("qwen2.5");
  const [regStyle, setRegStyle] = useState("");
  // regCount = "" significa "come la versione esistente" (default).
  const [regCount, setRegCount] = useState("");
  const [regFormat, setRegFormat] = useState("1024x768");
  const [regSteps, setRegSteps] = useState(8);
  // regPreset = "" significa "come la storia" (sw_kids per Story Whisper,
  // ns_free per Night Story), altrimenti override esplicito per test.
  const [regPreset, setRegPreset] = useState("");
  const [activeVersion, setActiveVersion] = useState(null);
  // 📖 Crea fumetto PDF: opzioni di composizione on-demand.
  const [comicLayout, setComicLayout] = useState("pages");
  const [comicFormat, setComicFormat] = useState("landscape");
  const [comicCaptions, setComicCaptions] = useState(true);
  // Estrai narrazione: estratto del testo della storia accanto a ogni
  // immagine nel PDF (deterministico, lato server).
  const [comicNarration, setComicNarration] = useState(false);
  // Mappa indice-scena -> incluso; assente = incluso (default tutte).
  const [comicScenes, setComicScenes] = useState({});
  const [comicBusy, setComicBusy] = useState(false);
  // Progress della rigenerazione: {done, total} per la barra, e messaggio
  // di fine che resta visibile anche dopo il busy.
  const [regProgress, setRegProgress] = useState(null);
  const [regDone, setRegDone] = useState("");
  // F4-B/C: formato e step delle illustrazioni.
  const [imageFormat, setImageFormat] = useState("1024x768");
  const [imageSteps, setImageSteps] = useState(8);
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
    setActiveVersion(null);
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
        agent: data.agent || STORY_AGENT,
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
      setStage("🌈 " + storyAgent + " scrive la storia" + (wantsTts ? " (testo + audio)" : "") + "…");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 310000);
      let storyData;
      try {
        const res = await fetch(`${API}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            agent: storyAgent,
            prompt: (wantsTts ? "audio e testo " : "") + prompt.trim(),
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
          encodeURIComponent(storyAgent) +
          "/" +
          encodeURIComponent(audioFilename);
      }

      setCurrent({
        story_id: null,
        prompt: prompt.trim(),
        text: storyText,
        agent: storyAgent,
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
          agent: storyAgent,
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
      // 2. Pianificazione scene STATELESS (planStoryScenes condivisa:
      //    lotti di 3, retry + repair, fallback mistral → qwen2.5).
      // ------------------------------------------------------
      // Art direction come nel box LeleAdmin: kids filter per Story
      // Whisper, genere per Night Story, stile extra libero.
      const kidsMode = storyAgent === STORY_AGENT && storyKids;
      const genre = storyAgent === NS_AGENT ? String(storyGenre || "Random").trim() : "";
      const artDirection = kidsMode
        ? "Every image prompt must enforce a colorful cartoon storybook illustration style suitable for young children: safe, wholesome, no violence, no scary or adult content, friendly rounded shapes, bright cheerful lighting. "
        : genre
          ? 'Every image prompt must follow an artistic illustration style that matches the story genre "' + genre + '" (mature audiences, never a children style). '
          : "";
      const styleExtra = storyStyle.trim()
        ? "Additional art direction from the user to apply to every scene: " + storyStyle.trim().slice(0, 500) + ". "
        : "";
      const scenes = await planStoryScenes({
        idToken,
        storyText,
        imageCount,
        artDirection: artDirection + stripClause(storyStrip),
        styleExtra,
        model: storyModel,
        onStatus: (s) => {
          if (s.kind === "batch") {
            setStage("🧠 Ollama seleziona le scene " + s.from + "-" + s.to + " di " + s.total + "… (" + s.model + ")");
          } else if (s.kind === "repair") {
            setStage("🧠 Correzione del formato JSON… (" + s.model + ")");
          }
        },
      });

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
          // F4-B/C: formato e step selezionati dall'utente.
          const [fmtWidth, fmtHeight] = String(imageFormat || "1024x768")
            .split("x")
            .map(Number);
          const sceneSteps = Math.max(1, Math.min(100, Number(imageSteps) || 8));
          const jobId = await createImageJob(idToken, scene.prompt, {
            preset: kidsMode ? "sw_kids" : (genre ? "ns_free" : ""),
            width: fmtWidth,
            height: fmtHeight,
            steps: sceneSteps,
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
              agent: storyAgent,
              audio_filename: audioFilename,
              language: "it",
              scenes: doneScenes.map((s) => ({
                title: s.title,
                prompt: s.prompt,
                job_id: s.job_id,
                seconds: s.seconds,
                version: 1,
                planner: storyModel,
                style_prompt: "",
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

  // 🔁 Rigenera le illustrazioni della storia aperta come NUOVA VERSIONE:
  // stessa storia (testo invariato), nuova selezione scene con modello
  // Ollama a scelta (e un prompt di stile extra opzionale per Z-Image-Turbo),
  // nuovo loop immagini. Le versioni si affiancano nella stessa storia e
  // si scelgono coi badge V1/V2/… — le scene restano nel DB tutte insieme.
  // Il preset di stile base segue l'agente della storia (ns_free per
  // Night Story, sw_kids per Story Whisper), con override dal selettore.
  async function regenerateIllustrations(event) {
    event.preventDefault();
    if (!current?.story_id || !current?.text) return;
    setBusy(true);
    setError("");
    setImgStart(null);
    setRegProgress(null);
    setRegDone("");
    try {
      const storyText = current.text;
      const oldScenes = current.scenes || [];
      const nextVersion =
        oldScenes.reduce(
          (max, s) => Math.max(max, Number(s?.version) || 1),
          0
        ) + 1;
      // Numero di immagini: selettore dedicato, default "come V1".
      const imageN = Math.max(
        1,
        Math.min(12, Number(regCount) || oldScenes.length || imageCount)
      );
      // Preset di stile base: default = quello dell'agente della storia.
      const preset = regPreset || storyPreset(current.agent);

      // 1. Pianificazione scene con modello selezionabile.
      const scenes = await planStoryScenes({
        idToken,
        storyText,
        imageCount: imageN,
        styleExtra: regStyle ? "Additional style requirements: " + regStyle.trim() + ". " : "",
        styleClause: PRESET_CLAUSES[preset] || PRESET_CLAUSES.sw_kids,
        model: regModel,
        onStatus: (s) => {
          if (s.kind === "batch") {
            setStage("🔁 V" + nextVersion + " — Ollama (" + s.model + ") seleziona le scene " + s.from + "-" + s.to + " di " + s.total + "…");
          } else if (s.kind === "repair") {
            setStage("🔁 V" + nextVersion + " — Correzione del formato JSON… (" + s.model + ")");
          }
        },
      });

      // 2. Libero la RAM di Ollama prima delle immagini.
      try {
        setStage("🧹 Libero la RAM usata da Ollama prima delle immagini…");
        await unloadOllama(idToken);
      } catch (e) {
        /* non blocca le illustrazioni */
      }

      // 3. Loop immagini (stessa logica collaudata di generateStory),
      //    con formato e step propri del pannello di rigenerazione.
      const sceneRetried = new Set();
      const doneScenes = [];
      for (let index = 0; index < scenes.length; index += 1) {
        const scene = scenes[index];
        const sceneNumber = index + 1;
        const total = scenes.length;
        let imageStage = "avvio immagine " + sceneNumber + "/" + total;
        setStage("🔁 V" + nextVersion + " — Immagine " + sceneNumber + "/" + total + ": " + scene.title + " — in coda…");
        try {
          const [fmtWidth, fmtHeight] = String(regFormat || "1024x768")
            .split("x")
            .map(Number);
          const sceneSteps = Math.max(1, Math.min(100, Number(regSteps) || 8));
          const jobId = await createImageJob(idToken, scene.prompt, {
            preset,
            width: fmtWidth,
            height: fmtHeight,
            steps: sceneSteps,
          });
          const sceneStart = Date.now();
          setImgStart(sceneStart);
          imageStage = "controllo stato immagine " + sceneNumber + "/" + total;
          const result = await waitForImageResult(idToken, jobId, {
            fetchStatus: () => fetchJobStatus(jobId),
            onProgress: (status) =>
              setStage(
                "🔁 V" + nextVersion + " — Immagine " + sceneNumber + "/" + total + " (" + scene.title + "): " +
                  (status === "running" || status === "processing" ? "generazione in corso" : "in coda") + "…"
              ),
          });
          imageStage = "download immagine " + sceneNumber + "/" + total;
          const src = resultToDataUrl(result);
          const sceneSeconds = Math.round((Date.now() - sceneStart) / 1000);
          setImgStart(null);
          doneScenes.push({
            ...scene,
            job_id: jobId,
            src,
            seconds: sceneSeconds,
            status: "Pronta",
            version: nextVersion,
            planner: regModel,
            style_prompt: regStyle.trim(),
          });
          setRegProgress({ done: doneScenes.length, total: scenes.length });
          setCurrent((c) =>
            c ? { ...c, scenes: [...(c.scenes || []).filter((s) => (Number(s?.version) || 1) !== nextVersion), ...doneScenes.map((s) => ({ ...s }))] } : c
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
          setError(
            "Immagine " + sceneNumber + "/" + scenes.length + " (" + scene.title + "), " +
              imageStage + ": " + (err.message || "errore sconosciuto")
          );
          break;
        }
      }

      // 4. Persistenza: affianca le nuove scene alle vecchie versioni.
      if (doneScenes.length) {
        setStage("💾 Aggiorno lo storico con le illustrazioni V" + nextVersion + "…");
        const oldKept = (current.scenes || []).filter(
          (s) => (Number(s?.version) || 1) !== nextVersion
        );
        await apiJson(idToken, "/api/admin/stories/" + encodeURIComponent(current.story_id), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: current.prompt || "",
            text: storyText,
            agent: current.agent || STORY_AGENT,
            audio_filename: current.audio_filename || "",
            language: "it",
            scenes: [...oldKept, ...doneScenes].map((s) => ({
              title: s.title,
              prompt: s.prompt,
              job_id: s.job_id,
              seconds: s.seconds,
              version: Number(s?.version) || 1,
              planner: s.planner || "",
              style_prompt: s.style_prompt || "",
            })),
          }),
        });
        setCurrent((c) =>
          c ? { ...c, scenes: [...oldKept, ...doneScenes.map((s) => ({ ...s }))] } : c
        );
        setActiveVersion(nextVersion);
        await loadStories();
        const doneMsg = "✅ Versione V" + nextVersion + " pronta (" + doneScenes.length + " illustrazioni con " + regModel + ", preset " + preset + ").";
        setStage(doneMsg);
        setRegDone(doneMsg);
      } else {
        setStage("⏹ Nessuna illustrazione generata per V" + nextVersion + ".");
      }
    } catch (err) {
      setRegDone("");
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      setImgStart(null);
    }
  }

  // 📖 Composizione fumetto on-demand: il gateway genera il PDF con
  // Pillow (leles/core/story_pdf_report) e il browser lo scarica subito.
  async function downloadComicPdf(event) {
    event.preventDefault();
    if (!current?.story_id || comicBusy) return;
    setComicBusy(true);
    setError("");
    try {
      const selected = visibleScenes
        .map((scene, i) => ({ scene, i }))
        .filter(({ i }) => comicScenes[i] !== false)
        .map(({ i }) => i);
      if (!selected.length) throw new Error("Seleziona almeno una scena per il fumetto.");

      const res = await fetch(
        `${API}/api/admin/stories/${encodeURIComponent(current.story_id)}/comic_pdf`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + idToken,
          },
          body: JSON.stringify({
            scene_indexes: selected,
            captions: comicCaptions,
            narration: comicNarration,
            layout: comicLayout,
            page_format: comicFormat,
            version: shownVersion,
          }),
        }
      );
      if (!res.ok) {
        let detail = "HTTP " + res.status;
        try {
          const j = await res.json();
          detail = (j && (j.detail || j.error)) || detail;
          if (typeof detail !== "string") detail = JSON.stringify(detail);
        } catch (e) { /* corpo non JSON */ }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "fumetto_" + current.story_id + "_V" + shownVersion + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setComicBusy(false);
    }
  }

  // Versioni disponibili nella storia aperta (V1, V2, …) e versione visibile.
  const sceneVersion = (s) => Number(s?.version) || 1;
  const versions = [...new Set((current?.scenes || []).map(sceneVersion))].sort((a, b) => a - b);
  const shownVersion = activeVersion && versions.includes(activeVersion)
    ? activeVersion
    : versions[versions.length - 1] || 1;
  const visibleScenes = current?.scenes?.filter((s) => sceneVersion(s) === shownVersion) || [];
  const sceneCount = visibleScenes.length;
  const autoPreset = storyPreset(current?.agent);

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

          <div style={{ display: "flex", flexWrap: "wrap", gap: ".6rem", alignItems: "center", marginBottom: ".6rem" }}>
            <select
              className="il-input"
              value={storyAgent}
              onChange={(event) => setStoryAgent(event.target.value)}
              style={{ flex: "0 0 auto", minWidth: "11rem" }}
              aria-label="Agente della storia"
              disabled={busy}
            >
              <option value="Story Whisper">🌈 Story Whisper</option>
              <option value="Night Story">🌙 Night Story</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: ".35rem", fontSize: ".8rem", color: "var(--ink-dim, #8fa1ac)" }}>
              <input
                type="checkbox"
                checked={wantsTts}
                onChange={(event) => setWantsTts(event.target.checked)}
                disabled={busy}
              />
              🎧 TTS
            </label>
            {storyAgent === STORY_AGENT && (
              <label title="Stile cartoon storybook per bambini (preset sw_kids)">
                <input
                  type="checkbox"
                  checked={storyKids}
                  onChange={(event) => setStoryKids(event.target.checked)}
                  disabled={busy}
                  style={{ verticalAlign: "middle" }}
                />{" "}
                <span style={{ fontSize: ".8rem", color: "var(--ink-dim, #8fa1ac)" }}>🧒 Filtro kids</span>
              </label>
            )}
            {storyAgent === NS_AGENT && (
              <select
                className="il-input"
                value={storyGenre}
                onChange={(event) => setStoryGenre(event.target.value)}
                style={{ flex: "0 0 auto", minWidth: "9rem" }}
                aria-label="Genere (Night Story)"
                disabled={busy}
              >
                {["Random", "Amore", "Comico", "Culturale", "Drammatica", "Horror", "Osè", "Ricerca"].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            )}
            <select
              className="il-input"
              value={storyModel}
              onChange={(event) => setStoryModel(event.target.value)}
              style={{ flex: "0 0 auto", minWidth: "9rem" }}
              aria-label="Modello Ollama per la pianificazione scene"
              disabled={busy}
            >
              {["qwen2.5", "mistral", "llama3", "gemma4", "deepseek-r1"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select
              className="il-input"
              value={storyStrip}
              onChange={(event) => setStoryStrip(event.target.value)}
              style={{ flex: "0 0 auto", minWidth: "10rem" }}
              aria-label="Pannelli fumetto per immagine"
              disabled={busy}
            >
              {STRIP_MODES.map(([value, label]) => (
                <option key={value} value={value}>📚 {label}</option>
              ))}
            </select>
          </div>
          <input
            className="il-input"
            type="text"
            value={storyStyle}
            onChange={(event) => setStoryStyle(event.target.value)}
            placeholder="Stile extra (opzionale): es. acquerello soft, matita colorata, cartoon manga…"
            aria-label="Stile extra per la creazione"
            style={{ marginBottom: ".6rem" }}
            disabled={busy}
          />

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
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "immagine" : "immagini"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="il-label" htmlFor="story-format">
                Formato
              </label>
              <select
                id="story-format"
                className="il-input"
                value={imageFormat}
                onChange={(event) => setImageFormat(event.target.value)}
                disabled={busy}
              >
                {[["512x512", "1:1 · 512"], ["768x768", "1:1 · 768"], ["1024x1024", "1:1 · 1024"], ["768x576", "4:3 · 768"], ["1024x768", "4:3 · 1024"], ["1280x720", "16:9 · 1280"], ["960x640", "3:2 · 960"]].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="il-label" htmlFor="story-steps">
                Step
              </label>
              <select
                id="story-steps"
                className="il-input"
                value={imageSteps}
                onChange={(event) => setImageSteps(Number(event.target.value))}
                disabled={busy}
              >
                {[1, 3, 4, 5, 6, 7, 8, 9, 12, 15].map((s) => (
                  <option key={s} value={s}>
                    {s} step
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

          {current.story_id && (
            <form
              onSubmit={regenerateIllustrations}
              style={{ marginTop: "1rem", padding: ".9rem", border: "1px solid var(--border, #1f2b35)", borderRadius: "8px" }}
            >
              <label className="il-label">🔁 Rigenera illustrazioni (nuova versione)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".6rem", alignItems: "center" }}>
                <select
                  className="il-input"
                  value={regModel}
                  onChange={(event) => setRegModel(event.target.value)}
                  style={{ flex: "0 0 auto", minWidth: "9rem" }}
                  aria-label="Modello Ollama per la nuova versione"
                  disabled={busy}
                >
                  {["qwen2.5", "mistral", "llama3", "gemma4", "deepseek-r1"].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select
                  className="il-input"
                  value={regPreset}
                  onChange={(event) => setRegPreset(event.target.value)}
                  style={{ flex: "0 0 auto", minWidth: "11rem" }}
                  aria-label="Preset di stile base per la nuova versione"
                  disabled={busy}
                >
                  <option value="">Come la storia ({autoPreset})</option>
                  <option value="sw_kids">Kids cartoon (sw_kids)</option>
                  <option value="ns_free">Adulta (ns_free)</option>
                </select>
                <select
                  className="il-input"
                  value={regCount}
                  onChange={(event) => setRegCount(event.target.value ? Number(event.target.value) : "")}
                  style={{ flex: "0 0 auto", minWidth: "10rem" }}
                  aria-label="Numero di illustrazioni per la nuova versione"
                  disabled={busy}
                >
                  <option value="">Come V{shownVersion} ({sceneCount})</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                    <option key={n} value={n}>{n} {n === 1 ? "immagine" : "immagini"}</option>
                  ))}
                </select>
                <select
                  className="il-input"
                  value={regFormat}
                  onChange={(event) => setRegFormat(event.target.value)}
                  style={{ flex: "0 0 auto", minWidth: "9rem" }}
                  aria-label="Formato immagini per la nuova versione"
                  disabled={busy}
                >
                  {[["512x512", "1:1 · 512"], ["768x768", "1:1 · 768"], ["1024x1024", "1:1 · 1024"], ["768x576", "4:3 · 768"], ["1024x768", "4:3 · 1024"], ["1280x720", "16:9 · 1280"], ["960x640", "3:2 · 960"]].map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <select
                  className="il-input"
                  value={regSteps}
                  onChange={(event) => setRegSteps(Number(event.target.value))}
                  style={{ flex: "0 0 auto", minWidth: "7rem" }}
                  aria-label="Step di generazione per la nuova versione"
                  disabled={busy}
                >
                  {[1, 3, 4, 5, 6, 7, 8, 9, 12, 15].map((s) => (
                    <option key={s} value={s}>{s} step</option>
                  ))}
                </select>
                <button className="il-button" type="submit" disabled={busy || !current.text}>
                  {busy ? "Lavoro in corso…" : "🔁 Rigenera come V" + ((versions[versions.length - 1] || 0) + 1)}
                </button>
              </div>

              {/* Progress live della rigenerazione, qui dove l'hai avviata */}
              {busy && regProgress && (
                <div style={{ marginTop: ".7rem" }}>
                  <div style={{ height: "6px", borderRadius: "3px", background: "var(--border, #1f2b35)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: (regProgress.total ? (100 * regProgress.done) / regProgress.total : 0) + "%",
                        height: "100%",
                        background: "var(--accent, #3fd0c9)",
                        transition: "width .4s ease",
                      }}
                    />
                  </div>
                  <p className="il-hint" style={{ margin: ".45rem 0 0" }}>
                    Scene pronte: {regProgress.done}/{regProgress.total}
                  </p>
                </div>
              )}
              {busy && stage && (
                <p className="il-hint" style={{ margin: ".45rem 0 0" }}>{stage}</p>
              )}
              {busy && imgStart != null && (
                <p className="il-hint" style={{ margin: ".25rem 0 0" }}>⏱ Immagine corrente: {formatSeconds(imgElapsed)}</p>
              )}
              {!busy && regDone && (
                <p className="il-hint" style={{ margin: ".45rem 0 0", color: "var(--accent, #3fd0c9)" }}>{regDone}</p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem", marginTop: ".6rem" }}>
                <input
                  className="il-input"
                  type="text"
                  value={regStyle}
                  onChange={(event) => setRegStyle(event.target.value)}
                  placeholder="Es. acquerello soft, matita colorata, cartoon manga…"
                  style={{ flex: "1 1 14rem" }}
                  aria-label="Stile extra per la nuova versione"
                  disabled={busy}
                />
                {REG_STYLE_PRESETS.map(([label, value]) => (
                  <button
                    key={label}
                    type="button"
                    className={"il-page-btn" + (regStyle === value ? " il-page-btn-active" : "")}
                    onClick={() => setRegStyle(regStyle === value ? "" : value)}
                    style={{ padding: ".2rem .6rem" }}
                    title={"Stile: " + value}
                    disabled={busy}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="il-hint" style={{ marginTop: ".5rem", marginBottom: 0 }}>
                Stessa storia, nuova selezione scene e nuove immagini (ora vedi V{shownVersion}).
                Stile base {regPreset || autoPreset} ({(regPreset || autoPreset) === "ns_free" ? "Night Story" : "Story Whisper"}), modificabile sopra per test.
                Se il modello scelto non produce JSON validi, riprova in cascata con mistral → qwen2.5.
              </p>
            </form>
          )}

          {current.story_id && sceneCount > 0 && (
            <form
              onSubmit={downloadComicPdf}
              style={{ marginTop: "1rem", padding: ".9rem", border: "1px solid var(--border, #1f2b35)", borderRadius: "8px" }}
            >
              <label className="il-label">📖 Crea fumetto PDF (V{shownVersion})</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".6rem", alignItems: "center" }}>
                <select
                  className="il-input"
                  value={comicLayout}
                  onChange={(event) => setComicLayout(event.target.value)}
                  style={{ flex: "0 0 auto", minWidth: "11rem" }}
                  aria-label="Layout del fumetto"
                  disabled={comicBusy}
                >
                  <option value="pages">Pagine (1 scena per pagina)</option>
                  <option value="collage">Collage (griglia 2×2)</option>
                  <option value="strip">Striscia unica verticale</option>
                </select>
                <select
                  className="il-input"
                  value={comicFormat}
                  onChange={(event) => setComicFormat(event.target.value)}
                  style={{ flex: "0 0 auto", minWidth: "10rem" }}
                  aria-label="Formato pagina"
                  disabled={comicBusy}
                >
                  <option value="landscape">A4 orizzontale</option>
                  <option value="portrait">A4 verticale</option>
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: ".35rem", fontSize: ".8rem", color: "var(--ink-dim, #8fa1ac)" }}>
                  <input
                    type="checkbox"
                    checked={comicCaptions}
                    onChange={(event) => setComicCaptions(event.target.checked)}
                    disabled={comicBusy}
                  />
                  Didascalie
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: ".35rem", fontSize: ".8rem", color: "var(--ink-dim, #8fa1ac)" }}>
                  <input
                    type="checkbox"
                    checked={comicNarration}
                    onChange={(event) => setComicNarration(event.target.checked)}
                    disabled={comicBusy}
                  />
                  📜 Estrai narrazione
                </label>
                <button className="il-button il-primary" type="submit" disabled={comicBusy}>
                  {comicBusy ? "Compongo…" : "📖 Genera e scarica PDF"}
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem", marginTop: ".6rem" }}>
                {visibleScenes.map((scene, i) => (
                  <label
                    key={i}
                    className={"il-page-btn" + (comicScenes[i] !== false ? " il-page-btn-active" : "")}
                    style={{ padding: ".2rem .6rem", display: "flex", alignItems: "center", gap: ".3rem", cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={comicScenes[i] !== false}
                      onChange={(event) => setComicScenes((prev) => ({ ...prev, [i]: event.target.checked }))}
                      disabled={comicBusy}
                    />
                    {i + 1} · {String(scene.title || "").slice(0, 24)}
                  </label>
                ))}
              </div>
              <p className="il-hint" style={{ marginTop: ".5rem", marginBottom: 0 }}>
                Il PDF si compone sul Mac dalle illustrazioni V{shownVersion} e si scarica subito nel browser (niente Telegram).
              </p>
            </form>
          )}

          {versions.length > 1 && (
            <div style={{ marginTop: ".6rem", display: "flex", gap: ".4rem", alignItems: "center", flexWrap: "wrap" }}>
              <span className="il-label" style={{ margin: 0 }}>Versioni illustrazioni:</span>
              {versions.map((v) => {
                const vScene = (current?.scenes || []).find((s) => sceneVersion(s) === v);
                const vTitle = "V" + v +
                  (vScene?.planner ? " · planner: " + vScene.planner : "") +
                  (vScene?.style_prompt ? " · stile: " + vScene.style_prompt : "");
                return (
                  <button
                    key={v}
                    type="button"
                    className={"il-page-btn" + (v === shownVersion ? " il-page-btn-active" : "")}
                    onClick={() => setActiveVersion(v)}
                    style={{ padding: ".2rem .6rem" }}
                    title={vTitle}
                  >
                    V{v}
                  </button>
                );
              })}
            </div>
          )}

          {sceneCount > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <label className="il-label">🖼 Illustrazioni</label>
              <div className="il-history-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                {visibleScenes.map((scene, i) => (
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
