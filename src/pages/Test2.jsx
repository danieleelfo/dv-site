// ============================================================
// TEST2 — Leles Admin Console (v2 "piu' figa")
// v2: 3 selettori modello (Super-Leles / Leles / Reviewer) sincronizzati
// col server via comando "modelli"; nuovo ordine sezioni (Comandi, Sessione,
// Pagine, Audio, Test); restyling (titolo gradient, ombre, hover lift).
// LeleAdmin.jsx resta la versione ufficiale su /leles.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import bgImage from '../assets/DataInFlames.jpg'
import SystemTiles, { parseSystem, parseOs, cleanRam, OsKpis, statLevel } from '../components/SystemPanel'
import {
  apiJson,
  buildRepairPrompt,
  buildStoryboardPrompt,
  createImageJob,
  fetchJobStatusWithRetry as fetchJobStatusWithRetryShared,
  normalizeScenes,
  parsePlan,
  resultToDataUrl,
  unloadOllama,
  waitForImageResult,
} from '../lib/imageJobs'

// F2: adminJson ora vive nel modulo condiviso src/lib/imageJobs.js
// (stessa firma di prima; migliora solo il messaggio d'errore HTTP
// mostrando il detail del gateway quando presente).
const adminJson = apiJson

const LELE_API_URL = 'https://api.danielevillanova.com'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const TOKEN_STORAGE_KEY = 'leles_admin_id_token'

// --- TEST TEMPORANEO: whitelist email per accesso alla console -----------
// TODO: rimuovere/estendere quando arriva il login Telegram con ADMIN_IDS.
const ALLOWED_EMAILS = [
  'dannybydanny@hotmail.com',
  'salatinodenise@gmail.com',
]
// Forza il chat_id a un ADMIN_IDS di Leles, così i comandi riservati
// al "capitano" funzionano anche dalla console web.
const FORCED_ADMIN_CHAT_ID = 8733881519
// ---------------------------------------------------------------------------

// --- AUDIO: TTS + registrazione + risposta audio ---------------------------
// Story Whisper e Night Story: API audio complete (/api/chat e /api/chat/audio).
// Leles: console admin (login Google). Testo e TTS passano da /api/admin/chat.
// ATTENZIONE: le due route qui sotto per audio in ingresso e file TTS sono
// ASSUNTE (speculari a quelle pubbliche): da verificare lato gateway.
const LELES_AGENT = 'Leles'
const LELES_AUDIO_PATH = '/api/admin/chat/audio'
const LELES_TTS_PATH = '/api/admin/chat/tts'
const AUDIO_AGENTS = [
  { value: 'Story Whisper', label: 'Story Whisper 🌈' },
  { value: 'Night Story', label: 'Night Story 🌙' },
  { value: LELES_AGENT, label: 'Leles 🏴‍☠️' },
]
const AUDIO_CHAT_ID_KEY = 'lele_chat_id'
const AUDIO_LANGUAGE = 'it'
const AUTO_SEND_RECORDING = true
// ---------------------------------------------------------------------------

// --- SUPER-LELES: selettore modello nel prompt ------------------------------
// La lista combacia con SUPER_LELES_ALLOWED_MODELS del gateway (gateway.py).
// Il cambio modello viene inviato come comando "modellosl <nome>", già
// supportato dal backend: nessuna sintassi nuova.
const SUPER_MODELS = [
  'mistral',
  'gemma4',
  'llama3',
  'qwen2.5',
  'deepseek-r1',
  'qwen2.5-coder:7b',
  'gpt-oss:20b',
]
const SUPER_MODEL_KEY = 'lc_super_model'

// Modelli permessi per gli agenti normali (ALLOWED_MODELS in gateway.py).
// Usati sia dal selettore "modello" (Leles) sia dal "reviewer".
const LELE_MODELS = ['mistral', 'gemma4', 'llama3', 'qwen2.5', 'deepseek-r1']
const LELE_MODEL_KEY = 'lc_lele_model'
const REVIEWER_MODEL_KEY = 'lc_reviewer_model'

// Pagine e console ufficiali del sito.
const QUICK_LINKS = [
  { to: '/improve', label: 'Improve 🛠️', desc: 'Editor file + revisione AI', main: true },
  { to: '/api-contracts', label: 'API Contracts 📡', desc: 'Contratti API del gateway', main: true },
  { to: '/image-lab', label: 'Image Lab 🖼️', desc: 'Z-Image-Turbo · generazione + gallery', main: true },
  { to: '/git-admin', label: 'Git Admin ⑂', desc: 'Status · diff · commit · push con conferma' },
  { to: '/dag-admin', label: 'DAG Admin 🌬️', desc: 'Pannello Airflow' },
  { to: '/b2b', label: 'B2B Arena ◎', desc: 'Bot-to-bot lab' },
  { to: '/bar-ai-admin', label: 'Bar AI Admin 🍸', desc: 'CRUD tabelle bar' },
  { to: '/ai-lab', label: 'AI Lab ◈', desc: 'Pagina pubblica degli agenti' },
]

// Pagine di test/laboratorio: in fondo, si validano da qui.
const TEST_LINKS = [
  { to: '/test', label: 'Test 🕰️', desc: 'Pagina test storica' },
  { to: '/test2', label: 'Test2 🏴‍☠️', desc: 'Leles Admin Console (questa pagina)' },
  { to: '/test3', label: 'Test3 🗺️', desc: 'Arena multi-agente' },
  { to: '/test4', label: 'Test4 🔬', desc: 'ImageLab preview · gallery · OCR/JCS' },
  { to: '/test5', label: 'Test5 🧠', desc: 'Image-to-image (img2img)' },
  { to: '/test6', label: 'Test6 🍹', desc: 'CRUD bar AI (promossa su /bar-ai-admin)' },
  { to: '/testbarai', label: 'TestBarAI 🧪', desc: 'Variante Bar AI in test' },
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
    id: 'modelli', title: 'Modelli & LLM', icon: '🎛️', color: '#c4b5fd',
    commands: [
      c('Modelli attivi', 'modelli'),
      c('Cambia reviewer', 'reviewer ', 'nome modello'),
      c('Query', 'query ', 'Scrivi la query'),
      c('Gemma', 'gemma ', 'prompt'),
      c('Llama', 'llama ', 'prompt'),
      c('Edita', 'edita'),
      c('Roast', 'roast'),
      c('Critica', 'critica'),
      c('Pirata', 'pirata'),
    ],
  },
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
      c('Start Story Whisper', 'start story whisper'),
      c('Stop Story Whisper', 'stop story whisper', undefined, true),
      c('Restart Story Whisper', 'restart story whisper', undefined, true),
      c('Start Night Story', 'start night story'),
      c('Stop Night Story', 'stop night story', undefined, true),
      c('Restart Night Story', 'restart night story', undefined, true),
      c('Restart Gateway', 'restart gateway', undefined, true),
      c('Logs Lele', 'logs lele'),
      c('Logs Story Whisper', 'logs story whisper'),
      c('Logs Night Story', 'logs night story'),
      c('Logs Leles', 'logs leles'),
    ],
  },
  {
    id: 'emergence', title: 'Emergence / QE', icon: '🧠', color: '#a78bfa',
    commands: [
      c('QE last 10', 'QE last 10'),
      c('QE last 3', 'QE last 3'),
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
      c('Esporta file', 'esporta file ', 'path del file remoto (via Lele Admin)'),
      c('Esporta record', 'esporta ', 'record in formato yaml'),
      c('Remoto test', 'remoto test'),
      c('Remoto LS', 'remoto ls ', 'path'),
      c('Remoto download', 'remoto download ', 'file'),
      c('Remoto upload', 'remoto upload ', 'file', true),
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

// chat_id anonimo e persistente per le API audio pubbliche.
function getAudioChatId() {
  try {
    const stored = window.localStorage.getItem(AUDIO_CHAT_ID_KEY)
    if (stored) return parseInt(stored, 10)
    const newId = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000
    window.localStorage.setItem(AUDIO_CHAT_ID_KEY, String(newId))
    return newId
  } catch (e) {
    return Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000
  }
}

const extractFilename = (value) => {
  if (!value || typeof value !== 'string') return null
  return value.split(/[/\\]/).pop() || null
}

const audioText = (data) => {
  if (data.answer) return data.answer
  if (data.error) return data.error
  if (data.detail) {
    return typeof data.detail === 'string'
      ? data.detail
      : JSON.stringify(data.detail, null, 2)
  }
  return 'Nessuna risposta ricevuta'
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(window.atob(base64))))
  } catch (e) {
    return null
  }
}

async function callAdmin(idToken, prompt, timeoutMs = 310000) {
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
          : 'Accesso non autorizzato per questo account Google. 🏴‍☠️'
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
      throw new Error('Timeout: il server non ha risposto in tempo. 😵‍💫')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Chiamata LLM stateless: il prompt va dritto a Ollama via gateway,
// SENZA passare dagli agenti e dalla loro memoria di conversazione.
// Usata per la pianificazione delle scene (niente scene "fantasma" di
// storie precedenti rimaste nella memoria dell'agente).
async function callLlm(idToken, prompt, model, timeoutMs = 310000) {
  const data = await adminJson(
    idToken,
    '/api/admin/llm',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model, keep_alive: 0 }),
    },
    timeoutMs
  )
  return data.answer || ''
}

// adminJson: vedi import da src/lib/imageJobs.js (F2).

const timeLabel = (ts) =>
  new Date(ts).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })


export default function Test2() {
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
  const [superMode, setSuperMode] = useState(false)
  const [superModel, setSuperModel] = useState(() => {
    try {
      const stored = window.localStorage.getItem(SUPER_MODEL_KEY)
      return SUPER_MODELS.includes(stored) ? stored : SUPER_MODELS[0]
    } catch (e) {
      return SUPER_MODELS[0]
    }
  })
  const [modelSwitching, setModelSwitching] = useState(false)
  const [leleModel, setLeleModel] = useState(() => {
    try {
      const stored = window.localStorage.getItem(LELE_MODEL_KEY)
      return LELE_MODELS.includes(stored) ? stored : LELE_MODELS[0]
    } catch (e) {
      return LELE_MODELS[0]
    }
  })
  const [reviewerModel, setReviewerModel] = useState(() => {
    try {
      const stored = window.localStorage.getItem(REVIEWER_MODEL_KEY)
      return LELE_MODELS.includes(stored) ? stored : LELE_MODELS[0]
    } catch (e) {
      return LELE_MODELS[0]
    }
  })
  const [armed, setArmed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [history, setHistory] = useState([])

  const [activeGroup, setActiveGroup] = useState(COMMAND_GROUPS[0].id)
  const [search, setSearch] = useState('')

  const [status, setStatus] = useState({})
  const [statusLoading, setStatusLoading] = useState(false)
  const [rawSys, setRawSys] = useState(false)
  const [ping, setPing] = useState({ ok: null, ms: null, agents: [] })

  const buttonRef = useRef(null)
  const textareaRef = useRef(null)

  // Token salvato ma email non (più) in whitelist: fuori subito.
  useEffect(() => {
    if (!idToken) return
    const email = decodeJwtPayload(idToken)?.email?.toLowerCase()
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      logout('Accesso non autorizzato per questo account Google. 🏴‍☠️')
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
          size: 'small',
          text: 'signin',
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
        if (err.status === 401 || err.status === 403) {
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

  // Selettore modello Super-Leles: invia subito "modellosl <nome>".
  async function switchSuperModel(model) {
    setSuperModel(model)
    try {
      window.localStorage.setItem(SUPER_MODEL_KEY, model)
    } catch (e) {
      /* no-op */
    }
    if (!idToken || modelSwitching) return

    setModelSwitching(true)
    const cmd = `modellosl ${model}`
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
      setModelSwitching(false)
    }
    setHistory((h) =>
      [{ id: t0, cmd, at: t0, ms: Date.now() - t0, ...outcome }, ...h].slice(0, 30)
    )
  }

  // Selettore modello Leles / reviewer: invia "modello <nome>" o
  // "reviewer <nome>" e logga la risposta in Sessione.
  async function switchModel(kind, model) {
    if (kind === 'lele') setLeleModel(model)
    else setReviewerModel(model)
    try {
      window.localStorage.setItem(
        kind === 'lele' ? LELE_MODEL_KEY : REVIEWER_MODEL_KEY,
        model
      )
    } catch (e) {
      /* no-op */
    }
    if (!idToken || modelSwitching) return

    setModelSwitching(true)
    const cmd = (kind === 'lele' ? 'modello ' : 'reviewer ') + model
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
      setModelSwitching(false)
    }
    setHistory((h) =>
      [{ id: t0, cmd, at: t0, ms: Date.now() - t0, ...outcome }, ...h].slice(0, 30)
    )
  }

  // ----------------------------------------------------------
  // SYNC MODELLI: all'apertura chiede "modelli" e allinea i 3
  // selettori ai modelli ATTIVI (fallback: localStorage, poi default).
  // ----------------------------------------------------------
  const modelsSyncedRef = useRef(false)

  useEffect(() => {
    if (!idToken || modelsSyncedRef.current) return
    modelsSyncedRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        const text = await callAdmin(idToken, 'modelli', 60000)
        if (cancelled || !text) return
        const lines = String(text).split('\n')
        const esc = (m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pick = (models, includeKeys, excludeKeys) => {
          const re = new RegExp('\\b(' + models.map(esc).sort((a, b) => b.length - a.length).join('|') + ')\\b', 'i')
          for (const line of lines) {
            const low = line.toLowerCase()
            if (excludeKeys && excludeKeys.some((k) => low.includes(k))) continue
            if (!includeKeys.some((k) => low.includes(k))) continue
            const m = line.match(re)
            if (m) return m[1].toLowerCase()
          }
          return null
        }
        const sup = pick(SUPER_MODELS, ['super', 'sl '], ['reviewer'])
        const rev = pick(LELE_MODELS, ['reviewer'], ['super', 'sl '])
        const lel = pick(LELE_MODELS, ['lele', 'modello', 'attiv'], ['super', 'sl ', 'reviewer'])
        if (sup && SUPER_MODELS.includes(sup)) {
          setSuperModel(sup)
          try { window.localStorage.setItem(SUPER_MODEL_KEY, sup) } catch (e) { /* no-op */ }
        }
        if (lel && LELE_MODELS.includes(lel)) {
          setLeleModel(lel)
          try { window.localStorage.setItem(LELE_MODEL_KEY, lel) } catch (e) { /* no-op */ }
        }
        if (rev && LELE_MODELS.includes(rev)) {
          setReviewerModel(rev)
          try { window.localStorage.setItem(REVIEWER_MODEL_KEY, rev) } catch (e) { /* no-op */ }
        }
      } catch (e) {
        /* silenzioso: si restano i valori locali */
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken])

  // IMMAGINI: prompt che inizia con "immagina ..." non passa da Leles:
  // la console chiama direttamente il gateway (POST /api/image/jobs),
  // fa polling e mostra il PNG in Sessione. Zero modifiche a lele_api.
  const [imageBusy, setImageBusy] = useState(false)

  async function runImage(imagePrompt) {
    const t0 = Date.now()
    const entry = { id: t0, cmd: 'immagina ' + imagePrompt, at: t0, ms: 0, text: '🎨 Generazione avviata…' }
    setHistory((h) => [entry, ...h].slice(0, 30))
    setImageBusy(true)
    try {
      const jobId = await createImageJob(idToken, imagePrompt)

      // Polling (max ~10 minuti) con lo stato mostrato nella entry.
      const result = await waitForImageResult(idToken, jobId, {
        onProgress: (status, elapsed) => {
          const label =
            status === 'running' || status === 'processing'
              ? '🎨 Generazione in corso… (' + elapsed + 's)'
              : '🎨 In coda… (' + elapsed + 's)'
          setHistory((h) =>
            h.map((x) => (x.id === t0 ? { ...x, ms: Date.now() - t0, text: label } : x))
          )
        },
      })

      const b64 = String(result.image_base64).replace(/^data:image\/png;base64,/i, '')
      setHistory((h) =>
        h.map((x) =>
          x.id === t0
            ? {
                ...x,
                ms: Date.now() - t0,
                text: '🖼️ Immagine generata (seed ' + (result.seed ?? '?') + ') — salvata anche in ImageLab.',
                img: 'data:image/png;base64,' + b64,
              }
            : x
        )
      )
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        logout(err.message)
        return
      }
      setHistory((h) =>
        h.map((x) => (x.id === t0 ? { ...x, ms: Date.now() - t0, err: err.message } : x))
      )
    } finally {
      setImageBusy(false)
    }
  }

  async function run(e) {
    e?.preventDefault()
    // Super-Leles: se il toggle e' attivo, il prompt parte come 'super <domanda>'
    // (a meno che non sia gia' un comando super/sl/modellosl).
    const raw = prompt.trim()
    // "immagina <prompt>" → generazione immagini via gateway (no Leles).
    const imgMatch = raw.match(/^immagina\s+(.+)$/i)
    if (imgMatch) {
      if (!idToken || imageBusy) return
      setPrompt('')
      await runImage(imgMatch[1].trim())
      return
    }
    const cmd = superMode && !/^(super|super-leles|sl|modellosl)\b/i.test(raw) ? 'super ' + raw : raw
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

  // ----------------------------------------------------------
  // AUDIO: TTS + registrazione + risposta audio
  // ----------------------------------------------------------
  const [audioAgent, setAudioAgent] = useState(AUDIO_AGENTS[0].value)
  const [audioPrompt, setAudioPrompt] = useState('')
  const [wantsTts, setWantsTts] = useState(false)
  const [audioReply, setAudioReply] = useState('')
  const [audioReplyFile, setAudioReplyFile] = useState(null)
  const [audioReplyAgent, setAudioReplyAgent] = useState('')
  const [audioError, setAudioError] = useState('')
  const [audioBusy, setAudioBusy] = useState(false)
  const [copiedAudioReply, setCopiedAudioReply] = useState(false)
  // Illustrazione opzionale per Story Whisper; disattivata per default.
  const [wantsStoryImage, setWantsStoryImage] = useState(false)
  const [storyImageBusy, setStoryImageBusy] = useState(false)
  const [storyImages, setStoryImages] = useState([])
  const [storyImageCount, setStoryImageCount] = useState(3)
  const [storyImageStatus, setStoryImageStatus] = useState('')
  const [storyImageError, setStoryImageError] = useState('')
  const [storyKidsFilter, setStoryKidsFilter] = useState(true)
  const [storyStylePrompt, setStoryStylePrompt] = useState('')
  const [storyGenre, setStoryGenre] = useState('Random')

  const [isSpeaking, setIsSpeaking] = useState(false)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)

  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [recUrl, setRecUrl] = useState(null)
  const [recBlob, setRecBlob] = useState(null)

  const audioChatIdRef = useRef(getAudioChatId())
  const audioPlayerRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const recTimerRef = useRef(null)
  const recBlobRef = useRef(null)
  const lelesAudioRef = useRef(null)

  useEffect(() => {
    return () => {
      if (recUrl) URL.revokeObjectURL(recUrl)
    }
  }, [recUrl])

  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current)
      if (lelesAudioRef.current) URL.revokeObjectURL(lelesAudioRef.current.url)
      const tracks = recorderRef.current?.stream?.getTracks?.() || []
      tracks.forEach((track) => track.stop())
    }
  }, [])

  async function audioRequest(path, init) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120000)
    try {
      const res = await fetch(`${LELE_API_URL}${path}`, {
        ...init,
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.json()
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Timeout: il server non ha risposto in tempo. 😵‍💫')
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  function resetAudioReply() {
    stopSpeaking()
    setAudioError('')
    setAudioReply('')
    setAudioReplyFile(null)
    setAudioDuration(0)
  }

  function applyAudioReply(data, agent) {
    const replyText = audioText(data)
    setAudioReply(replyText)
    setAudioReplyFile(
      extractFilename(data.audio_filename) || extractFilename(data.audio_path)
    )
    setAudioReplyAgent(agent)
    setStoryImages([])
    setStoryImageError('')
    setStoryImageStatus('')
    // Parte in background: testo e audio SW sono già disponibili e non aspettano l'immagine.
    if ((agent === 'Story Whisper' || agent === 'Night Story') && wantsStoryImage && replyText) {
      void generateStoryIllustration(replyText, agent)
    }
  }

  async function generateStoryIllustration(storyText, agent) {
    if (!idToken || storyImageBusy) return
    const imageCount = Math.max(1, Math.min(8, Number(storyImageCount) || 3))
    const kidsMode = agent === 'Story Whisper' && storyKidsFilter
    const genre = agent === 'Night Story' ? String(storyGenre || 'Random').trim() : ''
    const extraStyle = String(storyStylePrompt || '').trim().slice(0, 500)
    const artDirection = kidsMode
      ? 'Every image prompt must enforce a colorful cartoon storybook illustration style suitable for young children: safe, wholesome, no violence, no scary or adult content, friendly rounded shapes, bright cheerful lighting. '
      : genre
        ? 'Every image prompt must follow an artistic illustration style that matches the story genre "' + genre + '" (mature audiences, never a children style). '
        : ''
    const styleExtra = extraStyle ? 'Additional art direction from the user to apply to every scene: ' + extraStyle + '. ' : ''
    setStoryImageBusy(true)
    setStoryImageError('')
    setStoryImages([])
    setStoryImageStatus('🧠 Ollama seleziona ' + imageCount + ' scene in ordine narrativo…')
    let imageStage = 'selezione delle scene con Ollama'
    try {
      let rawPlan = String(await callLlm(idToken, buildStoryboardPrompt({
        count: imageCount,
        storyText,
        artDirection,
        styleExtra,
      }), leleModel, 180000)).trim()

      let parsedPlan
      try {
        parsedPlan = parsePlan(rawPlan)
      } catch {
        imageStage = 'correzione del formato JSON con Ollama'
        setStoryImageStatus('🧠 Sistemo il formato della selezione delle scene…')
        rawPlan = String(await callLlm(idToken, buildRepairPrompt(imageCount, rawPlan), leleModel, 180000)).trim()
        try {
          parsedPlan = parsePlan(rawPlan)
        } catch {
          throw new Error('Ollama non ha prodotto un JSON valido nemmeno dopo il tentativo di correzione.')
        }
      }
      const scenes = normalizeScenes(parsedPlan, imageCount)

      setStoryImages(scenes.map((scene, index) => ({
        id: index + 1, title: scene.title, prompt: scene.prompt, src: '', status: 'In attesa',
      })))

      // Pianificazione completata: scarichiamo i modelli Ollama (keep_alive=0)
      // per liberare RAM sul Mac prima del loop di immagini.
      try {
        setStoryImageStatus('🧹 Libero la RAM usata da Ollama prima delle immagini…')
        await unloadOllama(idToken)
      } catch {
        // Non blocca le illustrazioni: è solo un'ottimizzazione di memoria.
      }

      // Un solo job per volta: non si avvia la scena successiva finché la precedente non è pronta.
      // Le richieste di stato possono fallire transitoriamente (rete/Cloudflare): ritentiamo
      // senza creare un secondo job e senza perdere l'immagine già generata.
      const fetchJobStatusWithRetry = (jobId, sceneNumber) =>
        fetchJobStatusWithRetryShared(idToken, jobId, {
          onRetry: (attempt, attempts) =>
            setStoryImageStatus(
              '🔄 Connessione temporaneamente interrotta durante il controllo dell’immagine ' +
              sceneNumber + '/' + imageCount + ' — nuovo tentativo ' + attempt + '/' + attempts + '…'
            ),
        })
      const sceneRetried = new Set()
      for (let index = 0; index < scenes.length; index += 1) {
        const scene = scenes[index]
        const sceneNumber = index + 1
        let imageStage = 'avvio immagine ' + sceneNumber + '/' + imageCount + ' sul gateway'
        setStoryImageStatus('🎨 Immagine ' + sceneNumber + '/' + imageCount + ': ' + scene.title + ' — in coda…')
        setStoryImages((current) => current.map((item) =>
          item.id === sceneNumber ? { ...item, status: 'In coda' } : item
        ))
        try {
          // F3: il filtro stile (kids/genre) ora è applicato anche dal
          // gateway via preset, oltre che dal prompt del planner.
          const scenePreset = kidsMode ? 'sw_kids' : (genre ? 'ns_free' : '')
          const jobId = await createImageJob(idToken, scene.prompt, { preset: scenePreset })

          imageStage = 'controllo stato immagine ' + sceneNumber + '/' + imageCount
          const result = await waitForImageResult(idToken, jobId, {
            fetchStatus: () => fetchJobStatusWithRetry(jobId, sceneNumber),
            onProgress: (status, elapsed) =>
              setStoryImageStatus(
                '🎨 Immagine ' + sceneNumber + '/' + imageCount + ' (' + scene.title + '): ' +
                (status === 'running' || status === 'processing' ? 'generazione in corso' : 'in coda') +
                '… (' + elapsed + 's)'
              ),
          })
          imageStage = 'download immagine ' + sceneNumber + '/' + imageCount
          const src = resultToDataUrl(result)
          setStoryImages((current) => current.map((item) =>
            item.id === sceneNumber ? { ...item, src, status: 'Pronta' } : item
          ))
          setStoryImageStatus('🖼️ Immagine ' + sceneNumber + '/' + imageCount + ' pronta: ' + scene.title)
          if (index < scenes.length - 1) {
            setStoryImageStatus('⏳ Pausa 12s prima dell’immagine successiva (libero la RAM del Mac)…')
            await new Promise((resolve) => setTimeout(resolve, 12000))
          }
        } catch (err) {
          if (err.status === 401 || err.status === 403) {
            logout(err.message)
            return
          }
          if (!sceneRetried.has(sceneNumber)) {
            sceneRetried.add(sceneNumber)
            setStoryImages((current) => current.map((item) =>
              item.id === sceneNumber ? { ...item, status: 'Nuovo tentativo tra 60s…' } : item
            ))
            setStoryImageStatus(
              '🔄 Errore di rete sull’immagine ' + sceneNumber + '/' + imageCount +
              ' — attendo 60s e riprovo la scena una volta…'
            )
            await new Promise((resolve) => setTimeout(resolve, 60000))
            index -= 1
            continue
          }
          setStoryImages((current) => current.map((item) =>
            item.id === sceneNumber ? { ...item, status: 'Errore: ' + (err.message || 'errore sconosciuto') } : item
          ))
          setStoryImageError('Immagine ' + sceneNumber + '/' + imageCount + ' (' + scene.title + '), ' + imageStage + ': ' + (err.message || 'errore sconosciuto'))
          setStoryImageStatus('⛔ Sequenza fermata alla scena ' + sceneNumber + '/' + imageCount + '; le immagini già pronte restano visibili.')
          return
        }
      }
      setStoryImageStatus('✅ Tutte le ' + imageCount + ' illustrazioni sono pronte.')
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        logout(err.message)
        return
      }
      setStoryImageError('Errore in ' + imageStage + ': ' + (err.message || 'errore sconosciuto'))
      setStoryImageStatus('')
    } finally {
      setStoryImageBusy(false)
    }
  }

  // Testo -> Gateway (/api/chat)
  async function sendAudioText(e) {
    e?.preventDefault()
    const text = audioPrompt.trim()
    if (!text || audioBusy || isRecording) return

    resetAudioReply()
    setAudioBusy(true)

    // Leles: console admin (con token). I comandi sensibili passano solo
    // dal prompt principale, che chiede la conferma.
    if (audioAgent === LELES_AGENT) {
      if (isDanger(text)) {
        setAudioError(
          'Comando sensibile: usa il prompt principale, che chiede la conferma.'
        )
        setAudioBusy(false)
        return
      }
      const lelesClean = text.replace(/^(audio e testo|audio)\s*/i, '')
      try {
        const data = await adminJson(idToken, '/api/admin/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: wantsTts ? `audio e testo ${lelesClean}` : text,
            language: 'en',
            chat_id: FORCED_ADMIN_CHAT_ID,
          }),
        })
        applyAudioReply(data, LELES_AGENT)
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          logout(err.message)
          return
        }
        setAudioError(err.message)
      } finally {
        setAudioBusy(false)
      }
      return
    }

    const clean = text.replace(/^(audio e testo|audio)\s*/i, '')
    const promptToSend = wantsTts ? `audio e testo ${clean}` : audioPrompt

    try {
      const data = await audioRequest('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: audioAgent,
          prompt: promptToSend,
          language: AUDIO_LANGUAGE,
          chat_id: audioChatIdRef.current,
        }),
      })
      applyAudioReply(data, audioAgent)
    } catch (err) {
      setAudioError(err.message)
    } finally {
      setAudioBusy(false)
    }
  }

  // Audio registrato -> Gateway (/api/chat/audio)
  async function sendRecording(blobOverride) {
    const blob = blobOverride || recBlobRef.current
    if (!blob) return

    resetAudioReply()
    setAudioBusy(true)

    const isLeles = audioAgent === LELES_AGENT

    try {
      const form = new FormData()
      form.append('audio', blob, 'recording.webm')
      if (!isLeles) form.append('agent', audioAgent)
      form.append('language', AUDIO_LANGUAGE)
      form.append(
        'chat_id',
        String(isLeles ? FORCED_ADMIN_CHAT_ID : audioChatIdRef.current)
      )

      const data = isLeles
        ? await adminJson(idToken, LELES_AUDIO_PATH, { method: 'POST', body: form })
        : await audioRequest('/api/chat/audio', { method: 'POST', body: form })
      applyAudioReply(data, audioAgent)
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        logout(err.message)
        return
      }
      setAudioError(err.message)
    } finally {
      setAudioBusy(false)
    }
  }

  async function startRecording() {
    try {
      setAudioError('')
      setRecUrl(null)
      setRecBlob(null)
      recBlobRef.current = null

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus' }
        : {}
      const recorder = new MediaRecorder(stream, options)

      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })
        recBlobRef.current = blob
        setRecBlob(blob)
        setRecUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach((track) => track.stop())

        // Invio automatico appena termina la registrazione.
        // Con Leles (admin) niente invio automatico: si invia a mano.
        if (AUTO_SEND_RECORDING && audioAgent !== LELES_AGENT) sendRecording(blob)
      }

      recorder.start()
      setIsRecording(true)
      setRecordingTime(0)
      recTimerRef.current = setInterval(() => {
        setRecordingTime((time) => time + 1)
      }, 1000)
    } catch (err) {
      setAudioError(
        'Impossibile accedere al microfono. Controlla i permessi del browser.'
      )
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    setIsRecording(false)
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
  }

  // Audio TTS di Leles: richiede il token, quindi si scarica come blob.
  async function getLelesAudioUrl(file) {
    if (lelesAudioRef.current?.file === file) return lelesAudioRef.current.url
    const res = await fetch(
      `${LELE_API_URL}${LELES_TTS_PATH}/${encodeURIComponent(file)}`,
      { headers: { Authorization: `Bearer ${idToken}` } }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const url = URL.createObjectURL(await res.blob())
    if (lelesAudioRef.current) URL.revokeObjectURL(lelesAudioRef.current.url)
    lelesAudioRef.current = { file, url }
    return url
  }

  // Riproduzione audio generato dal backend
  async function togglePlayAudio() {
    const player = audioPlayerRef.current
    if (!audioReplyFile || !player) return

    if (isSpeaking) {
      player.pause()
      setIsSpeaking(false)
      return
    }

    const isLeles = audioReplyAgent === LELES_AGENT
    try {
      const url = isLeles
        ? await getLelesAudioUrl(audioReplyFile)
        : `${LELE_API_URL}/api/chat/tts/${encodeURIComponent(
            audioReplyAgent
          )}/${encodeURIComponent(audioReplyFile)}`

      if (player.src !== url) {
        player.src = url
        player.playbackRate = playbackRate
      }
      await player.play()
      setIsSpeaking(true)
    } catch (err) {
      setIsSpeaking(false)
      setAudioError(
        isLeles
          ? `Audio di Leles non disponibile: ${err.message}`
          : 'Riproduzione audio bloccata dal browser.'
      )
    }
  }

  function stopSpeaking() {
    const player = audioPlayerRef.current
    if (player) {
      player.pause()
      player.currentTime = 0
    }
    setIsSpeaking(false)
    setAudioCurrentTime(0)
  }

  function handleRateChange(rate) {
    setPlaybackRate(rate)
    if (audioPlayerRef.current) audioPlayerRef.current.playbackRate = rate
  }

  function handleSeek(e) {
    const t = parseFloat(e.target.value)
    setAudioCurrentTime(t)
    if (audioPlayerRef.current) audioPlayerRef.current.currentTime = t
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

  // ==========================================================
  // LOGIN
  // ==========================================================
  if (!idToken) {
    return (
      <div className="lc-page">
        <style>{css}</style>
        {backdrop}
        <div className="lc-wrap">
          <div className="lc-top">
            <h1 className="lc-title">Leles Admin Console</h1>
            <div ref={buttonRef} className="lc-gbtn" />
          </div>
          <p className="lc-dim lc-small lc-login-msg">Accesso riservato.</p>
          {authError && <p className="lc-err lc-small">{authError}</p>}
          {!gsiReady && !authError && (
            <p className="lc-dim lc-small">Caricamento login Google…</p>
          )}
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
          <h1 className="lc-title">Leles Admin Console</h1>
          <div className="lc-session">
            <span className="lc-ellipsis">{profile?.email || 'account Google'}</span>
            <button type="button" className="lc-btn lc-btn--sm" onClick={() => logout()}>
              Logout
            </button>
          </div>
        </div>

        <div className="lc-grid">
          <main className="lc-main">
            {/* PROMPT */}
            <form className="lc-panel lc-prompt" onSubmit={run}>
              <label htmlFor="lc-input" className="lc-sr">
                Comando per Leles
              </label>
              <div className="lc-prompt-row">
                <span className="lc-anchor" aria-hidden="true">⚓</span>
                <textarea
                  id="lc-input"
                  ref={textareaRef}
                  value={prompt}
                  rows={4}
                  placeholder="Scrivi a Leles…"
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
                <button
                  type="button"
                  className="lc-btn"
                  onClick={() => setSuperMode((v) => !v)}
                  style={superMode ? { borderColor: '#a78bfa', color: '#a78bfa' } : undefined}
                  title="Quando attivo, il prompt viene inviato come 'super <domanda>' a Super-Leles (grounded)"
                >
                  {superMode ? '⚡ Super-Leles ON' : '⚡ Super-Leles'}
                </button>
                {modelSwitching && (
                  <span className="lc-dim lc-small">Switch modello…</span>
                )}
                <button
                  type="button"
                  className="lc-btn"
                  disabled={imageBusy || isLoading}
                  title="Prefissa il prompt con immagina: la console genera un immagine con Z-Image-Turbo (via gateway), senza passare da Leles"
                  onClick={() => {
                    setPrompt((v) => (v.startsWith('immagina ') ? v : 'immagina ' + v))
                    textareaRef.current?.focus()
                  }}
                >
                  🖼️ Immagina
                </button>
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
                        <span className="lc-spin" /> Leles sta pensando… Aspé...🏴‍☠️
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

            {/* COMANDI */}
            <section className="lc-panel lc-pad" aria-label="Comandi">
              <div className="lc-cmd-head">
                <h2>Comandi</h2>
                <input
                  type="search"
                  className="lc-search"
                  placeholder="Cerca tra i comandi"
                  aria-label="Cerca comandi"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <p className="lc-dim lc-small lc-cmd-note">
                Git, Airflow e revisione file (improve/verifica/review) sono
                passati alle pagine dedicate — Git Admin · DAG Admin · Improve:
                link in fondo alla console.
              </p>

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

              {!q && group.id === 'modelli' && (
                <div className="lc-model-row">
                  <label>
                    <span className="lc-dim lc-small">Super-Leles</span>
                    <select
                      className="lc-select lc-model-select"
                      aria-label="Modello Super-Leles"
                      value={superModel}
                      disabled={modelSwitching || isLoading}
                      onChange={(e) => switchSuperModel(e.target.value)}
                      title="Invia il comando modellosl <nome> e mostra la conferma in Sessione"
                    >
                      {SUPER_MODELS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="lc-dim lc-small">Modello Leles</span>
                    <select
                      className="lc-select lc-model-select"
                      aria-label="Modello Leles"
                      value={leleModel}
                      disabled={modelSwitching || isLoading}
                      onChange={(e) => switchModel('lele', e.target.value)}
                      title="Invia il comando modello <nome> e mostra la conferma in Sessione"
                    >
                      {LELE_MODELS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="lc-dim lc-small">Reviewer</span>
                    <select
                      className="lc-select lc-model-select"
                      aria-label="Modello reviewer"
                      value={reviewerModel}
                      disabled={modelSwitching || isLoading}
                      onChange={(e) => switchModel('reviewer', e.target.value)}
                      title="Invia il comando reviewer <nome> e mostra la conferma in Sessione"
                    >
                      {LELE_MODELS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="lc-chips">
                {visible.length === 0 && (
                  <p className="lc-dim">
                    Nessun comando corrisponde a “{search}”. ⚓️
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
                    {h.img && <img src={h.img} alt="Immagine generata" className="lc-gen-img" />}
                    <pre className="lc-pre">{h.text || h.err}</pre>
                  </article>
                ))}
              </div>
            </section>
          </main>

          {/* DASHBOARD DESTRA: Sistema + OS + RAM + Gateway in un solo pannello */}
          <aside className="lc-side" aria-label="Stato del sistema">
            <section className="lc-panel lc-pad lc-status">
              <div className="lc-cmd-head">
                <h2>Stato del sistema</h2>
                <div className="lc-row">
                  <span
                    className={`lc-pill ${
                      ping.ok === null ? '' : ping.ok ? 'is-ok' : 'is-bad'
                    }`}
                    title="Gateway"
                  >
                    <span className={`lc-dot${ping.ok ? ' lc-pulse' : ''}`} />
                    {ping.ok === null ? '…' : ping.ok ? `${ping.ms} ms` : 'offline'}
                  </span>
                  <button
                    type="button"
                    className="lc-btn lc-btn--sm"
                    onClick={refreshStatus}
                    disabled={statusLoading}
                  >
                    {statusLoading ? 'Carico…' : 'Aggiorna'}
                  </button>
                </div>
              </div>

              {STATUS_CMDS.map(([key, label]) => {
                const s = status[key]
                const tiles = key === 'sys' && !rawSys ? parseSystem(s?.text) : null
                const osData = key === 'os' ? parseOs(s?.text) : null
                const ramText = key === 'ram' ? cleanRam(s?.text) : null
                const lvl = statLevel(key, status)
                return (
                    <div key={key} className="lc-stat">
                    <div className="lc-stat-head">
                        <h3 className={`lc-stat-name${lvl ? ` is-${lvl}` : ''}`}>{label}</h3>
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
                    ) : osData ? (
                        <OsKpis data={osData} />
                    ) : (
                        <pre className="lc-pre lc-pre--sm">
                            {(key === 'ram' && ramText) ||
                                s?.text ||
                                (statusLoading ? 'Carico…' : 'Nessun dato. Premi Aggiorna.')}
                        </pre>
                    )}
                </div>
            )
        })}
            </section>
          </aside>
        </div>

        {/* PAGINE DEL SITO: link alle console esistenti */}
        <nav className="lc-pages" aria-label="Pagine del sito">
          <div className="lc-pages-head">
            <h2>Pagine &amp; Console</h2>
            <span className="lc-dim lc-small">
              Tutte le rotte attive del sito — da qui validi e poi promuoviamo in nav
            </span>
          </div>
          <div className="lc-pages-grid">
            {QUICK_LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={`lc-pagecard${l.main ? ' lc-pagecard--main' : ''}`}
              >
                <span className="lc-pagecard-label">{l.label}</span>
                <small>{l.desc}</small>
              </Link>
            ))}
          </div>

          {/* AUDIO: Story Whisper / Night Story (penultimo blocco) */}
            {/* AUDIO: Story Whisper / Night Story */}
            <section className="lc-panel lc-pad lc-audio" aria-label="Audio">
              <audio
                ref={audioPlayerRef}
                onTimeUpdate={() =>
                  setAudioCurrentTime(audioPlayerRef.current?.currentTime || 0)
                }
                onLoadedMetadata={() =>
                  setAudioDuration(audioPlayerRef.current?.duration || 0)
                }
                onEnded={() => {
                  setIsSpeaking(false)
                  setAudioCurrentTime(0)
                }}
                onError={() => {
                  setIsSpeaking(false)
                  setAudioError("Impossibile riprodurre l'audio generato dal server.")
                }}
              />

              <div className="lc-cmd-head">
                <h2>Audio</h2>
                <select
                  className="lc-select"
                  aria-label="Agente audio"
                  value={audioAgent}
                  onChange={(e) => setAudioAgent(e.target.value)}
                  disabled={isRecording || audioBusy}
                >
                  {AUDIO_AGENTS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>

              <form className="lc-audio-form" onSubmit={sendAudioText}>
                <textarea
                  className="lc-audio-ta"
                  rows={3}
                  value={audioPrompt}
                  disabled={isRecording}
                  placeholder={`Scrivi a ${audioAgent}…`}
                  onChange={(e) => setAudioPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendAudioText(e)
                  }}
                />
                <div className="lc-audio-foot">
                  <label className="lc-check">
                    <input
                      type="checkbox"
                      checked={wantsTts}
                      disabled={isRecording || audioBusy}
                      onChange={(e) => setWantsTts(e.target.checked)}
                    />
                    Risposta audio (TTS)
                  </label>
                  {(audioAgent === 'Story Whisper' || audioAgent === 'Night Story') && (
                    <div className="lc-check" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }} title="Genera illustrazioni sequenziali delle scene principali dopo testo e audio">
                      <label className="lc-check">
                        <input
                          type="checkbox"
                          checked={wantsStoryImage}
                          disabled={isRecording || audioBusy || storyImageBusy}
                          onChange={(e) => setWantsStoryImage(e.target.checked)}
                        />
                        🎨 Crea illustrazioni della storia
                      </label>
                      <select
                        aria-label="Numero di illustrazioni"
                        value={storyImageCount}
                        disabled={isRecording || audioBusy || storyImageBusy}
                        onChange={(e) => setStoryImageCount(Number(e.target.value))}
                        style={{ padding: '4px 8px', borderRadius: 8, background: 'var(--surface, #fff)', color: 'inherit', border: '1px solid var(--line, #ccc)' }}
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count} {count === 1 ? 'immagine' : 'immagini'}</option>)}
                      </select>
                      {audioAgent === 'Story Whisper' && (
                        <label className="lc-check" title="Stile cartoon per bambini, contenuti sicuri">
                          <input
                            type="checkbox"
                            checked={storyKidsFilter}
                            disabled={isRecording || audioBusy || storyImageBusy}
                            onChange={(e) => setStoryKidsFilter(e.target.checked)}
                          />
                          🧒 Bambini
                        </label>
                      )}
                      {audioAgent === 'Night Story' && (
                        <select
                          aria-label="Genere Night Story"
                          value={storyGenre}
                          disabled={isRecording || audioBusy || storyImageBusy}
                          onChange={(e) => setStoryGenre(e.target.value)}
                          style={{ padding: '4px 8px', borderRadius: 8, background: 'var(--surface, #fff)', color: 'inherit', border: '1px solid var(--line, #ccc)' }}
                        >
                          {['Random', 'Amore', 'Comico', 'Culturale', 'Drammatica', 'Horror', 'Osè', 'Ricerca'].map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      )}
                      <input
                        type="text"
                        aria-label="Prompt di stile extra"
                        placeholder="Prompt stile extra (opzionale)"
                        value={storyStylePrompt}
                        disabled={isRecording || audioBusy || storyImageBusy}
                        onChange={(e) => setStoryStylePrompt(e.target.value)}
                        style={{ minWidth: 160, padding: '4px 8px', borderRadius: 8, background: 'var(--surface, #fff)', color: 'inherit', border: '1px solid var(--line, #ccc)' }}
                      />
                    </div>
                  )}
                  <div className="lc-row">
                    <button
                      type="button"
                      className="lc-btn"
                      disabled={!audioPrompt.trim() || isRecording}
                      onClick={() => setAudioPrompt('')}
                    >
                      Pulisci
                    </button>
                    <button
                      type="button"
                      className={`lc-btn${isRecording ? ' lc-btn--rec' : ''}`}
                      disabled={audioBusy}
                      onClick={isRecording ? stopRecording : startRecording}
                    >
                      {isRecording ? `⏹ ${formatTime(recordingTime)}` : '🎤 Registra'}
                    </button>
                    <button
                      type="submit"
                      className="lc-btn lc-btn--run"
                      disabled={audioBusy || isRecording || !audioPrompt.trim()}
                    >
                      {audioBusy ? (
                        <>
                          <span className="lc-spin" /> Attendi…
                        </>
                      ) : (
                        'Invia'
                      )}
                    </button>
                  </div>
                </div>
              </form>

              {recUrl && (
                <div className="lc-rec">
                  <div className="lc-cmd-head">
                    <span className="lc-small">🎤 Audio registrato</span>
                    <button
                      type="button"
                      className="lc-btn lc-btn--sm"
                      disabled={audioBusy || !recBlob}
                      onClick={() => sendRecording()}
                    >
                      Invia audio
                    </button>
                  </div>
                  <audio controls src={recUrl} className="lc-rec-audio" />
                </div>
              )}

              {audioError && <p className="lc-err lc-small">{audioError}</p>}

              {audioReply && (
                <div className="lc-audio-out" aria-live="polite">
                  <header>
                    <span>Risposta da {audioReplyAgent}</span>
                    <button
                      type="button"
                      className="lc-btn lc-btn--sm"
                      onClick={() => {
                        copy(audioReply)
                        setCopiedAudioReply(true)
                        setTimeout(() => setCopiedAudioReply(false), 2000)
                      }}
                    >
                      {copiedAudioReply ? 'Copiato ✓' : 'Copia'}
                    </button>
                  </header>

                  {audioReplyFile && (
                    <div className="lc-player">
                      <div className="lc-player-top">
                        <button
                          type="button"
                          className={`lc-btn lc-btn--sm lc-play${isSpeaking ? ' is-on' : ''}`}
                          onClick={togglePlayAudio}
                        >
                          {isSpeaking ? '⏸ Pausa' : '▶ Ascolta'}
                        </button>
                        <span className="lc-time">
                          {formatTime(audioCurrentTime)} / {formatTime(audioDuration)}
                        </span>
                        <input
                          type="range"
                          className="lc-seek"
                          aria-label="Posizione audio"
                          min="0"
                          max={audioDuration || 0}
                          step="0.1"
                          value={audioCurrentTime}
                          onChange={handleSeek}
                        />
                      </div>
                      <div className="lc-speed">
                        <span className="lc-dim lc-small">Velocità</span>
                        {[1, 1.25, 1.5, 1.75, 2].map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            className={`lc-btn lc-btn--sm${playbackRate === rate ? ' is-on' : ''}`}
                            onClick={() => handleRateChange(rate)}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <pre className="lc-pre">{audioReply}</pre>
                  {(storyImageStatus || storyImageError || storyImages.length > 0) && (audioReplyAgent === 'Story Whisper' || audioReplyAgent === 'Night Story') && (
                    <div className="lc-story-illustration" aria-live="polite" style={{ marginTop: 14 }}>
                      {storyImageStatus && <p className="lc-dim lc-small">{storyImageStatus}</p>}
                      {storyImageError && <p className="lc-err lc-small">Illustrazioni: {storyImageError}</p>}
                      {storyImages.map((item) => (
                        <div key={item.id} style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                          <p className="lc-dim lc-small" style={{ marginBottom: 6 }}>
                            <strong>{item.id}/{storyImages.length} · {item.title}</strong> — {item.status}
                          </p>
                          {item.src && (
                            <img
                              src={item.src}
                              alt={'Illustrazione ' + item.id + ': ' + item.title}
                              loading="lazy"
                              style={{ display: 'block', width: '100%', maxWidth: 640, height: 'auto', borderRadius: 12, marginTop: 8 }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>


          <div className="lc-pages-head lc-pages-head--sub">
            <h3>🧪 Test &amp; Laboratorio</h3>
            <span className="lc-dim lc-small">
              Si validano da qui, poi si promuovono tra le pagine ufficiali
            </span>
          </div>
          <div className="lc-pages-grid lc-pages-grid--test">
            {TEST_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="lc-pagecard">
                <span className="lc-pagecard-label">{l.label}</span>
                <small>{l.desc}</small>
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}

const css = `
.lc-page{--glass:rgba(16,23,30,.74);--line:rgba(255,255,255,.1);--ok:#4ade80;--bad:#f87171;--warn:#fbbf24;
  --mono:ui-monospace,'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;
  position:relative;min-height:calc(100vh - 64px);overflow:hidden;color:var(--ink);font-family:var(--sans)}
.lc-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.38}
.lc-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,16,21,.25) 0%,rgba(11,16,21,.40) 70%)}
.lc-wrap{position:relative;max-width:1280px;margin:0 auto;padding:28px 24px 72px}
.lc-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.lc-gbtn{min-height:32px;flex:none}
.lc-login-msg{margin-top:10px}
.lc-title{font-size:clamp(22px,4vw,30px);font-weight:650;letter-spacing:-.01em;line-height:1.15}
.lc-session{display:flex;align-items:center;gap:10px;padding:5px 5px 5px 14px;border:1px solid var(--line);
  border-radius:999px;background:var(--glass);font-size:12px;color:var(--ink-dim);max-width:100%}
.lc-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.lc-title{background:linear-gradient(92deg,#3fd0c9 0%,#a78bfa 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.lc-panel{box-shadow:0 22px 55px -32px rgba(0,0,0,.75),inset 0 1px 0 rgba(255,255,255,.06)}
.lc-btn--run{background:linear-gradient(135deg,#3fd0c9,#6fe3dd);border-color:transparent;box-shadow:0 10px 26px -12px rgba(63,208,201,.6)}
.lc-btn--run:hover:not(:disabled){background:linear-gradient(135deg,#6fe3dd,#9ff0ec);border-color:transparent;transform:translateY(-1px)}
.lc-chip{transition:background .15s,border-color .15s,transform .15s,box-shadow .15s}
.lc-chip:hover{transform:translateY(-2px);box-shadow:0 10px 22px -12px rgba(63,208,201,.4)}
.lc-pagecard{transition:background .15s,border-color .15s,transform .18s,box-shadow .18s}
.lc-pagecard:hover{box-shadow:0 16px 36px -18px rgba(63,208,201,.5)}
.lc-cmd-head h2{position:relative;padding-bottom:7px}
.lc-cmd-head h2::after{content:'';position:absolute;left:0;bottom:0;width:44px;height:2px;border-radius:2px;
  background:linear-gradient(90deg,#3fd0c9,#a78bfa)}
.lc-model-row{background:rgba(63,208,201,.07);border:1px solid rgba(63,208,201,.22);border-radius:12px;padding:10px 12px;margin:10px 0 14px}
.lc-links{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:28px;padding-top:16px;
  border-top:1px solid var(--line);font-size:13px}
.lc-pages{margin-top:28px;padding-top:16px;border-top:1px solid var(--line)}
.lc-pages-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.lc-pages-head h2{font-size:15px;font-weight:650}
.lc-pages-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.lc-pagecard{display:flex;flex-direction:column;gap:3px;padding:11px 14px;border-radius:12px;
  border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--ink);
  text-decoration:none;transition:background .15s,border-color .15s,transform .15s}
.lc-pagecard:hover{background:rgba(255,255,255,.1);border-color:var(--accent);transform:translateY(-1px)}
.lc-pagecard small{color:var(--ink-dim);font-size:11px;line-height:1.35}
.lc-pagecard--main{border-color:rgba(63,208,201,.45);background:rgba(63,208,201,.09)}
.lc-pagecard--main:hover{background:rgba(63,208,201,.16);border-color:var(--accent)}
.lc-pagecard-label{font-size:13px;font-weight:600}
.lc-cmd-note{margin:-2px 0 12px}
.lc-pages-head--sub{margin-top:16px;margin-bottom:10px}
.lc-pages-head--sub h3{font-size:12px;font-weight:650;color:var(--ink-dim)}
.lc-pages-grid--test .lc-pagecard{opacity:.82}
.lc-pages-grid--test .lc-pagecard:hover{opacity:1}
.lc-link{padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04);
  color:var(--ink);transition:background .15s,border-color .15s}
.lc-link:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.25)}
.lc-link--main{background:var(--accent);border-color:var(--accent);color:#07201f;font-weight:600}
.lc-link--main:hover{background:#6fe3dd;border-color:#6fe3dd}
.lc-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px;align-items:start;margin-top:18px}
.lc-main{display:flex;flex-direction:column;gap:18px;min-width:0}
.lc-side{display:flex;flex-direction:column;gap:18px;position:sticky;top:80px;max-height:calc(100vh - 100px);overflow:auto}
.lc-panel{background:var(--glass);border:1px solid var(--line);border-radius:16px;backdrop-filter:blur(14px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.lc-pad{padding:16px 18px}
.lc-panel h2{font-size:15px;font-weight:650}
.lc-panel h3{font-size:12px;font-weight:600;color:var(--ink-dim);margin-bottom:4px}
.lc-dim{color:var(--ink-dim)}.lc-small{font-size:12px}
.lc-model-select{max-width:170px;font-size:12px}
.lc-model-row{display:flex;gap:14px;flex-wrap:wrap;margin:2px 0 12px}
.lc-gen-img{display:block;width:100%;max-width:420px;margin:10px 12px 0;border:1px solid var(--line);border-radius:10px}
.lc-model-row label{display:flex;flex-direction:column;gap:4px}
.lc-err{color:var(--bad);font-size:14px}
.lc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.lc-row{display:flex;gap:8px;align-items:center}
.lc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:8px 14px;border-radius:8px;
  border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--ink);font:inherit;font-size:13px;
  cursor:pointer;transition:background .15s,border-color .15s}
.lc-btn:hover:not(:disabled){background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.25)}
.lc-btn:disabled{opacity:.45;cursor:not-allowed}
.lc-btn--sm{padding:4px 10px;font-size:11px;border-radius:999px}
.lc-btn--run{background:var(--accent);border-color:var(--accent);color:#07201f;font-weight:650;min-width:120px}
.lc-btn--run:hover:not(:disabled){background:#6fe3dd;border-color:#6fe3dd}
.lc-btn--warn{background:var(--warn);border-color:var(--warn)}
.lc-btn--warn:hover:not(:disabled){background:#fcd34d;border-color:#fcd34d}
.lc-prompt{border-color:rgba(63,208,201,.38);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 18px 50px -24px rgba(63,208,201,.45);padding:14px 16px}
.lc-prompt-row{display:flex;gap:12px;align-items:flex-start}
.lc-anchor{font-size:20px;line-height:1.6;opacity:.9}
.lc-prompt textarea{flex:1;min-width:0;resize:vertical;background:transparent;border:0;color:var(--ink);
  font-family:var(--mono);font-size:14px;line-height:1.6;padding:2px 0}
.lc-prompt textarea:focus{outline:none}
.lc-prompt-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;
  margin-top:10px;padding-top:12px;border-top:1px solid var(--line)}
.lc-cmd-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.lc-search{flex:1;min-width:180px;max-width:300px;padding:7px 12px;border-radius:999px;border:1px solid var(--line);
  background:rgba(255,255,255,.05);color:var(--ink);font:inherit;font-size:13px}
.lc-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:6px}
.lc-tab{--g:var(--accent);flex:none;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;
  border:1px solid var(--line);background:transparent;color:var(--ink-dim);font:inherit;font-size:13px;cursor:pointer;
  transition:color .15s,border-color .15s,background .15s}
.lc-tab:hover{color:var(--ink)}
.lc-tab.is-on{color:var(--ink);border-color:var(--g);background:color-mix(in srgb,var(--g) 16%,transparent)}
.lc-count{font-size:11px;color:var(--ink-dim)}
.lc-chips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.lc-chips>p{grid-column:1/-1}
.lc-chip{--g:var(--accent);display:flex;flex-direction:column;gap:2px;text-align:left;padding:9px 12px;border-radius:8px;
  border:1px solid var(--line);border-left:3px solid var(--g);background:rgba(255,255,255,.04);color:var(--ink);
  font:inherit;font-size:13px;cursor:pointer;transition:background .15s,border-color .15s}
.lc-chip:hover{background:rgba(255,255,255,.1);border-color:var(--g)}
.lc-chip small{color:var(--ink-dim);font-size:11px}
.lc-bang{color:var(--warn);font-weight:700}
.lc-log{display:flex;flex-direction:column;gap:12px}
.lc-entry{border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.28);overflow:hidden}
.lc-entry.is-err{border-color:rgba(248,113,113,.5)}
.lc-entry header{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line)}
.lc-entry code{flex:1;font-family:var(--mono);font-size:13px;color:var(--accent)}
.lc-entry.is-err code{color:var(--bad)}
.lc-pre{margin:0;padding:12px;font-family:var(--mono);font-size:12.5px;line-height:1.55;white-space:pre-wrap;
  word-break:break-word;max-height:340px;overflow:auto}
.lc-pre--sm{max-height:130px;font-size:11.5px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:rgba(0,0,0,.28)}
.lc-status .lc-cmd-head{margin-bottom:8px}
.lc-gw{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--line)}
.lc-stat{margin-bottom:10px}.lc-stat:last-child{margin-bottom:0}
.lc-stat-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px}
.lc-stat-head h3{margin:0}
.lc-sys-sec{margin-top:9px}.lc-sys-sec:first-child{margin-top:0}
.lc-sys-title{display:flex;justify-content:space-between;font-size:10px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-dim);margin-bottom:5px}
.lc-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.lc-ollama-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.lc-ollama-box{position:relative;display:flex;align-items:center;min-height:38px;
  padding:5px 12px 5px 8px;border-radius:8px;border:1px solid rgba(74,222,128,.4);
  background:rgba(74,222,128,.1);line-height:1.2;word-break:break-word;color:var(--ok)}
.lc-ollama-box::after{content:'';position:absolute;top:6px;right:6px;width:5px;height:5px;
  border-radius:50%;background:currentColor}
.lc-ollama-box b{font-size:10.5px;font-weight:650}
.lc-ollama-wide{grid-column:1/-1}
.lc-ollama-box.is-bad{color:var(--bad);background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.45)}
.lc-ollama-box.is-warn{color:var(--warn);background:rgba(251,191,36,.1);border-color:rgba(251,191,36,.45)}
.lc-ollama-box.is-off{color:var(--ink-dim);opacity:.8}.lc-tile{position:relative;display:flex;flex-direction:column;justify-content:center;gap:1px;min-height:38px;
  padding:5px 12px 5px 8px;border-radius:8px;border:1px solid var(--line);background:rgba(255,255,255,.04);
  line-height:1.2;word-break:break-word;color:var(--ink-dim)}

.lc-tile::after{content:'';position:absolute;top:6px;right:6px;width:5px;height:5px;border-radius:50%;background:currentColor}
.lc-tile b{font-size:10.5px;font-weight:650;color:var(--ink)}
.lc-tile small{font-size:9.5px;color:var(--ink-dim);overflow:hidden;text-overflow:ellipsis}
.lc-tile.is-ok{color:var(--ok);background:rgba(74,222,128,.1);border-color:rgba(74,222,128,.4)}
.lc-tile.is-bad{color:var(--bad);background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.45)}
.lc-tile.is-off{color:var(--ink-dim);opacity:.8}
.lc-tile.is-warn{color:var(--warn);background:rgba(251,191,36,.1);border-color:rgba(251,191,36,.45)}
.lc-sys-name{display:inline-flex;align-items:center;gap:5px}
.lc-sys-name.is-ok,.lc-sys-name.is-bad{font-weight:700}
.lc-sys-name.is-ok::before,.lc-sys-name.is-bad::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}
.lc-sys-name.is-ok{color:var(--ok)}
.lc-sys-name.is-bad{color:var(--bad)}
.lc-tile--wide{grid-column:1/-1;gap:6px;padding:6px 12px 7px 8px}
.lc-subs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.lc-sub{position:relative;padding:3px 5px 3px 13px;border-radius:6px;border:1px solid var(--line);background:rgba(255,255,255,.04);
  font-size:9.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-sub::before{content:'';position:absolute;left:5px;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:var(--ink-dim)}
.lc-sub.is-ok{background:rgba(74,222,128,.1);border-color:rgba(74,222,128,.4)}
.lc-sub.is-ok::before{background:var(--ok)}
.lc-sub.is-bad{background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.45)}
.lc-sub.is-bad::before{background:var(--bad)}
.lc-sub.is-off{opacity:.7}
.lc-sys-git{display:flex;gap:5px;flex-wrap:wrap}
.lc-badge{padding:2px 8px;border-radius:999px;border:1px solid var(--line);font-size:10.5px;font-family:var(--mono);color:var(--ink)}
.lc-badge.is-ok{color:var(--ok);border-color:rgba(74,222,128,.4)}
.lc-badge.is-warn{color:var(--warn);border-color:rgba(251,191,36,.45)}
.lc-pill{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);
  font-size:11px;color:var(--ink-dim)}
.lc-pill.is-ok{color:var(--ok);border-color:rgba(74,222,128,.4)}
.lc-pill.is-bad{color:var(--bad);border-color:rgba(248,113,113,.45)}
.lc-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.lc-pulse{animation:lc-pulse 2s ease-in-out infinite}
@keyframes lc-pulse{0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.55)}50%{box-shadow:0 0 0 5px rgba(74,222,128,0)}}
.lc-agent{padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.06);border:1px solid var(--line);font-size:10.5px;font-family:var(--mono)}
.lc-spin{width:12px;height:12px;border-radius:50%;border:2px solid rgba(7,32,31,.3);border-top-color:#07201f;animation:lc-rot .8s linear infinite}
@keyframes lc-rot{to{transform:rotate(360deg)}}
.lc-page :is(button,a,input,textarea):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:980px){
  .lc-grid{grid-template-columns:1fr}
  .lc-side{position:static;max-height:none;overflow:visible}
}
@media (max-width:560px){
  .lc-wrap{padding:20px 14px 56px}
  .lc-entry header{flex-wrap:wrap}
  .lc-chips{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (prefers-reduced-motion:reduce){.lc-pulse,.lc-spin{animation:none}}
.lc-select{padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--ink);font:inherit;font-size:13px}
.lc-select option{color:#111}
.lc-audio-form{display:flex;flex-direction:column;gap:10px}
.lc-audio-ta{width:100%;box-sizing:border-box;resize:vertical;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--ink);font-family:var(--mono);font-size:14px;line-height:1.5}
.lc-audio-ta:focus{outline:none;border-color:rgba(63,208,201,.5)}
.lc-audio-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.lc-check{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-dim);cursor:pointer}
.lc-btn--rec{background:rgba(248,113,113,.2);border-color:var(--bad);color:#fecaca}
.lc-rec{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.2)}
.lc-rec .lc-cmd-head{margin-bottom:8px}
.lc-rec-audio{width:100%}
.lc-audio .lc-err{margin-top:10px}
.lc-audio-hint{margin-top:8px}
.lc-audio-out{margin-top:14px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.28);overflow:hidden}
.lc-audio-out header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);font-size:13px;font-weight:600}
.lc-player{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
.lc-player-top{display:flex;align-items:center;gap:10px}
.lc-time{font-family:var(--mono);font-size:11.5px;color:var(--ink-dim);white-space:nowrap}
.lc-seek{flex:1;min-width:0;cursor:pointer;accent-color:var(--accent)}
.lc-speed{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.lc-btn--sm.is-on{background:var(--accent);border-color:var(--accent);color:#07201f}
.lc-play.is-on{background:var(--bad);border-color:var(--bad);color:#fff}
@media (max-width:560px){.lc-player-top{flex-wrap:wrap}.lc-seek{flex-basis:100%}}
@media (max-width:560px){
  .lc-bg{opacity:.55}
  .lc-shade{background:linear-gradient(180deg,rgba(11,16,21,.10) 0%,rgba(11,16,21,.22) 70%)}
}
` 



