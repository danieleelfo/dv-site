import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import hero from '../assets/hero.png'
import { projectSlugs, projectNames } from '../data/projects.js'

export default function Home() {
  const { t } = useTranslation()
  const expertiseItems = t('expertise.items', { returnObjects: true })

  return (
    <div>
      {/* HERO */}
      <section style={styles.hero}>
        <img src={hero} alt="" style={styles.heroImg} />
        <div style={styles.heroOverlay} />
        <div className="container" style={styles.heroContent}>
          <p className="section-label">{t('hero.label')}</p>
          <h1 style={styles.heroTitle}>Daniele Villanova</h1>
          <p style={styles.heroSubtitle}>{t('hero.subtitle')}</p>
          <div style={styles.heroActions}>
            <Link to="/projects" style={styles.btnPrimary}>{t('hero.viewProjects')}</Link>
            <a href="#contact" style={styles.btnGhost}>{t('hero.contact')}</a>
          </div>
        </div>
      </section>

      {/* ABOUT */}
      <section className="section container" id="about">
        <p className="section-label">{t('about.label')}</p>
        <h2 className="section-title">{t('about.title')}</h2>
        <p style={styles.aboutText}>{t('about.text')}</p>
      </section>

      {/* EXPERTISE */}
      <section className="section container" id="expertise" style={{ borderTop: '1px solid #1f2b35' }}>
        <p className="section-label">{t('expertise.label')}</p>
        <h2 className="section-title">{t('expertise.title')}</h2>
        <div style={styles.expertiseGrid}>
          {expertiseItems.map((e, i) => (
            <div key={i} style={styles.expertiseCard}>
              <h3 style={styles.expertiseTitle}>{e.title}</h3>
              <p style={styles.expertiseText}>{e.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SELECTED PROJECTS */}
      <section className="section container" id="projects" style={{ borderTop: '1px solid #1f2b35' }}>
        <p className="section-label">{t('projects.label')}</p>
        <h2 className="section-title">{t('projects.title')}</h2>
        <div style={styles.projectsGrid}>
          {projectSlugs.map((slug) => (
            <div key={slug} style={styles.projectCard}>
              <h3 style={styles.projectTitle}>{projectNames[slug]}</h3>
              <p style={styles.projectTag}>{t(`projectsData.${slug}.tag`)}</p>
              <p style={styles.projectText}>{t(`projectsData.${slug}.summary`)}</p>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '2.5rem' }}>
          <Link to="/projects" style={styles.btnGhost}>{t('projects.viewAll')} →</Link>
        </div>
      </section>

      {/* CONTACT */}
      <section className="section container" id="contact" style={{ borderTop: '1px solid #1f2b35' }}>
        <p className="section-label">{t('contact.label')}</p>
        <h2 className="section-title">{t('contact.title')}</h2>
        <p style={styles.aboutText}>{t('contact.text')}</p>
        <a href="mailto:daniele@danielevillanova.com" style={styles.btnPrimary}>
          daniele@danielevillanova.com
        </a>
      </section>

      <footer style={styles.footer}>
        <div className="container">© {new Date().getFullYear()} Daniele Villanova</div>
      </footer>
    </div>
  )
}

const styles = {
  hero: {
    position: 'relative',
    minHeight: '85vh',
    display: 'flex',
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  heroImg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  heroOverlay: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(11,16,21,0.35) 0%, rgba(11,16,21,0.75) 60%, rgba(11,16,21,0.97) 100%)',
  },
  heroContent: {
    position: 'relative',
    paddingBottom: '4.5rem',
  },
  heroTitle: {
    fontFamily: 'var(--serif)',
    fontWeight: 400,
    fontSize: 'clamp(2.2rem, 6vw, 4rem)',

    marginBottom: '1rem',
  },
  heroSubtitle: {
    color: '#b7c5cc',
    fontSize: '1.05rem',
    maxWidth: 560,
    marginBottom: '2rem',
  },
  heroActions: {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  btnPrimary: {
    background: '#3fd0c9',
    color: '#0b1015',
    padding: '0.75rem 1.5rem',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: '0.9rem',
    display: 'inline-block',
  },
  btnGhost: {
    border: '1px solid #3fd0c9',
    color: '#3fd0c9',
    padding: '0.75rem 1.5rem',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: '0.9rem',
    display: 'inline-block',
  },
  aboutText: {
    color: '#b7c5cc',
    fontSize: '1.05rem',
    maxWidth: 720,
  },
  expertiseGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '1.5rem',
  },
  expertiseCard: {
    background: '#121a22',
    border: '1px solid #1f2b35',
    borderRadius: 10,
    padding: '1.5rem',
  },
  expertiseTitle: {
    fontSize: '1rem',
    marginBottom: '0.6rem',
    color: '#3fd0c9',
  },
  expertiseText: {
    color: '#8fa1ac',
    fontSize: '0.9rem',
  },
  projectsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '1.5rem',
  },
  projectCard: {
    borderLeft: '2px solid #3fd0c9',
    paddingLeft: '1.2rem',
  },
  projectTitle: {
    fontSize: '1.1rem',
    marginBottom: '0.2rem',
  },
  projectTag: {
    fontSize: '0.75rem',
    color: '#3fd0c9',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    marginBottom: '0.6rem',
  },
  projectText: {
    color: '#8fa1ac',
    fontSize: '0.9rem',
  },
  footer: {
    borderTop: '1px solid #1f2b35',
    padding: '2rem 0',
    color: '#5c6b74',
    fontSize: '0.85rem',
  },
}
