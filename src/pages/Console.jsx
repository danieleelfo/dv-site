import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import bgImage from '../assets/DataInFlames.jpg'

// Base URL del Gateway pubblico Lele (SENZA /api/chat)
const LELE_API_URL = 'https://api.danielevillanova.com'

const CHAT_ID_STORAGE_KEY = 'lele_chat_id'

function getOrCreateChatId() {
  try {
    const stored = window.localStorage.getItem(CHAT_ID_STORAGE_KEY)
    if (stored) return parseInt(stored, 10)

    const newId = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000
    window.localStorage.setItem(CHAT_ID_STORAGE_KEY, String(newId))
    return newId
  } catch (e) {
    console.warn('localStorage non disponibile, chat_id non persistente:', e)
    return Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000
  }
}

// Lista fissa lato client — indipendente da cosa espone il gateway in
// AGENTS. Bar_AI demo escluso di proposito: non è un agente pubblico.
const AVAILABLE_AGENTS = [
  { value: 'Lele I', label: 'Lele I 🏴‍☠️' },
  { value: 'Story Whisper', label: 'Story Whisper 🌈' },
  { value: 'Night Story', label: 'Night Story 🌙' },
]

export default function Console() {
  const { t, i18n } = useTranslation()

  const [selectedLele, setSelectedLele] = useState('Lele I')
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // NUOVO: feedback copia (prompt e risposta)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [copiedResponse, setCopiedResponse] = useState(false)

  // Sessione anonima persistente
  const chatIdRef = useRef(getOrCreateChatId())

  // Piper TTS reale (solo Night Story e Story Whisper)
  const [wantsPiperAudio, setWantsPiperAudio] = useState(false)
  const [responseAudioFilename, setResponseAudioFilename] = useState(null)
  const PIPER_AGENTS = ['Night Story', 'Story Whisper']

  // NUOVO: auto-invio dell'audio registrato appena si ferma la registrazione
  const AUTO_SEND_RECORDING = true
  const audioBlobRef = useRef(null)

  // Lettore Audio Avanzato
  const audioPlayerRef = useRef(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)

  // Audio (input)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioUrl, setAudioUrl] = useState(null)
  const [audioBlob, setAudioBlob] = useState(null)
  const [isSendingAudio, setIsSendingAudio] = useState(false)

  const AUDIO_CAPABLE_AGENTS = ['Story Whisper']

  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const timerRef = useRef(null)

  const extractFilename = (value) => {
    if (!value || typeof value !== 'string') return null
    return value.split(/[/\\]/).pop() || null
  }

  // --------------------------------------------------
  // NUOVO: COPIA NEGLI APPUNTI
  // --------------------------------------------------
  const copyToClipboard = async (text, which) => {
    if (!text) return
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        // Fallback per contesti non-secure (http locale ecc.)
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }

      if (which === 'prompt') {
        setCopiedPrompt(true)
        setTimeout(() => setCopiedPrompt(false), 2000)
      } else {
        setCopiedResponse(true)
        setTimeout(() => setCopiedResponse(false), 2000)
      }
    } catch (err) {
      console.error('Clipboard error:', err)
      setError(t('Impossibile copiare negli appunti.'))
    }
  }

  // --------------------------------------------------
  // TESTO → GATEWAY (/api/chat)
  // --------------------------------------------------
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) return

    stopSpeaking()
    setIsLoading(true)
    setResponse('')
    setResponseAudioFilename(null)
    setError('')

    const usesPiperAudio =
      wantsPiperAudio && PIPER_AGENTS.includes(selectedLele)

    const cleanPrompt = prompt.replace(/^(audio e testo|audio)\s*/i, '')

    const promptToSend = usesPiperAudio
      ? `audio e testo ${cleanPrompt}`
      : prompt

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000)

    try {
      const res = await fetch(`${LELE_API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          agent: selectedLele,
          prompt: promptToSend,
          language: i18n.language || 'en',
          chat_id: chatIdRef.current,
        }),
      })

      clearTimeout(timeoutId)

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
        setResponse(t('Nessuna risposta ricevuta'))
      }

      const filename =
        extractFilename(data.audio_filename) ||
        extractFilename(data.audio_path)

      setResponseAudioFilename(filename)
    } catch (err) {
      clearTimeout(timeoutId)
      console.error('Lele Gateway error:', err)
      if (err.name === 'AbortError') {
        setError(t('Timeout: il server non ha risposto in tempo.'))
      } else {
        setError(err.message)
      }
      setResponse(
        t(
          'Errore di connessione con Lele Gateway. Il Mac deve essere acceso, avvisa Daniele!'
        )
      )
    } finally {
      setIsLoading(false)
    }
  }

  // --------------------------------------------------
  // CONTROLLI RIPRODUZIONE AUDIO DA BACKEND
  // --------------------------------------------------
  const togglePlayAudio = () => {
    if (!response || !responseAudioFilename) return

    const player = audioPlayerRef.current
    if (!player) return

    const url = `${LELE_API_URL}/api/chat/tts/${encodeURIComponent(
      selectedLele
    )}/${encodeURIComponent(responseAudioFilename)}`

    // Carica la sorgente se non ancora settata o se diversa
    if (player.src !== url) {
      player.src = url
      player.playbackRate = playbackRate
    }

    if (isSpeaking) {
      player.pause()
      setIsSpeaking(false)
    } else {
      player.play().then(() => {
        setIsSpeaking(true)
      }).catch((err) => {
        console.error('Audio play error:', err)
        setIsSpeaking(false)
        setError(t('Riproduzione audio bloccata dal browser.'))
      })
    }
  }

  const stopSpeaking = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause()
      audioPlayerRef.current.currentTime = 0
    }
    setIsSpeaking(false)
    setAudioCurrentTime(0)
  }

  const handleRateChange = (rate) => {
    setPlaybackRate(rate)
    if (audioPlayerRef.current) {
      audioPlayerRef.current.playbackRate = rate
    }
  }

  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value)
    setAudioCurrentTime(newTime)
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = newTime
    }
  }

  // --------------------------------------------------
  // REGISTRAZIONE AUDIO (input)
  // --------------------------------------------------
  const startRecording = async () => {
    try {
      setError('')
      setAudioUrl(null)

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus' }
        : {}

      const mediaRecorder = new MediaRecorder(stream, options)

      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        })
        const url = URL.createObjectURL(blob)
        audioBlobRef.current = blob
        setAudioBlob(blob)
        setAudioUrl(url)
        stream.getTracks().forEach((track) => track.stop())

        // NUOVO: auto-invio appena la registrazione si ferma —
        // Lelé riceve l'audio, lo capisce e risponde Audio&text.
        if (AUTO_SEND_RECORDING) {
          handleSendAudio(blob)
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)

      timerRef.current = setInterval(() => {
        setRecordingTime((time) => time + 1)
      }, 1000)
    } catch (err) {
      console.error('Microphone error:', err)
      setError(
        t('Impossibile accedere al microfono. Controlla i permessi del browser.')
      )
    }
  }

  // --------------------------------------------------
  // INVIO AUDIO → GATEWAY (/api/chat/audio)
  // --------------------------------------------------
  const handleSendAudio = async (blobOverride) => {
    const blob = blobOverride || audioBlobRef.current

    if (!blob) return

    if (!AUDIO_CAPABLE_AGENTS.includes(selectedLele)) {
      setError(
        t(
          `'${selectedLele}' non supporta l'input audio. Usa Story Whisper.`
        )
      )
      return
    }

    stopSpeaking()
    setIsSendingAudio(true)
    setError('')
    setResponse('')
    setResponseAudioFilename(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000)

    try {
      const formData = new FormData()
      formData.append('audio', blob, 'recording.webm')
      formData.append('agent', selectedLele)
      formData.append('language', i18n.language || 'en')
      formData.append('chat_id', String(chatIdRef.current))

      const res = await fetch(`${LELE_API_URL}/api/chat/audio`, {
        method: 'POST',
        signal: controller.signal,
        body: formData,
      })

      clearTimeout(timeoutId)

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
        setResponse(t('Nessuna risposta ricevuta'))
      }

      const filename =
        extractFilename(data.audio_filename) ||
        extractFilename(data.audio_path)

      setResponseAudioFilename(filename)
    } catch (err) {
      clearTimeout(timeoutId)
      console.error('Lele Gateway audio error:', err)
      if (err.name === 'AbortError') {
        setError(t('Timeout: il server non ha risposto in tempo.'))
      } else {
        setError(err.message)
      }
      setResponse(
        t(
          'Errore di connessione con Lele Gateway. Il Mac deve essere acceso, avvisa Daniele!'
        )
      )
    } finally {
      setIsSendingAudio(false)
    }
  }

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  // --------------------------------------------------
  // CLEANUP
  // --------------------------------------------------
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      if (mediaRecorderRef.current) {
        const tracks = mediaRecorderRef.current.stream?.getTracks?.() || []
        tracks.forEach((track) => track.stop())
      }
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause()
      }
    }
  }, [audioUrl])

  // --------------------------------------------------
  // UI
  // --------------------------------------------------
  return (
    <section className="section container" style={styles.wrap}>
      <img src={bgImage} alt="" style={styles.bgImg} />
      <div style={styles.overlay} />

      {/* Elemento audio invisibile per gestire gli eventi di riproduzione */}
      <audio
        ref={audioPlayerRef}
        onTimeUpdate={() => setAudioCurrentTime(audioPlayerRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setAudioDuration(audioPlayerRef.current?.duration || 0)}
        onEnded={() => {
          setIsSpeaking(false)
          setAudioCurrentTime(0)
        }}
        onError={() => {
          setIsSpeaking(false)
          setError(t("Impossibile riprodurre l'audio generato dal server."))
        }}
      />

      <div style={styles.content}>
        <p className="section-label">{t('Try Lele')}</p>
        <h2 className="section-title">{t('Interact with Lele AI Models')}</h2>

        {error && (
          <div style={styles.errorBox}>
            <p>⚠️ {t('Attenzione: Il Mac deve essere acceso, avvisa Daniele!')}</p>
            <p>{error}</p>
          </div>
        )}

        <div style={styles.promptContainer}>
          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.selector}>
              <label htmlFor="lele-select" style={styles.label}>
                {t('Select Lele AI:')}
              </label>
              <select
                id="lele-select"
                value={selectedLele}
                onChange={(e) => setSelectedLele(e.target.value)}
                style={styles.select}
                disabled={isRecording || isLoading}
              >
                {AVAILABLE_AGENTS.map((lele) => (
                  <option key={lele.value} value={lele.value}>
                    {lele.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Checkbox SOLO per Night Story e Story Whisper */}
            {PIPER_AGENTS.includes(selectedLele) && (
              <label style={styles.piperCheckboxRow}>
                <input
                  type="checkbox"
                  checked={wantsPiperAudio}
                  onChange={(e) => setWantsPiperAudio(e.target.checked)}
                  disabled={isRecording || isLoading}
                />{' '}
                {t('Send Audio (TTS)')}
              </label>
            )}

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('Enter your prompt here...')}
              style={styles.textarea}
              rows={4}
              disabled={isRecording}
            />

            {/* NUOVO: bottoncini Copia e Clear per il prompt utente */}
            <div style={styles.promptUtilityRow}>
              <button
                type="button"
                onClick={() => copyToClipboard(prompt, 'prompt')}
                disabled={!prompt.trim()}
                style={{
                  ...styles.utilityButton,
                  ...(copiedPrompt ? styles.utilityButtonCopied : {}),
                }}
              >
                {copiedPrompt ? '✓ Copiato' : '📋 Copia prompt'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setPrompt('')
                  setCopiedPrompt(false)
                }}
                disabled={!prompt.trim()}
                style={styles.utilityButtonDanger}
              >
                🧹 Clear
              </button>
            </div>

            <div style={styles.buttonsRow}>
              <button
                type="submit"
                disabled={isLoading || isRecording || !prompt.trim()}
                style={styles.button}
              >
                {isLoading ? t('Thinking...') : t('Send to Lele')}
              </button>

              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading}
                style={{
                  ...styles.recordButton,
                  ...(isRecording ? styles.recordingButton : {}),
                }}
              >
                {isRecording
                  ? `⏹ ${formatTime(recordingTime)}`
                  : '🎤 Record'}
              </button>
            </div>
          </form>

          {audioUrl && (
            <div style={styles.audioPreview}>
              <div style={styles.audioHeader}>
                <p style={styles.audioLabel}>🎤 {t('Recorded audio')}</p>
                <button
                  type="button"
                  disabled={isLoading || isSendingAudio || !audioBlob}
                  style={styles.audioSendButton}
                  onClick={() => handleSendAudio()}
                >
                  🎤 {isSendingAudio ? t('Sending...') : t('Send Audio')}
                </button>
              </div>
              <audio controls src={audioUrl} style={styles.audio} />
            </div>
          )}

          {response && (
            <div style={styles.response}>
              <div style={styles.responseHeader}>
                <h3 style={styles.responseTitle}>
                  {t('Response from')} {selectedLele}
                </h3>

                {/* NUOVO: bottoncino copia risposta */}
                <button
                  type="button"
                  onClick={() => copyToClipboard(response, 'response')}
                  style={{
                    ...styles.utilityButton,
                    ...(copiedResponse ? styles.utilityButtonCopied : {}),
                  }}
                >
                  {copiedResponse ? '✓ Copiato' : '📋 Copia'}
                </button>
              </div>

              {/* LETTORE AUDIO AVANZATO CON SCRUBBER E VELOCITA' */}
              {responseAudioFilename && (
                <div style={styles.playerContainer}>
                  <div style={styles.playerTopRow}>
                    <button
                      type="button"
                      onClick={togglePlayAudio}
                      style={{
                        ...styles.playButton,
                        ...(isSpeaking ? styles.playButtonActive : {}),
                      }}
                    >
                      {isSpeaking ? '⏸ Pausa' : '▶ Ascolta Audio'}
                    </button>

                    <span style={styles.timeLabel}>
                      {formatTime(audioCurrentTime)} / {formatTime(audioDuration)}
                    </span>

                    <input
                      type="range"
                      min="0"
                      max={audioDuration || 0}
                      step="0.1"
                      value={audioCurrentTime}
                      onChange={handleSeek}
                      style={styles.seekBar}
                    />
                  </div>

                  <div style={styles.speedRow}>
                    <span style={styles.speedLabel}>Velocità:</span>
                    {[1, 1.25, 1.5, 1.75, 2].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => handleRateChange(rate)}
                        style={{
                          ...styles.speedButton,
                          ...(playbackRate === rate ? styles.speedButtonActive : {}),
                        }}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <pre style={styles.responseText}>{response}</pre>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00"
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(
    remainingSeconds
  ).padStart(2, '0')}`
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
    opacity: 0.6,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(11,16,21,0.25) 0%, rgba(11,16,21,0.85) 100%)',
  },
  content: {
    position: 'relative',
    width: '100%',
    maxWidth: '800px',
    margin: '0 auto',
  },
  errorBox: {
    backgroundColor: 'rgba(255, 100, 100, 0.2)',
    border: '1px solid #ff6b6b',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '16px',
    color: '#ff6b6b',
  },
  promptContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    padding: '24px',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    marginTop: '20px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  selector: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  label: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  piperCheckboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#e2e8f0',
    fontSize: '14px',
    cursor: 'pointer',
  },
  select: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: '#e2e8f0',
    fontSize: '16px',
    cursor: 'pointer',
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
  // NUOVO: riga utility sotto la textarea (Copia prompt / Clear)
  promptUtilityRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '10px',
    marginTop: '-8px',
  },
  utilityButton: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    color: '#cbd5e1',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.2s ease',
  },
  utilityButtonCopied: {
    backgroundColor: 'rgba(52, 211, 153, 0.2)',
    borderColor: '#34d399',
    color: '#6ee7b7',
  },
  utilityButtonDanger: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid rgba(255, 107, 107, 0.4)',
    backgroundColor: 'rgba(255, 107, 107, 0.12)',
    color: '#fca5a5',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.2s ease',
  },
  buttonsRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
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
    transition: 'all 0.3s ease',
  },
  recordButton: {
    padding: '14px 24px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
  },
  recordingButton: {
    backgroundColor: 'rgba(255, 80, 80, 0.25)',
    border: '1px solid #ff6b6b',
    color: '#ffb3b3',
  },
  audioPreview: {
    marginTop: '20px',
    padding: '16px',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
  },
  audioHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px',
  },
  audioLabel: {
    color: '#e2e8f0',
    fontWeight: '600',
    margin: 0,
  },
  audioSendButton: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: 'none',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  audio: {
    width: '100%',
  },
  response: {
    marginTop: '24px',
    padding: '16px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
  },
  responseHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '12px',
  },
  responseTitle: {
    color: '#e2e8f0',
    fontSize: '18px',
    margin: 0,
  },
  // STILI LETTORE AUDIO AVANZATO
  playerContainer: {
    marginBottom: '16px',
    padding: '12px 16px',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  playerTopRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  playButton: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  playButtonActive: {
    backgroundColor: '#ef4444',
  },
  timeLabel: {
    color: '#cbd5e1',
    fontSize: '12px',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
  },
  seekBar: {
    flex: 1,
    cursor: 'pointer',
    accentColor: '#6366f1',
  },
  speedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  speedLabel: {
    color: '#94a3b8',
    fontSize: '12px',
  },
  speedButton: {
    padding: '2px 8px',
    borderRadius: '4px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#94a3b8',
    fontSize: '11px',
    cursor: 'pointer',
  },
  speedButtonActive: {
    backgroundColor: '#6366f1',
    color: '#ffffff',
    borderColor: '#818cf8',
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