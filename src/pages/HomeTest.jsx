import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import bgImage from '../assets/hero.png' // Usa la tua immagine di sfondo

export default function HomeTest() {
  const { t } = useTranslation()
  const [activeNode, setActiveNode] = useState(null)

  const nodes = {
    humans: {
      title: 'HUMANS',
      subtitle: 'Stories, Intuition & Narrative',
      links: [
        { label: 'Night Stories', path: '/night-stories' },
        { label: 'Story Teller', path: '/story-teller' },
      ],
    },
    ai: {
      title: 'AI',
      subtitle: 'Synthetic Intelligence & Multi-Agent Systems',
      links: [
        { label: 'Emergence Experiments', path: '/emergence' },
        { label: 'Console Playground', path: '/console' },
      ],
    },
    data: {
      title: 'DATA',
      subtitle: 'Architectures, Foundations & Engineering',
      links: [
        { label: 'About & Corporate CV', path: '/about' },
        { label: 'Data Projects', path: '/projects' },
      ],
    },
  }

  return (
    <div style={styles.container}>
      <img src={bgImage} alt="" style={styles.bgImg} />
      <div style={styles.overlay} />

      <div className="container" style={styles.content}>
        {/* HEADER HERO */}
        <header style={styles.header}>
          <p className="section-label">ECOSYSTEM HUB</p>
          <h1 style={styles.title}>Daniele Villanova</h1>
          <p style={styles.subtitle}>
            At the intersection of Human Experience, Artificial Intelligence, and Data Architecture.
          </p>
        </header>

        {/* LOGO INTERATTIVO / DIAGRAMMA A 3 NODI */}
        <div style={styles.diagramWrapper}>
          <svg viewBox="0 0 300 300" style={styles.svg}>
            {/* Cerchio di sfondo */}
            <circle cx="150" cy="150" r="110" stroke="#1f2b35" strokeWidth="2" fill="none" />
            
            {/* Triangolo connettivo */}
            <polygon points="150,50 55,215 245,215" stroke="#3fd0c9" strokeWidth="1.5" fill="none" opacity="0.4" />

            {/* Nodo HUMANS (Alto) */}
            <g
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setActiveNode('humans')}
              onClick={() => setActiveNode('humans')}
            >
              <circle cx="150" cy="50" r="18" fill={activeNode === 'humans' ? '#3fd0c9' : '#121a22'} stroke="#3fd0c9" strokeWidth="2" />
              <text x="150" y="22" fill="#ffffff" fontSize="12" textAnchor="middle" fontWeight="bold">HUMANS</text>
            </g>

            {/* Nodo AI (Basso Sinistra) */}
            <g
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setActiveNode('ai')}
              onClick={() => setActiveNode('ai')}
            >
              <circle cx="55" cy="215" r="18" fill={activeNode === 'ai' ? '#3fd0c9' : '#121a22'} stroke="#3fd0c9" strokeWidth="2" />
              <text x="55" y="248" fill="#ffffff" fontSize="12" textAnchor="middle" fontWeight="bold">AI</text>
            </g>

            {/* Nodo DATA (Basso Destra) */}
            <g
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setActiveNode('data')}
              onClick={() => setActiveNode('data')}
            >
              <circle cx="245" cy="215" r="18" fill={activeNode === 'data' ? '#3fd0c9' : '#121a22'} stroke="#3fd0c9" strokeWidth="2" />
              <text x="245" y="248" fill="#ffffff" fontSize="12" textAnchor="middle" fontWeight="bold">DATA</text>
            </g>
          </svg>
        </div>

        {/* PANNELLO DINAMICO DEI CONTENUTI */}
        <div style={styles.cardContainer}>
          {activeNode ? (
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>{nodes[activeNode].title}</h3>
              <p style={styles.cardSubtitle}>{nodes[activeNode].subtitle}</p>
              <div style={styles.linkGroup}>
                {nodes[activeNode].links.map((link, idx) => (
                  <Link key={idx} to={link.path} style={styles.btnPrimary}>
                    {link.label} →
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <p style={styles.hint}>Passa il mouse o clicca su uno dei 3 nodi per esplorare</p>
          )}
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
    overflow: 'hidden',
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
    background: 'linear-gradient(180deg, rgba(11,16,21,0.5) 0%, rgba(11,16,21,0.92) 100%)',
  },
  content: {
    position: 'relative',
    zIndex: 2,
    textAlign: 'center',
    padding: '2rem 1rem',
    maxWidth: 800,
  },
  header: { marginBottom: '1.5rem' },
  title: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontFamily: 'var(--serif)', fontWeight: 400 },
  subtitle: { color: '#b7c5cc', fontSize: '1rem', marginTop: '0.5rem' },
  diagramWrapper: { width: 280, height: 280, margin: '0 auto' },
  svg: { width: '100%', height: '100%' },
  cardContainer: { minHeight: 140, marginTop: '1.5rem' },
  card: {
    background: 'rgba(18, 26, 34, 0.85)',
    border: '1px solid #3fd0c9',
    borderRadius: 12,
    padding: '1.5rem',
    backdropFilter: 'blur(8px)',
  },
  cardTitle: { color: '#3fd0c9', marginBottom: '0.2rem', fontSize: '1.2rem' },
  cardSubtitle: { color: '#8fa1ac', fontSize: '0.9rem', marginBottom: '1rem' },
  linkGroup: { display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' },
  btnPrimary: {
    background: '#3fd0c9',
    color: '#0b1015',
    padding: '0.5rem 1.2rem',
    borderRadius: 6,
    fontWeight: 600,
    textDecoration: 'none',
    fontSize: '0.85rem',
  },
  hint: { color: '#5c6b74', fontSize: '0.9rem', fontStyle: 'italic' },
}
