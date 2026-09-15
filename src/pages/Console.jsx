import { useTranslation } from 'react-i18next'
import bgImage from '../assets/DataInFlames.jpd'

export default function Console() {
  const { t } = useTranslation()

  return (
    <section className="section container" style={styles.wrap}>
      <img src={bgImage} alt="" style={styles.bgImg} />
      <div style={styles.overlay} />
      <div style={styles.content}>
        <p className="section-label">{t('console.label')}</p>
        <h2 className="section-title">{t('console.title')}</h2>
        <p style={styles.text}>{t('console.text')}</p>
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
    opacity: 0.35,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(11,16,21,0.5) 0%, rgba(11,16,21,0.92) 100%)',
  },
  content: {
    position: 'relative',
  },
  text: {
    color: '#8fa1ac',
  },
}
