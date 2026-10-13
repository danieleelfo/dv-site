import { useEffect, useRef, useState } from 'react'
import bgImage from '../assets/Faro.jpeg'

const LELE_API_URL = 'https://api.danielevillanova.com'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

const TOKEN_STORAGE_KEY = 'leles_admin_id_token'
const ALLOWED_EMAILS = [
  'dannybydanny@hotmail.com',
  'salatinodenise@gmail.com',
]
const FORCED_ADMIN_CHAT_ID = 8733881519

// ============================================================
// Catalogo DAG — rispecchia KNOWN_DAGS in leles/scripts/airflow_agent.py
// type: 'int' | 'float' | 'str' | 'text' | 'json' | 'list' | 'bool'
// ============================================================
const DAGS = [
  {
    id: 'emergence_flow',
    name: 'Emergence Flow',
    desc: 'Pipeline completa: nuova simulazione multi-agente + analisi finale (target_role), senza trigger inter-DAG.',
    params: [
      { k: 'scenario', label: 'Scenario', type: 'text', def: 'Design coordinamento agenti' },
      { k: 'num_iterations', label: 'Iterazioni', type: 'int', def: 3 },
      { k: 'judge_model', label: 'Judge model', type: 'str', def: 'qwen2.5' },
      { k: 'target_role', label: 'Target role', type: 'str', def: 'ALL', hint: "'ALL' o un ruolo: Planner, Critic, Sheriff…" },
      { k: 'temperature', label: 'Temperature', type: 'float', def: 0.7 },
      { k: 'seed', label: 'Seed', type: 'int', def: 42 },
      { k: 'pipeline_config', label: 'Pipeline config (JSON)', type: 'json', def: '', hint: 'opzionale, es. {"model_strategy":"fixed"}' },
    ],
  },
  {
    id: 'emergence_dag',
    name: 'Emergence + Audit',
    desc: 'Simulazione multi-agente con audit di coerenza (LLM-as-a-Judge). target_run_id = 0 crea una nuova run, >0 rianalizza una run esistente.',
    params: [
      { k: 'target_run_id', label: 'Target run id', type: 'int', def: 0, hint: '0 = nuova run' },
      { k: 'scenario', label: 'Scenario', type: 'text', def: "Progettazione dell'architettura di coordinamento agenti" },
      { k: 'num_iterations', label: 'Iterazioni', type: 'int', def: 3 },
      { k: 'temperature', label: 'Temperature', type: 'float', def: 0.7 },
      { k: 'seed', label: 'Seed', type: 'int', def: 42 },
      { k: 'judge_model', label: 'Judge model', type: 'str', def: 'qwen2.5' },
      { k: 'pipeline_config', label: 'Pipeline config (JSON)', type: 'json', def: '' },
    ],
  },
  {
    id: 'emergence_lab_analysis',
    name: 'Lab Analysis',
    desc: 'Analizza una run Emergence Lab con un LLM giudice.',
    params: [
      { k: 'run_id', label: 'Run ID', type: 'int', def: '', req: true },
      { k: 'target_role', label: 'Target role', type: 'str', def: 'ALL' },
      { k: 'judge_model', label: 'Judge model', type: 'str', def: 'mistral' },
    ],
  },
  {
    id: 'decisione_dag',
    name: 'Decisione',
    desc: 'Estrae la decisione/conclusione di una run Emergence Lab completata.',
    params: [
      { k: 'run_id', label: 'Run ID', type: 'int', def: '', req: true },
      { k: 'judge_model', label: 'Judge model', type: 'str', def: 'deepseek-r1' },
    ],
  },
  {
    id: 'decisione_run_dag',
    name: 'Decisione Run (approfondita)',
    desc: 'Analisi decisionale completa: ogni iterazione singolarmente + evoluzione + decisione finale. Piu lenta di decisione_dag.',
    params: [
      { k: 'emergence_run_id', label: 'Emergence run ID', type: 'int', def: '', req: true, hint: "chiave 'emergence_run_id', NON 'run_id'" },
      { k: 'judge_model', label: 'Judge model', type: 'str', def: 'mistral' },
      { k: 'judge_role', label: 'Judge role', type: 'str', def: '' },
    ],
  },
  {
    id: 'sintetizza_dag',
    name: 'Sintetizza',
    desc: 'Sintetizza una run: analizza tutti i 12 ruoli individualmente + analisi globale.',
    params: [
      { k: 'run_id', label: 'Run ID', type: 'int', def: '', req: true },
      { k: 'model', label: 'Model', type: 'str', def: 'deepseek-r1' },
      { k: 'pipeline_config', label: 'Pipeline config (JSON)', type: 'json', def: '' },
    ],
  },
  {
    id: 'memory_summary_dag',
    name: 'Memory Summary',
    desc: 'Consolida il report di una run nella tabella di memoria storica (emergence.memory_run_summary).',
    params: [
      { k: 'run_id', label: 'Run ID', type: 'int', def: '', req: true },
      { k: 'judge_model', label: 'Judge model', type: 'str', def: 'llama3' },
    ],
  },
  {
    id: 'improve_dag',
    name: 'Improve (refactoring)',
    desc: 'Refactoring/feature su un singolo file .py esistente, guidato da agenti multi-modello. Sintesi in AI_TMP.',
    params: [
      { k: 'target_file_path', label: 'Target file (path assoluto)', type: 'str', def: '', req: true },
      { k: 'feature_request', label: 'Feature request', type: 'text', def: '' },
      { k: 'num_iterations', label: 'Iterazioni', type: 'int', def: 3 },
      { k: 'temperature', label: 'Temperature', type: 'float', def: 0.7 },
      { k: 'seed', label: 'Seed', type: 'int', def: 42 },
      { k: 'synthesizer_model', label: 'Synthesizer model', type: 'str', def: 'qwen2.5' },
      { k: 'output_dir', label: 'Output dir', type: 'str', def: '/Users/danny/Desktop/Danny/AI_TMP' },
    ],
  },
  {
    id: 'dv_site_telegram_dag',
    name: 'Report Sito (Telegram)',
    desc: 'Report giornaliero del traffico di danielevillanova.com via Cloudflare, inviato su Telegram. Nessun parametro.',
    params: [],
  },
  {
    id: 'bar_ai_schema_audit_dag',
    name: 'Bar AI Schema Audit',
    desc: 'Confronta lo schema PostgreSQL di Bar AI con le definizioni SQL nel codice Python. Report su Telegram.',
    params: [],
  },
  {
    id: 'process_uploaded_file',
    name: 'Sposta File',
    desc: 'Sposta un file gia presente sul filesystem (directory consentite: leles, airflow, AI_TMP).',
    params: [
      { k: 'file_path', label: 'File path (assoluto)', type: 'str', def: '', req: true },
      { k: 'target_path', label: 'Target path', type: 'str', def: '/Users/danny/Desktop/Danny/leles/' },
    ],
  },
  {
    id: 'process_multiple_files',
    name: 'Sposta File Multipli',
    desc: 'Sposta piu file, ognuno nella sua destinazione. Le due liste devono avere la stessa lunghezza.',
    params: [
      { k: 'file_paths', label: 'File paths (sep. da virgola)', type: 'list', def: '', req: true },
      { k: 'target_paths', label: 'Target paths (sep. da virgola)', type: 'list', def: '', req: true },
      { k: 'overwrite', label: 'Overwrite', type: 'bool', def: true, hint: 'senza true: successo riportato ma nessuna copia se il file esiste' },
    ],
  },
  {
    id: 'save_file_dag',
    name: 'Salva File',
    desc: 'Salva un file locale con il contenuto indicato.',
    params: [
      { k: 'file_path', label: 'File path (assoluto)', type: 'str', def: '', req: true },
      { k: 'file_content', label: 'Contenuto', type: 'text', def: '', req: true },
    ],
  },
]

function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(window.atob(base64))))
  } catch (e) {
    return null
  }
}

function defaultValues(dag) {
  const out = {}
  dag.params.forEach((p) => { out[p.k] = p.def })
  return out
}

function buildConf(dag, values) {
  const conf = {}
  for (const p of dag.params) {
    let v = values[p.k]
    if (v === '' || v === null || v === undefined) continue
    if (p.type === 'int') v = parseInt(v, 10)
    else if (p.type === 'float') v = parseFloat(v)
    else if (p.type === 'list') v = String(v).split(',').map((s) => s.trim()).filter(Boolean)
    else if (p.type === 'bool') v = v === true || v === 'true'
    if (p.type === 'int' || p.type === 'float') { if (Number.isNaN(v)) continue }
    conf[p.k] = v
  }
  return conf
}

export default function DagPanel() {
  const [idToken, setIdToken] = useState(() => {
    try { return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || null } catch (e) { return null }
  })
  const [profile, setProfile] = useState(() => (idToken ? decodeJwtPayload(idToken) : null))
  const [authError, setAuthError] = useState('')
  const [gsiReady, setGsiReady] = useState(false)
  const buttonRef = useRef(null)

  const [selectedId, setSelectedId] = useState(DAGS[0].id)
  const [values, setValues] = useState(() => {
    const v = {}
    DAGS.forEach((d) => { v[d.id] = defaultValues(d) })
    return v
  })
  const [isLoading, setIsLoading] = useState(false)
  const [response, setResponse] = useState('')
  const [error, setError] = useState('')
  const [pausedMap, setPausedMap] = useState({})
  const [taskId, setTaskId] = useState('')
  const [lastAction, setLastAction] = useState('')

  const selected = DAGS.find((d) => d.id === selectedId)

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
      if (!window.google?.accounts?.id) { setTimeout(tryInit, 150); return }
      if (!GOOGLE_CLIENT_ID) {
        setAuthError('GOOGLE_CLIENT_ID non configurato (VITE_GOOGLE_CLIENT_ID mancante).')
        return
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
      })
      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard', theme: 'filled_black', size: 'large',
          text: 'signin_with', shape: 'pill',
        })
      }
      setGsiReady(true)
    }
    tryInit()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken])

  function handleCredentialResponse(credentialResponse) {
    const token = credentialResponse?.credential
    if (!token) { setAuthError('Login Google fallito: nessun token ricevuto.'); return }
    const decoded = decodeJwtPayload(token)
    const email = decoded?.email?.toLowerCase()
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      setAuthError('Accesso non autorizzato per questo account Google.')
      try { window.google?.accounts?.id?.disableAutoSelect() } catch (e) {}
      return
    }
    setAuthError('')
    setProfile(decoded)
    setIdToken(token)
    try { window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token) } catch (e) {}
  }

  function logout() {
    setIdToken(null)
    setProfile(null)
    setResponse('')
    setError('')
    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      window.google?.accounts?.id?.disableAutoSelect()
    } catch (e) {}
  }

  async function sendCommand(prompt, actionLabel) {
    if (!idToken || !prompt.trim()) return null
    setIsLoading(true)
    setResponse('')
    setError('')
    if (actionLabel) setLastAction(actionLabel)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000)

    try {
      const res = await fetch(LELE_API_URL + '/api/admin/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + idToken,
        },
        signal: controller.signal,
        body: JSON.stringify({
          prompt,
          language: 'en',
          chat_id: FORCED_ADMIN_CHAT_ID,
        }),
      })

      clearTimeout(timeoutId)

      if (res.status === 401 || res.status === 403) {
        logout()
        setError(res.status === 401 ? 'Sessione scaduta, effettua di nuovo il login.' : 'Accesso non autorizzato.')
        return null
      }

      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText)

      const data = await res.json()
      let answer = data.answer || data.error || ''
      if (!answer && data.detail) {
        answer = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail, null, 2)
      }
      if (!answer) answer = 'Nessuna risposta ricevuta'
      setResponse(answer)
      return answer
    } catch (err) {
      clearTimeout(timeoutId)
      setError(err.name === 'AbortError' ? 'Timeout: il server non ha risposto in tempo.' : err.message)
      return null
    } finally {
      setIsLoading(false)
    }
  }

  async function refreshPaused() {
    const answer = await sendCommand('status dag', 'Elenco DAG')
    if (!answer) return
    const map = {}
    answer.split('\n').forEach((line) => {
      const m = line.match(/•\s*(\S+)\s*\(([^)]+)\)/)
      if (m) map[m[1]] = m[2].includes('pausa')
    })
    setPausedMap(map)
  }

  useEffect(() => {
    if (idToken) refreshPaused()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken])

  function setValue(dagId, key, val) {
    setValues((prev) => ({ ...prev, [dagId]: { ...prev[dagId], [key]: val } }))
  }

  function handleLaunch() {
    const conf = buildConf(selected, values[selected.id])
    const missing = selected.params.filter((p) => p.req && !values[selected.id][p.k] && values[selected.id][p.k] !== 0)
    if (missing.length) {
      setError('Parametri obbligatori mancanti: ' + missing.map((p) => p.label).join(', '))
      return
    }
    setError('')
    sendCommand('exec airflow lancia ' + selected.id + ' conf: ' + JSON.stringify(conf), 'Lancio ' + selected.id)
  }

  if (!idToken) {
    return (
      <section className="section container" style={styles.wrap}>
        <img src={bgImage} alt="" style={styles.bgImg} />
        <div style={styles.overlay} />
        <div style={styles.content}>
          <h2 style={styles.pageTitle}>Airflow DAG Panel</h2>
          <div style={styles.loginBox}>
            <p style={styles.loginText}>
              Accesso riservato. Login Google per lanciare e gestire i DAG Airflow.
            </p>
            {authError && <p style={styles.authErrorText}>⚠️ {authError}</p>}
            <div ref={buttonRef} style={styles.googleButtonSlot} />
            {!gsiReady && !authError && <p style={styles.loadingText}>Caricamento login Google…</p>}
          </div>
        </div>
      </section>
    )
  }

  const isPaused = pausedMap[selected.id]

  return (
    <section className="section container" style={styles.wrap}>
      <img src={bgImage} alt="" style={styles.bgImg} />
      <div style={styles.overlay} />

      <div style={styles.contentWide}>
        <style>{`
          @media (max-width: 820px) {
            .dgp-layout { display: flex !important; flex-direction: column !important; gap: 0.75rem !important; }
            .dgp-sidebar { padding: 0.6rem !important; }
            .dgp-daglist { flex-direction: row !important; overflow-x: auto; gap: 0.35rem !important; padding-bottom: 0.3rem; -webkit-overflow-scrolling: touch; }
            .dgp-daglist::-webkit-scrollbar { height: 4px; }
            .dgp-daglist::-webkit-scrollbar-thumb { background: #2a3a48; border-radius: 4px; }
            .dgp-daglist > button { flex: 0 0 auto; max-width: 180px; }
            .dgp-paramgrid { grid-template-columns: 1fr !important; }
            .dgp-logrow { flex-wrap: wrap; }
            .dgp-logrow > input { flex: 1 1 100% !important; }
            .dgp-logrow > button { width: 100%; }
          }
          @media (max-width: 520px) {
            .dgp-layout { font-size: 0.95rem; }
            .dgp-titlerow { gap: 0.5rem !important; }
          }
        `}</style>
        <div className="dgp-titlerow" style={styles.titleRow}>
          <div>
            <h2 style={styles.pageTitle}>Airflow DAG Panel</h2>
            <p style={styles.subtitle}>
              Lancia, metti in pausa e monitora i DAG — comandi via Leles, senza LLM nel routing.
            </p>
          </div>
          <div style={styles.sessionBox}>
            <span style={styles.sessionLabel}>{profile?.email || 'account Google'}</span>
            <button type="button" onClick={logout} style={styles.logoutButton}>Logout</button>
          </div>
        </div>

        <div className="dgp-layout" style={styles.layout}>
          {/* ============ SIDEBAR DAG ============ */}
          <aside className="dgp-sidebar" style={styles.sidebar}>
            <div style={styles.sidebarHeader}>
              <span style={styles.label}>DAG ({DAGS.length})</span>
              <button type="button" disabled={isLoading} onClick={refreshPaused} style={styles.secondaryBtn}>
                ↻
              </button>
            </div>
            <div className="dgp-daglist" style={styles.dagList}>
              {DAGS.map((d) => {
                const paused = pausedMap[d.id]
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={isLoading}
                    onClick={() => setSelectedId(d.id)}
                    style={{
                      ...styles.dagBtn,
                      ...(selectedId === d.id ? styles.dagBtnActive : {}),
                    }}
                  >
                    <span style={styles.dagName}>{d.name}</span>
                    <span style={{ ...styles.dagBadge, ...(paused ? styles.badgePaused : styles.badgeActive) }}>
                      {paused === undefined ? '·' : paused ? '⏸' : '▶'}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          {/* ============ PANNELLO PRINCIPALE ============ */}
          <div style={styles.main}>
            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <div>
                  <h3 style={styles.dagTitle}>{selected.name}</h3>
                  <code style={styles.dagId}>{selected.id}</code>
                </div>
                <span style={{ ...styles.dagBadge, ...(isPaused ? styles.badgePaused : styles.badgeActive) }}>
                  {isPaused === undefined ? 'stato sconosciuto' : isPaused ? '⏸ in pausa' : '▶ attivo'}
                </span>
              </div>
              <p style={styles.dagDesc}>{selected.desc}</p>

              {selected.params.length > 0 && (
                <>
                  <span style={styles.label}>Parametri</span>
                  <div className="dgp-paramgrid" style={styles.paramGrid}>
                    {selected.params.map((p) => {
                      const v = values[selected.id][p.k]
                      return (
                        <label key={p.k} style={{ ...styles.field, ...(p.type === 'text' || p.type === 'json' ? { gridColumn: '1 / -1' } : {}) }}>
                          <span style={styles.label}>
                            {p.label}{p.req ? ' *' : ''}
                          </span>
                          {p.type === 'bool' ? (
                            <input
                              type="checkbox"
                              checked={v === true || v === 'true'}
                              onChange={(e) => setValue(selected.id, p.k, e.target.checked)}
                            />
                          ) : p.type === 'text' ? (
                            <textarea
                              value={v}
                              onChange={(e) => setValue(selected.id, p.k, e.target.value)}
                              rows={2}
                              style={styles.input}
                            />
                          ) : (
                            <input
                              type={p.type === 'int' || p.type === 'float' ? 'number' : 'text'}
                              step={p.type === 'float' ? '0.1' : undefined}
                              value={v}
                              placeholder={p.hint || ''}
                              onChange={(e) => setValue(selected.id, p.k, e.target.value)}
                              style={styles.input}
                            />
                          )}
                          {p.hint && p.type !== 'text' && <span style={styles.hint}>{p.hint}</span>}
                        </label>
                      )
                    })}
                  </div>
                </>
              )}

              <div style={styles.actionsRow}>
                <button type="button" disabled={isLoading} onClick={handleLaunch} style={{ ...styles.launchBtn, ...(isLoading ? styles.buttonDisabled : {}) }}>
                  {isLoading ? '⏳ Invio comando…' : '▶ Lancia ' + selected.id}
                </button>
                <button type="button" disabled={isLoading} onClick={() => sendCommand('status dag ' + selected.id, 'Status ' + selected.id)} style={styles.secondaryBtn}>
                  🔄 Ultime run
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => sendCommand((isPaused ? 'attiva dag ' : 'pausa dag ') + selected.id, (isPaused ? 'Attiva ' : 'Pausa ') + selected.id).then((a) => { if (a) refreshPaused() })}
                  style={styles.secondaryBtn}
                >
                  {isPaused ? '▶ Attiva' : '⏸ Pausa'}
                </button>
                <button type="button" disabled={isLoading} onClick={() => setValues((prev) => ({ ...prev, [selected.id]: defaultValues(selected) }))} style={styles.secondaryBtn}>
                  ↺ Reset parametri
                </button>
              </div>

              <div className="dgp-logrow" style={styles.logRow}>
                <input
                  type="text"
                  value={taskId}
                  placeholder="task_id per il log (es. run_coherence_analysis_task)"
                  onChange={(e) => setTaskId(e.target.value)}
                  style={{ ...styles.input, flex: 1 }}
                />
                <button
                  type="button"
                  disabled={isLoading || !taskId.trim()}
                  onClick={() => sendCommand('log task ' + selected.id + ' ' + taskId.trim(), 'Log ' + selected.id + '/' + taskId.trim())}
                  style={{ ...styles.secondaryBtn, ...(isLoading || !taskId.trim() ? styles.buttonDisabled : {}) }}
                >
                  📄 Log task
                </button>
              </div>
            </div>

            {error && (
              <div style={styles.errorBox}>
                <strong>⚠️ Errore</strong>
                <p>{error}</p>
              </div>
            )}

            {response && (
              <div style={styles.response}>
                <div style={styles.responseHeader}>
                  <h3 style={styles.responseTitle}>
                    {lastAction ? 'Risposta Leles — ' + lastAction : 'Risposta Leles'}
                  </h3>
                  <button type="button" onClick={() => setResponse('')} style={styles.secondaryBtn}>Chiudi</button>
                </div>
                <div style={styles.responseLines}>
                  {response.split('\n').map((line, i) => {
                    let color = '#c5d4de'
                    if (line.includes('success')) color = '#6ee7a8'
                    else if (line.includes('failed') || line.startsWith('❌')) color = '#ff9b9b'
                    else if (line.includes('running') || line.includes('queued')) color = '#fbbf24'
                    return (
                      <div key={i} style={{ ...styles.responseLine, color }}>{line}</div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
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
    background: 'linear-gradient(180deg, rgba(8,12,18,0.15) 0%, rgba(8,12,18,0.25) 100%)',
    zIndex: 0,
    pointerEvents: 'none',
  },
  content: { position: 'relative', zIndex: 1, maxWidth: 520, margin: '0 auto' },
  contentWide: { position: 'relative', zIndex: 1, maxWidth: 1080, margin: '0 auto' },
  pageTitle: { margin: 0, fontSize: '1.75rem', color: '#e8f1f5' },
  subtitle: { margin: '0.35rem 0 0', color: '#8fa1ac', fontSize: '0.9rem' },
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1.25rem',
    flexWrap: 'wrap',
  },
  sessionBox: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  sessionLabel: { color: '#a8b8c4', fontSize: '0.85rem' },
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
  googleButtonSlot: { display: 'flex', justifyContent: 'center', minHeight: 40 },

  layout: { display: 'grid', gridTemplateColumns: '250px 1fr', gap: '1rem' },
  sidebar: {
    background: 'rgba(18,26,34,0.88)',
    border: '1px solid #1f2b35',
    borderRadius: 12,
    padding: '0.85rem',
    alignContent: 'start',
  },
  sidebarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.6rem',
  },
  dagList: { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  dagBtn: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem',
    background: '#0b1015',
    border: '1px solid #2a3a48',
    color: '#c5d4de',
    borderRadius: 8,
    padding: '0.5rem 0.65rem',
    cursor: 'pointer',
    fontSize: '0.82rem',
    textAlign: 'left',
    transition: 'all 0.15s ease',
  },
  dagBtnActive: { border: '1px solid #3fd0c9', color: '#e8f1f5', background: 'rgba(63,208,201,0.1)' },
  dagName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dagBadge: { fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: 999, border: '1px solid', whiteSpace: 'nowrap' },
  badgeActive: { color: '#6ee7a8', borderColor: '#2c6e52', background: 'rgba(110,231,168,0.07)' },
  badgePaused: { color: '#fbbf24', borderColor: '#6e5a2c', background: 'rgba(251,191,36,0.07)' },

  main: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  panel: {
    background: 'rgba(18,26,34,0.88)',
    border: '1px solid #1f2b35',
    borderRadius: 12,
    padding: '1.25rem',
  },
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '0.8rem',
    flexWrap: 'wrap',
    marginBottom: '0.4rem',
  },
  dagTitle: { margin: 0, fontSize: '1.15rem', color: '#e8f1f5' },
  dagId: { color: '#3fd0c9', fontSize: '0.78rem' },
  dagDesc: { color: '#8fa1ac', fontSize: '0.85rem', margin: '0.4rem 0 1rem', lineHeight: 1.5 },
  label: {
    color: '#8fa1ac',
    fontSize: '0.72rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  paramGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: '0.85rem',
    margin: '0.6rem 0 1.2rem',
  },
  field: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  hint: { color: '#718491', fontSize: '0.7rem' },
  input: {
    background: '#0b1015',
    border: '1px solid #2a3a48',
    borderRadius: 8,
    color: '#e8f1f5',
    padding: '0.55rem 0.7rem',
    fontSize: '0.9rem',
    boxSizing: 'border-box',
    width: '100%',
  },
  actionsRow: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', marginBottom: '0.9rem' },
  launchBtn: {
    background: 'linear-gradient(135deg, #2dd4bf, #0ea5e9)',
    border: 'none',
    color: '#041016',
    fontWeight: 700,
    borderRadius: 999,
    padding: '0.65rem 1.25rem',
    cursor: 'pointer',
    fontSize: '0.95rem',
  },
  secondaryBtn: {
    background: 'transparent',
    border: '1px solid #3a4a58',
    color: '#c5d4de',
    borderRadius: 999,
    padding: '0.5rem 0.9rem',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  buttonDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  logRow: { display: 'flex', gap: '0.6rem', alignItems: 'center' },
  errorBox: {
    padding: '0.9rem',
    background: 'rgba(80,20,20,0.55)',
    border: '1px solid #7a3030',
    borderRadius: 10,
    color: '#ffc9c9',
  },
  response: {
    background: 'rgba(18,26,34,0.92)',
    border: '1px solid #1f2b35',
    borderRadius: 12,
    padding: '1rem',
  },
  responseHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
    gap: '0.5rem',
  },
  responseTitle: { margin: 0, fontSize: '1rem', color: '#e8f1f5' },
  responseLines: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: 1.55,
  },
  responseLine: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
}
