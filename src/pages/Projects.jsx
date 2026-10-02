import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import bgImage from '../assets/Project.jpg'
import { projectSlugs, projectNames } from '../data/projects.js'

// In sviluppo punta alla demo locale (Vite su :5180).
// In produzione usa VITE_BAR_AI_URL; se non è impostata, il box resta non cliccabile.

const BAR_AI_URL = import.meta.env.DEV
  ? 'http://localhost:5180'
  : 'https://bar-ai.pages.dev'


const projectLinks = {
  leles: '/en/leles-console',
  'emergence-lab': '/en/emergence',
  stories: '/en/console',
  'bar-ai': BAR_AI_URL,
}

const isExternal = (href) => /^https?:\/\//.test(href)

export default function Projects() {
  const { t } = useTranslation()

  return (
    <div>
      {/* Hero section with image */}
      <section style={styles.wrap}>
        <img src={bgImage} alt="" style={styles.bgImg} />
        <div style={styles.overlay} />
        <div className="container" style={styles.content}>
          <p className="section-label">{t('projects.portfolioLabel')}</p>
          <h2 className="section-title">{t('projects.portfolioTitle')}</h2>
        </div>
      </section>

      {/* Cards section below image */}
      <section className="section container" style={{ paddingTop: '2rem' }}>
        <div className="projects-list">
          {projectSlugs.map((slug) => {
            const href = projectLinks[slug]
            const external = href && isExternal(href)

            const card = (
              <article style={styles.card}>
                <h3 style={styles.title}>{projectNames[slug]}</h3>
                <p style={styles.tag}>{t(`projectsData.${slug}.tag`)}</p>
                <p style={styles.text}>{t(`projectsData.${slug}.summary`)}</p>
                {external && <p style={styles.cta}>Live demo →</p>}
              </article>
            )

            if (!href) {
              return <div key={slug}>{card}</div>
            }

            if (external) {
              return (
                <a
                  key={slug}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  {card}
                </a>
              )
            }

            return (
              <Link
                key={slug}
                to={href}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {card}
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}

const styles = {
  wrap: {
    position: 'relative',
    height: '40vh',
    overflow: 'hidden',
  },
  bgImg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: 0.85,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(11,16,21,0.55) 0%, rgba(11,16,21,0.9) 100%)',
  },
  content: {
    position: 'relative',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    paddingBottom: '2rem',
  },
  list: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '0.75rem',
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
  cta: {
    marginTop: '0.9rem',
    color: '#3fd0c9',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
}
