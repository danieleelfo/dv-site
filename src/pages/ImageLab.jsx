// src/pages/ImageLab.jsx
// AI IMAGE LAB — fusione di Test4 (txt2img + history + OCR) e Test5 (img2img)
// ============================================================
// AI IMAGE LAB — Z-Image-Turbo
//
// Frontend per la generazione asincrona di immagini sul Mac.
//
// API previste sul gateway:
//   POST /api/image/jobs
//       { prompt, width, height, steps, seed }
//       -> { job_id, status }
//
//   GET /api/image/jobs/{job_id}
//       -> { job_id, status, progress?, error? }
//
//   GET /api/image/jobs/{job_id}/result
//       -> { image_base64, seed, width, height }
//
// AUTH: stesso login Google di Improve.jsx.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

const API = "https://api.danielevillanova.com";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_STORAGE_KEY = "dv_google_id_token";

const POLL_INTERVAL = 5000;

// Griglia identica a RESOLUTION_OPTIONS dell'app Gradio (main.py):
// cosi' il gateway non deve snappare e l'output ha ESATTAMENTE
// le dimensioni scelte. Struttura: categoria -> [ [label, w, h], ... ]
const GRADIO_FORMATS = {
  512: [["512 × 512 (1:1)", 512, 512], ["640 × 384 (5:3)", 640, 384], ["384 × 640 (3:5)", 384, 640], ["512 × 384 (4:3)", 512, 384], ["384 × 512 (3:4)", 384, 512], ["640 × 368 (16:9)", 640, 368], ["368 × 640 (9:16)", 368, 640]],
  768: [["768 × 768 (1:1)", 768, 768], ["960 × 576 (5:3)", 960, 576], ["576 × 960 (3:5)", 576, 960], ["768 × 576 (4:3)", 768, 576], ["576 × 768 (3:4)", 576, 768], ["960 × 544 (16:9)", 960, 544], ["544 × 960 (9:16)", 544, 960]],
  1024: [["1024 × 1024 (1:1)", 1024, 1024], ["1280 × 768 (5:3)", 1280, 768], ["768 × 1280 (3:5)", 768, 1280], ["1024 × 768 (4:3)", 1024, 768], ["768 × 1024 (3:4)", 768, 1024], ["1280 × 720 (16:9)", 1280, 720], ["720 × 1280 (9:16)", 720, 1280], ["1024 × 576 (16:9)", 1024, 576], ["576 × 1024 (9:16)", 576, 1024]],
  1280: [["1280 × 1280 (1:1)", 1280, 1280], ["1536 × 1024 (3:2)", 1536, 1024], ["1024 × 1536 (2:3)", 1024, 1536], ["1536 × 864 (16:9)", 1536, 864], ["864 × 1536 (9:16)", 864, 1536]],
};

function parseJwt(token) {
  try {
    const base64 = token
      .split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

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
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    return isTokenValid(token) ? token : null;
  } catch {
    return null;
  }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (minutes === 0) return `${remainingSeconds} s`;

  return `${minutes} min ${String(remainingSeconds).padStart(2, "0")} s`;
}

function normalizeStatus(value) {
  return String(value || "").toLowerCase();
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : data.detail
          ? JSON.stringify(data.detail)
          : `HTTP ${response.status}`;

    throw new Error(detail);
  }

  return data;
}

export default function ImageLab() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const loginButtonRef = useRef(null);
  const pollControllerRef = useRef(null);
  const startedAtRef = useRef(null);

  const [idToken, setIdToken] = useState(readStoredToken);
  const [email, setEmail] = useState("");

  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState(512);
  const [formatIdx, setFormatIdx] = useState(0);
  const formats = GRADIO_FORMATS[size] || GRADIO_FORMATS[512];
  const dimensions = formats[Math.min(formatIdx, formats.length - 1)].slice(1);
  const [steps, setSteps] = useState(8);
  const [randomSeed, setRandomSeed] = useState(true);
  const [seed, setSeed] = useState("12345");

  const [tab, setTab] = useState("genera");
  const [initFile, setInitFile] = useState(null);
  const [initPreview, setInitPreview] = useState("");
  const [strength, setStrength] = useState(0.65);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [usedSeed, setUsedSeed] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState(null);

  const busy = ["submitting", "queued", "running"].includes(status);


  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyPreview, setHistoryPreview] = useState(null);

  const totalPages = Math.max(1, Math.ceil(history.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = history.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const [ocrImage, setOcrImage] = useState(null);
  const [ocrStatus, setOcrStatus] = useState("idle");
  const [ocrText, setOcrText] = useState("");
  const [ocrError, setOcrError] = useState("");
  const [jcsInterpretation, setJcsInterpretation] = useState("");

  // ----------------------------------------------------------
  // Google login condiviso con Improve.jsx
  // ----------------------------------------------------------

  useEffect(() => {
    function onStorage(event) {
      if (event.key !== TOKEN_STORAGE_KEY) return;

      const token =
        event.newValue && isTokenValid(event.newValue)
          ? event.newValue
          : null;

      setIdToken(token);
    }

    window.addEventListener("storage", onStorage);

    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!idToken) {
      setEmail("");
      return;
    }

    setEmail(parseJwt(idToken)?.email || "");
  }, [idToken]);

  useEffect(() => {
    if (idToken || !GOOGLE_CLIENT_ID) return;

    let cancelled = false;
    let attempts = 0;
    let timer;

    function initializeGoogle() {
      if (cancelled) return;

      if (!window.google?.accounts?.id) {
        if (++attempts < 80) {
          timer = window.setTimeout(initializeGoogle, 150);
        }
        return;
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          const token = response?.credential;

          if (!token || !isTokenValid(token)) return;

          try {
            localStorage.setItem(TOKEN_STORAGE_KEY, token);
          } catch {
            // Lo stato della pagina viene comunque aggiornato.
          }

          setIdToken(token);
        },
      });

      if (loginButtonRef.current) {
        loginButtonRef.current.innerHTML = "";

        window.google.accounts.id.renderButton(loginButtonRef.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "signin_with",
        });
      }
    }

    initializeGoogle();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [idToken]);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.google?.accounts?.id?.disableAutoSelect?.();
    } catch {
      // Nessuna azione necessaria.
    }

    setIdToken(null);
  }, []);

  // ----------------------------------------------------------
  // History delle generazioni (persistente sul gateway)
  // ----------------------------------------------------------

  const loadHistory = useCallback(async () => {
    if (!idToken) return;

    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await fetch(`${API}/api/image/history`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      const data = await readResponse(response);
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setHistoryError(err.message || String(err));
    } finally {
      setHistoryLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    if (idToken) loadHistory();
  }, [idToken, loadHistory]);

  // Ricarica la history dopo una generazione completata.
  useEffect(() => {
    if (status === "completed") loadHistory();
  }, [status, loadHistory]);

  const openHistoryItem = useCallback(async (item) => {
    setHistoryError("");

    try {
      const response = await fetch(
        `${API}/api/image/history/${encodeURIComponent(item.job_id)}/image`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      setHistoryPreview({ item, url: URL.createObjectURL(blob) });
    } catch (err) {
      setHistoryError(err.message || String(err));
    }
  }, [idToken]);

  const closeHistoryPreview = useCallback(() => {
    setHistoryPreview((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  // ----------------------------------------------------------
  // OCR — estrazione testo da foto (Qwen-VL via gateway)
  // ----------------------------------------------------------

  const onOcrFile = useCallback((event) => {
    const file = event.target.files?.[0];

    setOcrText("");
    setOcrError("");
    setJcsInterpretation("");

    if (!file) {
      setOcrImage(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setOcrError(t("img.notAnImage"));
      setOcrImage(null);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setOcrError(t("img.tooLarge", { max: 10 }));
      setOcrImage(null);
      return;
    }

    setOcrImage(file);
  }, []);

  async function runOcr(event) {
    event.preventDefault();

    setOcrError("");
    setOcrText("");

    if (!ocrImage || !idToken) return;

    setOcrStatus("running");

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(t("img.readFailed")));
        reader.readAsDataURL(ocrImage);
      });

      const response = await fetch(`${API}/api/vision/ocr`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ image_base64: base64 }),
      });

      const data = await readResponse(response);
      setOcrText(data.text || "");
      setJcsInterpretation(data.is_jcs ? data.jcs || "" : "");
      setOcrStatus("done");
    } catch (err) {
      setOcrError(err.message || String(err));
      setOcrStatus("error");
    }
  }

  function copyOcrText() {
    if (!ocrText) return;
    navigator.clipboard?.writeText(ocrText);
  }

  const reuseHistoryParams = useCallback((item) => {
    setPrompt(item.prompt || "");

    if (Number.isFinite(item.seed)) {
      setSeed(String(item.seed));
      setRandomSeed(false);
    }

    if (Number.isFinite(item.steps)) setSteps(item.steps);

    for (const [cat, list] of Object.entries(GRADIO_FORMATS)) {
      const idx = list.findIndex(
        (f) => f[1] === item.width && f[2] === item.height
      );
      if (idx >= 0) {
        setSize(Number(cat));
        setFormatIdx(idx);
        break;
      }
    }

    closeHistoryPreview();
    setTab("genera");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [closeHistoryPreview]);

  // ----------------------------------------------------------
  // Pulizia del polling se la pagina viene chiusa o smontata
  // ----------------------------------------------------------

  useEffect(() => {
    return () => {
      pollControllerRef.current?.abort();
    };
  }, []);

  // ----------------------------------------------------------
  // Timer della generazione
  // ----------------------------------------------------------

  useEffect(() => {
    if (!busy || !startedAt) return;

    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    };

    updateElapsed();

    const timer = window.setInterval(updateElapsed, 1000);

    return () => window.clearInterval(timer);
  }, [busy, startedAt]);

  // ----------------------------------------------------------
  // Polling asincrono
  // ----------------------------------------------------------

  useEffect(() => {
    if (!jobId || !idToken) return;

    const controller = new AbortController();
    pollControllerRef.current = controller;

    let cancelled = false;
    let timer = null;

    async function poll() {
      if (cancelled || controller.signal.aborted) return;

      try {
        const response = await fetch(
          `${API}/api/image/jobs/${encodeURIComponent(jobId)}`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
            signal: controller.signal,
          }
        );

        const data = await readResponse(response);

        if (cancelled) return;

        const nextStatus = normalizeStatus(data.status);

        setProgress(
          Number.isFinite(data.progress)
            ? Math.max(0, Math.min(100, data.progress))
            : null
        );

        if (data.error) {
          setError(String(data.error));
        }

        if (
          ["queued", "pending", "starting"].includes(nextStatus)
        ) {
          setStatus("queued");
        } else if (
          ["running", "processing"].includes(nextStatus)
        ) {
          setStatus("running");
        } else if (
          ["completed", "complete", "succeeded", "success"].includes(
            nextStatus
          )
        ) {
          setStatus("loading-result");

          const resultResponse = await fetch(
            `${API}/api/image/jobs/${encodeURIComponent(jobId)}/result`,
            {
              headers: {
                Authorization: `Bearer ${idToken}`,
              },
              signal: controller.signal,
            }
          );

          const result = await readResponse(resultResponse);

          if (cancelled) return;

          if (!result.image_base64) {
            throw new Error(
              t("img.jobNoImage")
            );
          }

          const base64 = String(result.image_base64).replace(
            /^data:image\/png;base64,/i,
            ""
          );

          setImageUrl(`data:image/png;base64,${base64}`);
          setUsedSeed(result.seed ?? null);
          setProgress(100);
          setStatus("completed");
          return;
        } else if (
          ["failed", "error", "cancelled", "canceled"].includes(nextStatus)
        ) {
          setStatus("error");

          if (!data.error) {
            setError(t("img.genFailed"));
          }

          return;
        } else {
          throw new Error(
            t("img.unknownStatus", { status: data.status || t("img.empty") })
          );
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;

        // Un errore di rete temporaneo non interrompe subito il lavoro.
        setError(
          t("img.connRetry", { message: err.message || String(err) })
        );
      }

      if (!cancelled && !controller.signal.aborted) {
        timer = window.setTimeout(poll, POLL_INTERVAL);
      }
    }

    poll();

    return () => {
      cancelled = true;

      if (timer) window.clearTimeout(timer);

      controller.abort();

      if (pollControllerRef.current === controller) {
        pollControllerRef.current = null;
      }
    };
  }, [jobId, idToken]);

  // ----------------------------------------------------------
  // Selezione immagine originale (img2img)
  // ----------------------------------------------------------

  function pickInitFile(file) {
    setInitPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });

    if (!file) {
      setInitFile(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError(t("img.notAnImage"));
      setInitFile(null);
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setError(t("img.tooLarge", { max: 15 }));
      setInitFile(null);
      return;
    }

    setError("");
    setInitFile(file);
    setInitPreview(URL.createObjectURL(file));
  }

  // ----------------------------------------------------------
  // Generazione
  // ----------------------------------------------------------

  async function generateImage(event) {
    event.preventDefault();

    setError("");
    setImageUrl("");
    setUsedSeed(null);
    setProgress(null);
    setJobId("");
    setElapsed(0);

    if (!prompt.trim() && !initFile) {
      setError(
        t("img.promptOrImage")
      );
      return;
    }

    // dimensions = [width, height] dal formato Gradio selezionato
    const [outWidth, outHeight] = dimensions;

    const selectedSeed = randomSeed
      ? Math.floor(Math.random() * (2 ** 31 - 1))
      : Number(seed);

    if (
      !Number.isSafeInteger(selectedSeed) ||
      selectedSeed < 0 ||
      selectedSeed > 2147483647
    ) {
      setError(t("img.seedRange"));
      return;
    }

    setStatus("submitting");

    const now = Date.now();

    startedAtRef.current = now;
    setStartedAt(now);

    try {
      let response;

      if (initFile) {
        // img2img: immagine originale + prompt + forza di trasformazione
        const body = new FormData();

        body.append("image", initFile);
        body.append("prompt", prompt.trim());
        body.append("strength", String(strength));
        body.append("width", String(outWidth));
        body.append("height", String(outHeight));
        body.append("steps", String(Number(steps)));
        body.append("seed", String(selectedSeed));

        response = await fetch(`${API}/api/image/img2img`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
          body,
        });
      } else {
        response = await fetch(`${API}/api/image/jobs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            prompt: prompt.trim(),
            width: outWidth,
            height: outHeight,
            steps: Number(steps),
            seed: selectedSeed,
          }),
        });
      }

      const data = await readResponse(response);

      if (!data.job_id) {
        throw new Error(t("img.noJobId"));
      }

      setProgress(
        Number.isFinite(data.progress) ? data.progress : 0
      );

      setStatus("queued");
      setJobId(String(data.job_id));
    } catch (err) {
      setStatus("error");
      setError(err.message || String(err));
    }
  }

  function downloadImage() {
    if (!imageUrl) return;

    const link = document.createElement("a");

    link.href = imageUrl;
    link.download = `z-image-${usedSeed ?? "generated"}.png`;

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function startAnotherVersion() {
    setImageUrl("");
    setUsedSeed(null);
    setError("");
    setProgress(null);
    setJobId("");
    setStatus("idle");
    setElapsed(0);
    setStartedAt(null);

    // Il prompt e le altre impostazioni vengono conservati.
  }

  // ----------------------------------------------------------
  // Login richiesto
  // ----------------------------------------------------------

  if (!idToken) {
    return (
      <main className="il-page">
        <div className="il-container">
          <header className="il-header">
            <div>
              <p className="il-eyebrow">D. VILLANOVA · AI SYSTEMS</p>
              <h1>AI Image Lab</h1>
            </div>
            <button
              className="il-button"
              onClick={() => navigate("/improve")}
            >
              ← Improve
            </button>
          </header>

          <section className="il-panel il-login">
            <h2>{t("img.loginTitle")}</h2>
            <p>
              {t("img.loginHint")}
            </p>

            {!GOOGLE_CLIENT_ID && (
              <p className="il-error">
                {t("img.clientIdMissing")}
              </p>
            )}

            <div ref={loginButtonRef} />
          </section>
        </div>

        <style>{STYLES}</style>
      </main>
    );
  }

  // ----------------------------------------------------------
  // Pagina principale — tab GENERA / STORICO / OCR
  // ----------------------------------------------------------

  return (
    <main className="il-page">
      <div className="il-container">
        <header className="il-header">
          <div>
            <p className="il-eyebrow">D. VILLANOVA · AI SYSTEMS</p>
            <h1>AI Image Lab</h1>
            <p className="il-subtitle">
              {t("img.subtitle")}
            </p>
          </div>

          <div className="il-account">
            <span title={email}>{email}</span>

            <button
              className="il-button"
              onClick={() => navigate("/improve")}
            >
              Improve ↗
            </button>

            <button className="il-button" onClick={logout}>
              {t("img.logout")}
            </button>
          </div>
        </header>

        <div className="il-notice">
          <span className="il-status-dot" />
          {t("img.notice")}
        </div>

        <div className="il-tabs" role="tablist">
          <button
            type="button"
            className={"il-tab" + (tab === "genera" ? " il-tab-active" : "")}
            onClick={() => setTab("genera")}
          >
            {t("img.tabGenera")}
          </button>
          <button
            type="button"
            className={"il-tab" + (tab === "storico" ? " il-tab-active" : "")}
            onClick={() => {
              setTab("storico");
              loadHistory();
            }}
          >
            {t("img.tabStorico")}
          </button>
          <button
            type="button"
            className={"il-tab" + (tab === "ocr" ? " il-tab-active" : "")}
            onClick={() => setTab("ocr")}
          >
            📄 OCR
          </button>
        </div>

        {tab === "genera" && (
          <div className="il-layout">
            <section className="il-panel">
              <div className="il-section-heading">
                <div>
                  <p className="il-eyebrow">01 / PROMPT</p>
                  <h2>{initFile ? t("img.editTitle") : t("img.createTitle")}</h2>
                </div>
              </div>

              <form onSubmit={generateImage}>
                <div className="il-upload">
                  <label className="il-label" htmlFor="il-init-file">
                    {initFile
                      ? t("img.imgLabel")
                      : t("img.imgLabelOptional")}
                  </label>

                  <div className="il-init-row">
                    <input
                      id="il-init-file"
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        pickInitFile(event.target.files?.[0] || null)
                      }
                      disabled={busy}
                    />

                    {initPreview && (
                      <>
                        <img
                          className="il-init-preview"
                          src={initPreview}
                          alt={t("img.altInit")}
                        />
                        <button
                          className="il-button"
                          type="button"
                          onClick={() => pickInitFile(null)}
                          disabled={busy}
                        >
                          {t("img.remove")}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {initFile && (
                  <div className="il-strength">
                    <label className="il-label" htmlFor="il-strength">
                      {t("img.strengthLabel")} {strength.toFixed(2)} ·{" "}
                      {strength < 0.35
                        ? t("img.strengthMore")
                        : strength > 0.7
                          ? t("img.strengthLess")
                          : t("img.strengthBalanced")}
                    </label>
                    <input
                      id="il-strength"
                      className="il-range"
                      type="range"
                      min="0.15"
                      max="0.95"
                      step="0.05"
                      value={strength}
                      onChange={(event) =>
                        setStrength(Number(event.target.value))
                      }
                      disabled={busy}
                    />
                  </div>
                )}

                <label className="il-label" htmlFor="il-prompt">
                  {initFile ? t("img.editPromptLabel") : t("img.promptLabel")}
                </label>

                <textarea
                  id="il-prompt"
                  className="il-input il-prompt"
                  placeholder={
                    initFile
                      ? t("img.placeholderEdit")
                      : t("img.placeholderCreate")
                  }
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={6}
                  maxLength={12000}
                  disabled={busy}
                />

                <div className="il-char-count">
                  {prompt.length.toLocaleString()} / 12.000
                </div>

                <div className="il-form-grid">
                  <div>
                    <label className="il-label" htmlFor="il-category">
                      {t("img.category")}
                    </label>

                    <select
                      id="il-category"
                      className="il-input"
                      value={size}
                      onChange={(event) => {
                        setSize(Number(event.target.value));
                        setFormatIdx(0);
                      }}
                      disabled={busy}
                    >
                      {Object.keys(GRADIO_FORMATS).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="il-label" htmlFor="il-format">
                      {t("img.format")}
                    </label>

                    <select
                      id="il-format"
                      className="il-input"
                      value={formatIdx}
                      onChange={(event) =>
                        setFormatIdx(Number(event.target.value))
                      }
                      disabled={busy}
                    >
                      {formats.map((f, i) => (
                        <option key={f[0]} value={i}>
                          {f[0]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="il-label" htmlFor="il-steps">
                      {t("img.steps")}
                    </label>

                    <select
                      id="il-steps"
                      className="il-input"
                      value={steps}
                      onChange={(event) =>
                        setSteps(Number(event.target.value))
                      }
                      disabled={busy}
                    >
                      <option value={4}>{t("img.stepFast")}</option>
                      <option value={8}>{t("img.stepStandard")}</option>
                      <option value={9}>{t("img.stepExperimental")}</option>
                    </select>
                  </div>
                </div>

                <div className="il-seed-row">
                  <div className="il-seed-heading">
                    <label className="il-label" htmlFor="il-seed">
                      Seed
                    </label>

                    <label className="il-checkbox">
                      <input
                        type="checkbox"
                        checked={randomSeed}
                        onChange={(event) =>
                          setRandomSeed(event.target.checked)
                        }
                        disabled={busy}
                      />
                      {t("img.random")}
                    </label>
                  </div>

                  <input
                      id="il-seed"
                      className="il-input"
                      type="number"
                      min="0"
                      max="2147483647"
                      step="1"
                     value={seed}
                      onChange={(event) => setSeed(event.target.value)}
                      disabled={busy || randomSeed}
                    />
                </div>

                <p className="il-hint">
                  {t("img.macHint")}
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
                    disabled={busy || (!prompt.trim() && !initFile)}
                  >
                    {busy
                      ? t("img.generating")
                      : initFile
                        ? t("img.editBtn")
                        : t("img.generateBtn")}
                  </button>

                  {imageUrl && (
                    <button
                      className="il-button"
                      type="button"
                      onClick={startAnotherVersion}
                    >
                      {t("img.newVariant")}
                    </button>
                  )}
                </div>
              </form>
            </section>

            <section className="il-panel il-result-panel">
              <div className="il-section-heading">
                <div>
                  <p className="il-eyebrow">02 / OUTPUT</p>
                  <h2>{t("img.result")}</h2>
                </div>

                {busy && (
                  <span className="il-live">
                    <span className="il-status-dot" />
                    LIVE
                  </span>
                )}
              </div>

              {status === "idle" && !imageUrl && (
                <div className="il-empty">
                  <div className="il-empty-icon">✳</div>
                  <h3>{t("img.emptyTitle")}</h3>
                  <p>
                    {t("img.emptyText")}
                  </p>
                </div>
              )}

              {status === "submitting" && (
                <div className="il-progress">
                  <div className="il-spinner" />
                  <h3>{t("img.submitting")}</h3>
                  <p>{t("img.submittingText")}</p>
                </div>
              )}

              {(status === "queued" || status === "running") && (
                <div className="il-progress">
                  <div className="il-spinner" />

                  <h3>
                    {status === "queued"
                      ? t("img.queued")
                      : t("img.working")}
                  </h3>

                  <p>
                    {t("img.workingText")}
                  </p>

                  <div className="il-progress-track">
                    <div
                      className="il-progress-fill"
                      style={{
                        width:
                          progress === null ? "35%" : `${progress}%`,
                      }}
                    />
                  </div>

                  <div className="il-progress-meta">
                    <span>
                      {progress === null
                        ? t("img.processing")
                        : `${Math.round(progress)}%`}
                    </span>

                    <span>{formatDuration(elapsed)}</span>
                  </div>

                  <p className="il-hint">
                    {t("img.timeHint")}
                  </p>
                </div>
              )}

              {status === "loading-result" && (
                <div className="il-progress">
                  <div className="il-spinner" />
                  <h3>{t("img.loadingResult")}</h3>
                </div>
              )}

              {status === "completed" && imageUrl && (
                <div className="il-output">
                  <img
                    className="il-generated-image"
                    src={imageUrl}
                    alt={prompt}
                  />

                  <div className="il-result-meta">
                    <span>PNG</span>
                    <span>{formatDuration(elapsed)}</span>
                    {usedSeed !== null && <span>Seed: {usedSeed}</span>}
                  </div>

                  <div className="il-actions">
                    <button
                      className="il-button il-primary"
                      onClick={downloadImage}
                    >
                      {t("img.downloadPng")}
                    </button>

                    <button
                      className="il-button"
                      onClick={startAnotherVersion}
                    >
                      {t("img.createVariant")}
                    </button>
                  </div>
                </div>
              )}

              {status === "error" && (
                <div className="il-error-panel">
                  <h3>{t("img.errorTitle")}</h3>
                  <p>
                    {error || t("img.errorFallback")}
                  </p>

                  <button
                    className="il-button"
                    onClick={() => {
                      setError("");
                      setStatus("idle");
                      setJobId("");
                    }}
                  >
                    {t("img.backToPrompt")}
                  </button>
                </div>
              )}

              {jobId && (
                <p className="il-job-id">
                  Job ID: <code>{jobId}</code>
                </p>
              )}
            </section>
          </div>
        )}

        {tab === "storico" && (
          <section className="il-panel il-history-panel">
            <div className="il-section-heading">
              <div>
                <p className="il-eyebrow">03 / GALLERY</p>
                <h2>{t("img.historyTitle")}</h2>
              </div>
              <button
                className="il-button"
                onClick={loadHistory}
                disabled={historyLoading}
              >
                {historyLoading ? t("img.loading") : t("img.refresh")}
              </button>
            </div>

            {historyError && (
              <div className="il-error" role="alert">
                {historyError}
              </div>
            )}

            {!historyLoading && history.length === 0 && !historyError && (
              <p className="il-hint">
                {t("img.historyEmpty")}
              </p>
            )}

            {history.length > 0 && (
              <div className="il-page-size">
                <span>{t("img.perPage")}</span>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
                <span className="il-page-info">
                  {t("img.totalGenerations", { count: history.length })}
                </span>
              </div>
            )}

            <div className="il-history-grid">
              {pageItems.map((item) => (
                <article key={item.job_id} className="il-history-card">
                  <p className="il-history-prompt">
                    {String(item.prompt || "").length > 160
                      ? String(item.prompt).slice(0, 160) + "…"
                      : item.prompt}
                  </p>
                  <div className="il-history-meta">
                    <span>
                      {item.width} × {item.height}
                    </span>
                    <span>{item.steps} step</span>
                    <span>Seed: {item.seed}</span>
                  </div>
                  <div className="il-history-actions">
                    <button
                      className="il-button"
                      onClick={() => openHistoryItem(item)}
                    >
                      {t("img.view")}
                    </button>
                    <button
                      className="il-button"
                      onClick={() => reuseHistoryParams(item)}
                    >
                      {t("img.params")}
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {history.length > 0 && (
              <div className="il-pagination">
                <button
                  className="il-page-btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                >
                  {t("img.prev")}
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (n) => (
                    <button
                      key={n}
                      className={
                        "il-page-btn" +
                        (n === safePage ? " il-page-btn-active" : "")
                      }
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
                  )
                )}

                <button
                  className="il-page-btn"
                  onClick={() =>
                    setPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={safePage >= totalPages}
                >
                  {t("img.next")}
                </button>

                <span className="il-page-info">
                  {t("img.pageOf", { page: safePage, total: totalPages })}
                </span>
              </div>
            )}

            {historyPreview && (
              <div
                className="il-history-overlay"
                onClick={closeHistoryPreview}
              >
                <div
                  className="il-history-modal"
                  onClick={(event) => event.stopPropagation()}
                >
                  <img
                    className="il-generated-image"
                    src={historyPreview.url}
                    alt={historyPreview.item.prompt}
                  />
                  <div className="il-history-modal-meta">
                    <span>
                      {historyPreview.item.width} × {historyPreview.item.height}
                    </span>
                    <span>Seed: {historyPreview.item.seed}</span>
                    <span>{historyPreview.item.steps} step</span>
                  </div>
                  <div className="il-actions">
                    <a
                      className="il-button il-primary"
                      href={historyPreview.url}
                      download={"z-image-" + historyPreview.item.seed + ".png"}
                    >
                      {t("img.downloadPng")}
                    </a>
                    <button
                      className="il-button"
                      onClick={() => reuseHistoryParams(historyPreview.item)}
                    >
                      {t("img.reuseParams")}
                    </button>
                    <button
                      className="il-button"
                      onClick={closeHistoryPreview}
                    >
                      {t("img.close")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "ocr" && (
          <section className="il-panel il-ocr-panel">
            <div className="il-section-heading">
              <div>
                <p className="il-eyebrow">04 / OCR</p>
                <h2>{t("img.ocrTitle")}</h2>
              </div>
            </div>

            <form onSubmit={runOcr} className="il-ocr-form">
              <input
                type="file"
                accept="image/*"
                onChange={onOcrFile}
                disabled={ocrStatus === "running"}
              />

              {ocrImage && (
                <p className="il-hint">
                  {ocrImage.name} ({Math.round(ocrImage.size / 1024)} KB)
                </p>
              )}

              <button
                className="il-button il-primary"
                type="submit"
                disabled={!ocrImage || ocrStatus === "running"}
              >
                {ocrStatus === "running" ? t("img.analyzing") : t("img.extract")}
              </button>
            </form>

            {ocrError && (
              <div className="il-error" role="alert">
                {ocrError}
              </div>
            )}

            {ocrText && (
              <div className="il-ocr-result">
                <div className="il-history-modal-meta">
                  <span>{t("img.extractedText")}</span>
                  <button className="il-button" onClick={copyOcrText}>
                    {t("img.copy")}
                  </button>
                </div>
                <pre className="il-ocr-pre">{ocrText}</pre>
              </div>
            )}

            {jcsInterpretation && (
              <div className="il-ocr-result il-jcs-result">
                <div className="il-history-modal-meta">
                  <span>{t("img.jcsLabel")}</span>
                </div>
                <pre className="il-ocr-pre">{jcsInterpretation}</pre>
              </div>
            )}
          </section>
        )}

        <footer className="il-footer">
          <span>Z-Image-Turbo</span>
          <span>Local inference · Async jobs</span>
          <button
            className="il-text-button"
            onClick={() => navigate("/improve")}
          >
            {t("img.backToImprove")}
          </button>
        </footer>
      </div>

      <style>{STYLES}</style>
    </main>
  );
}
const STYLES = `
.il-page {
  min-height: 100vh;
  padding: 2rem 1.5rem 3rem;
  background: var(--bg, #0b1015);
  color: var(--ink, #e7edf1);
  font-family: var(--sans, Inter, system-ui, sans-serif);
}
.il-container {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
}
.il-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1.25rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--border, #1f2b35);
}
.il-header h1 {
  font-family: var(--serif, Georgia, serif);
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 400;
  letter-spacing: -.035em;
}
.il-eyebrow {
  color: var(--accent, #3fd0c9);
  font-size: .7rem;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  margin-bottom: .35rem;
}
.il-subtitle {
  color: var(--ink-dim, #8fa1ac);
  font-size: .9rem;
}
.il-account {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: .6rem;
}
.il-account > span {
  color: var(--ink-dim, #8fa1ac);
  font-size: .8rem;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.il-notice {
  display: flex;
  align-items: center;
  gap: .65rem;
  margin: 1.25rem 0;
  padding: .8rem 1rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 8px;
  background: var(--bg-alt, #0f151c);
  color: var(--ink-dim, #8fa1ac);
  font-size: .82rem;
}
.il-status-dot {
  display: inline-block;
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 7px #4ade8055;
}
.il-layout {
  display: grid;
  grid-template-columns: minmax(0, .92fr) minmax(0, 1.08fr);
  align-items: start;
  gap: 1rem;
}
.il-panel {
  min-width: 0;
  padding: 1.25rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 12px;
  background: var(--panel, #121a22);
}
.il-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.il-section-heading h2 {
  font-size: 1.2rem;
  font-weight: 600;
}
.il-label {
  display: block;
  margin-bottom: .45rem;
  color: var(--ink-dim, #8fa1ac);
  font-size: .78rem;
  font-weight: 600;
}
.il-input {
  width: 100%;
  min-width: 0;
  padding: .8rem .85rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 7px;
  outline: none;
  background: var(--bg, #0b1015);
  color: var(--ink, #e7edf1);
  font: inherit;
  font-size: .9rem;
}
.il-input:focus {
  border-color: var(--accent, #3fd0c9);
  box-shadow: 0 0 0 2px #3fd0c91a;
}
.il-input:disabled {
  opacity: .6;
  cursor: not-allowed;
}
.il-prompt {
  resize: vertical;
  min-height: 145px;
  line-height: 1.6;
}
.il-char-count {
  margin-top: .3rem;
  color: var(--ink-dim, #8fa1ac);
  text-align: right;
  font-size: .72rem;
}
.il-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .8rem;
  margin-top: 1rem;
}
.il-seed-row {
  margin-top: 1rem;
}
.il-seed-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
}
.il-checkbox {
  display: inline-flex;
  align-items: center;
  gap: .4rem;
  color: var(--ink-dim, #8fa1ac);
  font-size: .8rem;
}
.il-checkbox input {
  accent-color: var(--accent, #3fd0c9);
}
.il-hint {
  margin-top: .7rem;
  color: var(--ink-dim, #8fa1ac);
  font-size: .76rem;
  line-height: 1.55;
}
.il-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: .6rem;
  margin-top: 1rem;
}
.il-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .4rem;
  padding: .65rem .9rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 6px;
  background: transparent;
  color: var(--ink, #e7edf1);
  font: inherit;
  font-size: .82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.il-button:hover:not(:disabled) {
  border-color: var(--accent, #3fd0c9);
}
.il-button:disabled {
  opacity: .5;
  cursor: not-allowed;
}
.il-primary {
  border-color: var(--accent, #3fd0c9);
  background: var(--accent, #3fd0c9);
  color: #071212;
}
.il-primary:hover:not(:disabled) {
  background: #68e0da;
}
.il-result-panel {
  min-height: 490px;
}
.il-live {
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  color: #4ade80;
  font-size: .7rem;
  font-weight: 700;
  letter-spacing: .1em;
}
.il-empty, .il-progress {
  display: flex;
  min-height: 340px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 1.5rem;
}
.il-empty-icon {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  margin-bottom: 1rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 50%;
  color: var(--accent, #3fd0c9);
  font-size: 1.7rem;
}
.il-empty h3, .il-progress h3 {
  margin-bottom: .4rem;
  font-size: 1rem;
  font-weight: 600;
}
.il-empty p, .il-progress p {
  max-width: 360px;
  color: var(--ink-dim, #8fa1ac);
  font-size: .82rem;
  line-height: 1.6;
}
.il-spinner {
  width: 32px;
  height: 32px;
  margin-bottom: 1rem;
  border: 3px solid var(--border, #1f2b35);
  border-top-color: var(--accent, #3fd0c9);
  border-radius: 50%;
  animation: il-spin .8s linear infinite;
}
@keyframes il-spin {
  to { transform: rotate(360deg); }
}
.il-progress-track {
  width: 100%;
  max-width: 360px;
  height: 5px;
  margin-top: 1.25rem;
  overflow: hidden;
  border-radius: 99px;
  background: var(--border, #1f2b35);
}
.il-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent, #3fd0c9);
  transition: width .35s ease;
}
.il-progress-meta {
  display: flex;
  width: 100%;
  max-width: 360px;
  justify-content: space-between;
  margin-top: .5rem;
  color: var(--ink-dim, #8fa1ac);
  font-size: .75rem;
}
.il-output {
  display: flex;
  flex-direction: column;
  gap: .75rem;
}
.il-generated-image {
  display: block;
  width: 100%;
  max-height: 680px;
  object-fit: contain;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 8px;
  background: #080c10;
}
.il-result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem 1rem;
  color: var(--ink-dim, #8fa1ac);
  font-size: .76rem;
}
.il-error, .il-error-panel {
  margin-top: 1rem;
  padding: .8rem;
  border: 1px solid #7f1d1d;
  border-radius: 7px;
  background: #7f1d1d20;
  color: #fca5a5;
  font-size: .82rem;
  overflow-wrap: anywhere;
}
.il-error-panel h3 {
  margin-bottom: .5rem;
}
.il-job-id {
  margin-top: 1rem;
  color: var(--ink-dim, #8fa1ac);
  font-size: .7rem;
  overflow-wrap: anywhere;
}
.il-job-id code {
  color: var(--ink, #e7edf1);
}
.il-login {
  max-width: 560px;
  margin: 2rem auto;
}
.il-login h2 {
  margin-bottom: .5rem;
}
.il-login p {
  margin-bottom: 1rem;
  color: var(--ink-dim, #8fa1ac);
}
.il-history-panel {
  margin-top: 1rem;
}
.il-history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: .8rem;
}
.il-history-card {
  display: flex;
  flex-direction: column;
  gap: .55rem;
  min-width: 0;
  padding: .85rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 9px;
  background: var(--bg-alt, #0f151c);
}
.il-history-prompt {
  color: var(--ink, #e7edf1);
  font-size: .8rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.il-history-meta {
  display: flex;
  flex-wrap: wrap;
  gap: .35rem .75rem;
  color: var(--ink-dim, #8fa1ac);
  font-size: .7rem;
}
.il-history-actions {
  display: flex;
  gap: .45rem;
  margin-top: auto;
}
.il-history-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(4, 8, 12, .82);
}
.il-history-modal {
  display: flex;
  flex-direction: column;
  gap: .75rem;
  width: min(760px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  padding: 1.1rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 12px;
  background: var(--panel, #121a22);
}
.il-history-modal-meta {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem 1rem;
  color: var(--ink-dim, #8fa1ac);
  font-size: .76rem;
}
.il-ocr-panel {
  margin-top: 1rem;
}
.il-ocr-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: .6rem;
}
.il-ocr-result {
  margin-top: .8rem;
}
.il-ocr-pre {
  margin: .5rem 0 0;
  padding: .8rem 1rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 9px;
  background: var(--bg-alt, #0f151c);
  color: var(--ink, #e7edf1);
  font-family: inherit;
  font-size: .82rem;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 380px;
  overflow-y: auto;
}
.il-jcs-result {
  border-left: 3px solid var(--accent, #6fe3dd);
  padding-left: .8rem;
}
.il-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border, #1f2b35);
  color: var(--ink-dim, #8fa1ac);
  font-size: .75rem;
}
.il-text-button {
  border: 0;
  background: transparent;
  color: var(--accent, #3fd0c9);
  font: inherit;
  cursor: pointer;
}
.il-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem;
  margin-bottom: 1rem;
}
.il-tab {
  padding: .55rem 1rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 8px;
  background: transparent;
  color: var(--ink-dim, #8fa1ac);
  font: inherit;
  font-size: .82rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, color .15s ease;
}
.il-tab:hover {
  border-color: var(--accent, #3fd0c9);
  color: var(--ink, #e7edf1);
}
.il-tab-active {
  border-color: var(--accent, #3fd0c9);
  background: var(--accent, #3fd0c9);
  color: #071212;
}
.il-tab-active:hover {
  color: #071212;
}
.il-upload {
  margin-bottom: 1rem;
  padding: .8rem;
  border: 1px dashed var(--border, #1f2b35);
  border-radius: 9px;
  background: var(--bg-alt, #0f151c);
}
.il-upload .il-label {
  margin-bottom: .5rem;
}
.il-init-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: .75rem;
}
.il-init-row input[type="file"] {
  max-width: 280px;
  color: var(--ink-dim, #8fa1ac);
  font-size: .8rem;
}
.il-init-preview {
  width: 84px;
  height: 84px;
  object-fit: cover;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 7px;
}
.il-strength {
  margin-bottom: 1rem;
}
.il-range {
  width: 100%;
  accent-color: var(--accent, #3fd0c9);
}
.il-page-size {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: .5rem;
  margin-bottom: .9rem;
  color: var(--ink-dim, #8fa1ac);
  font-size: .78rem;
}
.il-page-size select {
  padding: .35rem .5rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 6px;
  background: var(--bg, #0b1015);
  color: var(--ink, #e7edf1);
  font: inherit;
  font-size: .8rem;
  cursor: pointer;
}
.il-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: .4rem;
  margin-top: 1.1rem;
}
.il-page-btn {
  min-width: 34px;
  padding: .4rem .55rem;
  border: 1px solid var(--border, #1f2b35);
  border-radius: 6px;
  background: transparent;
  color: var(--ink, #e7edf1);
  font: inherit;
  font-size: .78rem;
  cursor: pointer;
}
.il-page-btn:hover:not(:disabled) {
  border-color: var(--accent, #3fd0c9);
}
.il-page-btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}
.il-page-btn-active {
  border-color: var(--accent, #3fd0c9);
  background: var(--accent, #3fd0c9);
  color: #071212;
  font-weight: 700;
}
.il-page-btn-active:hover:not(:disabled) {
  color: #071212;
}
.il-page-info {
  margin-left: .5rem;
  color: var(--ink-dim, #8fa1ac);
  font-size: .75rem;
}
@media (max-width: 850px) {
  .il-layout {
    grid-template-columns: 1fr;
  }
  .il-result-panel {
    min-height: 360px;
  }
}
@media (max-width: 560px) {
  .il-page {
    padding: 1.1rem .75rem 2rem;
  }
  .il-panel {
    padding: .9rem;
  }
  .il-form-grid {
    grid-template-columns: 1fr;
  }
  .il-account {
    justify-content: flex-start;
  }
  .il-account > span {
    width: 100%;
    max-width: none;
  }
}
`;
