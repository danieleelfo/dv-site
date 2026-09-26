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

    return JSON.parse(
      decodeURIComponent(
        escape(window.atob(base64))
      )
    )
  } catch (e) {
    return null
  }
}

const COMMAND_GROUPS = [
  {
    id: 'system',
    title: 'SYSTEM',
    icon: '⚙️',
    commands: [
      { label: 'Status sistema', command: 'status sistema' },
      { label: 'Status OS', command: 'status os' },
      { label: 'Status RAM', command: 'status ram' },
      { label: 'Status IP', command: 'status ip' },
      { label: 'Uvicorn status', command: 'uvicorn status' },
      { label: 'Telegram status', command: 'telegram status' },
    ],
  },

  {
    id: 'processi',
    title: 'PROCESSI',
    icon: '🤖',
    commands: [
      { label: 'Start Lele', command: 'start lele' },
      { label: 'Stop Lele', command: 'stop lele' },
      { label: 'Restart Lele', command: 'restart lele' },
      { label: 'Restart Story Whisper', command: 'restart story whisper' },
      { label: 'Restart Night Story', command: 'restart night story' },
      { label: 'Restart Gateway', command: 'restart gateway' },
      { label: 'Logs Lele', command: 'logs lele' },
      { label: 'Logs Story Whisper', command: 'logs story whisper' },
      { label: 'Logs Night Story', command: 'logs night story' },
      { label: 'Logs Leles', command: 'logs leles' },
    ],
  },

  {
    id: 'airflow',
    title: 'AIRFLOW',
    icon: '🌬️',
    commands: [
      { label: 'Status Airflow', command: 'status airflow' },
      {
        label: 'Status DAG',
        command: 'status dag ',
        hint: 'Opzionale: dag_id',
      },
      {
        label: 'Log task',
        command: 'log task ',
        hint: 'dag_id task_id',
      },
      {
        label: 'Pausa DAG',
        command: 'pausa dag ',
        hint: 'dag_id',
      },
      {
        label: 'Attiva DAG',
        command: 'attiva dag ',
        hint: 'dag_id',
      },
      {
        label: 'Lancia DAG',
        command: 'exec airflow lancia ',
        hint: 'dag_id e conf se necessario',
      },
    ],
  },

  {
    id: 'emergence',
    title: 'EMERGENCE / QE',
    icon: '🧠',
    commands: [
      { label: 'QE last 10', command: 'QE last 10' },
      {
        label: 'QE status',
        command: 'QE status ',
        hint: 'run_id opzionale',
      },
      {
        label: 'Decisione',
        command: 'decisione ',
        hint: 'run_id',
      },
      {
        label: 'Decisione run',
        command: 'decisione run ',
        hint: 'run_id',
      },
      {
        label: 'Sintetizza',
        command: 'sintetizza ',
        hint: 'run_id',
      },
      { label: 'Query worlds', command: 'query worlds' },
      {
        label: 'Query world',
        command: 'query world ',
        hint: 'world id',
      },
      {
        label: 'Save world',
        command: 'save world ',
        hint: 'nome as "descrizione"',
      },
    ],
  },

  {
    id: 'files',
    title: 'FILES',
    icon: '📁',
    commands: [
      { label: 'Directory leles', command: 'directory leles' },
      {
        label: 'LS',
        command: 'ls ',
        hint: 'progetto [subpath]',
      },
      {
        label: 'Invia file',
        command: 'invia file ',
        hint: 'path assoluto',
      },
      { label: 'Remoto test', command: 'remoto test' },
      {
        label: 'Remoto LS',
        command: 'remoto ls ',
        hint: 'path',
      },
      {
        label: 'Remoto download',
        command: 'remoto download ',
        hint: 'file',
      },
      {
        label: 'Remoto upload',
        command: 'remoto upload ',
        hint: 'file',
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
        hint: 'file o richiesta',
      },
      {
        label: 'Verifica',
        command: 'verifica ',
        hint: 'file o richiesta',
      },
      {
        label: 'Review',
        command: 'review ',
        hint: 'file o richiesta',
      },
      {
        label: 'Gemma',
        command: 'gemma ',
        hint: 'prompt',
      },
      {
        label: 'Llama',
        command: 'llama ',
        hint: 'prompt',
      },
    ],
  },

  {
    id: 'git',
    title: 'GIT',
    icon: '🔀',
    commands: [
      { label: 'Status leles', command: 'status leles' },
      { label: 'Status gateway', command: 'status gateway' },
      { label: 'Diff leles', command: 'diff leles' },
      { label: 'Diff gateway', command: 'diff gateway' },
      { label: 'Pull report leles', command: 'pull report leles' },
      { label: 'Pull force leles', command: 'pull force leles' },
      { label: 'Pull report gateway', command: 'pull report gateway' },
      { label: 'Pull force gateway', command: 'pull force gateway' },
      {
        label: 'Ultimo commit leles',
        command: 'commit leles',
      },
      {
        label: 'Ultimo commit gateway',
        command: 'commit gateway',
      },
    ],
  },

  {
    id: 'leles',
    title: 'LELES',
    icon: '🏴‍☠️',
    commands: [
      { label: 'Restart Lelé', command: 'restart Lelé' },
      {
        label: 'Export DAG',
        command: 'export dag ',
        hint: 'filename',
      },
      {
        label: 'Crea DAG',
        command: 'crea dag ',
        hint: 'Descrivi il DAG',
      },
    ],
  },
]

export default function ConsoleTest() {
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

  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const [openGroup, setOpenGroup] = useState(null)

  const buttonRef = useRef(null)
  const chatIdRef = useRef(getOrCreateChatId())

  // Se al mount risulta già un token salvato ma l'email non è (più)
  // in whitelist, buttalo fuori subito.
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

  function handleCredentialResponse(credentialResponse) {
    const token = credentialResponse?.credential

    if (!token) {
      setAuthError(
        'Login Google fallito: nessun token ricevuto.'
      )
      return
    }

    const decoded = decodeJwtPayload(token)
    const email = decoded?.email?.toLowerCase()

    // --- TEST TEMPORANEO: solo email in whitelist può entrare ---
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      setAuthError(
        'Accesso non autorizzato per questo account Google.'
      )

      try {
        if (window.google?.accounts?.id) {
          window.google.accounts.id.disableAutoSelect()
        }
      } catch (e) {
        // no-op
      }

      return
    }
    // --------------------------------------------------------------

    setAuthError('')
    setProfile(decoded)
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

  function selectCommand(command) {
    setPrompt(command.command)
    setResponse('')
    setError('')

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

  // ==========================================================
  // LOGIN
  // ==========================================================

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
          <h2 style={styles.pageTitle}>
            Lele Admin Console
          </h2>

          <div style={styles.loginBox}>
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

  // ==========================================================
  // DASHBOARD
  // ==========================================================

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

        {/* TITOLO — SUBITO SOTTO LA NAV */}

        <div style={styles.titleRow}>
          <h2 style={styles.pageTitle}>
            Lele Admin Console
          </h2>

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

        {/* ====================================================
            PROMPT — PRIMA DEI BOTTONI
            ==================================================== */}

        <div style={styles.dashboard}>

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

          {/* ==================================================
              COMANDI
              ================================================== */}

          <div style={styles.commandTitle}>
            <span>
              🏴‍☠️ Comandi Leles
            </span>

            <span style={styles.dashboardHint}>
              Seleziona → modifica → esegui
            </span>
          </div>

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

          {error && (
            <div style={styles.errorBox}>
              <strong>
                ⚠️ Errore
              </strong>

              <p>{error}</p>
            </div>
          )}

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

const styles = {
  wrap: {
    position: 'relative',
    minHeight: '70vh',
    display: 'flex',
    flexDirection: 'column',
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

  titleRow: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'nowrap',
  },

  pageTitle: {
    margin: 0,
    color: '#e2e8f0',
    fontSize: 'clamp(18px, 4.5vw, 28px)',
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
    flexShrink: 1,
  },

  sessionBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    background:
      'rgba(255,255,255,0.07)',
    border:
      '1px solid rgba(255,255,255,0.14)',
    borderRadius: '8px',
    flexShrink: 0,
  },

  sessionLabel: {
    color: '#8fa1ac',
    fontSize: '10px',
    maxWidth: '150px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  logoutButton: {
    padding: '5px 8px',
    borderRadius: '5px',
    border:
      '1px solid rgba(255,255,255,0.25)',
    background:
      'rgba(255,255,255,0.08)',
    color: '#cbd5e1',
    fontSize: '10px',
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
    padding: '18px',
    backdropFilter: 'blur(12px)',
    border:
      '1px solid rgba(255,255,255,0.16)',
  },

  form: {
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

  commandTitle: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    marginTop: '20px',
    marginBottom: '12px',
    color: '#e2e8f0',
    fontSize: '14px',
    fontWeight: '600',
  },

  dashboardHint: {
    color: '#7f8c96',
    fontSize: '10px',
    fontWeight: '400',
  },

  groupGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(145px, 1fr))',
    gap: '8px',
  },

  groupButton: {
    minHeight: '56px',
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
    marginTop: '10px',
    padding: '10px',
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
