// ============================================================
// TEST7 — OCR Lab avanzato
// Test di estrazione testo con prompt personalizzato:
// immagine + prompt -> gateway /api/vision/ocr (qwen2.5vl via Ollama).
// Se il testo e' un timesheet, il gateway attiva l'agente JCS e la
// pagina mostra anche il pannello di interpretazione.
// Sovrascrive la Leles Admin Console (recuperabile in git history).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const API = 'https://api.danielevillanova.com'
const GOOGLE_CLIENT_ID = import.meta.env.VIDE_GOOGLE_CLIENT_ID
const TOKEN_STORAGE_KEY = 'dv_google_id_token'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

// Prompt preconfezionati: clic ne inserisce uno nell'area di testo,
// dove resta modificabile prima dell'intio.
const PROMPT_PRESETS = [
  {
    label: 'Leggi tutto',
    prompt:
      "Estrai tutto il testo presente in questa immagine. Riportalo fedelmente, mantenendo l'ordine di lettura. Se è una tabella, usa una riga per persona con i valori separati da |.",
  },
  {
    label: 'Timesheet 🧾',
    prompt:
      'Estrai il testo di questo foglio di presenza. Per ogni persona riporta il nome seguito dalle lettere di stato di ogni giorno, separate da spazi. Una riga per persona, formato: NOME | lettere.',
  },
  {
    label: 'Solo cifre',
    prompt:
      "Estrai da questa immagine solo numeri, prezzi e date. Riportali come elenco, uno per riga, nel formato che vedi nell'immagine.",
  },
  {
    label: 'Fattura',
    prompt:
      "Estrai da questo documento i dati principali: mittente, destinatario, numero documento, data, totali e voci (descrizione, quantità, importo). Formatta come elenco.",
  },
]

const DEFAULT_PROMPT = PROMPT_PRESETS[0].prompt

function parseJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
         .join('')
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(';base64,')
      resolve(comma >= 0 ? result.slice(comma + 8) : result)
    }
    reader.onerror = () => reject(new Error('Lettura del file non riuscita.'))
    reader.readAsDataURL(file)
  })
}

export default function Test7() {
  const [idToken, setIdToken] = useState(() => {
    try {
      return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || null
    } catch {
      return null
    }
  })
  const [profile, setProfile] = useState(() => (idToken ? parseJwt(idToken) : null))
  const [authError, setAuthError] = useState('')
  const [gsiReady, setGsiReady] = useState(false)
  const buttonRef = useRef(null)

  const [image, setImage] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  // ------------------------------------------------------------
  // Login Google
  // ------------------------------------------------------------
  useEffect(() => {
    if (idToken) return
    let cancelled = false
    let attempts = 0

    function tryInit() {
      if (cancelled) return
      if (!window.google?.accounts?.id) {
        if (++attempts > 80) {
          setAuthError('Impossibile caricare il login Google. Controlla adblock e rete.')
          return
        }
        setTimeout(tryInit, 150)
        return
      }
      if (!GOOGLE_CLIENT_ID) {
        setAuthError('VITE_GOOGLE_CLIENT_ID non configurato nel frontend.')
        return
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
      })
      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'medium',
          shape: 'pill',
        })
      }
      setGsiReady(true)
    }

    tryInit()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken])

  function handleCredentialResponse(credentialResponse) {
    const token = credentialResponse?.credential
    if (!token) {
      setAuthError('Login Google fallito: nessun token ricevuto.')
      return
    }
    setAuthError('')
    setProfile(parseJwt(token))
    setIdToken(token)
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } catch {
      /* no-op */
    }
  }

  const logout = useCallback((message = '') => {
    setIdToken(null)
    setProfile(null)
    setAuthError(message)
    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      window.google?.accounts?.id?.disableAutoSelect()
    } catch {
      /* no-op */
    }
  }, [])

  // ------------------------------------------------------------
  // Immagine
  // ------------------------------------------------------------
  async function pickImage(file) {
    setError('')
    setResult(null)

    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview('')
    setImage(null)

    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('Seleziona un file immagine.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Immagine troppo grande (massimo 10 MB).')
      return
    }

    setImage(file)
    setImagePreview(URL.createObjectURL(file))
  }

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  // ------------------------------------------------------------
  // OCR
  // ------------------------------------------------------------
  async function runOcr(event) {
    event.preventDefault()
    if (!image || busy) return

    const cleanPrompt = prompt.trim()
    if (!cleanPrompt) {
      setError("Scrivi un'istruzione per il modello (o scegli un preset).")
      return
    }

    setBusy(true)
    setError('')
    setResult(null)
    setCopied(false)

    try {
      const imageBase64 = await fileToBase64(image)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 320000)

      let res
      try {
        res = await fetch(`${API}/api/vision/ocr`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          signal: controller.signal,
          body: JSON.stringify({ image_base64: imageBase64, prompt: cleanPrompt }),
        })
      } finally {
        clearTimeout(timer)
      }

      if (res.status === 401 || res.status === 403) {
        logout(res.status === 401 ? 'Sessione scaduta, rilogga.' : 'Accesso non autorizzato.')
        return
      }
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const data = await res.json()
          detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
        } catch {
          /* no-op */
        }
        setError(detail)
        return
      }

      const data = await res.json()
      setResult({
        text: data.text || '',
        model: data.model || '',
        isJcs: Boolean(data.is_jcs),
        jcs: data.jcs || '',
      })
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Timeout: il modello non ha risposto in 5 minuti.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  function copyText() {
    try {
      navigator.clipboard?.writeText(result?.text || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* no-op */
    }
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  if (!idToken) {
    return (
      <div className="oc-page">
        <style>{CSS}</style>
        <div className="oc-container oc-center">
          <p className="oc-eyebrow">D. VILLANOVA AI SISTEMAS</p>
          <h1>OCR Lab</h1>
          <p className="oc-sub">Accesso riservato — login Google</p>
          {authError && <p className="oc-error">{authError}</p>}
          <div ref={buttonRef} className="oc-gbtn" />
          {!gsiReady && !authError && <p className="oc-hint">Caricamento login…</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="oc-page">
      <style>{CSS}</style>
      <div className="oc-container">
        <header className="oc-header">
          <div>
            <p className="oc-eyebrow">D. VILLANOVA AI SISTEMAS</p>
            <h1>OCR Lab</h1>
            <p className="oc-sub">
              Estrazione testo con prompt personalizzato — {result?.model || 'qwen2.5-vl'}
            </p>
          </div>
          <div className="oc-account">
            <span title={profile?.email}>{profile?.email || 'account'}</span>
            <Link className="oc-button" to="/image-lab">Image Lab ↗</Link>
            <button className="oc-button" onClick={() => logout()}>Logout</button>
          </div>
        </header>

        <div className="oc-layout">
          {/* ---------------------------- INPUT ---------------------------- */}
          <section className="oc-panel">
            <p className="oc-eyebrow">01 / INPUT</p>
            <h2>Immagine &amp; istruzioni</h2>

            <form onSubmit={runOcr}>
              <label className="oc-label" htmlFor="oc-file">Immagine (max 10 MB)</label>
              <div className="oc-file-row">
                <input
                  id="oc-file"
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => pickImage(e.target.files?.[0] || null)}
                />
                {imagePreview && (
                  <>
                    <img className="oc-preview" src={imagePreview} alt="Anteprima" />
                    <button
                      type="button"
                      className="oc-button"
                      disabled={busy}
                      onClick={() => pickImage(null)}
                    >
                      ✕ Rimuovi
                    </button>
                  </>
                )}
              </div>

              {image && (
                <p className="oc-hint">
                  {image.name} — {Math.round(image.size / 1024)} KB
                </p>
              )}

              <label className="oc-label" htmlFor="oc-prompt">Istruzione per il modello</label>
              <textarea
                id="oc-prompt"
                className="oc-textarea"
                rows={5}
                maxLength={2000}
                value={prompt}
                disabled={busy}
                placeholder="Es. Estrai solo i totali di questa fattura…"
                onChange={(e) => setPrompt(e.target.value)}
              />

              <div className="oc-presets">
                <span className="oc-hint">Preset:</span>
                {PROMPT_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="oc-button oc-preset"
                    disabled={busy}
                    onClick={() => setPrompt(p.prompt)}
                    title={p.prompt}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {error && (
                <div className="oc-error" role="alert">{error}</div>
              )}

              <div className="oc-actions">
                <button
                  type="submit"
                  className="oc-button oc-primary"
                  disabled={busy || !image}
                >
                  {busy ? 'Analizzo…' : 'Estrai testo ▶'}
                </button>
                {result && (
                  <button
                    type="button"
                    className="oc-button"
                    onClick={() => {
                      setResult(null)
                      setError('')
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* ---------------------------- OUTPUT ---------------------------- */}
          <section className="oc-panel oc-result">
            <div className="oc-result-head">
              <div>
                <p className="oc-eyebrow">02 / OUTPUT</p>
                <h2>Risultato</h2>
              </div>
              {busy && <span className="oc-live">● LIVE</span>}
            </div>

            {busy && (
              <div className="oc-progress">
                <div className="oc-spinner" />
                <p>Il modello vision sta leggendo l'immagine…</p>
              </div>
            )}

            {!busy && !result && !error && (
              <p className="oc-hint">
                Carica un'immagine, scegli o scrivi l'istruzione ed estrai il testo.
              </p>
            )}

            {result && (
              <>
                <div className="oc-result-block">
                  <div className="oc-block-head">
                    <span>Testo estratto</span>
                    <button className="oc-button" onClick={copyText}>
                      {copied ? 'Copiato ✓' : 'Copia'}
                    </button>
                  </div>
                  <pre className="oc-pre">{result.text}</pre>
                </div>

                {result.isJcs && (
                  <div className="oc-result-block oc-jcs">
                    <div className="oc-block-head">
                      <span>🧾 Interpretazione JCS</span>
                    </div>
                    <pre className="oc-pre">{result.jcs}</pre>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <footer className="oc-footer">
          <span>Test7 · OCR Lab</span>
          <span>qwen2.5-vl locale via Ollama</span>
          <Link to="/image-lab">Image Lab ↗</Link>
        </footer>
      </div>
    </div>
  )
}

const CSS = `
.oc-page{min-height:100vh;padding:2rem 1.25rem 3rem;color:#e7edf1;
  background:radial-gradient(1200px 600px at 70% -10%,rgba(63,208,201,.08),transparent),#0b1015;
  font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
.oc-container{max-width:1180px;margin:0 auto}
.oc-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8rem;min-height:70vh;text-align:center}
.oc-header{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;flex-wrap:wrap;margin-bottom:1.4rem}
.oc-header h1{margin:.2rem 0 .1rem;font-size:1.9rem;letter-spacing:-.02em}
.oc-sub{margin:0;color:#8fa1ac;font-size:.9rem}
.oc-eyebrow{margin:0;color:#3fd0c9;font-size:.7rem;font-weight:700;letter-spacing:.14em}
.oc-account{display:flex;align-items:center;gap:.6rem;font-size:.85rem;color:#8fa1ac;flex-wrap:wrap}
.oc-account span{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-gbtn{min-height:36px}
.oc-layout{display:grid;grid-template-columns:1fr 1fr;gap:1.1rem;align-items:start}
.oc-panel{background:rgba(16,23,30,.72);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:1.2rem;backdrop-filter:blur(10px)}
.oc-panel h2{margin:.15rem 0 .9rem;font-size:1.15rem}
.oc-label{display:block;margin:.9rem 0 .35rem;font-size:.78rem;font-weight:600;color:#c9d6de}
.oc-file-row{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;
  padding:.7rem;border:1px dashed rgba(255,255,255,.16);border-radius:9px;background:rgba(0,0,0,.22)}
.oc-file-row input[type=file]{max-width:260px;font-size:.8rem;color:#8fa1ac}
.oc-preview{width:76px;height:76px;object-fit:cover;border-radius:7px;border:1px solid rgba(255,255,255,.14)}
.oc-textarea{width:100%;box-sizing:border-box;resize:vertical;padding:.7rem .8rem;border-radius:9px;
  border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.28);color:#e7edf1;font:inherit;font-size:.88rem;line-height:1.55}
.oc-textarea:focus{outline:none;border-color:#3fd0c9}
.oc-presets{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-top:.5rem}
.oc-preset{font-size:.72rem;padding:.3rem .6rem}
.oc-button{display:inline-flex;align-items:center;gap:.35rem;padding:.45rem .85rem;border-radius:8px;
  border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#e7edf1;
  font:inherit;font-size:.8rem;cursor:pointer;text-decoration:none;transition:background .15s,border-color .15s}
.oc-button:hover:not(:disabled){background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.3)}
.oc-button:disabled{opacity:.45;cursor:not-allowed}
.oc-primary{background:#3fd0c9;border-color:#3fd0c9;color:#071212;font-weight:700}
.oc-primary:hover:not(:disabled){background:#6fe3dd;border-color:#6fe3dd}
.oc-actions{display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap}
.oc-error{margin-top:.8rem;padding:.6rem .8rem;border-radius:8px;border:1px solid rgba(248,113,113,.5);
  background:rgba(248,113,113,.12);color:#fca5a5;font-size:.85rem}
.oc-hint{margin:.45rem 0 0;color:#8fa1ac;font-size:.78rem}
.oc-result-head{display:flex;justify-content:space-between;align-items:center;gap:.8rem}
.oc-live{color:#3fd0c9;font-size:.75rem;font-weight:700;letter-spacing:.12em;animation:oc-pulse 1.6s infinite}
@keyframes oc-pulse{0%,100%{opacity:.5}50%{opacity:1}}
.oc-progress{display:flex;flex-direction:column;align-items:center;gap:.8rem;padding:2rem 0;color:#8fa1ac;font-size:.9rem}
.oc-spinner{width:34px;height:34px;border-radius:50%;border:3px solid rgba(63,208,201,.25);border-top-color:#3fd0c9;animation:oc-rot .9s linear infinite}
@keyframes oc-rot{to{transform:rotate(360deg)}}
.oc-result-block{margin-top:1rem;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(0,0,0,.26);overflow:hidden}
.oc-block-head{display:flex;justify-content:space-between;align-items:center;gap:.6rem;
  padding:.55rem .8rem;border-bottom:1px solid rgba(255,255,255,.08);font-size:.78rem;font-weight:700;color:#c9d6de}
.oc-pre{margin:0;padding:.8rem;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  font-size:.82rem;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}
.oc-jcs{border-color:rgba(63,208,201,.4)}
.oc-jcs .oc-block-head{color:#3fd0c9}
.oc-footer{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;
  margin-top:1.6rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,.08);color:#8fa1ac;font-size:.78rem}
.oc-footer a{color:#3fd0c9;text-decoration:none}
.oc-footer a:hover{text-decoration:underline}
@media (max-width:880px){.oc-layout{grid-template-columns:1fr}}
@media (max-width:560px){
  .oc-page{padding:1.1rem .75rem 2rem}
  .oc-panel{padding:.9rem}
  .oc-account span{max-width:140px}
}
`
