// ============================================================
// Dag Admin Console
// Frontend prepared for the authenticated Dag Admin.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
    id: 'story_pdf_dag',
    name: 'Story Fumetto PDF',
    desc: "Fumetto PDF dalle storie dv-site (versione attiva) inviato via Telegram. Senza parametri genera e invia solo i PDF nuovi; con story_id/story_match invia sempre il PDF richiesto, anche se gia' generato; send=false genera soltanto.",
    params: [
      { k: 'story_id', label: 'Story ID', type: 'str', def: '', hint: "match esatto sull'id della storia" },
      { k: 'story_match', label: 'Story match', type: 'str', def: '', hint: "sottostringa nel prompt della storia (es. 'cane pirata')" },
      { k: 'send', label: 'Send', type: 'bool', def: true, hint: 'false = genera soltanto senza inviare' },
    ],
  },
  {
    id: 'bronze_ingest_dag',
    name: 'Bronze Ingest',
    desc: "Copia i dati grezzi (db lele: public+emergence, db lele_ns, db lele_sw, ImageLab history) nello schema leles_dbt_dev_bronze. Full refresh idempotente, report su Telegram.",
    params: [],
  },
  {
    id: 'bronze_check_dag',
    name: 'Bronze Check (governance)',
    desc: "Integrity check sorgenti vs leles_dbt_dev_bronze: confronta i conteggi righe di ogni tabella e segnala mismatch/missing/orfane. Report su Telegram ogni giorno alle 16:00, lanciabile anche a mano.",
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

export default function DagAdmin() {
  const { t } = useTranslation()
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
  const [dagRunId, setDagRunId] = useState('')
  const [lastAction, setLastAction] = useState('')
  const [dirFiles, setDirFiles] = useState(null)
  const [pickedFile, setPickedFile] = useState(null)
  const [newDagId, setNewDagId] = useState('')
  const [newDagDesc, setNewDagDesc] = useState('')
  const [extraDags, setExtraDags] = useState([])
  const [runsSummary, setRunsSummary] = useState(null)
  const [runsLoading, setRunsLoading] = useState(false)

  const allDags = [...DAGS, ...extraDags]
  const selected = allDags.find((d) => d.id === selectedId)

  useEffect(() => {
    if (!idToken) return
    const decoded = decodeJwtPayload(idToken)
    const email = decoded?.email?.toLowerCase()
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      logout()
      setAuthError(t('dga.unauthorized'))
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
        setAuthError(t('dga.clientIdMissing'))
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
    if (!token) { setAuthError(t('dga.loginFailed')); return }
    const decoded = decodeJwtPayload(token)
    const email = decoded?.email?.toLowerCase()
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      setAuthError(t('dga.unauthorized'))
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
        setError(res.status === 401 ? t('dga.sessionExpired') : t('dga.accessDenied'))
        return null
      }

      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText)

      const data = await res.json()
      let answer = data.answer || data.error || ''
      if (!answer && data.detail) {
        answer = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail, null, 2)
      }
      if (!answer) answer = t('dga.noAnswer')
      setResponse(answer)
      return answer
    } catch (err) {
      clearTimeout(timeoutId)
      setError(err.name === 'AbortError' ? t('dga.timeout') : err.message)
      return null
    } finally {
      setIsLoading(false)
    }
  }

  // Ultime run del DAG selezionato (stesso comando 'status dag', ma in un
  // riquadro dedicato: auto-caricato alla selezione, ordinato per data desc.
  async function fetchRuns(dagId) {
    if (!idToken || !dagId) return
    setRunsLoading(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)
    try {
      const res = await fetch(LELE_API_URL + '/api/admin/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + idToken,
        },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: 'status dag ' + dagId,
          language: 'en',
          chat_id: FORCED_ADMIN_CHAT_ID,
        }),
      })
      clearTimeout(timeoutId)
      if (res.status === 401 || res.status === 403) { logout(); return }
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      const answer = data.answer || data.error || ''
      const runs = []
      answer.split('\n').forEach((line) => {
        const parts = line.split('|')
        if (parts.length < 3) return
        const id = parts[0].replace(/[^\w]/g, '')
        if (!id) return
        const state = parts[1].trim()
        const timing = parts.slice(2).join('|').trim()
        const sep = timing.indexOf('→')
        const start = sep >= 0 ? timing.slice(0, sep).trim() : timing
        const end = sep >= 0 ? timing.slice(sep + 1).trim() : '?'
        runs.push({ id, state, start, end })
      })
      setRunsSummary(runs)
    } catch (e) {
      setRunsSummary(null)
    } finally {
      clearTimeout(timeoutId)
      setRunsLoading(false)
    }
  }

  async function refreshPaused() {
    const answer = await sendCommand('status dag', t('dga.listDags'))
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

  useEffect(() => {
    if (!idToken) return
    setRunsSummary(null)
    fetchRuns(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, idToken])

  function setValue(dagId, key, val) {
    setValues((prev) => ({ ...prev, [dagId]: { ...prev[dagId], [key]: val } }))
  }

  async function handleDirectory() {
    const a = await sendCommand('directory dags', 'Directory dags')
    if (!a) return
    // Prende SOLO i file della sezione "📁 dags/" (indent 4 spazi: diretti in dags/,
    // esclude Archive/, incoming_files/, config della root AIRFLOW, ecc.)
    const files = []
    const lines = a.split('\n')
    let inDags = false
    for (const line of lines) {
      if (/📁\s*dags\/\s*$/.test(line)) { inDags = true; continue }
      if (inDags) {
        const mm = line.match(/^\s{4}📄\s*(\S+\.py)\s*\(/)
        if (mm) { files.push(mm[1]); continue }
        if (/^\s{2}📁/.test(line)) { inDags = false; continue }
      }
    }
    setDirFiles(files)
    setPickedFile(null)
    if (!files.length) setError(t('dga.noPyFiles'))
  }

  async function handleAddDag() {
    const id = newDagId.trim()
    if (!id) { setError(t('dga.enterDagId')); return }
    setError('')
    const a = await sendCommand('aggiungi dag ' + id + (newDagDesc.trim() ? ' ' + newDagDesc.trim() : ''), t('dga.add') + ' ' + id)
    if (!a) return
    if (a.includes('aggiunto a KNOWN_DAGS')) {
      setExtraDags((prev) => [...prev.filter((d) => d.id !== id), {
        id, name: id,
        desc: newDagDesc.trim() || t('dga.newDagDesc'),
        params: [],
      }])
      setSelectedId(id)
      setPickedFile(null)
      setDirFiles(null)
    }
  }

  function handleLaunch() {
    const vals = values[selected.id] || {}
    const conf = buildConf(selected, vals)
    const missing = selected.params.filter((p) => p.req && !vals[p.k] && vals[p.k] !== 0)
    if (missing.length) {
      setError(t('dga.missingParams', { list: missing.map((p) => p.label).join(', ') }))
      return
    }
    setError('')
    sendCommand('exec airflow lancia ' + selected.id + ' conf: ' + JSON.stringify(conf), t('dga.launching') + ' ' + selected.id).then(() => fetchRuns(selected.id))
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
              {t('dga.loginIntro')}
            </p>
            {authError && <p style={styles.authErrorText}>⚠️ {authError}</p>}
            <div ref={buttonRef} style={styles.googleButtonSlot} />
            {!gsiReady && !authError && <p style={styles.loadingText}>{t('dga.loadingLogin')}</p>}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <svg width="44" height="44" viewBox="0 0 200 200" role="img" aria-label="Apache Airflow" style={{ flex: '0 0 auto' }}>
              <defs>
                <linearGradient id="afRed" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#E43921"/><stop offset="1" stopColor="#A62B5B"/></linearGradient>
                <linearGradient id="afBlue" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#017CEE"/><stop offset="1" stopColor="#00A6D6"/></linearGradient>
                <linearGradient id="afTeal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#00A6D6"/><stop offset="1" stopColor="#26C6DA"/></linearGradient>
                <linearGradient id="afGreen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#26C6DA"/><stop offset="1" stopColor="#58C9B4"/></linearGradient>
              </defs>
              <g>
                <path d="M100 100 L46 54 A66 66 0 0 1 154 54 Z" fill="url(#afRed)"/>
                <path d="M100 100 L146 46 A66 66 0 0 1 146 154 Z" fill="url(#afBlue)"/>
                <path d="M100 100 L154 146 A66 66 0 0 1 46 146 Z" fill="url(#afTeal)"/>
                <path d="M100 100 L54 154 A66 66 0 0 1 54 46 Z" fill="url(#afGreen)"/>
              </g>
              <circle cx="100" cy="100" r="18" fill="#0b1015"/>
              <circle cx="100" cy="100" r="10" fill="#58C9B4"/>
            </svg>
            <div>
              <h2 style={{ ...styles.pageTitle, margin: 0 }}>Airflow DAG Panel</h2>
            </div>
          </div>
          <div style={styles.sessionBox}>
            <span style={styles.sessionLabel}>{profile?.email || t('dga.googleAccount')}</span>
            <button type="button" onClick={logout} style={styles.logoutButton}>{t('dga.logout')}</button>
          </div>
        </div>

        <div className="dgp-layout" style={styles.layout}>
          {/* ============ SIDEBAR DAG ============ */}
          <aside className="dgp-sidebar" style={styles.sidebar}>
            <div style={styles.sidebarHeader}>
              <span style={styles.label}>DAG ({allDags.length})</span>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button type="button" disabled={isLoading} onClick={handleDirectory} title={t('dga.listDirTitle')} style={styles.secondaryBtn}>
                  📂
                </button>
                <button type="button" disabled={isLoading} onClick={refreshPaused} title={t('dga.refreshStateTitle')} style={styles.secondaryBtn}>
                  ↻
                </button>
              </div>
            </div>
            <div className="dgp-daglist" style={styles.dagList}>
              {allDags.map((d) => {
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

            {dirFiles !== null && (
              <div style={{ ...styles.panel, padding: '0.7rem', marginTop: '0.6rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={styles.label}>📁 dags/ ({dirFiles.length})</span>
                <button type="button" onClick={() => { setDirFiles(null); setPickedFile(null) }} style={styles.secondaryBtn}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 240, overflowY: 'auto' }}>
                {dirFiles.map((f) => {
                  const base = f.replace(/\.py$/, '')
                  const candidates = [base, base.replace(/_dag$/, ''), base.replace(/^nightly_/, 'night_')]
                  const isNew = !allDags.some((d) => candidates.includes(d.id))
                  const isPicked = pickedFile === f
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                      if (isNew) {
                        setPickedFile(f)
                        setNewDagId(base.replace(/_dag$/, ''))
                        setNewDagDesc('')
                      } else {
                        const match = allDags.find((d) => candidates.includes(d.id))
                        if (match) {
                          setSelectedId(match.id)
                          setPickedFile(null)
                        }
                      }
                    }}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem',
                        background: isPicked ? 'rgba(63,208,201,0.12)' : '#0b1015',
                        border: '1px solid ' + (isPicked ? '#3fd0c9' : '#2a3a48'),
                        color: '#c5d4de', borderRadius: 8, padding: '0.4rem 0.55rem',
                        cursor: 'pointer', fontSize: '0.75rem', textAlign: 'left',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
                      {isNew
                        ? <span style={{ fontSize: '0.65rem', color: '#fbbf24', border: '1px solid #6e5a2c', borderRadius: 999, padding: '0.05rem 0.4rem', whiteSpace: 'nowrap' }}>{t('dga.new')}</span>
                        : <span style={{ fontSize: '0.65rem', color: '#6ee7a8', border: '1px solid #2c6e52', borderRadius: 999, padding: '0.05rem 0.4rem', whiteSpace: 'nowrap' }}>{t('dga.known')}</span>}
                    </button>
                  )
                })}
              </div>

              {pickedFile && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.6rem', borderTop: '1px solid #1f2b35', paddingTop: '0.6rem' }}>
                  <span style={styles.label}>＋ {t('dga.addAsKnown')}</span>
                  <input
                    type="text"
                    value={newDagId}
                    placeholder={t('dga.dagIdPh')}
                    onChange={(e) => setNewDagId(e.target.value)}
                    style={styles.input}
                  />
                  <input
                    type="text"
                    value={newDagDesc}
                    placeholder={t('dga.descPh')}
                    onChange={(e) => setNewDagDesc(e.target.value)}
                    style={styles.input}
                  />
                  <button
                    type="button"
                    disabled={isLoading || !newDagId.trim()}
                    onClick={handleAddDag}
                    style={{ ...styles.launchBtn, padding: '0.5rem 0.9rem', fontSize: '0.8rem', ...(isLoading || !newDagId.trim() ? styles.buttonDisabled : {}) }}
                  >
                    ＋ {t('dga.add')} {newDagId.trim() || pickedFile}
                  </button>
                  <span style={styles.hint}>{t('dga.addHint')}</span>
                </div>
              )}
              </div>
            )}
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
                  {isPaused === undefined ? t('dga.statusUnknown') : isPaused ? t('dga.paused') : t('dga.active')}
                </span>
              </div>
              <p style={styles.dagDesc}>{t('dga.desc.' + selected.id, { defaultValue: selected.desc })}</p>

              {selected.params.length > 0 && (
                <>
                  <span style={styles.label}>{t('dga.params')}</span>
                  <div className="dgp-paramgrid" style={styles.paramGrid}>
                    {selected.params.map((p) => {
                      const v = (values[selected.id] || {})[p.k]
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
                  {isLoading ? t('dga.sending') : t('dga.launch', { id: selected.id })}
                </button>
                <button type="button" disabled={isLoading} onClick={() => sendCommand('status dag ' + selected.id, 'Status ' + selected.id)} style={styles.secondaryBtn}>
                  {t('dga.lastRuns')}
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => sendCommand((isPaused ? 'attiva dag ' : 'pausa dag ') + selected.id, (isPaused ? t('dga.activate') : t('dga.pause')) + ' ' + selected.id).then((a) => { if (a) refreshPaused() })}
                  style={styles.secondaryBtn}
                >
                  {isPaused ? t('dga.activate') : t('dga.pause')}
                </button>
                <button type="button" disabled={isLoading} onClick={() => setValues((prev) => ({ ...prev, [selected.id]: defaultValues(selected) }))} style={styles.secondaryBtn}>
                  {t('dga.resetParams')}
                </button>
              </div>

              <div className="dgp-logrow" style={styles.logRow}>
                <input
                  type="text"
                  value={dagRunId}
                  placeholder={t('dga.dagRunIdPh')}
                  onChange={(e) => setDagRunId(e.target.value)}
                  style={{ ...styles.input, flex: 1 }}
                />
                <button
                  type="button"
                  disabled={isLoading || !dagRunId.trim()}
                  onClick={() => sendCommand('task run ' + selected.id + ' ' + dagRunId.trim(), t('dga.runTask', { id: dagRunId.trim() }))}
                  style={{ ...styles.secondaryBtn, ...(isLoading || !dagRunId.trim() ? styles.buttonDisabled : {}) }}
                >
                  📋 Task
                </button>
                <input
                  type="text"
                  value={taskId}
                  placeholder={t('dga.taskIdPh')}
                  onChange={(e) => setTaskId(e.target.value)}
                  style={{ ...styles.input, flex: 1 }}
                />
                <button
                  type="button"
                  disabled={isLoading || !taskId.trim()}
                  onClick={() => sendCommand('log task ' + selected.id + ' ' + taskId.trim(), 'Log ' + selected.id + '/' + taskId.trim())}
                  style={{ ...styles.secondaryBtn, ...(isLoading || !taskId.trim() ? styles.buttonDisabled : {}) }}
                >
                  {t('dga.logTask')}
                </button>
              </div>
            </div>

            <div style={{ ...styles.panel, padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={styles.label}>{t('dga.runsOf', { id: selected.id })}</span>
                <button type="button" disabled={runsLoading} onClick={() => fetchRuns(selected.id)} style={styles.secondaryBtn} title={t('dga.refresh')}>
                  {runsLoading ? '⏳' : '↻'}
                </button>
              </div>
              {runsSummary === null ? (
                <p style={{ ...styles.hint, marginTop: '0.5rem' }}>{runsLoading ? t('dga.loadingRuns') : t('dga.noRunData')}</p>
              ) : runsSummary.length === 0 ? (
                <p style={{ ...styles.hint, marginTop: '0.5rem' }}>{t('dga.noRuns')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.5rem' }}>
                  {runsSummary.slice(0, 5).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      title={t('dga.clickToFill')}
                      onClick={() => setDagRunId(r.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
                        background: '#0b1015', border: '1px solid #2a3a48', borderRadius: 8,
                        color: '#c5d4de', padding: '0.4rem 0.6rem', cursor: 'pointer',
                        fontSize: '0.75rem', textAlign: 'left',
                      }}
                    >
                      <span style={{ color: r.state === 'success' ? '#6ee7a8' : r.state === 'failed' ? '#ff9b9b' : r.state === 'running' ? '#fbbf24' : '#c5d4de' }}>
                        {r.state === 'success' ? '✅' : r.state === 'failed' ? '❌' : r.state === 'running' ? '🔄' : '⏳'} {r.state}
                      </span>
                      <code style={{ color: '#3fd0c9' }}>{r.id}</code>
                      <span style={{ color: '#8fa1ac' }}>{r.start} → {r.end}</span>
                    </button>
                  ))}
                  <span style={styles.hint}>{t('dga.runsHint')}</span>
                </div>
              )}
            </div>

            {error && (
              <div style={styles.errorBox}>
                <strong>{t('dga.error')}</strong>
                <p>{error}</p>
              </div>
            )}

            {response && (
              <div style={styles.response}>
                <div style={styles.responseHeader}>
                  <h3 style={styles.responseTitle}>
                    {lastAction ? t('dga.lelesResponseWith', { action: lastAction }) : t('dga.lelesResponse')}
                  </h3>
                  <button type="button" onClick={() => setResponse('')} style={styles.secondaryBtn}>{t('dga.close')}</button>
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

