import { useEffect, useRef, useState } from 'react'
import bgImage from '../assets/DataInFlames.jpg'

// ============================================================
// CONFIG — IDENTICA A LELE ADMIN
// ============================================================

const LELE_API_URL = 'https://api.danielevillanova.com'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

const TOKEN_STORAGE_KEY = 'leles_admin_id_token'
const CHAT_ID_STORAGE_KEY = 'leles_admin_chat_id'

// ============================================================
// CHAT ID
// ============================================================

function getOrCreateChatId() {
  try {
    const stored = window.sessionStorage.getItem(CHAT_ID_STORAGE_KEY)

    if (stored) {
      return parseInt(stored, 10)
    }

    const newId =
      Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000

    window.sessionStorage.setItem(
      CHAT_ID_STORAGE_KEY,
      String(newId)
    )

    return newId
  } catch (e) {
    return Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000
  }
}

// ============================================================
// JWT
// ============================================================

function decodeJwtPayload(token) {
  try {
    const base64 = token
      .split('.')[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')

    return JSON.parse(
      decodeURIComponent(
        escape(window.atob(base64))
      )
    )
  } catch (e) {
    return null
  }
}

// ============================================================
// COMANDI
//
// IMPORTANTE:
// il click NON esegue il comando.
// Lo mette semplicemente nel textarea.
// ============================================================

const COMMAND_GROUPS = [
  {
    id: 'system',
    title: 'SYSTEM',
    icon: '⚙️',
    commands: [
      {
        label: 'Status sistema',
        command: 'status sistema',
      },
      {
        label: 'Status RAM',
        command: 'status ram',
      },
      {
        label: 'Status OS',
        command: 'status os',
      },
      {
        label: 'Status IP',
        command: 'status ip',
      },
      {
        label: 'Uvicorn status',
        command: 'uvicorn status',
      },
      {
        label: 'Telegram status',
        command: 'telegram status',
      },
      {
        label: 'Logs Leles',
        command: 'logs leles',
      },
    ],
  },

  {
    id: 'agents',
    title: 'AGENTI',
    icon: '🤖',
    commands: [
      {
        label: 'Start Lele',
        command: 'start lele',
      },
      {
        label: 'Stop Lele',
        command: 'stop lele',
      },
      {
        label: 'Restart Lele',
        command: 'restart lele',
      },
      {
        label: 'Logs Lele',
        command: 'logs lele',
      },
      {
        label: 'Logs Story Whisper',
        command: 'logs story whisper',
      },
      {
        label: 'Logs Night Story',
        command: 'logs night story',
      },
      {
        label: 'Telegram status',
        command: 'telegram status',
      },
    ],
  },

  {
    id: 'airflow',
    title: 'AIRFLOW',
    icon: '🌬️',
    commands: [
      {
        label: 'Status Airflow',
        command: 'status airflow',
      },
      {
        label: 'Status DAG',
        command: 'status dag',
      },
      {
        label: 'Log task',
        command: 'log task ',
        hint: 'Aggiungi DAG/task o i parametri richiesti',
      },
      {
        label: 'Pausa DAG',
        command: 'pausa dag ',
        hint: 'Aggiungi il dag_id',
      },
      {
        label: 'Attiva DAG',
        command: 'attiva dag ',
        hint: 'Aggiungi il dag_id',
      },
      {
        label: 'Lancia DAG',
        command: 'exec airflow lancia ',
        hint: 'Aggiungi dag_id e, se necessario, conf: {...}',
      },
    ],
  },

  {
    id: 'emergence',
    title: 'EMERGENCE / QE',
    icon: '🧠',
    commands: [
      {
        label: 'QE last 10',
        command: 'QE last 10',
      },
      {
        label: 'QE status',
        command: 'QE status ',
        hint: 'Aggiungi run_id se necessario',
      },
      {
        label: 'Decisione',
        command: 'decisione ',
        hint: 'Aggiungi run_id',
      },
      {
        label: 'Decisione run',
        command: 'decisione run ',
        hint: 'Aggiungi run_id',
      },
      {
        label: 'Decisione DAG',
        command: 'decisione dag ',
        hint: 'Aggiungi run_id',
      },
      {
        label: 'Sintetizza',
        command: 'sintetizza ',
        hint: 'Aggiungi run_id',
      },
      {
        label: 'Query worlds',
        command: 'query worlds',
      },
      {
        label: 'Query world',
        command: 'query world ',
        hint: 'Aggiungi world id',
      },
      {
        label: 'Save world',
        command: 'save world ',
        hint: 'Esempio: save world nome as "descrizione"',
      },
    ],
  },

  {
    id: 'files',
    title: 'FILES',
    icon: '📁',
    commands: [
      {
        label: 'Directory',
        command: 'directory',
      },
      {
        label: 'LS',
        command: 'ls ',
        hint: 'Aggiungi percorso se necessario',
      },
      {
        label: 'Invia file',
        command: 'invia file ',
        hint: 'Aggiungi percorso/nome file',
      },
      {
        label: 'Remote test',
        command: 'remoto test',
      },
      {
        label: 'Remote LS',
        command: 'remoto ls ',
        hint: 'Aggiungi percorso',
      },
      {
        label: 'Remote download',
        command: 'remoto download ',
        hint: 'Aggiungi file',
      },
      {
        label: 'Remote upload',
        command: 'remoto upload ',
        hint: 'Aggiungi file',
      },
    ],
  },

  {
    id: 'ai',
    title: 'AI / CODE',
    icon: '✨',
    commands: [
      {
        label: 'Query',
        command: 'query ',
        hint: 'Scrivi la query',
      },
      {
        label: 'Improve',
        command: 'improve ',
        hint: 'Aggiungi file o richiesta',
      },
      {
        label: 'Verifica',
        command: 'verifica ',
        hint: 'Aggiungi file o richiesta',
      },
      {
        label: 'Review',
        command: 'review ',
        hint: 'Aggiungi file o richiesta',
      },
      {
        label: 'Gemma',
        command: 'gemma ',
        hint: 'Aggiungi prompt',
      },
      {
        label: 'Llama',
        command: 'llama ',
        hint: 'Aggiungi prompt',
      },
    ],
  },

  {
    id: 'git',
    title: 'GIT',
    icon: '🔀',
    commands: [
      {
        label: 'Git status',
        command: 'git status',
      },
      {
        label: 'Git diff',
        command: 'git diff',
      },
      {
        label: 'Git commit',
        command: 'git commit ',
        hint: 'Aggiungi messaggio',
      },
      {
        label: 'Git pull report',
        command: 'git pull report',
      },
      {
        label: 'Git pull force',
        command: 'git pull force',
      },
    ],
  },

  {
    id: 'leles',
    title: 'LELES',
    icon: '🏴‍☠️',
    commands: [
      {
        label: 'Restart Lelé',
        command: 'restart Lelé',
      },
      {
        label: 'Status sistema',
        command: 'status sistema',
      },
      {
        label: 'Status Airflow',
        command: 'status airflow',
      },
      {
        label: 'Export DAG',
        command: 'export dag ',
        hint: 'Aggiungi dag_id',
      },
      {
        label: 'Crea DAG',
        command: 'crea dag ',
        hint: 'Descrivi il DAG da creare',
      },
    ],
  },
]

// ============================================================
// COMPONENT
// ============================================================

export default function ConsoleTest() {
  console.log('🔥 CONSOLE TEST MONTATA')

  // ----------------------------------------------------------
  // AUTH
  // ----------------------------------------------------------

  const [idToken, setIdToken] = useState(() => {
    try {
      return (
        window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
        null
      )
    } catch (e) {
      return null
    }
  })

  const [profile, setProfile] = useState(() =>
    idToken ? decodeJwtPayload(idToken) : null
  )

  const [authError, setAuthError] = useState('')
  const [gsiReady, setGsiReady] = useState(false)

  // ----------------------------------------------------------
  // PROMPT
  // ----------------------------------------------------------

  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const [openGroup, setOpenGroup] = useState(null)

  const buttonRef = useRef(null)
  const chatIdRef = useRef(getOrCreateChatId())

  // ----------------------------------------------------------
  // GOOGLE IDENTITY SERVICES
  // ----------------------------------------------------------

  useEffect(() => {
    if (idToken) return

    let cancelled = false

    function tryInit() {
      if (cancelled) return

      if (
        !window.google ||
        !window.google.accounts ||
        !window.google.accounts.id
      ) {
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
        window.google.accounts.id.renderButton(
          buttonRef.current,
          {
            type: 'standard',
            theme: 'filled_black',
            size: 'large',
            text: 'signin_with',
            shape: 'pill',
          }
        )
      }

      setGsiReady(true)
    }

    tryInit()

    return () => {
      cancelled = true
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken])

  // ----------------------------------------------------------
  // GOOGLE LOGIN
  // ----------------------------------------------------------

  function handleCredentialResponse(credentialResponse) {
    const token = credentialResponse?.credential

    if (!token) {
      setAuthError(
        'Login Google fallito: nessun token ricevuto.'
      )
      return
    }

    setAuthError('')
    setProfile(decodeJwtPayload(token))
    setIdToken(token)

    try {
      window.sessionStorage.setItem(
        TOKEN_STORAGE_KEY,
        token
      )
    } catch (e) {
      // no-op
    }
  }

  // ----------------------------------------------------------
  // LOGOUT
  // ----------------------------------------------------------

  function logout() {
    setIdToken(null)
    setProfile(null)
    setResponse('')
    setError('')

    try {
      window.sessionStorage.removeItem(
        TOKEN_STORAGE_KEY
      )

      if (window.google?.accounts?.id) {
        window.google.accounts.id.disableAutoSelect()
      }
    } catch (e) {
      // no-op
    }
  }

  // ----------------------------------------------------------
  // PREPARA COMANDO
  // ----------------------------------------------------------

  function selectCommand(command) {
    setPrompt(command.command)
    setResponse('')
    setError('')

    // porta il cursore nel textarea dopo il render
    setTimeout(() => {
      const textarea =
        document.getElementById('leles-command-input')

      if (textarea) {
        textarea.focus()
        textarea.setSelectionRange(
          textarea.value.length,
          textarea.value.length
        )
      }
    }, 50)
  }

  // ----------------------------------------------------------
  // INVIO PROMPT
  // ----------------------------------------------------------

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!prompt.trim() || !idToken) {
      return
    }

    setIsLoading(true)
    setResponse('')
    setError('')

    const controller = new AbortController()

    const timeoutId = setTimeout(
      () => controller.abort(),
      310000
    )

    try {
      const res = await fetch(
        `${LELE_API_URL}/api/admin/chat`,
        {
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
        }
      )

      clearTimeout(timeoutId)

      if (
        res.status === 401 ||
        res.status === 403
      ) {
        logout()

        setError(
          res.status === 401
            ? 'Sessione scaduta, effettua di nuovo il login.'
            : 'Accesso non autorizzato per questo account Google.'
        )

        return
      }

      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status}: ${res.statusText}`
        )
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
            : JSON.stringify(
                data.detail,
                null,
                2
              )
        )
      } else {
        setResponse(
          'Nessuna risposta ricevuta'
        )
      }
    } catch (err) {
      clearTimeout(timeoutId)

      if (err.name === 'AbortError') {
        setError(
          'Timeout: il server non ha risposto in tempo.'
        )
      } else {
        setError(err.message)
      }
    } finally {
      setIsLoading(false)
    }
  }

  // ----------------------------------------------------------
  // LOGIN
  // ----------------------------------------------------------

  if (!idToken) {
    return (
      <section
        className="section container"
        style={styles.wrap}
      >
        <img
          src={bgImage}
          alt=""
          style={styles.bgImg}
        />

        <div style={styles.overlay} />

        <div style={styles.content}>
          <p className="section-label">
            Leles
          </p>

          <h2 className="section-title">
            Lele Admin Console
          </h2>

          <div style={styles.loginBox}>
            <div style={styles.testBadge}>
              TEST 5
            </div>

            <p style={styles.loginText}>
              Accesso riservato. Effettua il
              login con l'account Google
              autorizzato.
            </p>

            {authError && (
              <p style={styles.authErrorText}>
                ⚠️ {authError}
              </p>
            )}

            <div
              ref={buttonRef}
              style={styles.googleButtonSlot}
            />

            {!gsiReady && !authError && (
              <p style={styles.loadingText}>
                Caricamento login Google…
              </p>
            )}
          </div>
        </div>
      </section>
    )
  }

  // ----------------------------------------------------------
  // DASHBOARD
  // ----------------------------------------------------------

  return (
    <section
      className="section container"
      style={styles.wrap}
    >
      <img
        src={bgImage}
        alt=""
        style={styles.bgImg}
      />

      <div style={styles.overlay} />

      <div style={styles.contentWide}>

        {/* HEADER */}

        <div style={styles.header}>
          <div>
            <div style={styles.testBadge}>
              TEST 5
            </div>

            <p className="section-label">
              Leles
            </p>

            <h2 className="section-title">
              Lele Admin Console
            </h2>

            <p style={styles.subtitle}>
              Command center
            </p>
          </div>

          <div style={styles.sessionBox}>
            <span style={styles.sessionLabel}>
              {profile?.email ||
                'account Google'}
            </span>

            <button
              type="button"
              onClick={logout}
              style={styles.logoutButton}
            >
              Logout
            </button>
          </div>
        </div>

        {/* COMMAND CENTER */}

        <div style={styles.dashboard}>

          <div style={styles.dashboardTitle}>
            <span>
              🏴‍☠️ Comandi Leles
            </span>

            <span style={styles.dashboardHint}>
              Seleziona → modifica → esegui
            </span>
          </div>

          {/* MACRO BUTTONS */}

          <div style={styles.groupGrid}>
            {COMMAND_GROUPS.map((group) => {
              const isOpen =
                openGroup === group.id

              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() =>
                    setOpenGroup(
                      isOpen
                        ? null
                        : group.id
                    )
                  }
                  style={{
                    ...styles.groupButton,
                    ...(isOpen
                      ? styles.groupButtonActive
                      : {}),
                  }}
                >
                  <span style={styles.groupIcon}>
                    {group.icon}
                  </span>

                  <span>
                    {group.title}
                  </span>

                  <span style={styles.chevron}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </button>
              )
            })}
          </div>

          {/* COMMAND PANEL */}

          {openGroup && (
            <div style={styles.commandPanel}>
              {COMMAND_GROUPS
                .find(
                  (group) =>
                    group.id === openGroup
                )
                ?.commands.map(
                  (command, index) => (
                    <button
                      key={`${openGroup}-${index}`}
                      type="button"
                      onClick={() =>
                        selectCommand(command)
                      }
                      style={styles.commandButton}
                    >
                      <span>
                        {command.label}
                      </span>

                      {command.hint && (
                        <small
                          style={
                            styles.commandHint
                          }
                        >
                          {command.hint}
                        </small>
                      )}
                    </button>
                  )
                )}
            </div>
          )}

          {/* PROMPT */}

          <form
            onSubmit={handleSubmit}
            style={styles.form}
          >
            <div style={styles.inputHeader}>
              <label
                htmlFor="leles-command-input"
                style={styles.inputLabel}
              >
                Parla con Leles
              </label>

              <button
                type="button"
                onClick={() => {
                  setPrompt('')
                  setResponse('')
                  setError('')
                }}
                style={styles.clearButton}
              >
                Pulisci
              </button>
            </div>

            <textarea
              id="leles-command-input"
              value={prompt}
              onChange={(e) =>
                setPrompt(e.target.value)
              }
              placeholder="Scrivi un comando o parla liberamente con Leles…"
              style={styles.textarea}
              rows={5}
            />

            <div style={styles.buttonsRow}>
              <button
                type="submit"
                disabled={
                  isLoading ||
                  !prompt.trim()
                }
                style={{
                  ...styles.executeButton,
                  ...(isLoading ||
                  !prompt.trim()
                    ? styles.buttonDisabled
                    : {}),
                }}
              >
                {isLoading
                  ? '⏳ Leles sta lavorando…'
                  : '▶ ESEGUI'}
              </button>
            </div>
          </form>

          {/* ERROR */}

          {error && (
            <div style={styles.errorBox}>
              <strong>
                ⚠️ Errore
              </strong>

              <p>{error}</p>
            </div>
          )}

          {/* RESPONSE */}

          {response && (
            <div style={styles.response}>
              <div
                style={
                  styles.responseHeader
                }
              >
                <h3
                  style={
                    styles.responseTitle
                  }
                >
                  Risposta Leles
                </h3>

                <button
                  type="button"
                  onClick={() =>
                    setResponse('')
                  }
                  style={
                    styles.clearButton
                  }
                >
                  Chiudi
                </button>
              </div>

              <pre
                style={styles.responseText}
              >
                {response}
              </pre>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ============================================================
// STYLES
// ============================================================

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
    opacity: 0.45,
  },

  overlay: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(11,16,21,0.45) 0%, rgba(11,16,21,0.95) 100%)',
  },

  content: {
    position: 'relative',
    width: '100%',
    maxWidth: '700px',
    margin: '0 auto',
  },

  contentWide: {
    position: 'relative',
    width: '100%',
    maxWidth: '1100px',
    margin: '0 auto',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '20px',
    marginBottom: '20px',
  },

  subtitle: {
    color: '#8fa1ac',
    marginTop: '-8px',
    fontSize: '14px',
  },

  testBadge: {
    display: 'inline-block',
    padding: '4px 9px',
    marginBottom: '8px',
    borderRadius: '999px',
    background:
      'rgba(118, 75, 162, 0.35)',
    border:
      '1px solid rgba(167, 139, 250, 0.45)',
    color: '#d8b4fe',
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '1px',
  },

  sessionBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 10px',
    background:
      'rgba(255,255,255,0.07)',
    border:
      '1px solid rgba(255,255,255,0.14)',
    borderRadius: '9px',
  },

  sessionLabel: {
    color: '#8fa1ac',
    fontSize: '12px',
    maxWidth: '220px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  logoutButton: {
    padding: '6px 11px',
    borderRadius: '6px',
    border:
      '1px solid rgba(255,255,255,0.25)',
    background:
      'rgba(255,255,255,0.08)',
    color: '#cbd5e1',
    fontSize: '12px',
    cursor: 'pointer',
  },

  loginBox: {
    backgroundColor:
      'rgba(255,255,255,0.1)',
    borderRadius: '12px',
    padding: '32px 24px',
    backdropFilter: 'blur(10px)',
    border:
      '1px solid rgba(255,255,255,0.2)',
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

  dashboard: {
    backgroundColor:
      'rgba(255,255,255,0.08)',
    borderRadius: '14px',
    padding: '20px',
    backdropFilter: 'blur(12px)',
    border:
      '1px solid rgba(255,255,255,0.16)',
  },

  dashboardTitle: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '14px',
    color: '#e2e8f0',
    fontSize: '15px',
    fontWeight: '600',
  },

  dashboardHint: {
    color: '#7f8c96',
    fontSize: '11px',
    fontWeight: '400',
  },

  groupGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(145px, 1fr))',
    gap: '8px',
  },

  groupButton: {
    minHeight: '58px',
    padding: '9px 10px',
    borderRadius: '9px',
    border:
      '1px solid rgba(255,255,255,0.13)',
    background:
      'rgba(255,255,255,0.06)',
    color: '#dce5eb',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    fontWeight: '600',
    textAlign: 'left',
  },

  groupButtonActive: {
    background:
      'rgba(118,75,162,0.30)',
    border:
      '1px solid rgba(167,139,250,0.45)',
  },

  groupIcon: {
    fontSize: '17px',
  },

  chevron: {
    marginLeft: 'auto',
    color: '#82909a',
    fontSize: '9px',
  },

  commandPanel: {
    marginTop: '12px',
    padding: '12px',
    borderRadius: '10px',
    background:
      'rgba(0,0,0,0.22)',
    border:
      '1px solid rgba(255,255,255,0.1)',
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(190px, 1fr))',
    gap: '7px',
  },

  commandButton: {
    padding: '11px 12px',
    borderRadius: '7px',
    border:
      '1px solid rgba(255,255,255,0.12)',
    background:
      'rgba(255,255,255,0.055)',
    color: '#dbe4ea',
    cursor: 'pointer',
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    fontSize: '12px',
  },

  commandHint: {
    color: '#75838d',
    fontSize: '10px',
    fontWeight: '400',
  },

  form: {
    marginTop: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },

  inputHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  inputLabel: {
    color: '#e2e8f0',
    fontSize: '13px',
    fontWeight: '600',
  },

  clearButton: {
    padding: '5px 9px',
    borderRadius: '5px',
    border:
      '1px solid rgba(255,255,255,0.15)',
    background:
      'rgba(255,255,255,0.05)',
    color: '#8fa1ac',
    cursor: 'pointer',
    fontSize: '10px',
  },

  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px',
    borderRadius: '9px',
    border:
      '1px solid rgba(255,255,255,0.22)',
    background:
      'rgba(0,0,0,0.28)',
    color: '#e2e8f0',
    fontSize: '15px',
    resize: 'vertical',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, monospace',
    outline: 'none',
    lineHeight: 1.5,
  },

  buttonsRow: {
    display: 'flex',
    justifyContent: 'flex-end',
  },

  executeButton: {
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    background:
      'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
    color: 'white',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
  },

  buttonDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },

  errorBox: {
    marginTop: '16px',
    padding: '13px',
    borderRadius: '8px',
    background:
      'rgba(255,100,100,0.12)',
    border:
      '1px solid rgba(255,107,107,0.55)',
    color: '#ff8585',
    fontSize: '13px',
  },

  response: {
    marginTop: '18px',
    padding: '16px',
    background:
      'rgba(0,0,0,0.25)',
    borderRadius: '9px',
    border:
      '1px solid rgba(255,255,255,0.15)',
  },

  responseHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },

  responseTitle: {
    color: '#e2e8f0',
    fontSize: '15px',
    margin: 0,
  },

  responseText: {
    color: '#dbe4ea',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    margin: 0,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: 1.55,
  },
}