import { useTranslation } from 'react-i18next'
import { projectSlugs, projectNames } from '../data/projects.js'

export default function Projects() {
  const { t } = useTranslation()

  return (
    <section className="section container">
      <p className="section-label">{t('projects.portfolioLabel')}</p>
      <h2 className="section-title">{t('projects.portfolioTitle')}</h2>
      <div style={styles.list}>
        {projectSlugs.map((slug) => (
          <article key={slug} style={styles.card}>
            <h3 style={styles.title}>{projectNames[slug]}</h3>
            <p style={styles.tag}>{t(`projectsData.${slug}.tag`)}</p>
            <p style={styles.text}>{t(`projectsData.${slug}.summary`)}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

const styles = {
  list: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '1.75rem',
  },
  card: {
    background: '#121a22',
    border: '1px solid #1f2b35',
    borderRadius: 10,
    padding: '1.75rem',
  },
  title: {
    fontSize: '1.2rem',
    marginBottom: '0.3rem',
  },
  tag: {
    fontSize: '0.75rem',
    color: '#3fd0c9',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    marginBottom: '0.8rem',
  },
  text: {
    color: '#8fa1ac',
    fontSize: '0.9rem',
  },
}
