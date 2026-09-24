import { useEffect, useRef, useState } from 'react'
import bgImage from '../assets/DataInFlames.jpg'

// Base URL del Gateway pubblico Lele (SENZA /api/admin)
const LELE_API_URL = 'https://api.danielevillanova.com'

// Client ID Google, da .env (Vite): VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

const TOKEN_STORAGE_KEY = 'leles_admin_id_token'
const CHAT_ID_STORAGE_KEY = 'leles_admin_chat_id'

function getOrCreateChatId() {
  try {
    const stored = window.sessionStorage.getItem(CHAT_ID_STORAGE_KEY)
    if (stored) return parseInt(stored, 10)
    const newId = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000
    window.sessionStorage.setItem(CHAT_ID_STORAGE_KEY, String(newId))
    return newId
  } catch (e) {
    return Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000
  }
}

// Decodifica minimale del payload JWT (solo per mostrare nome/email in UI,
// NON è verifica: la verifica vera è lato server sul gateway).
function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(window.atob(base64))))
  } catch (e) {
    return null
  }
}

export default function LeleAdmin() {
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
  const [response, setResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const buttonRef = useRef(null)
  const chatIdRef = useRef(getOrCreateChatId())

  // --------------------------------------------------
  // GOOGLE IDENTITY SERVICES — init + render bottone
  // --------------------------------------------------
  useEffect(() => {
    if (idToken) return // già loggato, non serve il bottone

    let cancelled = false

    function tryInit() {
      if (cancelled) return
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        setTimeout(tryInit, 150)
        return
      }
      if (!GOOGLE_CLIENT_ID) {
        setAuthError(
          'GOOGLE_CLIENT_ID non configurato nel frontend (VITE_GOOGLE_CLIENT_ID mancante).'
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
    setAuthError('')
    setProfile(decodeJwtPayload(token))
    setIdToken(token)
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } catch (e) {
      // sessionStorage non disponibile: la sessione non sopravvive al refresh
    }
  }

  function logout() {
    setIdToken(null)
    setProfile(null)
    setResponse('')
    setError('')
    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      if (window.google?.accounts?.id) {
        window.google.accounts.id.disableAutoSelect()
      }
    } catch (e) {
      // no-op
    }
  }

  // --------------------------------------------------
  // INVIO PROMPT → /api/admin/chat
  // --------------------------------------------------
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!prompt.trim() || !idToken) return

    setIsLoading(true)
    setResponse('')
    setError('')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000)

    try {
      const res = await fetch(`${LELE_API_URL}/api/admin/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          prompt,
          language: 'en',
          chat_id: chatIdRef.current,
        }),
      })

      clearTimeout(timeoutId)

      if (res.status === 401 || res.status === 403) {
        // Token scaduto o email non autorizzata: forza nuovo login
        logout()
        setError(
          res.status === 401
            ? 'Sessione scaduta, effettua di nuovo il login.'
            : 'Accesso non autorizzato per questo account Google.'
        )
        return
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()

      if (data.answer) {
        setResponse(data.answer)
      } else if (data.error) {
        setResponse(data.error)
      } else if (data.detail) {
        setResponse(
          typeof data.detail === 'string'
            ? data.detail
            : JSON.stringify(data.detail, null, 2)
        )
      } else {
        setResponse('Nessuna risposta ricevuta')
      }
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

  // --------------------------------------------------
  // UI
  // --------------------------------------------------
  return (
    <section className="section container" style={styles.wrap}>
      <img src={bgImage} alt="" style={styles.bgImg} />
      <div style={styles.overlay} />

      <div style={styles.content}>
        <p className="section-label">Leles</p>
        <h2 className="section-title">Lele Admin Console</h2>

        {!idToken ? (
          <div style={styles.loginBox}>
            <p style={styles.loginText}>
              Accesso riservato. Effettua il login con l'account Google
              autorizzato.
            </p>
            {authError && <p style={styles.authErrorText}>⚠️ {authError}</p>}
            <div ref={buttonRef} style={styles.googleButtonSlot} />
            {!gsiReady && !authError && (
              <p style={styles.loadingText}>Caricamento login Google…</p>
            )}
          </div>
        ) : (
          <div style={styles.promptContainer}>
            <div style={styles.sessionRow}>
              <span style={styles.sessionLabel}>
                Connesso come {profile?.email || 'account Google'}
              </span>
              <button type="button" onClick={logout} style={styles.logoutButton}>
                Logout
              </button>
            </div>

            {error && (
              <div style={styles.errorBox}>
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} style={styles.form}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Comando o domanda per Lele Admin..."
                style={styles.textarea}
                rows={4}
              />
              <div style={styles.buttonsRow}>
                <button
                  type="submit"
                  disabled={isLoading || !prompt.trim()}
                  style={styles.button}
                >
                  {isLoading ? 'Thinking...' : 'Invia'}
                </button>
              </div>
            </form>

            {response && (
              <div style={styles.response}>
                <h3 style={styles.responseTitle}>Risposta</h3>
                <pre style={styles.responseText}>{response}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

const styles = {
  wrap: {
    position: 'relative',
    minHeight: '70vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bgImg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: 0.5,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(11,16,21,0.35) 0%, rgba(11,16,21,0.9) 100%)',
  },
  content: {
    position: 'relative',
    width: '100%',
    maxWidth: '700px',
    margin: '0 auto',
  },
  loginBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    padding: '32px 24px',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    marginTop: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    textAlign: 'center',
  },
  loginText: {
    color: '#cbd5e1',
    fontSize: '15px',
    margin: 0,
  },
  authErrorText: {
    color: '#ff6b6b',
    fontSize: '14px',
    margin: 0,
  },
  loadingText: {
    color: '#8fa1ac',
    fontSize: '13px',
    margin: 0,
  },
  googleButtonSlot: {
    minHeight: '44px',
  },
  promptContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    padding: '24px',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    marginTop: '20px',
  },
  sessionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  sessionLabel: {
    color: '#8fa1ac',
    fontSize: '13px',
  },
  logoutButton: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    color: '#cbd5e1',
    fontSize: '12px',
    cursor: 'pointer',
  },
  errorBox: {
    backgroundColor: 'rgba(255, 100, 100, 0.2)',
    border: '1px solid #ff6b6b',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '16px',
    color: '#ff6b6b',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  textarea: {
    padding: '14px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: '#e2e8f0',
    fontSize: '16px',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  buttonsRow: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  button: {
    padding: '14px 24px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  response: {
    marginTop: '24px',
    padding: '16px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
  },
  responseTitle: {
    color: '#e2e8f0',
    fontSize: '18px',
    margin: '0 0 12px 0',
  },
  responseText: {
    color: '#e2e8f0',
    whiteSpace: 'pre-wrap',
    margin: 0,
    fontFamily: 'inherit',
    fontSize: '15px',
    lineHeight: 1.5,
  },
}
