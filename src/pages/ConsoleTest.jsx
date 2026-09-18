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

  // Piper TTS reale (solo Night Story, via "audio e testo <prompt>")
  const [wantsPiperAudio, setWantsPiperAudio] = useState(false)
  const [responseAudioFilename, setResponseAudioFilename] = useState(null)
  const PIPER_AGENTS = ['Night Story']
  const audioPlayerRef = useRef(null)

  // Audio (input)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioUrl, setAudioUrl] = useState(null)
  const [audioBlob, setAudioBlob] = useState(null)
  const [isSendingAudio, setIsSendingAudio] = useState(false)

  // Agenti che il gateway sa gestire in input audio (vedi AGENTS in Python: solo chi ha "audio_path")
  const AUDIO_CAPABLE_AGENTS = ['Story Whisper']

  // TTS (output) — Web Speech API, nessun backend coinvolto
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [ttsSupported, setTtsSupported] = useState(true)
  const [voicesReady, setVoicesReady] = useState(false)
  const utteranceRef = useRef(null)
  const voicesRef = useRef([])

  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const timerRef = useRef(null)

  // SOLO agenti pubblici
  const leles = [
    'Lele I',
    'Story Whisper',
    'Night Story',
  ]

  // --------------------------------------------------
  // TESTO → GATEWAY
  // --------------------------------------------------

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!prompt.trim()) return

    // Se stava leggendo una risposta precedente, interrompe
    stopSpeaking()

    // Se stava leggendo una risposta precedente, interrompe
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
      const response = await fetch(LELE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent: selectedLele,
          prompt: promptToSend,
        }),
      })

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}`
        )
      }

      const data = await response.json()

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

      if (data.audio_filename) {
        setResponseAudioFilename(data.audio_filename)
      }

    } catch (err) {
      console.error('Lele Gateway error:', err)

      setError(err.message)

      setResponse(
        t(
          'Errore di connessione con Lele Gateway. Il Mac deve essere acceso e il tunnel attivo!'
        )
      )

    } finally {
      setIsLoading(false)
    }
  }

  // --------------------------------------------------
  // TTS — Web Speech API (speechSynthesis)
  // --------------------------------------------------

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setTtsSupported(false)
      return
    }

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) {
        voicesRef.current = voices
        setVoicesReady(true)
      }
    }

    loadVoices()

    // Chrome popola le voci in modo asincrono al primo utilizzo
    window.speechSynthesis.onvoiceschanged = loadVoices

    return () => {
      window.speechSynthesis.onvoiceschanged = null
    }
  }, [])

  const pickVoice = () => {
    const voices = voicesRef.current

    if (!voices.length) return null

    const wantsItalian = i18n?.language?.startsWith('it') ?? true

    // 1) voce nella lingua desiderata
    if (wantsItalian) {
      const it = voices.find((v) => v.lang?.toLowerCase().startsWith('it'))
      if (it) return it
    } else {
      const match = voices.find((v) =>
        v.lang?.toLowerCase().startsWith(i18n.language.toLowerCase())
      )
      if (match) return match
    }

    // 2) fallback inglese
    const en = voices.find((v) => v.lang?.toLowerCase().startsWith('en'))
    if (en) return en

    // 3) fallback: prima voce disponibile sul sistema
    return voices[0]
  }

  const speakResponse = () => {
    if (!response) return

    // Caso 1: abbiamo un audio Piper reale generato dal backend
    if (responseAudioFilename) {
      const url = `${LELE_API_URL}/tts/${encodeURIComponent(
        selectedLele
      )}/${encodeURIComponent(responseAudioFilename)}`

      if (!audioPlayerRef.current) {
        audioPlayerRef.current = new Audio()
      }

      const player = audioPlayerRef.current
      player.src = url
      player.onended = () => setIsSpeaking(false)
      player.onerror = () => {
        setIsSpeaking(false)
        setError(
          t('Impossibile riprodurre l\'audio generato dal server.')
        )
      }

      setIsSpeaking(true)
      player.play().catch(() => {
        setIsSpeaking(false)
        setError(t("Riproduzione audio bloccata dal browser."))
      })
      return
    }

    // Caso 2: fallback — voce del browser
    if (!ttsSupported) return

    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(response)

    const voice = pickVoice()

    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else {
      utterance.lang = i18n?.language?.startsWith('it')
        ? 'it-IT'
        : i18n?.language || 'it-IT'
    }

    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)

    utteranceRef.current = utterance

    setIsSpeaking(true)
    window.speechSynthesis.speak(utterance)
  }

  const stopSpeaking = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause()
      audioPlayerRef.current.currentTime = 0
    }
    if (ttsSupported && window.speechSynthesis?.speaking) {
      window.speechSynthesis.cancel()
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
        const audioBlob = new Blob(
          audioChunksRef.current,
          { type: mediaRecorder.mimeType }
        )

        const url = URL.createObjectURL(audioBlob)

        setAudioBlob(audioBlob)
        setAudioUrl(url)

        // Per ora NON inviamo ancora l'audio al Gateway.
        // Questo è solo il test della registrazione.

        stream.getTracks().forEach((track) => {
          track.stop()
        })
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

    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')
      formData.append('agent', selectedLele)

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
    } catch (err) {
      console.error('Lele Gateway audio error:', err)
      setError(err.message)
      setResponse(
        t(
          'Errore di connessione con Lele Gateway. Il Mac deve essere acceso e il tunnel attivo!'
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
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }

      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }

      if (mediaRecorderRef.current) {
        const tracks =
          mediaRecorderRef.current.stream?.getTracks?.() || []

        tracks.forEach((track) => track.stop())
      }

      if (ttsSupported && window.speechSynthesis?.speaking) {
        window.speechSynthesis.cancel()
      }

      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause()
      }
    }
  }, [audioUrl, ttsSupported])

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

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
          {t('Try Lele')}
        </p>

        <h2 className="section-title">
          {t('Interact with Lele AI Models')}
        </h2>

        {error && (
          <div style={styles.errorBox}>
            <p>
              ⚠️{' '}
              {t(
                'Attenzione: Il Mac deve essere acceso e il tunnel Cloudflare attivo!'
              )}
            </p>

            <p>{error}</p>
          </div>
        )}

        <div style={styles.promptContainer}>

          <form
            onSubmit={handleSubmit}
            style={styles.form}
          >

            {/* AGENTE */}

            <div style={styles.selector}>

              <label
                htmlFor="lele-select"
                style={styles.label}
              >
                {t('Select Lele AI:')}
              </label>

              <select
                id="lele-select"
                value={selectedLele}
                onChange={(e) =>
                  setSelectedLele(e.target.value)
                }
                style={styles.select}
                disabled={isRecording || isLoading}
              >
                {leles.map((lele) => (
                  <option
                    key={lele}
                    value={lele}
                  >
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
                  onChange={(e) =>
                    setWantsPiperAudio(e.target.checked)
                  }
                  disabled={isRecording || isLoading}
                />
                {' '}
                {t('Genera anche audio (voce Piper)')}
              </label>
            )}

            {/* TESTO */}

            <textarea
              value={prompt}
              onChange={(e) =>
                setPrompt(e.target.value)
              }
              placeholder={t('Enter your prompt here...')}
              style={styles.textarea}
              rows={4}
              disabled={isRecording}
            />

            {/* BOTTONI */}

            <div style={styles.buttonsRow}>

              <button
                type="submit"
                disabled={
                  isLoading ||
                  isRecording ||
                  !prompt.trim()
                }
                style={styles.button}
              >
                {isLoading
                  ? t('Thinking...')
                  : t('Send to Lele')}
              </button>

              <button
                type="button"
                onClick={
                  isRecording
                    ? stopRecording
                    : startRecording
                }
                disabled={isLoading}
                style={{
                  ...styles.recordButton,
                  ...(isRecording
                    ? styles.recordingButton
                    : {}),
                }}
              >
                {isRecording
                  ? `⏹ ${formatTime(recordingTime)}`
                  : '🎙️ Record'}
              </button>

            </div>

          </form>

          {/* AUDIO PREVIEW */}

          {audioUrl && (
            <div style={styles.audioPreview}>

              <div style={styles.audioHeader}>

                <p style={styles.audioLabel}>
                  🎙️ {t('Recorded audio')}
                </p>

                <button
                  type="button"
                  disabled={isLoading || isSendingAudio || !audioBlob}
                  style={styles.audioSendButton}
                  onClick={handleSendAudio}
                >
                  🎙️{' '}
                  {isSendingAudio
                    ? t('Sending...')
                    : t('Send Audio')}
                </button>

              </div>

              <audio
                controls
                src={audioUrl}
                style={styles.audio}
              />

            </div>
          )}

          {/* RISPOSTA */}

          {response && (
            <div style={styles.response}>

              <div style={styles.responseHeader}>

                <h3 style={styles.responseTitle}>
                  {t('Response from')} {selectedLele}
                </h3>

                {ttsSupported && (
                  <button
                    type="button"
                    onClick={
                      isSpeaking
                        ? stopSpeaking
                        : speakResponse
                    }
                    style={{
                      ...styles.ttsButton,
                      ...(isSpeaking
                        ? styles.ttsButtonActive
                        : {}),
                    }}
                  >
                    {isSpeaking
                      ? `⏹ ${t('Stop')}`
                      : `🔊 ${t('Listen')}`}
                  </button>
                )}

              </div>

              <pre style={styles.responseText}>
                {response}
              </pre>

            </div>
          )}

        </div>
      </div>
    </section>
  )
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(
    remainingSeconds
  ).padStart(2, '0')}`
}

// --------------------------------------------------
// STYLES
// --------------------------------------------------

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
    background:
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
    background:
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
    background:
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  audio: {
    width: '100%',
  },

  audioInfo: {
    color: '#a0aec0',
    fontSize: '13px',
    marginTop: '10px',
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
    whiteSpace: 'nowrap',
    transition: 'all 0.3s ease',
  },

  ttsButtonActive: {
    backgroundColor: 'rgba(255, 80, 80, 0.25)',
    border: '1px solid #ff6b6b',
    color: '#ffb3b3',
  },

  responseText: {
    color: '#a0aec0',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    fontFamily: 'monospace',
    fontSize: '14px',
    lineHeight: '1.6',
  },
}