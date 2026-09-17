import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import bgImage from '../assets/DataInFlames.jpg'

// 👇 URL del Gateway esposto via Cloudflare Tunnel - DOMINIO CORRETTO: danielevillanova.com
const LELE_API_URL = 'https://api.leles.danielevillanova.com/api/chat';

export default function ConsoleTest() {
  const { t } = useTranslation()
  const [selectedLele, setSelectedLele] = useState('Lele Admin')
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const leles = [
    'Lele Admin',
    'Lele I',
    'Story Whisper',
    'Night Story',
    'Bar_AI demo'
  ]

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) return

    setIsLoading(true)
    setResponse('')
    setError('')

    try {
      const response = await fetch(LELE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: selectedLele,
          prompt: prompt,
          chat_id: 8733881519
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      
      if (data.answer) {
        setResponse(data.answer)
      } else if (data.error) {
        setResponse(data.error)
      } else if (data.detail) {
        setResponse(data.detail)
      } else {
        setResponse(t('Nessuna risposta ricevuta'))
      }

    } catch (err) {
      setError(err.message)
      setResponse(t('Errore di connessione con Lele Gateway. Il Mac deve essere acceso e il tunnel attivo!'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="section container" style={styles.wrap}>
      <img src={bgImage} alt="" style={styles.bgImg} />
      <div style={styles.overlay} />
      <div style={styles.content}>
        <p className="section-label">{t('Console - Lele AI Prompt')}</p>
        <h2 className="section-title">{t('Interact with Lele AI Models')}</h2>
        
        {error && (
          <div style={styles.errorBox}>
            <p>⚠️ {t('Attenzione: Il Mac deve essere acceso e il tunnel Cloudflare attivo!')}</p>
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
              >
                {leles.map((lele) => (
                  <option key={lele} value={lele}>
                    {lele}
                  </option>
                ))}
              </select>
            </div>
            
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('Enter your prompt here...')}
              style={styles.textarea}
              rows={4}
            />
            
            <button
              type="submit"
              disabled={isLoading || !prompt.trim()}
              style={styles.button}
            >
              {isLoading ? t('Thinking...') : t('Send to Lele')}
            </button>
          </form>
          
          {response && (
            <div style={styles.response}>
              <h3 style={styles.responseTitle}>
                {t('Response from')} {selectedLele}
              </h3>
              <pre style={styles.responseText}>{response}</pre>
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
    alignSelf: 'flex-end',
  },
  response: {
    marginTop: '24px',
    padding: '16px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
  },
  responseTitle: {
    color: '#e2e8f0',
    fontSize: '18px',
    marginBottom: '12px',
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
