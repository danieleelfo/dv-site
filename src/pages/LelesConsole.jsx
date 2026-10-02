import { useEffect, useRef, useState } from 'react'
import bgImage from '../assets/DataInFlames.jpg'

const LELE_API_URL = 'https://api.danielevillanova.com'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

const TOKEN_STORAGE_KEY = 'leles_admin_id_token'
const CHAT_ID_STORAGE_KEY = 'leles_admin_chat_id'

// --- TEST TEMPORANEO: whitelist email per accesso alla console -----------
// TODO: rimuovere/estendere quando arriva il login Telegram con ADMIN_IDS
// (8733881519, 8249666123), gestiti separatamente lato Leles.
const ALLOWED_EMAILS = ['dannybydanny@hotmail.com']

// Forziamo il chat_id a coincidere con un ADMIN_IDS di Leles, così i comandi
// riservati al "capitano" funzionano anche dalla console web.
// TODO: da sostituire con l'id reale assegnato al login Telegram, quando
// implementato, invece di uno dei due ADMIN_IDS fissi.
const FORCED_ADMIN_CHAT_ID = 8733881519
// ---------------------------------------------------------------------------

function getOrCreateChatId() {
  return FORCED_ADMIN_CHAT_ID
}

function decodeJwtPayload(token) {
  try {
    const base64 = token
      .split('.')[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(window.atob(base64))))
  } catch (e) {
    return null
  }
}

export default function LelesConsole() {
  const [idToken, setIdToken] = useState(() => {
    try {
      return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || null
    } catch (e) {
      return null
    }
  })
  const [profile, setProfile] = useState(() =>
    idToken ? decodeJwtPayload(idToken) : null
  )
  const [authError, setAuthError] = useState('')
  const [gsiReady, setGsiReady] = useState(false)

  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [response, setResponse] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState([])

  const buttonRef = useRef(null)
  const chatIdRef = useRef(getOrCreateChatId())

  useEffect(() => {
    if (!idToken) return
    const decoded = decodeJwtPayload(idToken)
    const email = decoded?.email?.toLowerCase()
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      logout()
      setAuthError('Accesso non autorizzato per questo account Google.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (idToken) return
    let cancelled = false
    function tryInit() {
      if (cancelled) return
      if (!window.google?.accounts?.id) {
        setTimeout(tryInit, 150)
        return
      }
      if (!GOOGLE_CLIENT_ID) {
        setAuthError(
          'GOOGLE_CLIENT_ID non configurato (VITE_GOOGLE_CLIENT_ID mancante).'
        )
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
          size: 'large',
          text: 'signin_with',
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
    const decoded = decodeJwtPayload(token)
    const email = decoded?.email?.toLowerCase()
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      setAuthError('Accesso non autorizzato per questo account Google.')
      try {
        window.google?.accounts?.id?.disableAutoSelect()
      } catch (e) {}
      return
    }
    setAuthError('')
    setProfile(decoded)
    setIdToken(token)
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } catch (e) {}
  }

  function logout() {
    setIdToken(null)
    setProfile(null)
    setResponse('')
    setError('')
    setHistory([])
    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      window.google?.accounts?.id?.disableAutoSelect()
    } catch (e) {}
  }

  async function sendCommand(e) {
    e?.preventDefault?.()
    if (!idToken || !prompt.trim()) return
    setIsLoading(true)
    setResponse('')
    setError('')
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 310000)
    try {
      const res = await fetch(`${LELE_API_URL}/api/admin/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: prompt.trim(),
          language: 'en',
          chat_id: chatIdRef.current,
        }),
      })
      clearTimeout(timeoutId)
      if (res.status === 401 || res.status === 403) {
        logout()
        setError(
          res.status === 401
            ? 'Sessione scaduta, effettua di nuovo il login.'
            : 'Accesso non autorizzato.'
        )
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      const data = await res.json()
      let answer = ''
      if (data.answer) answer = data.answer
      else if (data.error) answer = data.error
      else if (data.detail)
        answer =
          typeof data.detail === 'string'
            ? data.detail
            : JSON.stringify(data.detail, null, 2)
      else answer = 'Nessuna risposta ricevuta'
      setResponse(answer)
      setHistory((h) => [
        ...h,
        { prompt: prompt.trim(), answer, ts: Date.now() },
      ])
      setPrompt('')
    } catch (err) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        setError('Timeout: il server non ha risposto in tempo.')
      } else {
        setError(err.message)
      }
    } finally {
      setIsLoading(false)
    }
  }

  if (!idToken) {
    return (
      <section className="section container" style={styles.wrap}>
        <img src={bgImage} alt="" style={styles.bgImg} />
        <div style={styles.overlay} />
        <div style={styles.content}>
          <h2 style={styles.pageTitle}>Leles Console</h2>
          <div style={styles.loginBox}>
            <p style={styles.loginText}>
              Accesso riservato. Login Google per usare la console admin.
            </p>
            {authError && <p style={styles.authErrorText}>⚠️ {authError}</p>}
            <div ref={buttonRef} style={styles.googleButtonSlot} />
            {!gsiReady && !authError && (
              <p style={styles.loadingText}>Caricamento login Google…</p>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="section container" style={styles.wrap}>
      <img src={bgImage} alt="" style={styles.bgImg} />
      <div style={styles.overlay} />
      <div style={styles.contentWide}>
        <div style={styles.titleRow}>
          <div>
            <h2 style={styles.pageTitle}>Leles Console</h2>
            <p style={styles.subtitle}>Console admin — comandi Leles via gateway</p>
          </div>
          <div style={styles.sessionBox}>
            <span style={styles.sessionLabel}>
              {profile?.email || 'account Google'}
            </span>
            <button type="button" onClick={logout} style={styles.logoutButton}>
              Logout
            </button>
          </div>
        </div>

        <form onSubmit={sendCommand} style={styles.form}>
          <label style={styles.field}>
            <span style={styles.label}>Comando</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="status sistema"
              rows={3}
              style={styles.textarea}
            />
          </label>
          <button
            type="submit"
            disabled={isLoading || !prompt.trim()}
            style={{
              ...styles.launchBtn,
              ...(isLoading || !prompt.trim() ? styles.buttonDisabled : {}),
            }}
          >
            {isLoading ? '⏳ Invio…' : '▶ Invia'}
          </button>
        </form>

        {error && (
          <div style={styles.errorBox}>
            <strong>⚠️ Errore</strong>
            <p>{error}</p>
          </div>
        )}

        {response && (
          <div style={styles.response}>
            <div style={styles.responseHeader}>
              <h3 style={styles.responseTitle}>Risposta</h3>
              <button
                type="button"
                onClick={() => setResponse('')}
                style={styles.secondaryBtn}
              >
                Chiudi
              </button>
            </div>
            <pre style={styles.responsePre}>{response}</pre>
          </div>
        )}

        {history.length > 0 && (
          <div style={styles.history}>
            <h3 style={styles.responseTitle}>Storico</h3>
            {history
              .slice()
              .reverse()
              .map((h, i) => (
                <div key={i} style={styles.historyItem}>
                  <div style={styles.historyPrompt}>{h.prompt}</div>
                  <pre style={styles.historyAnswer}>{h.answer}</pre>
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  )
}

const styles = {
  wrap: {
    position: 'relative',
    minHeight: '100vh',
    paddingTop: '5.5rem',
    paddingBottom: '3rem',
  },
  bgImg: {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: 0.35,
    zIndex: 0,
    pointerEvents: 'none',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(8,12,18,0.75) 0%, rgba(8,12,18,0.92) 100%)',
    zIndex: 0,
    pointerEvents: 'none',
  },
  content: {
    position: 'relative',
    zIndex: 1,
    maxWidth: 520,
    margin: '0 auto',
  },
  contentWide: {
    position: 'relative',
    zIndex: 1,
    maxWidth: 800,
    margin: '0 auto',
  },
  pageTitle: {
    margin: 0,
    fontSize: '1.75rem',
    color: '#e8f1f5',
  },
  subtitle: {
    margin: '0.35rem 0 0',
    color: '#8fa1ac',
    fontSize: '0.9rem',
  },
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1.25rem',
    flexWrap: 'wrap',
  },
  sessionBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
  },
  sessionLabel: {
    color: '#a8b8c4',
    fontSize: '0.85rem',
  },
  logoutButton: {
    background: 'transparent',
    border: '1px solid #3a4a58',
    color: '#c5d4de',
    borderRadius: 999,
    padding: '0.35rem 0.85rem',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  loginBox: {
    marginTop: '1.5rem',
    padding: '1.5rem',
    background: 'rgba(18,26,34,0.85)',
    border: '1px solid #1f2b35',
    borderRadius: 12,
    textAlign: 'center',
  },
  loginText: { color: '#c5d4de', marginBottom: '1rem' },
  authErrorText: { color: '#ff8f8f', marginBottom: '0.75rem' },
  loadingText: { color: '#8fa1ac', fontSize: '0.85rem' },
  googleButtonSlot: {
    display: 'flex',
    justifyContent: 'center',
    minHeight: 40,
  },
  form: {
    background: 'rgba(18,26,34,0.88)',
    border: '1px solid #1f2b35',
    borderRadius: 12,
    padding: '1.25rem',
    marginBottom: '1rem',
  },
  field: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  label: {
    color: '#8fa1ac',
    fontSize: '0.75rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  textarea: {
    background: '#0b1015',
    border: '1px solid #2a3a48',
    borderRadius: 8,
    color: '#e8f1f5',
    padding: '0.55rem 0.7rem',
    fontSize: '0.9rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    resize: 'vertical',
  },
  launchBtn: {
    marginTop: '0.75rem',
    background: 'linear-gradient(135deg, #1a9e96, #0d6b66)',
    border: 'none',
    color: '#e8f1f5',
    borderRadius: 999,
    padding: '0.65rem 1.25rem',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 600,
  },
  buttonDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  secondaryBtn: {
    background: 'transparent',
    border: '1px solid #3a4a58',
    color: '#c5d4de',
    borderRadius: 999,
    padding: '0.45rem 0.9rem',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  errorBox: {
    marginTop: '1rem',
    padding: '0.85rem 1rem',
    background: 'rgba(80,20,20,0.55)',
    border: '1px solid #7a3030',
    borderRadius: 10,
    color: '#ffb0b0',
  },
  response: {
    marginTop: '1.25rem',
    background: 'rgba(18,26,34,0.9)',
    border: '1px solid #1f2b35',
    borderRadius: 12,
    overflow: 'hidden',
  },
  responseHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #1f2b35',
  },
  responseTitle: {
    margin: 0,
    fontSize: '0.95rem',
    color: '#e8f1f5',
  },
  responsePre: {
    margin: 0,
    padding: '1rem',
    color: '#c5d4de',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: 1.55,
  },
  history: {
    marginTop: '1.5rem',
  },
  historyItem: {
    marginTop: '0.75rem',
    padding: '0.75rem',
    background: 'rgba(18,26,34,0.7)',
    border: '1px solid #1f2b35',
    borderRadius: 8,
  },
  historyPrompt: {
    color: '#3fd0c9',
    fontSize: '0.85rem',
    marginBottom: '0.35rem',
  },
  historyAnswer: {
    color: '#c5d4de',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    margin: 0,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: 1.55,
  },
}
