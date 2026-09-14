import { useTranslation } from 'react-i18next'

export default function Console() {
  const { t } = useTranslation()

  return (
    <section className="section container" style={styles.wrap}>
      <p className="section-label">{t('console.label')}</p>
      <h2 className="section-title">{t('console.title')}</h2>
      <p style={styles.text}>{t('console.text')}</p>
    </section>
  )
}

const styles = {
  wrap: {
    minHeight: '50vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  },
  text: {
    color: '#8fa1ac',
  },
}
