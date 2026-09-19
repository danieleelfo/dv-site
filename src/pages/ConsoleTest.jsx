import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import bgImage from '../assets/DataInFlames.jpg'

// Gateway pubblico Lele
const LELE_API_URL = 'https://api.danielevillanova.com/api/chat'

export default function Console() {
  const { t, i18n } = useTranslation()

  const [selectedLele, setSelectedLele] = useState('Lele I')
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Audio generato sul Mac (Piper / TTS)
  const [wantsPiperAudio, setWantsPiperAudio] = useState(false)
  const [responseAudioFilename, setResponseAudioFilename] = useState(null)
  const PIPER_AGENTS = ['Night Story']
  const audioPlayerRef = useRef(null)

  // Audio input (registrazione)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioUrl, setAudioUrl] = useState(null)
  const [audioBlob, setAudioBlob] = useState(null)
  const [isSendingAudio, setIsSendingAudio] = useState(false)

  // Solo Story Whisper ha /ask/audio completo al momento
  const AUDIO_CAPABLE_AGENTS = ['Story Whisper']

  const [isSpeaking, setIsSpeaking] = useState(false)

  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const timerRef = useRef(null)

  const leles = ['Lele I', 'Story Whisper', 'Night Story']

  // --------------------------------------------------
  // Helper: estrae solo il nome file da path o filename
  // --------------------------------------------------
  const extractFilename = (value) => {
    if (!value || typeof value !== 'string') return null
    return value.split(/[/\\]/).pop() || null
  }

  // --------------------------------------------------
  // TESTO → GATEWAY
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

    const promptToSend = usesPiperAudio
      ? `audio e testo ${prompt}`
      : prompt

    try {
      const res = await fetch(LELE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: selectedLele,
          prompt: promptToSend,
          language: i18n.language || 'en',
        }),
      })

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

      // Preferisci audio_filename, altrimenti audio_path (solo basename)
      const filename =
        extractFilename(data.audio_filename) ||
        extractFilename(data.audio_path)

      setResponseAudioFilename(filename)

    } catch (err) {
      console.error('Lele Gateway error:', err)
      setError(err.message)
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
  // LISTEN — SOLO file .ogg dal Mac (niente Web Speech)
  // --------------------------------------------------
  const speakResponse = () => {
    if (!response || !responseAudioFilename) return

    const url = `\( {LELE_API_URL}/tts/ \){encodeURIComponent(
      selectedLele
    )}/${encodeURIComponent(responseAudioFilename)}`

    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio()
    }

    const player = audioPlayerRef.current

    // Ferma eventuale riproduzione precedente
    player.pause()
    player.currentTime = 0

    player.src = url
    player.onended = () => setIsSpeaking(false)
    player.onerror = () => {
      setIsSpeaking(false)
      setError(t("Impossibile riprodurre l'audio generato dal server."))
    }

    setIsSpeaking(true)

    // Deve partire da un click utente → ok anche su mobile
    player.play().catch((err) => {
      console.error('Audio play error:', err)
      setIsSpeaking(false)
      setError(
        t('Riproduzione audio bloccata o non supportata su questo dispositivo.')
      )
    })
  }

  const stopSpeaking = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause()
      audioPlayerRef.current.currentTime = 0
    }
    setIsSpeaking(false)
  }

  // --------------------------------------------------
  // REGISTRAZIONE AUDIO (input)
  // --------------------------------------------------
  const startRecording = async () => {
    try {
      setError('')
      setAudioUrl(null)

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })

      const mediaRecorder = new MediaRecorder(stream)
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
        setAudioBlob(blob)
        setAudioUrl(url)
        stream.getTracks().forEach((track) => track.stop())
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
        t(
          'Impossibile accedere al microfono. Controlla i permessi del browser.'
        )
      )
    }
  }

  const handleSendAudio = async () => {
    if (!audioBlob) return

    if (!AUDIO_CAPABLE_AGENTS.includes(selectedLele)) {
      setError(
        t(
          `'${selectedLele}' non supporta ancora l'input audio sul gateway. Seleziona Story Whisper.`
        )
      )
      return
    }

    stopSpeaking()
    setIsSendingAudio(true)
    setError('')
    setResponse('')
    setResponseAudioFilename(null)

    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')
      formData.append('agent', selectedLele)
      formData.append('language', i18n.language || 'en')

      const res = await fetch(`${LELE_API_URL}/audio`, {
        method: 'POST',
        body: formData,
      })

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
      console.error('Lele Gateway audio error:', err)
      setError(err.message)
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
        const tracks =
          mediaRecorderRef.current.stream?.getTracks?.() || []
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

      <div style={styles.content}>
        <p className="section-label">{t('Try Lele')}</p>
        <h2 className="section-title">
          {t('Interact with Lele AI Models')}
        </h2>

        {error && (
          <div style={styles.errorBox}>
            <p>
              ⚠️{' '}
              {t(
                'Attenzione: Il Mac deve essere acceso, avvisa Daniele!'
              )}
            </p>
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
                {leles.map((lele) => (
                  <option key={lele} value={lele}>
                    {lele}
                  </option>
                ))}
              </select>
            </div>

            {PIPER_AGENTS.includes(selectedLele) && (
              <label style={styles.piperCheckboxRow}>
                <input
                  type="checkbox"
                  checked={wantsPiperAudio}
                  onChange={(e) => setWantsPiperAudio(e.target.checked)}
                  disabled={isRecording || isLoading}
                />{' '}
                {t('Genera anche audio (voce Piper)')}
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
                <p style={styles.audioLabel}>
                  🎤 {t('Recorded audio')}
                </p>
                <button
                  type="button"
                  disabled={isLoading || isSendingAudio || !audioBlob}
                  style={styles.audioSendButton}
                  onClick={handleSendAudio}
                >
                  🎤{' '}
                  {isSendingAudio ? t('Sending...') : t('Send Audio')}
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

                {/* Listen SOLO se c'è un file .ogg dal Mac */}
                {responseAudioFilename && (
                  <button
                    type="button"
                    onClick={isSpeaking ? stopSpeaking : speakResponse}
                    style={{
                      ...styles.ttsButton,
                      ...(isSpeaking ? styles.ttsButtonActive : {}),
                    }}
                  >
                    {isSpeaking
                      ? `⏹ ${t('Stop')}`
                      : `🔊 ${t('Listen')}`}
                  </button>
                )}
              </div>

              <pre style={styles.responseText}>{response}</pre>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `\( {String(minutes).padStart(2, '0')}: \){String(
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
  ttsButton: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: '#e2e8f0',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  ttsButtonActive: {
    backgroundColor: 'rgba(255, 100, 100, 0.25)',
    border: '1px solid #ff6b6b',
    color: '#ffb3b3',
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