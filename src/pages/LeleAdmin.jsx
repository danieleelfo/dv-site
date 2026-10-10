import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import bgImage from '../assets/DataInFlames.jpg'
import SystemTiles, { parseSystem } from '../components/SystemPanel'

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

// Pagine di test raggiungibili al volo.
const QUICK_LINKS = [
  { to: '/test3', label: 'Bot to bot'},
  { to: '/test2', label: 'AI Lab' },
  { to: '/test', label: 'Lele Admin', main: true  },
  { to: '/test6', label: 'Test' },
  { to: '/test4', label: 'Test 4' },
  { to: '/test5', label: 'Test 5' },
  { to: '/improve', label: 'Improve' },
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
      c('Verifica', 'verifica ', 'file o richiesta'),
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

// Chiamata admin generica (JSON o FormData) che restituisce il JSON grezzo.
async function adminJson(idToken, path, init = {}, timeoutMs = 310000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${LELE_API_URL}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${idToken}` },
      signal: controller.signal,
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

const timeLabel = (ts) =>
  new Date(ts).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })


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
    setAudioReply(audioText(data))
    setAudioReplyFile(
      extractFilename(data.audio_filename) || extractFilename(data.audio_path)
    )
    setAudioReplyAgent(agent)
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
            <h1 className="lc-title">Lele Admin Console</h1>
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
          <h1 className="lc-title">Lele Admin Console</h1>
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
                </div>
              )}
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
          </aside>
        </div>

        {/* VAI A (temporanei): in fondo alla pagina */}
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
.lc-links{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:28px;padding-top:16px;
  border-top:1px solid var(--line);font-size:13px}
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
/* Solo GPT-OSS: nome verde se su, grigio se non caricato */
.lc-sys .lc-ollama-box.lc-ollama-wide.is-ok,
.lc-sys .lc-ollama-box.lc-ollama-wide.is-ok b {
  color: #22c55e;
}
.lc-sys .lc-ollama-box.lc-ollama-wide.is-off,
.lc-sys .lc-ollama-box.lc-ollama-wide.is-off b {
  color: var(--ink-dim);
}
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
` 
