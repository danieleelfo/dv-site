import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import bgImage from '../assets/hero.png'

export default function HomeTest4() {
  const { t } = useTranslation()
  const location = useLocation()
  const [activeNode, setActiveNode] = useState('ai')

  // Recupera la lingua dall'URL:
  // /it       -> it
  // /en       -> en
  // /es       -> es
  // /fr       -> fr
  // /de       -> de
  // /ca       -> ca
  const pathLanguage = location.pathname.split('/')[1]

  const supportedLanguages = ['it', 'en', 'es', 'fr', 'de', 'ca']
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
      title: 'HUMANS',
      subtitle:
        'Intuition, Emotional Intelligence & Narrative Engines',
      description:
        'Exploring human cognition through interactive storytelling and creative emergence.',
      links: [
        {
          label: 'Night Stories',
          path: '/night-stories',
        },
        {
          label: 'Story Teller',
          path: '/story-teller',
        },
        {
          label: 'Bar AI',
          path: '/bar-ai',
        },
      ],
    },

    ai: {
      title: 'AI Agents',
      subtitle:
        'Synthetic Intelligence & Persistent Memory Agents',
      description:
        'Autonomous multi-agent architectures running local and cloud inferencing models.',
      links: [
        {
          label: 'Emergence Experiments',
          path: '/emergence',
        },
        {
          label: 'Console Playground',
          path: '/console',
        },
      ],
    },

    data: {
      title: 'DATA',
      subtitle:
        'Architectures, Foundations & Distributed Pipelines',
      description:
        'Enterprise data engineering, BI systems, and scalable infrastructure.',
      links: [
        {
          label: 'Corporate CV & About',
          path: '/about',
        },
        {
          label: 'Data Projects',
          path: '/projects',
        },
      ],
    },
  }

  return (
    <div style={styles.container}>
      {/* BACKGROUND */}
      <img
        src={bgImage}
        alt="Background"
        style={styles.bgImg}
      />

      <div style={styles.overlay} />

      {/* MAIN CONTENT */}
      <div className="container" style={styles.content}>

        {/* HEADER */}
        <header style={styles.header}>
          <p style={styles.systemBadge}>
            Human -🏴‍☠️- AI Agent -🧜🏻‍♀️- Data
          </p>

          <h1 style={styles.title}>
            Daniele Villanova
          </h1>

          <p style={styles.subtitle}>
            Data Architecture • AI Systems • Human Experience
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
                fontSize="11"
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
                fontSize="11"
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
                fontSize="11"
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
                    className="home-test4-button"
                  >
                    {link.label} →
                  </Link>
                ))}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
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

  bgImg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },

  overlay: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(11,16,21,0.65) 0%, rgba(11,16,21,0.95) 100%)',
  },

  content: {
    position: 'relative',
    zIndex: 2,
    textAlign: 'center',
    maxWidth: 750,
    width: '100%',
  },

  header: {
    marginBottom: '1rem',
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
    marginTop: '1.5rem',
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
    padding: '1.2rem',
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
    marginBottom: '1.2rem',
    lineHeight: '1.4',
  },

  linkGroup: {
    display: 'flex',
    gap: '0.8rem',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
}
