//multifoto tab, txt2img, img2img and pillow

import { useEffect, useRef, useState } from "react";
import { IMG_STEPS, IMG_STRENGTH } from "../lib/imageParams.js";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

const API = "https://api.danielevillanova.com";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_KEY = "dv_google_id_token";
const POLL_MS = 4000;
const MAX_FILES = 12;

// Griglia identica a RESOLUTION_OPTIONS dell'app Gradio (main.py):
// cosi' il gateway non deve snappare e l'output ha ESATTAMENTE
// le dimensioni scelte qui. Struttura: categoria -> [ [label, w, h], ... ]
const GRADIO_FORMATS = {
  512: [["512 × 512 (1:1)", 512, 512], ["640 × 384 (5:3)", 640, 384], ["384 × 640 (3:5)", 384, 640], ["512 × 384 (4:3)", 512, 384], ["384 × 512 (3:4)", 384, 512], ["640 × 368 (16:9)", 640, 368], ["368 × 640 (9:16)", 368, 640]],
  768: [["768 × 768 (1:1)", 768, 768], ["960 × 576 (5:3)", 960, 576], ["576 × 960 (3:5)", 576, 960], ["768 × 576 (4:3)", 768, 576], ["576 × 768 (3:4)", 576, 768], ["960 × 544 (16:9)", 960, 544], ["544 × 960 (9:16)", 544, 960]],
  1024: [["1024 × 1024 (1:1)", 1024, 1024], ["1280 × 768 (5:3)", 1280, 768], ["768 × 1280 (3:5)", 768, 1280], ["1024 × 768 (4:3)", 1024, 768], ["768 × 1024 (3:4)", 768, 1024], ["1280 × 720 (16:9)", 1280, 720], ["720 × 1280 (9:16)", 720, 1280], ["1024 × 576 (16:9)", 1024, 576], ["576 × 1024 (9:16)", 576, 1024]],
  1280: [["1280 × 1280 (1:1)", 1280, 1280], ["1536 × 1024 (3:2)", 1536, 1024], ["1024 × 1536 (2:3)", 1024, 1536], ["1536 × 864 (16:9)", 1536, 864], ["864 × 1536 (9:16)", 864, 1536]],
};

function decodeJwt(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(part).split("").map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
  } catch { return null; }
}
function valid(token) { const p = token ? decodeJwt(token) : null; return !!p?.exp && p.exp * 1000 > Date.now() + 5000; }
function readToken() { try { const t = localStorage.getItem(TOKEN_KEY); return valid(t) ? t : ""; } catch { return ""; } }
async function request(url, token, init = {}, t) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) throw new Error(t ? t("img.puzzle.endpointMissing") : "Gateway endpoint not found (404).");
    throw new Error(typeof data.detail === "string" ? data.detail : data.detail ? JSON.stringify(data.detail) : `HTTP ${res.status}`);
  }
  return data;
}

// COMPOSIZIONE MULTIFOTO — la fusione ora avviene SUL MAC con Pillow
// (POST /api/image/compose): N foto (fino a 12), layout griglia/fila/
// colonna/sfondo e dissolvenza cross-fade tra le foto. Il PNG composito
// torna qui e va all'img2img esistente: il flusso dopo non cambia.
async function composeServer(token, files, layout, blend, outW, outH) {
  const body = new FormData();
  files.forEach(f => body.append("images", f, f.name));
  body.append("layout", layout);
  body.append("blend", String(blend));
  body.append("width", String(outW));
  body.append("height", String(outH));
  const res = await fetch(`${API}/api/image/compose`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = (j && (j.detail || j.error)) || detail;
      if (typeof detail !== "string") detail = JSON.stringify(detail);
    } catch (e) { /* corpo non JSON */ }
    throw new Error(detail);
  }
  return await res.blob();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Invia un'immagine all'img2img e fa polling inline del job fino al risultato.
async function runImg2Img(token, payload, name, opts) {
  const { prompt, antiArtifact, strength, outW, outH, steps, seed, onJobId, t } = opts;
  const body = new FormData();
  body.append("image", payload, name);
  body.append("prompt", antiArtifact ? prompt.trim() + ", seamless unified photo, no text, no Chinese characters, no watermark" : prompt.trim());
  body.append("strength", String(strength)); body.append("width", String(outW)); body.append("height", String(outH));
  body.append("steps", steps); body.append("seed", seed.trim() || "-1");
  const data = await request(`${API}/api/image/img2img`, token, { method: "POST", body }, t);
  const id = data.job_id || data.id;
  if (!id) {
    if (data.image_base64) return data.image_base64.startsWith("data:") ? data.image_base64 : `data:image/png;base64,${data.image_base64}`;
    throw new Error(t ? t("img.puzzle.noJobOrImage") : "The server returned no job_id or image.");
  }
  onJobId(String(id));
  for (;;) {
    await sleep(POLL_MS);
    const st = await request(`${API}/api/image/jobs/${encodeURIComponent(String(id))}`, token, {}, t);
    const sv = String(st.status || "").toLowerCase();
    if (["failed", "error", "cancelled"].includes(sv)) throw new Error(st.error || st.detail || t("img.genFailed"));
    if (["completed", "complete", "succeeded"].includes(sv)) {
      const out = await request(`${API}/api/image/jobs/${encodeURIComponent(String(id))}/result`, token, {}, t);
      const img = out.image_base64 || out.image || out.result_base64;
      if (img) return img.startsWith("data:") ? img : `data:image/png;base64,${img}`;
      if (out.image_url) return out.image_url;
      throw new Error(t ? t("img.puzzle.jobNoImage") : "The job finished without returning an image.");
    }
  }
}

export default function MultifotoTab({ embedded = true }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const loginRef = useRef(null);
  const [token, setToken] = useState(readToken);
  const [email, setEmail] = useState("");
  // N foto: file + anteprime allineate per indice.
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  // Composizione (server-side con Pillow): griglia/fila/colonna/sfondo.
  const [layout, setLayout] = useState("grid");
  const [blend, setBlend] = useState(0.25);
  const [antiArtifact, setAntiArtifact] = useState(true);
  // Modalità: mix = fusione Pillow + img2img · compose = solo fusione · split = solo img2img, una per foto.
  const [mode, setMode] = useState("mix");
  const [prompt, setPrompt] = useState("Keep the main subject and composition, improve the lighting and details.");
  const [strength, setStrength] = useState(0.65);
  const [size, setSize] = useState(512);
  const [formatIdx, setFormatIdx] = useState(0);
  const formats = GRADIO_FORMATS[size] || GRADIO_FORMATS[512];
  const [outW, outH] = formats[Math.min(formatIdx, formats.length - 1)].slice(1);
  const [steps, setSteps] = useState("9");
  const [seed, setSeed] = useState("");
  const [status, setStatus] = useState("idle");
  const [jobId, setJobId] = useState("");
  const [result, setResult] = useState("");
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const busy = ["submitting", "queued", "running"].includes(status);

  useEffect(() => {
    const fn = e => { if (e.key === TOKEN_KEY) setToken(e.newValue && valid(e.newValue) ? e.newValue : ""); };
    window.addEventListener("storage", fn);
    return () => window.removeEventListener("storage", fn);
  }, []);
  useEffect(() => { setEmail(token ? decodeJwt(token)?.email || "" : ""); }, [token]);
  useEffect(() => {
    if (token || !CLIENT_ID) return;
    let dead = false, attempts = 0, timer;
    const init = () => {
      if (dead) return;
      if (!window.google?.accounts?.id) { if (++attempts < 80) timer = setTimeout(init, 150); return; }
      window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: r => {
        const t = r?.credential;
        if (!t || !valid(t)) return;
        try { localStorage.setItem(TOKEN_KEY, t); } catch {}
        setToken(t);
      }});
      if (loginRef.current) {
        loginRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(loginRef.current, { theme: "filled_black", size: "large", shape: "pill", text: "signin_with" });
      }
    };
    init();
    return () => { dead = true; clearTimeout(timer); };
  }, [token]);
  useEffect(() => {
    if (!started || !busy) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [started, busy]);
  // Il polling dei job è inline in runImg2Img (vale per tutte le modalità).

  function pickFiles(list) {
    if (!list || !list.length) return;
    setError("");
    const accepted = [];
    for (const f of list) {
      if (!f.type.startsWith("image/")) { setError(t("img.puzzle.onlyImages")); continue; }
      if (f.size > 15 * 1024 * 1024) { setError(t("img.puzzle.maxPhotoSize")); continue; }
      accepted.push(f);
    }
    if (!accepted.length) return;
    setFiles(prev => {
      const room = Math.max(0, MAX_FILES - prev.length);
      const added = accepted.slice(0, room);
      setPreviews(p => [...p, ...added.map(f => URL.createObjectURL(f))]);
      if (accepted.length > room) setError(t("img.puzzle.maxPhotos", { max: MAX_FILES }));
      return [...prev, ...added];
    });
    setResult(""); setStatus("idle");
  }
  function removeAt(i) {
    if (busy) return;
    setPreviews(p => { URL.revokeObjectURL(p[i]); return p.filter((_, j) => j !== i); });
    setFiles(f => f.filter((_, j) => j !== i));
    setResult(""); setStatus("idle");
  }
  function clearPhotos() {
    previews.forEach(u => URL.revokeObjectURL(u));
    setFiles([]); setPreviews([]);
  }
  async function generate(e) {
    e.preventDefault();
    if (!files.length || !prompt.trim() || busy) return;
    setError(""); setResult(""); setResults([]); setJobId(""); setStatus("submitting");
    const now = Date.now(); setStarted(now); setElapsed(0);
    const opts = { prompt, antiArtifact, strength, outW, outH, steps, seed, t, onJobId: id => setJobId(id) };
    try {
      if (mode === "compose") {
        // Solo fusione Pillow: nessuna generazione AI.
        if (files.length < 2) throw new Error(t("img.puzzle.needTwoPhotos"));
        const blob = await composeServer(token, files, layout, blend, outW, outH);
        setResult(URL.createObjectURL(blob));
        setStatus("completed");
      } else if (mode === "split") {
        // Esclude la fusione: ogni foto va separatamente all'img2img.
        const outs = [];
        for (let i = 0; i < files.length; i++) {
          const src = await runImg2Img(token, files[i], files[i].name, opts);
          outs.push({ src, name: files[i].name });
          setResults([...outs]);
        }
        setStatus("completed");
      } else {
        // Mix: 1 foto dritta all'img2img, più foto fuse con Pillow e
        // il composito va all'img2img (flusso originale).
        const payload = files.length > 1
          ? await composeServer(token, files, layout, blend, outW, outH)
          : files[0];
        setResult(await runImg2Img(token, payload, files.length > 1 ? "merge.png" : files[0].name, opts));
        setStatus("completed");
      }
    } catch (e) { setError(e.message); setStatus("error"); }
  }
  function reset() { setStatus("idle"); setJobId(""); setResult(""); setResults([]); setError(""); }
  function logout() { try { localStorage.removeItem(TOKEN_KEY); window.google?.accounts?.id?.disableAutoSelect(); } catch {} setToken(""); setEmail(""); }

  return <main className="i2i-page"><div className="i2i-wrap">
    {!embedded && (<header className="i2i-header"><div><p className="i2i-kicker">D. VILLANOVA · IMAGE LAB</p><h1>{t("img.puzzle.title")}</h1><p className="i2i-muted">{t("img.puzzle.description", { max: MAX_FILES })}</p></div>
      <div className="i2i-account">{token ? <><span>{email}</span><button className="i2i-btn" onClick={logout}>{t("img.logout")}</button></> : <div ref={loginRef} />}</div></header>)}
    {!token && <section className="i2i-panel i2i-login"><h2>{t("img.puzzle.loginTitle")}</h2><p>{t("img.puzzle.loginHint")}</p>{!CLIENT_ID && <p className="i2i-error">{t("img.clientIdMissing")}</p>}</section>}
    {token && <form className="i2i-grid" onSubmit={generate}>
      <section className="i2i-panel"><p className="i2i-kicker">01 / SOURCE</p><h2>{t("img.puzzle.yourPhotos", { count: files.length, max: MAX_FILES })}</h2>
        <label className="i2i-upload">{previews.length ? <img src={previews[0]} alt={t("img.puzzle.photoAlt", { index: 1, count: files.length })} /> : <span><b>＋ {t("img.puzzle.choosePhotos")}</b><small>{t("img.puzzle.uploadHint", { max: MAX_FILES })}</small></span>}<input type="file" accept="image/*" multiple onChange={e => pickFiles(e.target.files)} disabled={busy} /></label>
        {files.length > 0 && (
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginBottom: ".8rem" }}>
            {files.map((f, i) => (
              <span key={i} style={{ position: "relative", width: 84, height: 84, flex: "0 0 auto" }}>
                <img src={previews[i]} alt={t("img.puzzle.photoAlt", { index: i + 1, count: files.length })} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 7, border: "1px solid rgba(255,255,255,.14)" }} />
                <button type="button" onClick={() => removeAt(i)} disabled={busy} title={t("img.puzzle.removePhoto", { index: i + 1 })} style={{ position: "absolute", top: -7, right: -7, width: 22, height: 22, borderRadius: "50%", border: "1px solid #7f1d1d", background: "#7f1d1d", color: "#fff", fontSize: ".7rem", lineHeight: 1, cursor: "pointer" }}>✕</button>
                <small style={{ position: "absolute", bottom: 3, left: 3, padding: "1px 4px", borderRadius: 4, background: "rgba(0,0,0,.55)", color: "#e7edf1", fontSize: ".62rem" }}>{i + 1}</small>
              </span>
            ))}
          </div>
        )}
        {files.length > 1 && mode !== "split" && (
          <>
            <div className="i2i-field"><span className="i2i-label">{t("img.puzzle.composition")}</span>
              <select className="i2i-input" value={layout} onChange={e => setLayout(e.target.value)} disabled={busy}>
                <option value="grid">{t("img.puzzle.layoutGrid")}</option>
                <option value="side">{t("img.puzzle.layoutRow")}</option>
                <option value="stack">{t("img.puzzle.layoutColumn")}</option>
                <option value="bg">{t("img.puzzle.layoutBackground")}</option>
              </select>
            </div>
            <div className="i2i-field"><label className="i2i-label" htmlFor="i2i-blend">{t("img.puzzle.blend", { value: Math.round(blend * 100) })}</label>
              <input id="i2i-blend" type="range" min="0" max="45" step="5" value={Math.round(blend * 100)} onChange={e => setBlend(Number(e.target.value) / 100)} disabled={busy} />
              <div className="i2i-range"><span>{t("img.puzzle.sharpEdges")}</span><span>{t("img.puzzle.blended")}</span></div>
            </div>
          </>
        )}
        <div className="i2i-field"><span className="i2i-label">{t("img.puzzle.mode")}</span>
          <select className="i2i-input" value={mode} onChange={e => { setMode(e.target.value); setResults([]); setResult(""); setStatus("idle"); }} disabled={busy}>
            <option value="mix">{t("img.puzzle.modeMix")}</option>
            <option value="compose">{t("img.puzzle.modeCompose")}</option>
            <option value="split">{t("img.puzzle.modeSplit")}</option>
          </select>
        </div>
        <label className="i2i-label" htmlFor="i2i-prompt">{t("img.puzzle.editInstructions")}</label><textarea id="i2i-prompt" className="i2i-input i2i-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={3000} required={mode !== "compose"} disabled={busy} />
        <div className="i2i-field"><label className="i2i-label" htmlFor="i2i-strength">{t("img.strengthLabel")} {strength.toFixed(2)}</label><input id="i2i-strength" type="range" min={IMG_STRENGTH.min} max={IMG_STRENGTH.max} step={IMG_STRENGTH.step} value={strength} onChange={e => setStrength(Number(e.target.value))} disabled={busy} /><div className="i2i-range"><span>{t("img.strengthMore")}</span><span>{t("img.strengthLess")}</span></div></div>
        <label className="i2i-check"><input type="checkbox" checked={antiArtifact} onChange={e => setAntiArtifact(e.target.checked)} disabled={busy} /> {t("img.puzzle.antiArtifacts")}</label>
        <div className="i2i-fields"><label className="i2i-field"><span className="i2i-label">{t("img.category")}</span><select className="i2i-input" value={size} onChange={e => { setSize(Number(e.target.value)); setFormatIdx(0); }} disabled={busy}>{Object.keys(GRADIO_FORMATS).map(c => <option key={c} value={c}>{c}</option>)}</select></label><label className="i2i-field"><span className="i2i-label">{t("img.format")}</span><select className="i2i-input" value={formatIdx} onChange={e => setFormatIdx(Number(e.target.value))} disabled={busy}>{formats.map((f, i) => <option key={f[0]} value={i}>{f[0]}</option>)}</select></label>
        <label className="i2i-field"><span className="i2i-label">{t("img.steps")}</span><select className="i2i-input" value={steps} onChange={e => setSteps(e.target.value)} disabled={busy}>{IMG_STEPS.map(s => <option key={s} value={s}>{s}</option>)}</select></label></div>
        <label className="i2i-label" htmlFor="i2i-seed">{t("img.puzzle.seedOptional")}</label><input id="i2i-seed" className="i2i-input" placeholder={t("img.random")} value={seed} onChange={e => setSeed(e.target.value.replace(/[^0-9-]/g, ""))} disabled={busy} />
        <div className="i2i-actions"><button className="i2i-btn i2i-primary" type="submit" disabled={!files.length || (mode !== "compose" && !prompt.trim()) || busy}>{busy ? t("img.puzzle.processing") : t("img.puzzle.editImage")}</button><button className="i2i-btn" type="button" onClick={reset} disabled={busy}>{t("img.puzzle.resetResult")}</button></div>
      </section>
      <section className="i2i-panel i2i-result"><div className="i2i-result-head"><div><p className="i2i-kicker">02 / RESULT</p><h2>{t("img.puzzle.generatedResult")}</h2></div><span>{busy ? "● " + t("img.puzzle.inProgress") : status === "completed" ? "● " + t("img.puzzle.completed") : "● " + t("img.puzzle.ready")}</span></div>
        {status === "idle" && <div className="i2i-empty"><span>✧</span><h3>{t("img.puzzle.variantHere")}</h3><p>{t("img.puzzle.emptyHint")}</p></div>}
        {busy && <div className="i2i-empty"><div className="i2i-spinner" /><h3>{status === "submitting" ? (files.length > 1 ? t("img.puzzle.composingAndSending") : t("img.puzzle.sending")) : status === "queued" ? t("img.queued") : t("img.generating")}</h3><p>{t("img.puzzle.elapsed")}: {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</p>{jobId && <small>Job ID: {jobId}</small>}{mode === "split" && <small>{t("img.puzzle.photosProcessed")}: {results.length}/{files.length}</small>}</div>}
        {status === "completed" && result && mode !== "split" && <div className="i2i-output"><img src={result} alt={t("img.puzzle.resultAlt")} /><div className="i2i-actions"><a className="i2i-btn i2i-primary" href={result} download="multifoto.png">{t("img.downloadPng")}</a><button className="i2i-btn" type="button" onClick={() => { clearPhotos(); reset(); }}>{t("img.puzzle.newPhotos")}</button></div></div>}
        {status === "completed" && mode === "split" && results.length > 0 && (
          <div className="i2i-output">
            {results.map((r, i) => (
              <figure key={i} style={{ margin: "0 0 1.2rem" }}>
                <img src={r.src} alt={t("img.puzzle.photoVariant", { index: i + 1 })} style={{ marginBottom: ".45rem" }} />
                <figcaption className="i2i-actions"><span style={{ fontSize: ".72rem", color: "var(--ink-dim,#8fa1ac)" }}>{r.name}</span><a className="i2i-btn i2i-primary" href={r.src} download={"multifoto_" + (i + 1) + ".png"}>{t("img.puzzle.downloadPhoto", { index: i + 1 })}</a></figcaption>
              </figure>
            ))}
            <div className="i2i-actions"><button className="i2i-btn" type="button" onClick={() => { clearPhotos(); reset(); }}>{t("img.puzzle.newPhotos")}</button></div>
          </div>
        )}
        {status === "error" && <div className="i2i-error"><h3>{t("img.puzzle.testFailed")}</h3><p>{error}</p><button className="i2i-btn" type="button" onClick={reset}>{t("img.puzzle.retry")}</button></div>}
        {jobId && <p className="i2i-muted">Job ID: <code>{jobId}</code></p>}
      </section>
    </form>}
    {!embedded && (<footer className="i2i-footer"><span>Multifoto · composizione: <code>/api/image/compose</code> · modifica: <code>/api/image/img2img</code></span><button className="i2i-link" onClick={() => navigate("/improve")}>Improve ↗</button></footer>)}
  </div><style>{STYLES}</style></main>;
}

const STYLES = `
.i2i-page{min-height:100vh;padding:2rem 1.25rem 3rem;background:var(--bg,#0b1015);color:var(--ink,#e7edf1);font-family:var(--sans,Inter,system-ui,sans-serif)}.i2i-wrap{max-width:1180px;margin:auto}.i2i-header{display:flex;align-items:center;justify-content:space-between;gap:1.2rem;flex-wrap:wrap;padding-bottom:1.5rem;border-bottom:1px solid var(--border,#1f2b35)}.i2i-header h1{font:400 clamp(2rem,4vw,3rem)/1.15 var(--serif,Georgia,serif);margin:.25rem 0}.i2i-header h1 small{font:700 .7rem var(--sans,system-ui);color:var(--accent,#3fd0c9)}.i2i-kicker{color:var(--accent,#3fd0c9);font-size:.68rem;font-weight:700;letter-spacing:.14em;margin:0 0 .4rem}.i2i-muted{color:var(--ink-dim,#8fa1ac);font-size:.78rem;line-height:1.55}.i2i-account,.i2i-actions{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}.i2i-account span{font-size:.8rem;color:var(--ink-dim,#8fa1ac)}.i2i-grid{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.05fr);gap:1rem;align-items:start;margin-top:1.2rem}.i2i-panel{min-width:0;padding:1.25rem;border:1px solid var(--border,#1f2b35);border-radius:12px;background:var(--panel,#121a22)}.i2i-panel h2{font-size:1.15rem;margin:0 0 1rem}.i2i-upload{display:flex;align-items:center;justify-content:center;min-height:230px;margin-bottom:1rem;border:1px dashed var(--border,#33414c);border-radius:9px;background:var(--bg-alt,#0f151c);cursor:pointer;overflow:hidden;text-align:center}.i2i-upload input{position:absolute;width:1px;height:1px;opacity:0}.i2i-upload img{width:100%;max-height:420px;object-fit:contain}.i2i-upload b,.i2i-upload small{display:block}.i2i-upload b{color:var(--accent,#3fd0c9);margin-bottom:.5rem}.i2i-upload small{color:var(--ink-dim,#8fa1ac);font-size:.75rem}.i2i-label{display:block;margin:.85rem 0 .4rem;color:var(--ink-dim,#8fa1ac);font-size:.78rem;font-weight:600}.i2i-input{display:block;width:100%;min-width:0;padding:.75rem .8rem;border:1px solid var(--border,#1f2b35);border-radius:7px;background:var(--bg,#0b1015);color:var(--ink,#e7edf1);font:inherit;font-size:.88rem}.i2i-prompt{min-height:120px;resize:vertical;line-height:1.55}.i2i-field{display:flex;flex-direction:column;gap:.35rem}.i2i-field input[type=range]{width:100%;accent-color:var(--accent,#3fd0c9)}.i2i-range{display:flex;justify-content:space-between;color:var(--ink-dim,#8fa1ac);font-size:.7rem}.i2i-fields{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}.i2i-btn{display:inline-flex;align-items:center;justify-content:center;padding:.65rem .9rem;border:1px solid var(--border,#1f2b35);border-radius:6px;background:transparent;color:var(--ink,#e7edf1);font:inherit;font-size:.8rem;font-weight:600;text-decoration:none;cursor:pointer}.i2i-btn:disabled{opacity:.45;cursor:not-allowed}.i2i-primary{border-color:var(--accent,#3fd0c9);background:var(--accent,#3fd0c9);color:#071212}.i2i-result{min-height:550px}.i2i-result-head{display:flex;align-items:center;justify-content:space-between;gap:.8rem}.i2i-result-head>span{font-size:.65rem;color:var(--ink-dim,#8fa1ac)}.i2i-empty{display:flex;min-height:390px;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:1.5rem}.i2i-empty>span{font-size:2.4rem;color:var(--accent,#3fd0c9)}.i2i-empty p,.i2i-empty small{color:var(--ink-dim,#8fa1ac);font-size:.8rem;line-height:1.6}.i2i-spinner{width:32px;height:32px;border:3px solid var(--border,#1f2b35);border-top-color:var(--accent,#3fd0c9);border-radius:50%;animation:i2ispin .8s linear infinite;margin-bottom:1rem}@keyframes i2ispin{to{transform:rotate(360deg)}}.i2i-output img{display:block;width:100%;max-height:700px;object-fit:contain;border-radius:8px;background:#080c10}.i2i-error{padding:.9rem;border:1px solid #7f1d1d;border-radius:8px;background:#7f1d1d20;color:#fca5a5;font-size:.82rem;overflow-wrap:anywhere}.i2i-footer{display:flex;align-items:center;flex-wrap:wrap;gap:1rem;margin-top:1.4rem;padding-top:1rem;border-top:1px solid var(--border,#1f2b35);font-size:.75rem;color:var(--ink-dim,#8fa1ac)}.i2i-footer code{color:var(--ink,#e7edf1)}.i2i-link{border:0;background:none;color:var(--accent,#3fd0c9);font:inherit;cursor:pointer}.i2i-login{max-width:550px;margin:1.5rem auto}.i2i-login p{color:var(--ink-dim,#8fa1ac)}.i2i-check{display:flex;align-items:center;gap:.5rem;margin:.85rem 0 0;color:var(--ink-dim,#8fa1ac);font-size:.78rem;cursor:pointer}.i2i-check input{accent-color:var(--accent,#3fd0c9)}
@media(max-width:850px){.i2i-grid{grid-template-columns:1fr}.i2i-result{min-height:360px}.i2i-empty{min-height:280px}}@media(max-width:560px){.i2i-page{padding:1rem .7rem 2rem}.i2i-panel{padding:.9rem}.i2i-fields{grid-template-columns:1fr}.i2i-upload{min-height:180px}}
`;