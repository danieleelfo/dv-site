import React, { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import bgImage from '../assets/hero.png'
import { projectSlugs, projectNames } from '../data/projects.js'

export default function HomeTest2() {
  const { t } = useTranslation()
  const location = useLocation()
  const { lang } = useParams()
  const [activeNode, setActiveNode] = useState('ai')

  // Recupera la lingua dall'URL:
  // /it       -> it
  // /en       -> en
  // /es       -> es
  // /fr       -> fr
  // /ca       -> ca
  // /nl       -> nl
  const pathLanguage = location.pathname.split('/')[1]

  const supportedLanguages = ['it', 'en', 'es', 'fr', 'ca', 'nl']
  const language = supportedLanguages.includes(pathLanguage)
    ? pathLanguage
    : 'en'

  // Tutti i link interni rispettano automaticamente la lingua corrente.
  const localizedPath = (path) => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`
    return `/${language}${cleanPath}`
  }

  const nodes = {
    humans: {
      title: t('homeTest4.humans.title', 'HUMANS'),
      subtitle: t(
        'homeTest4.humans.subtitle',
        'Intuition, Emotional Intelligence & Narrative Engines'
      ),
      description: t(
        'homeTest4.humans.description',
        'Exploring human cognition through interactive storytelling and creative emergence.'
      ),
      links: [
        {
          label: t(
            'homeTest4.humans.links.nightStories',
            'Night Stories'
          ),
          path: '/night-stories',
        },
        {
          label: t(
            'homeTest4.humans.links.storyTeller',
            'Story Teller'
          ),
          path: '/story-teller',
        },
        {
          label: t(
            'homeTest4.humans.links.barAI',
            'Bar AI'
          ),
          path: '/bar-ai',
        },
      ],
    },

    ai: {
      title: t('homeTest4.ai.title', 'AI Agents'),
      subtitle: t(
        'homeTest4.ai.subtitle',
        'Synthetic Intelligence & Persistent Memory Agents'
      ),
      description: t(
        'homeTest4.ai.description',
        'Autonomous multi-agent architectures running local and cloud inferencing models.'
      ),
      links: [
        {
          label: t(
            'homeTest4.ai.links.emergence',
            'Emergence Experiments'
          ),
          path: '/emergence',
        },
        {
          label: t(
            'homeTest4.ai.links.console',
            'Console Playground'
          ),
          path: '/console',
        },
      ],
    },

    data: {
      title: t('homeTest4.data.title', 'DATA'),
      subtitle: t(
        'homeTest4.data.subtitle',
        'Architectures, Foundations & Distributed Pipelines'
      ),
      description: t(
        'homeTest4.data.description',
        'Enterprise data engineering, BI systems, and scalable infrastructure.'
      ),
      links: [
        {
          label: t(
            'homeTest4.data.links.about',
            'Corporate CV & About'
          ),
          path: '/about',
        },
        {
          label: t(
            'homeTest4.data.links.projects',
            'Data Projects'
          ),
          path: '/projects',
        },
      ],
    },
  }

  const expertiseItems = t('expertise.items', { returnObjects: true })

  return (
    <div style={pageStyles.page}>

      {/* FIXED BACKGROUND */}
      <img
        src={bgImage}
        alt=""
        style={pageStyles.background}
      />

      <div style={pageStyles.backgroundOverlay} />

      <div style={pageStyles.content}>

        {/* ============================================================
            HOMETEST4 — HUMAN / AI / DATA SYSTEM
            ============================================================ */}

        <div style={styles.container}>

          {/* MAIN CONTENT */}
          <div className="container" style={styles.content}>

            {/* HEADER */}
            <header style={styles.header}>
              <p style={styles.systemBadge}>
                Human -🏴‍☠️- AI Agent -🧜🏻‍♀️- Data
              </p>
            </header>

            {/* INTERACTIVE TRIANGLE */}
            <div style={styles.diagramWrapper}>
              <svg
                viewBox="0 0 300 300"
                style={styles.svg}
                aria-label="Human AI Data system"
              >

                {/* BACKGROUND CIRCLES */}
                <circle
                  cx="150"
                  cy="150"
                  r="110"
                  stroke="#1f2b35"
                  strokeWidth="1.5"
                  fill="none"
                />

                <circle
                  cx="150"
                  cy="150"
                  r="125"
                  stroke="#1f2b35"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                  fill="none"
                  opacity="0.5"
                />

                {/* TRIANGLE */}
                <polygon
                  points="150,50 55,215 245,215"
                  stroke="#1f2b35"
                  strokeWidth="2"
                  fill="none"
                />

                {/* ACTIVE CONNECTIONS */}
                {activeNode === 'humans' && (
                  <>
                    <line
                      x1="150"
                      y1="50"
                      x2="55"
                      y2="215"
                      stroke="#3fd0c9"
                      strokeWidth="3"
                      opacity="0.8"
                    />

                    <line
                      x1="150"
                      y1="50"
                      x2="245"
                      y2="215"
                      stroke="#3fd0c9"
                      strokeWidth="3"
                      opacity="0.8"
                    />
                  </>
                )}

                {activeNode === 'ai' && (
                  <>
                    <line
                      x1="55"
                      y1="215"
                      x2="150"
                      y2="50"
                      stroke="#3fd0c9"
                      strokeWidth="3"
                      opacity="0.8"
                    />

                    <line
                      x1="55"
                      y1="215"
                      x2="245"
                      y2="215"
                      stroke="#3fd0c9"
                      strokeWidth="3"
                      opacity="0.8"
                    />
                  </>
                )}

                {activeNode === 'data' && (
                  <>
                    <line
                      x1="245"
                      y1="215"
                      x2="150"
                      y2="50"
                      stroke="#3fd0c9"
                      strokeWidth="3"
                      opacity="0.8"
                    />

                    <line
                      x1="245"
                      y1="215"
                      x2="55"
                      y2="215"
                      stroke="#3fd0c9"
                      strokeWidth="3"
                      opacity="0.8"
                    />
                  </>
                )}

                {/* HUMANS NODE */}
                <g
                  style={{ cursor: 'pointer' }}
                  onClick={() => setActiveNode('humans')}
                  onMouseEnter={() => setActiveNode('humans')}
                >
                  <defs>
                    <filter
                      id="glow-humans"
                      x="-30%"
                      y="-30%"
                      width="160%"
                      height="160%"
                    >
                      <feGaussianBlur
                        stdDeviation="4"
                        result="blur"
                      />

                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  <circle
                    cx="150"
                    cy="50"
                    r="20"
                    fill={
                      activeNode === 'humans'
                        ? '#3fd0c9'
                        : '#0b1015'
                    }
                    stroke="#3fd0c9"
                    strokeWidth="2"
                    filter={
                      activeNode === 'humans'
                        ? 'url(#glow-humans)'
                        : 'none'
                    }
                  />

                  <text
                    x="150"
                    y="54"
                    fill={
                      activeNode === 'humans'
                        ? '#0b1015'
                        : '#fff'
                    }
                    fontSize="10"
                    textAnchor="middle"
                    fontWeight="bold"
                  >
                    HU
                  </text>

                  <text
                    x="150"
                    y="22"
                    fill="#3fd0c9"
                    fontSize="13"
                    textAnchor="middle"
                    fontWeight="600"
                    letterSpacing="1"
                  >
                    HUMANS
                  </text>
                </g>

                {/* AI NODE */}
                <g
                  style={{ cursor: 'pointer' }}
                  onClick={() => setActiveNode('ai')}
                  onMouseEnter={() => setActiveNode('ai')}
                >
                  <defs>
                    <filter
                      id="glow-ai"
                      x="-30%"
                      y="-30%"
                      width="160%"
                      height="160%"
                    >
                      <feGaussianBlur
                        stdDeviation="4"
                        result="blur"
                      />

                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  <circle
                    cx="55"
                    cy="215"
                    r="20"
                    fill={
                      activeNode === 'ai'
                        ? '#3fd0c9'
                        : '#0b1015'
                    }
                    stroke="#3fd0c9"
                    strokeWidth="2"
                    filter={
                      activeNode === 'ai'
                        ? 'url(#glow-ai)'
                        : 'none'
                    }
                  />

                  <text
                    x="55"
                    y="219"
                    fill={
                      activeNode === 'ai'
                        ? '#0b1015'
                        : '#fff'
                    }
                    fontSize="10"
                    textAnchor="middle"
                    fontWeight="bold"
                  >
                    AI
                  </text>

                  <text
                    x="55"
                    y="250"
                    fill="#3fd0c9"
                    fontSize="13"
                    textAnchor="middle"
                    fontWeight="600"
                    letterSpacing="1"
                  >
                    AI
                  </text>
                </g>

                {/* DATA NODE */}
                <g
                  style={{ cursor: 'pointer' }}
                  onClick={() => setActiveNode('data')}
                  onMouseEnter={() => setActiveNode('data')}
                >
                  <defs>
                    <filter
                      id="glow-data"
                      x="-30%"
                      y="-30%"
                      width="160%"
                      height="160%"
                    >
                      <feGaussianBlur
                        stdDeviation="4"
                        result="blur"
                      />

                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  <circle
                    cx="245"
                    cy="215"
                    r="20"
                    fill={
                      activeNode === 'data'
                        ? '#3fd0c9'
                        : '#0b1015'
                    }
                    stroke="#3fd0c9"
                    strokeWidth="2"
                    filter={
                      activeNode === 'data'
                        ? 'url(#glow-data)'
                        : 'none'
                    }
                  />

                  <text
                    x="245"
                    y="219"
                    fill={
                      activeNode === 'data'
                        ? '#0b1015'
                        : '#fff'
                    }
                    fontSize="10"
                    textAnchor="middle"
                    fontWeight="bold"
                  >
                    DA
                  </text>

                  <text
                    x="245"
                    y="250"
                    fill="#3fd0c9"
                    fontSize="13"
                    textAnchor="middle"
                    fontWeight="600"
                    letterSpacing="1"
                  >
                    DATA
                  </text>
                </g>
              </svg>
            </div>

            {/* DYNAMIC CARD */}
            <div style={styles.cardContainer}>
              <div style={styles.card}>

                {/* TERMINAL HEADER */}
                <div style={styles.consoleHeader}>
                  <span style={styles.dotRed} />
                  <span style={styles.dotYellow} />
                  <span style={styles.dotGreen} />

                  <span style={styles.consoleTitle}>
                    terminal // {activeNode.toUpperCase()}
                  </span>
                </div>

                {/* CARD CONTENT */}
                <div style={styles.cardBody}>

                  <h3 style={styles.cardTitle}>
                    {nodes[activeNode].title}
                  </h3>

                  <p style={styles.cardSubtitle}>
                    {nodes[activeNode].subtitle}
                  </p>

                  <p style={styles.cardDesc}>
                    {nodes[activeNode].description}
                  </p>

                  <div style={styles.linkGroup}>
                    {nodes[activeNode].links.map((link) => (
                      <Link
                        key={link.path}
                        to={localizedPath(link.path)}
                        className="home-test2-button"
                      >
                        {link.label} →
                      </Link>
                    ))}
                  </div>

                </div>
              </div>
            </div>

            {/* SIGNATURE + ACTIONS */}
            <div style={styles.signatureRow}>

              <div style={styles.signature}>
                designed and developed by Daniele Villanova
              </div>

              <div style={homeStyles.heroActions}>
                <Link
                  to={lang ? `/${lang}/projects` : '/projects'}
                  style={homeStyles.btnPrimary}
                >
                  {t('hero.viewProjects')}
                </Link>

                <Link
                  to={lang ? `/${lang}#expertise` : '/#expertise'}
                  style={homeStyles.btnGhost}
                >
                  {t('nav.expertise')}
                </Link>

                <a
                  href="#contact"
                  style={homeStyles.btnGhost}
                >
                  {t('hero.contact')}
                </a>
              </div>

            </div>

          </div>
        </div>

        {/* ============================================================
            EXPERTISE
            ============================================================ */}

        <section
          className="section container home-test2-section"
          id="expertise"
          style={{
            borderTop: '1px solid #1f2b35',
          }}
        >
          <p className="section-label">
            {t('expertise.label')}
          </p>

          <h2 className="section-title">
            {t('expertise.title')}
          </h2>

          <div
            className="home-test2-expertise-grid"
            style={homeStyles.expertiseGrid}
          >
            {expertiseItems.map((e, i) => (
              <div
                key={i}
                style={homeStyles.expertiseCard}
              >
                <h3 style={homeStyles.expertiseTitle}>
                  {e.title}
                </h3>

                <p style={homeStyles.expertiseText}>
                  {e.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ============================================================
            SELECTED PROJECTS
            ============================================================ */}

        <section
          className="section container home-test2-section"
          id="projects"
          style={{
            borderTop: '1px solid #1f2b35',
          }}
        >
          <p className="section-label">
            {t('projects.label')}
          </p>

          <h2 className="section-title">
            {t('projects.title')}
          </h2>

          <div
            className="home-test2-projects-grid"
            style={homeStyles.projectsGrid}
          >
            {projectSlugs.map((slug) => (
              <div
                key={slug}
                style={homeStyles.projectCard}
              >
                <h3 style={homeStyles.projectTitle}>
                  {projectNames[slug]}
                </h3>

                <p style={homeStyles.projectTag}>
                  {t(`projectsData.${slug}.tag`)}
                </p>

                <p style={homeStyles.projectText}>
                  {t(`projectsData.${slug}.summary`)}
                </p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '2.5rem' }}>
            <Link
              to={lang ? `/${lang}/projects` : '/projects'}
              style={homeStyles.btnGhost}
            >
              {t('projects.viewAll')} →
            </Link>
          </div>
        </section>

        {/* ============================================================
            ABOUT ME
            ============================================================ */}

        <section
          className="section container home-test2-section"
          id="about"
          style={{
            borderTop: '1px solid #1f2b35',
          }}
        >
          <p className="section-label">
            {t('about.label')}
          </p>

          <h2 className="section-title">
            {t('about.title')}
          </h2>

          <p style={homeStyles.aboutText}>
            {t('about.text')}
          </p>
        </section>

        {/* ============================================================
            CONTACT
            ============================================================ */}

        <section
          className="section container home-test2-section"
          id="contact"
          style={{
            borderTop: '1px solid #1f2b35',
          }}
        >
          <p className="section-label">
            {t('contact.label')}
          </p>

          <h2 className="section-title">
            {t('contact.title')}
          </h2>

          <p style={homeStyles.aboutText}>
            {t('contact.text')}
          </p>

          <a
            href="mailto:daniele@danielevillanova.com"
            style={homeStyles.btnPrimary}
          >
            daniele@danielevillanova.com
          </a>
        </section>

        {/* ============================================================
            FOOTER
            ============================================================ */}

        <footer style={homeStyles.footer}>
          <div className="container">
            © {new Date().getFullYear()} Daniele Villanova
          </div>
        </footer>

      </div>
    </div>
  )
}

const pageStyles = {
  page: {
    position: 'relative',
    minHeight: '100vh',
    background: '#0b1015',
    overflow: 'hidden',
  },

  background: {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center 35%',
    zIndex: 0,
  },

  backgroundOverlay: {
    position: 'fixed',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(11,16,21,0.72) 0%, rgba(11,16,21,0.94) 45%, rgba(11,16,21,0.98) 100%)',
    zIndex: 1,
  },

  content: {
    position: 'relative',
    zIndex: 2,
  },
}

const styles = {
  container: {
    position: 'relative',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    padding: '2rem 1rem',
  },

  content: {
    position: 'relative',
    zIndex: 2,
    textAlign: 'left',
    maxWidth: 950,
    width: '100%',
  },

  header: {
    marginBottom: '0.5rem',
  },

  systemBadge: {
    color: '#3fd0c9',
    fontSize: '0.75rem',
    letterSpacing: '0.15em',
    marginBottom: '0.5rem',
  },

  title: {
    fontSize: 'clamp(1.8rem, 4vw, 2.5rem)',
    fontFamily: 'var(--serif)',
    fontWeight: 400,
    marginBottom: '0.5rem',
  },

  subtitle: {
    color: '#8fa1ac',
    fontSize: '0.95rem',
  },

  diagramWrapper: {
    width: 260,
    height: 260,
    margin: '1rem auto',
  },

  svg: {
    width: '100%',
    height: '100%',
  },

  cardContainer: {
    marginTop: '0.8rem',
  },

  card: {
    background: 'rgba(11, 16, 21, 0.85)',
    border: '1px solid #1f2b35',
    borderRadius: 8,
    overflow: 'hidden',
    backdropFilter: 'blur(10px)',
  },

  consoleHeader: {
    background: '#121a22',
    padding: '0.5rem 1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    borderBottom: '1px solid #1f2b35',
  },

  dotRed: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#ff5f56',
  },

  dotYellow: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#ffbd2e',
  },

  dotGreen: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#27c93f',
  },

  consoleTitle: {
    color: '#8fa1ac',
    fontSize: '0.75rem',
    marginLeft: 'auto',
    fontFamily: 'monospace',
  },

  cardBody: {
    padding: '1.2rem 2rem 1.3rem',
  },

  cardTitle: {
    color: '#3fd0c9',
    fontSize: '1.1rem',
    fontFamily: 'monospace',
    marginBottom: '0.3rem',
  },

  cardSubtitle: {
    color: '#fff',
    fontSize: '0.9rem',
    marginBottom: '0.5rem',
    fontWeight: 600,
  },

  cardDesc: {
    color: '#8fa1ac',
    fontSize: '0.85rem',
    marginBottom: '1rem',
    lineHeight: '1.4',
  },

  linkGroup: {
    display: 'flex',
    gap: '0.8rem',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },

  signatureRow: {
    marginTop: '1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
  },

  signature: {
    color: '#5c6b74',
    fontSize: '0.65rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
}

const homeStyles = {
  heroActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '0.6rem',
    flexWrap: 'wrap',
  },

  btnPrimary: {
    background: '#3fd0c9',
    color: '#0b1015',
    padding: '0.45rem 0.9rem',
    border: '1px solid #3fd0c9',
    borderRadius: '4px',
    fontWeight: 600,
    fontSize: '0.72rem',
    display: 'inline-block',
  },

  btnGhost: {
    border: '1px solid #3fd0c9',
    color: '#3fd0c9',
    padding: '0.45rem 0.9rem',
    borderRadius: '4px',
    fontWeight: 600,
    fontSize: '0.72rem',
    display: 'inline-block',
  },

  aboutText: {
    color: '#b7c5cc',
    fontSize: '1.05rem',
    maxWidth: 720,
  },

  expertiseGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: '0.75rem',
  },

  expertiseCard: {
    background: 'rgba(18, 26, 34, 0.85)',
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
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '0.75rem',
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
