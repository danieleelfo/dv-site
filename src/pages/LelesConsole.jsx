import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import bgImage from '../assets/DataInFlames.jpg'

const LELE_API_URL = 'https://api.danielevillanova.com'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const TOKEN_STORAGE_KEY = 'leles_admin_id_token'

// --- TEST TEMPORANEO: whitelist email per accesso alla console -----------
// TODO: rimuovere/estendere quando arriva il login Telegram con ADMIN_IDS.
const ALLOWED_EMAILS = ['dannybydanny@hotmail.com']
// Forza il chat_id a un ADMIN_IDS di Leles, così i comandi riservati
// al "capitano" funzionano anche dalla console web.
const FORCED_ADMIN_CHAT_ID = 8733881519
// ---------------------------------------------------------------------------

// Pagine di test raggiungibili al volo.
const QUICK_LINKS = [
  { to: '/en/arena', label: 'Bot to bot', main: true },
  { to: '/en/leles-console', label: 'Test 6' },
  { to: '/test3', label: 'Test 3' },
  { to: '/test2', label: 'Test 2' },
  { to: '/en/emergence', label: 'Test' },
  { to: '/leles', label: 'Lele Admin' },
]

// Comandi mostrati nel pannello di destra (si aggiornano con "Aggiorna").
const STATUS_CMDS = [
  ['sys', 'Sistema', 'status sistema'],
  ['os', 'OS', 'status os'],
  ['ram', 'RAM', 'status ram'],
]

const c = (label, command, hint, danger) => ({ label, command, hint, danger })

const COMMAND_GROUPS = [
  {
    id: 'system', title: 'Sistema', icon: '⚙️', color: '#3fd0c9',
    commands: [
      c('Status sistema', 'status sistema'),
      c('Status OS', 'status os'),
      c('Status RAM', 'status ram'),
      c('Status IP', 'status ip'),
      c('Uvicorn status', 'uvicorn status'),
      c('Telegram status', 'telegram status'),
    ],
  },
  {
    id: 'processi', title: 'Processi', icon: '🤖', color: '#fbbf24',
    commands: [
      c('Start Lele', 'start lele'),
      c('Stop Lele', 'stop lele', undefined, true),
      c('Restart Lele', 'restart lele', undefined, true),
      c('Restart Story Whisper', 'restar
t story whisper', undefined, true),
      c('Restart Night Story', 'restart night story', undefined, true),
      c('Restart Gateway', 'restart gateway', undefined, true),
      c('Logs Lele', 'logs lele'),
      c('Logs Story Whisper', 'logs story whisper'),
      c('Logs Night Story', 'logs night story'),
      c('Logs Leles', 'logs leles'),
    ],
  },
  {
    id: 'airflow', title: 'Airflow', icon: '🌬️', color: '#38bdf8',
    commands: [
      c('Status Airflow', 'status airflow'),
      c('Status DAG', 'status dag ', 'Opzionale: dag_id'),
      c('Log task', 'log task ', 'dag_id task_id'),
      c('Pausa DAG', 'pausa dag ', 'dag_id', true),
      c('Attiva DAG', 'attiva dag ', 'dag_id'),
      c('Lancia DAG', 'exec airflow lancia ', 'dag_id e conf se necessario', true),
    ],
  },
  {
    id: 'emergence', title: 'Emergence / QE', icon: '🧠', color: '#a78bfa',
    commands: [
      c('QE last 10', 'QE last 10'),
      c('QE status', 'QE status ', 'run_id opzionale'),
      c('Decisione', 'decisione ', 'run_id'),
      c('Decisione run', 'decisione run ', 'run_id'),
      c('Sintetizza', 'sintetizza ', 'run_id'),
      c('Query worlds', 'query worlds'),
      c('Query world', 'query world ', 'world id'),
      c('Save world', 'save world ', 'nome as "descrizione"'),
    ],
  },
  {
    id: 'files', title: 'File', icon: '📁', color: '#4ade80',
    commands: [
      c('Directory leles', 'directory leles'),
      c('LS', 'ls ', 'progetto [subpath]'),
      c('Invia file', 'invia file ', 'path assoluto'),
      c('Remoto test', 'remoto test'),
      c('Remoto LS', 'remoto ls ', 'path'),
      c('Remoto download', 'remoto download ', 'file'),
      c('Remoto upload', 'remoto upload ', 'file', true),
    ],
  },
  {
    id: 'ai', title: 'AI / Code', icon: '✨', color: '#f472b6',
    commands: [
      c('Query', 'query ', 'Scrivi la query'),
      c('Esporta', 'esporta ', 'record in formato yaml'),
      c('Improve', 'improve ', 'file o richiesta'),
      c('Verifica', 've
rifica ', 'file o richiesta'),
      c('Review', 'review ', 'file o richiesta'),
      c('Gemma', 'gemma ', 'prompt'),
      c('Llama', 'llama ', 'prompt'),
    ],
  },
  {
    id: 'modelli', title: 'Modelli e review', icon: '🎛️', color: '#c4b5fd',
    commands: [
      c('Modelli attivi', 'modelli'),
      c('Cambia modello', 'modello ', 'nome (es. mistral)'),
      c('Cambia reviewer', 'reviewer ', 'nome modello'),
      c('Edita', 'edita'),
      c('Roast', 'roast'),
      c('Critica', 'critica'),
      c('Pirata', 'pirata'),
    ],
  },
  {
    id: 'git', title: 'Git', icon: '🔀', color: '#fb923c',
    commands: [
      c('Status leles', 'status leles'),
      c('Status gateway', 'status gateway'),
      c('Diff leles', 'diff leles'),
      c('Diff gateway', 'diff gateway'),
      c('Pull report leles', 'pull report leles'),
      c('Pull force leles', 'pull force leles', undefined, true),
      c('Pull report gateway', 'pull report gateway'),
      c('Pull force gateway', 'pull force gateway', undefined, true),
      c('Ultimo commit leles', 'commit leles'),
      c('Ultimo commit gateway', 'commit gateway'),
    ],
  },
  {
    id: 'leles', title: 'Leles', icon: '🏴‍☠️', color: '#e2e8f0',
    commands: [
      c('Restart Lelé', 'restart Lelé', undefined, true),
      c('Export DAG', 'export dag ', 'filename'),
      c('Crea DAG', 'crea dag ', 'Descrivi il DAG'),
    ],
  },
]

// Comandi che cambiano lo stato del sistema: chiedono una seconda conferma.
const DANGER = COMMAND_GROUPS.flatMap((g) =>
  g.commands.filter((x) => x.danger).map((x) => x.command.trim().toLowerCase())
)
const isDanger = (text) => {
  const t = text.trim().toLowerCase()
  return DANGER.some((d) => t.startsWith(d))
}

function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(window.atob(base64))))
  } catch (e) {
    return null
  }
}

async function callAdmin(idToken, prompt, timeo
utMs = 310000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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
        chat_id: FORCED_ADMIN_CHAT_ID,
      }),
    })

    if (res.status === 401 || res.status === 403) {
      const err = new Error(
        res.status === 401
          ? 'Sessione scaduta, effettua di nuovo il login.'
          : 'Accesso non autorizzato per questo account Google.'
      )
      err.status = res.status
      throw err
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

    const data = await res.json()
    if (data.answer) return data.answer
    if (data.error) return data.error
    if (data.detail) {
      return typeof data.detail === 'string'
        ? data.detail
        : JSON.stringify(data.detail, null, 2)
    }
    return 'Nessuna risposta ricevuta'
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Timeout: il server non ha risposto in tempo.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const timeLabel = (ts) =>
  new Date(ts).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

// ------------------------------------------------------------------
// Dashboard "Sistema": parser del testo di `status sistema` + tessere.
// ------------------------------------------------------------------
const SYS_SECTIONS = {
  'Projects': 'Progetti',
  'Shared Services': 'Servizi',
  'Models': 'Modelli',
}

// Trasforma l'output testuale di "status sistema" in dati per le tessere.
// Ritorna null se il formato non è riconosciuto (si ripiega sul testo).
function parseSystem(text) {
  if (!text) retu
rn null
  const sections = []
  let cur = null
  let git = null
  let inGit = false

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || /^[\u2500-]+$/.test(line)) continue

    if (SYS_SECTIONS[line]) {
      cur = { title: SYS_SECTIONS[line], items: [] }
      sections.push(cur)
      inGit = false
      continue
    }
    if (line === 'Git') {
      git = { branch: '', status: '', clean: false, files: [] }
      cur = null
      inGit = true
      continue
    }

    if (inGit && git) {
      if (line.startsWith('Branch:')) git.branch = line.slice(7).trim()
      else if (line.startsWith('Status:')) {
        git.status = line.slice(7).trim()
        git.clean = /clean/i.test(git.status)
      } else git.files.push(line)
      continue
    }

    const m = line.match(/^(✅|❌|🟢|⚪️|⚪)\s*(.+)$/u)
    if (m && cur) {
      const state = m[1] === '✅' || m[1] === '🟢' ? 'ok' : m[1] === '❌' ? 'bad' : 'off'
      const nm = m[2].match(/^(.*?)\s*\((.+)\)$/)
      cur.items.push({
        label: (nm ? nm[1] : m[2]).replace(/_/g, ' '),
        sub: nm ? nm[2] : '',
        state,
      })
    }
  }

  // Leles è sempre su (è lui che risponde): il suo stato diventa quello
  // dell'intestazione "Progetti" e il suo box viene tolto.
  for (const sec of sections) {
    if (sec.title === 'Progetti') {
      const i = sec.items.findIndex((it) => /^leles$/i.test(it.label))
      if (i >= 0) {
        sec.head = sec.items[i].state
        sec.items.splice(i, 1)
      }
    }
  }

  // Ollama: i modelli diventano sotto-box del suo riquadro (a tutta
  // larghezza, in fondo ai servizi). Se Ollama non c'è, i modelli
  // restano una sezione a parte.
  const services = sections.find((sec) => sec.title === 'Servizi')
  const models = sections.find((sec) => sec.title === 'Modelli')
  const ollama = services?.items.find((it) => /^ollama$/i.test(it.label))
  if (ollama && models) {
    ollama.children = models.items
    sections.splice(sections.indexOf(models
), 1)
    services.items.splice(services.items.indexOf(ollama), 1)
    services.items.push(ollama)
  }

  const filled = sections.filter((sec) => sec.items.length > 0)
  if (filled.length === 0) return null
  return { sections: filled, git }
}

// Schemino a quadratini: verde = su, rosso = giù, grigio = non caricato.
function SystemTiles({ data }) {
  const label = { ok: 'attivo', bad: 'non attivo', off: 'non caricato' }
  return (
    <div className="lc-sys">
      {data.sections.map((sec) => {
        const up = sec.items.filter((i) => i.state === 'ok').length
        return (
          <div key={sec.title} className="lc-sys-sec">
            <div className="lc-sys-title">
              <span
                className={`lc-sys-name${sec.head ? ` is-${sec.head}` : ''}`}
                title={sec.head ? `Leles: ${label[sec.head]}` : undefined}
              >
                {sec.title}
                {sec.head && <span className="lc-sr"> (Leles {label[sec.head]})</span>}
              </span>
              <span>
                {up}/{sec.items.length}
              </span>
            </div>
            <div className="lc-tiles">
              {sec.items.map((it) =>
                it.children ? (
                  <div
                    key={it.label}
                    className={`lc-tile lc-tile--wide is-${it.state}`}
                    title={`${it.label}: ${label[it.state]}`}
                  >
                    <b>{it.label}</b>
                    <span className="lc-sr">{label[it.state]}</span>
                    <div className="lc-subs">
                      {it.children.map((m) => (
                        <span
                          key={m.label}
                          className={`lc-sub is-${m.state}`}
                          title={`${m.label}: ${label[m.state]}`}
                        >
                          {m.label}
                          <span className="lc-sr"> {label[m.state]}</span>
                        </span>
 
                     ))}
                    </div>
                  </div>
                ) : (
                  <div
                    key={it.label}
                    className={`lc-tile is-${it.state}`}
                    title={`${it.label}${it.sub ? ` (${it.sub})` : ''}: ${label[it.state]}`}
                  >
                    <b>{it.label}</b>
                    {it.sub && <small>{it.sub}</small>}
                    <span className="lc-sr">{label[it.state]}</span>
                  </div>
                )
              )}
            </div>
          </div>
        )
      })}

      {data.git && (
        <div className="lc-sys-sec">
          <div className="lc-sys-title">
            <span>Git</span>
          </div>
          <div className="lc-sys-git">
            {data.git.branch && <span className="lc-badge">{data.git.branch}</span>}
            <span
              className={`lc-badge ${data.git.clean ? 'is-ok' : 'is-warn'}`}
              title={data.git.files.join('\n') || undefined}
            >
              {data.git.clean ? 'Clean' : data.git.status.replace(/^⚠️\s*/, '')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ConsoleTest() {
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
  const [armed, setArmed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [history, setHistory] = useState([])

  const [activeGroup, setActiveGroup] = useState(COMMAND_GROUPS[0].id)
  const [search, setSearch] = useState('')

  const [status, setStatus] = useState({})
  const [statusLoading, setStatusLoad
ing] = useState(false)
  const [rawSys, setRawSys] = useState(false)
  const [ping, setPing] = useState({ ok: null, ms: null, agents: [] })

  const buttonRef = useRef(null)
  const textareaRef = useRef(null)

  // Token salvato ma email non (più) in whitelist: fuori subito.
  useEffect(() => {
    if (!idToken) return
    const email = decodeJwtPayload(idToken)?.email?.toLowerCase()
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      logout('Accesso non autorizzato per questo account Google.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Login Google (SDK caricato da index.html).
  useEffect(() => {
    if (idToken) return
    let cancelled = false
    let attempts = 0

    function tryInit() {
      if (cancelled) return
      if (!window.google?.accounts?.id) {
        if (++attempts > 80) {
          setAuthError(
            'Impossibile caricare il login Google. Controlla adblock e rete, poi ricarica la pagina.'
          )
          return
        }
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
      setAuthError('Login Google fallito: nessun token ricevut
o.')
      return
    }
    const decoded = decodeJwtPayload(token)
    const email = decoded?.email?.toLowerCase()

    if (!email || !ALLOWED_EMAILS.includes(email)) {
      setAuthError('Accesso non autorizzato per questo account Google.')
      try {
        window.google?.accounts?.id?.disableAutoSelect()
      } catch (e) {
        /* no-op */
      }
      return
    }

    setAuthError('')
    setProfile(decoded)
    setIdToken(token)
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } catch (e) {
      /* no-op */
    }
  }

  function logout(message = '') {
    setIdToken(null)
    setProfile(null)
    setHistory([])
    setStatus({})
    setPrompt('')
    setArmed(false)
    setAuthError(message)
    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      window.google?.accounts?.id?.disableAutoSelect()
    } catch (e) {
      /* no-op */
    }
  }

  // Stato del gateway: GET / è aperto, niente token.
  useEffect(() => {
    if (!idToken) return
    let stop = false

    async function check() {
      const t0 = performance.now()
      try {
        const res = await fetch(`${LELE_API_URL}/`)
        const data = await res.json()
        if (!stop) {
          setPing({
            ok: res.ok,
            ms: Math.round(performance.now() - t0),
            agents: data.agents || [],
          })
        }
      } catch (e) {
        if (!stop) setPing((p) => ({ ...p, ok: false, ms: null }))
      }
    }

    check()
    const id = setInterval(check, 30000)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [idToken])

  // Status sistema/OS/RAM: un comando alla volta, via console admin.
  const refreshStatus = useCallback(async () => {
    if (!idToken) return
    setStatusLoading(true)
    for (const [key, , cmd] of STATUS_CMDS) {
      try {
        const text = await callAdmin(idToken, cmd, 60000)
        setStatus((s) => ({ ...s, [key]: { text } }))
      } catch (err) {
        if (err.st
atus === 401 || err.status === 403) {
          logout(err.message)
          break
        }
        setStatus((s) => ({ ...s, [key]: { err: err.message } }))
      }
    }
    setStatusLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  function selectCommand(command) {
    setPrompt(command.command)
    setArmed(false)
    setTimeout(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      }
    }, 30)
  }

  async function run(e) {
    e?.preventDefault()
    const cmd = prompt.trim()
    if (!cmd || !idToken || isLoading) return

    // Comandi sensibili: serve una seconda pressione.
    if (isDanger(cmd) && !armed) {
      setArmed(true)
      return
    }

    setArmed(false)
    setIsLoading(true)
    const t0 = Date.now()
    let outcome
    try {
      outcome = { text: await callAdmin(idToken, cmd) }
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        logout(err.message)
        return
      }
      outcome = { err: err.message }
    } finally {
      setIsLoading(false)
    }
    setHistory((h) =>
      [{ id: t0, cmd, at: t0, ms: Date.now() - t0, ...outcome }, ...h].slice(0, 30)
    )
  }

  function copy(text) {
    try {
      navigator.clipboard?.writeText(text)
    } catch (e) {
      /* no-op */
    }
  }

  const q = search.trim().toLowerCase()
  const group = COMMAND_GROUPS.find((g) => g.id === activeGroup)
  const visible = q
    ? COMMAND_GROUPS.flatMap((g) => g.commands.map((x) => ({ ...x, g }))).filter(
        (x) => `${x.label} ${x.command} ${x.hint || ''}`.toLowerCase().includes(q)
      )
    : group.commands.map((x) => ({ ...x, g: group }))

  const backdrop = (
    <>
      <img src={bgImage} alt="" className="lc-bg" />
      <div className="lc-shade" />
    </>
  )

  // ==========================================
================
  // LOGIN
  // ==========================================================
  if (!idToken) {
    return (
      <div className="lc-page">
        <style>{css}</style>
        {backdrop}
        <div className="lc-wrap lc-wrap--narrow">
          <h1 className="lc-title">Lele Admin Console</h1>
          <div className="lc-panel lc-login">
            <p>Accesso riservato. Entra con l'account Google autorizzato.</p>
            {authError && <p className="lc-err">{authError}</p>}
            <div ref={buttonRef} style={{ minHeight: 44 }} />
            {!gsiReady && !authError && (
              <p className="lc-dim">Caricamento login Google…</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ==========================================================
  // CONSOLE
  // ==========================================================
  return (
    <div className="lc-page">
      <style>{css}</style>
      {backdrop}

      <div className="lc-wrap">
        <div className="lc-top">
          <h1 className="lc-title">Lele Admin Console</h1>
          <div className="lc-session">
            <span className="lc-ellipsis">{profile?.email || 'account Google'}</span>
            <button type="button" className="lc-btn lc-btn--sm" onClick={() => logout()}>
              Logout
            </button>
          </div>
        </div>

        <nav className="lc-links" aria-label="Altre pagine">
          <span className="lc-dim">Vai a</span>
          {QUICK_LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`lc-link${l.main ? ' lc-link--main' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="lc-grid">
          <main className="lc-main">
            {/* PROMPT */}
            <form className="lc-panel lc-prompt" onSubmit={run}>
              <label htmlFor="lc-input" className="lc-sr">
                Comando p
er Leles
              </label>
              <div className="lc-prompt-row">
                <span className="lc-anchor" aria-hidden="true">⚓</span>
                <textarea
                  id="lc-input"
                  ref={textareaRef}
                  value={prompt}
                  rows={4}
                  placeholder="Scrivi un comando o parla liberamente con Leles…"
                  onChange={(e) => {
                    setPrompt(e.target.value)
                    setArmed(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(e)
                  }}
                />
              </div>
              <div className="lc-prompt-foot">
                <span className="lc-dim lc-small">
                  {armed
                    ? 'Comando che cambia lo stato del sistema: premi di nuovo per confermare.'
                    : 'Ctrl+Invio esegue il comando.'}
                </span>
                <div className="lc-row">
                  <button
                    type="button"
                    className="lc-btn"
                    onClick={() => {
                      setPrompt('')
                      setArmed(false)
                    }}
                  >
                    Pulisci
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading || !prompt.trim()}
                    className={`lc-btn lc-btn--run${armed ? ' lc-btn--warn' : ''}`}
                  >
                    {isLoading ? (
                      <>
                        <span className="lc-spin" /> Leles sta lavorando…
                      </>
                    ) : armed ? (
                      'Conferma ed esegui'
                    ) : (
                      'Esegui'
                    )}
                  </button>
                </div>
              </div>
            </form>

            {/* C
OMANDI */}
            <section className="lc-panel lc-pad" aria-label="Comandi">
              <div className="lc-cmd-head">
                <h2>Comandi</h2>
                <input
                  type="search"
                  className="lc-search"
                  placeholder="Cerca tra tutti i comandi"
                  aria-label="Cerca comandi"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {!q && (
                <div className="lc-tabs" role="tablist">
                  {COMMAND_GROUPS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      role="tab"
                      aria-selected={g.id === activeGroup}
                      className={`lc-tab${g.id === activeGroup ? ' is-on' : ''}`}
                      style={{ '--g': g.color }}
                      onClick={() => setActiveGroup(g.id)}
                    >
                      <span aria-hidden="true">{g.icon}</span> {g.title}
                      <span className="lc-count">{g.commands.length}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="lc-chips">
                {visible.length === 0 && (
                  <p className="lc-dim">
                    Nessun comando corrisponde a “{search}”. Puoi comunque scriverlo a mano sopra.
                  </p>
                )}
                {visible.map((x, i) => (
                  <button
                    key={`${x.g.id}-${i}`}
                    type="button"
                    className="lc-chip"
                    style={{ '--g': x.g.color }}
                    title={x.danger ? 'Chiede conferma prima di partire' : undefined}
                    onClick={() => selectCommand(x)}
                  >
                    <span>
                      {x.label}
                    
  {x.danger && <span className="lc-bang" aria-label="sensibile"> !</span>}
                    </span>
                    {x.hint && <small>{x.hint}</small>}
                    {q && <small>{x.g.title}</small>}
                  </button>
                ))}
              </div>
            </section>

            {/* CRONOLOGIA */}
            <section className="lc-panel lc-pad" aria-label="Risposte">
              <div className="lc-cmd-head">
                <h2>Sessione</h2>
                {history.length > 0 && (
                  <button type="button" className="lc-btn lc-btn--sm" onClick={() => setHistory([])}>
                    Svuota
                  </button>
                )}
              </div>

              <div aria-live="polite" className="lc-log">
                {history.length === 0 && (
                  <p className="lc-dim">
                    Nessun comando eseguito. Scegline uno qui sopra o scrivilo nel prompt.
                  </p>
                )}
                {history.map((h) => (
                  <article key={h.id} className={`lc-entry${h.err ? ' is-err' : ''}`}>
                    <header>
                      <code className="lc-ellipsis">{h.cmd}</code>
                      <span className="lc-dim lc-small">
                        {timeLabel(h.at)}, {(h.ms / 1000).toFixed(1)}s
                      </span>
                      <button
                        type="button"
                        className="lc-btn lc-btn--sm"
                        onClick={() => {
                          setPrompt(h.cmd)
                          setArmed(false)
                          textareaRef.current?.focus()
                        }}
                      >
                        Riusa
                      </button>
                      <button
                        type="button"
                        className="lc-btn lc-btn--sm"
                        onClick={() => copy(h.text || h.err)}
                    
  >
                        Copia
                      </button>
                    </header>
                    <pre className="lc-pre">{h.text || h.err}</pre>
                  </article>
                ))}
              </div>
            </section>
          </main>

          {/* DASHBOARD DESTRA */}
          <aside className="lc-side" aria-label="Stato del sistema">
            <section className="lc-panel lc-pad">
              <div className="lc-cmd-head">
                <h2>Stato del sistema</h2>
                <button
                  type="button"
                  className="lc-btn lc-btn--sm"
                  onClick={refreshStatus}
                  disabled={statusLoading}
                >
                  {statusLoading ? 'Carico…' : 'Aggiorna'}
                </button>
              </div>
              {STATUS_CMDS.map(([key, label]) => {
                const s = status[key]
                const tiles = key === 'sys' && !rawSys ? parseSystem(s?.text) : null
                return (
                  <div key={key} className="lc-stat">
                    <div className="lc-stat-head">
                      <h3>{label}</h3>
                      {key === 'sys' && s?.text && parseSystem(s.text) && (
                        <button
                          type="button"
                          className="lc-btn lc-btn--sm"
                          onClick={() => setRawSys((v) => !v)}
                        >
                          {rawSys ? 'Schema' : 'Testo'}
                        </button>
                      )}
                    </div>
                    {s?.err ? (
                      <p className="lc-err lc-small">{s.err}</p>
                    ) : tiles ? (
                      <SystemTiles data={tiles} />
                    ) : (
                      <pre className="lc-pre lc-pre--sm">
                        {s?.text || (statusLoading ? 'Carico…' : 'Nessun dato. Premi Aggiorna.')}
                      </pre>

                    )}
                  </div>
                )
              })}
            </section>

            <section className="lc-panel lc-pad">
              <div className="lc-cmd-head">
                <h2>Gateway</h2>
                <span
                  className={`lc-pill ${
                    ping.ok === null ? '' : ping.ok ? 'is-ok' : 'is-bad'
                  }`}
                >
                  <span className={`lc-dot${ping.ok ? ' lc-pulse' : ''}`} />
                  {ping.ok === null ? 'Controllo…' : ping.ok ? `Online, ${ping.ms} ms` : 'Non raggiungibile'}
                </span>
              </div>
              {ping.agents.length > 0 && (
                <>
                  <p className="lc-dim lc-small">Agenti registrati nel gateway</p>
                  <div className="lc-agents">
                    {ping.agents.map((a) => (
                      <span key={a} className="lc-agent">{a}</span>
                    ))}
                  </div>
                </>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}

const css = `
.lc-page{--glass:rgba(16,23,30,.74);--line:rgba(255,255,255,.1);--ok:#4ade80;--bad:#f87171;--warn:#fbbf24;
  --mono:ui-monospace,'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;
  position:relative;min-height:calc(100vh - 64px);overflow:hidden;color:var(--ink);font-family:var(--sans)}
.lc-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.38}
.lc-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,16,21,.5) 0%,rgba(11,16,21,.96) 70%)}
.lc-wrap{position:relative;max-width:1280px;margin:0 auto;padding:28px 24px 72px}
.lc-wrap--narrow{max-width:560px;padding-top:64px}
.lc-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.lc-title{font-size:clamp(22px,4vw,30px);font-weight:650;letter-spacing:-.01em;line-height:1.15}
.lc-session{display:flex;align-items:center;ga
p:10px;padding:5px 5px 5px 14px;border:1px solid var(--line);
  border-radius:999px;background:var(--glass);font-size:12px;color:var(--ink-dim);max-width:100%}
.lc-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.lc-links{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px;font-size:13px}
.lc-link{padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04);
  color:var(--ink);transition:background .15s,border-color .15s}
.lc-link:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.25)}
.lc-link--main{background:var(--accent);border-color:var(--accent);color:#07201f;font-weight:600}
.lc-link--main:hover{background:#6fe3dd;border-color:#6f

... [Content truncated]