import React, { useState } from 'react'
import { Link } from 'react-router-dom'

export default function HomeTest3() {
  const [activeNode, setActiveNode] = useState('ai')

  const nodes = {
    humans: {
      code: 'NODE // 01',
      title: 'HUMANS',
      tagline: 'INTUITION & NARRATIVE ENGINES',
      desc: 'Esplorazione dell’esperienza umana, della coscienza e dello storytelling generativo.',
      links: [
        { label: 'Night Stories', path: '/night-stories' },
        { label: 'Story Teller', path: '/story-teller' },
      ],
    },
    ai: {
      code: 'NODE // 02',
      title: 'SYNTHETIC AI',
      tagline: 'PERSISTENT MEMORY & AGENTS',
      desc: 'Sistemi multi-agente autonomi, inferenza locale e modelli decisionali emergenti.',
      links: [
        { label: 'Emergence Experiments', path: '/emergence' },
        { label: 'Console', path: '/console' },
      ],
    },
    data: {
      code: 'NODE // 03',
      title: 'DATA FOUNDATION',
      tagline: 'DISTRIBUTED ARCHITECTURES',
      desc: 'Ingegneria dei dati ad alte prestazioni, pipeline complesse e visione aziendale B2B.',
      links: [
        { label: 'About & Corporate CV', path: '/about' },
        { label: 'Data Projects', path: '/projects' },
      ],
    },
  }

  return (
    <div style={styles.viewport}>
      {/* BACKGROUND PARTICLES & HUD GRID */}
      <div style={styles.gridOverlay} />
      
      {/* SCENA CENTRALE: STAGE SCENOGRAFICO GIGANTE */}
      <div style={styles.stage}>
        
        {/* SVG HOLOGRAM GIGANTE */}
        <svg viewBox="0 0 500 500" style={styles.svgHolo}>
          <defs>
            {/* Effetti di bagliore Neon (Glow) */}
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            
            <linearGradient id="cyanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3fd0c9" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#0055ff" stopOpacity="0.2" />
            </linearGradient>
          </defs>

          {/* Anelli esterni d'atmosfera */}
          <circle cx="250" cy="250" r="210" stroke="#1f2b35" strokeWidth="1" fill="none" strokeDasharray="2 6" />
          <circle cx="250" cy="250" r="190" stroke="rgba(63, 208, 201, 0.15)" strokeWidth="1.5" fill="none" />
          <circle cx="250" cy="250" r="180" stroke="url(#cyanGrad)" strokeWidth="1" fill="none" opacity="0.4" />

          {/* Triangolo Geometrico Sacro */}
          <polygon points="250,70 90,350 410,350" stroke="#1f2b35" strokeWidth="2" fill="none" />

          {/* FLUSSI DI ENERGIA ATTIVI AL CLICK */}
          {activeNode === 'humans' && (
            <>
              <line x1="250" y1="70" x2="90" y2="350" stroke="#3fd0c9" strokeWidth="3" filter="url(#glow)" />
              <line x1="250" y1="70" x2="410" y2="350" stroke="#3fd0c9" strokeWidth="3" filter="url(#glow)" />
              <circle cx="250" cy="70" r="45" stroke="#3fd0c9" strokeWidth="1" fill="none" opacity="0.3" />
            </>
          )}

          {activeNode === 'ai' && (
            <>
              <line x1="90" y1="350" x2="250" y2="70" stroke="#3fd0c9" strokeWidth="3" filter="url(#glow)" />
              <line x1="90" y1="350" x2="410" y2="350" stroke="#3fd0c9" strokeWidth="3" filter="url(#glow)" />
              <circle cx="90" cy="350" r="45" stroke="#3fd0c9" strokeWidth="1" fill="none" opacity="0.3" />
            </>
          )}

          {activeNode === 'data' && (
            <>
              <line x1="410" y1="350" x2="250" y2="70" stroke="#3fd0c9" strokeWidth="3" filter="url(#glow)" />
              <line x1="410" y1="350" x2="90" y2="350" stroke="#3fd0c9" strokeWidth="3" filter="url(#glow)" />
              <circle cx="410" cy="350" r="45" stroke="#3fd0c9" strokeWidth="1" fill="none" opacity="0.3" />
            </>
          )}

          {/* NODO 1: HUMANS (VERTICE ALTO) */}
          <g style={{ cursor: 'pointer' }} onClick={() => setActiveNode('humans')}>
            <circle cx="250" cy="70" r="28" fill="#0b1015" stroke="#3fd0c9" strokeWidth={activeNode === 'humans' ? "3" : "1.5"} filter={activeNode === 'humans' ? "url(#glow)" : ""} />
            <circle cx="250" cy="70" r="8" fill="#3fd0c9" opacity={activeNode === 'humans' ? "1" : "0.4"} />
            <text x="250" y="28" fill="#3fd0c9" fontSize="13" textAnchor="middle" fontWeight="800" letterSpacing="3">HUMANS</text>
          </g>

          {/* NODO 2: AI (BASSO SINISTRA) */}
          <g style={{ cursor: 'pointer' }} onClick={() => setActiveNode('ai')}>
            <circle cx="90" cy="350" r="28" fill="#0b1015" stroke="#3fd0c9" strokeWidth={activeNode === 'ai' ? "3" : "1.5"} filter={activeNode === 'ai' ? "url(#glow)" : ""} />
            <circle cx="90" cy="350" r="8" fill="#3fd0c9" opacity={activeNode === 'ai' ? "1" : "0.4"} />
            <text x="90" y="398" fill="#3fd0c9" fontSize="13" textAnchor="middle" fontWeight="800" letterSpacing="3">AI</text>
          </g>

          {/* NODO 3: DATA (BASSO DESTRA) */}
          <g style={{ cursor: 'pointer' }} onClick={() => setActiveNode('data')}>
            <circle cx="410" cy="350" r="28" fill="#0b1015" stroke="#3fd0c9" strokeWidth={activeNode === 'data' ? "3" : "1.5"} filter={activeNode === 'data' ? "url(#glow)" : ""} />
            <circle cx="410" cy="350" r="8" fill="#3fd0c9" opacity={activeNode === 'data' ? "1" : "0.4"} />
            <text x="410" y="398" fill="#3fd0c9" fontSize="13" textAnchor="middle" fontWeight="800" letterSpacing="3">DATA</text>
          </g>
        </svg>

        {/* INFO HUD OVERLAY (TESTO SCENOGRAFICO) */}
        <div style={styles.hudOverlay}>
          <p style={styles.hudCode}>{nodes[activeNode].code}</p>
          <h2 style={styles.hudTitle}>{nodes[activeNode].title}</h2>
          <p style={styles.hudTagline}>{nodes[activeNode].tagline}</p>
          <p style={styles.hudDesc}>{nodes[activeNode].desc}</p>

          <div style={styles.hudActions}>
            {nodes[activeNode].links.map((link, idx) => (
              <Link key={idx} to={link.path} style={styles.hudBtn}>
                EXPLORE {link.label.toUpperCase()} ➔
              </Link>
            ))}
          </div>
        </div>

      </div>

      {/* FOOTER BAR STILE INTERFACCIA VIVO */}
      <footer style={styles.footerHud}>
        <span>DANIELE VILLANOVA // ECOSYSTEM</span>
        <span style={{ color: '#3fd0c9' }}>● SYSTEM LIVE</span>
      </footer>
    </div>
  )
}

const styles = {
  viewport: {
    position: 'relative',
    width: '100vw',
    height: '100vh',
    background: '#06090c',
    color: '#fff',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    fontFamily: '"Courier New", Courier, monospace',
  },
  gridOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'radial-gradient(rgba(63, 208, 201, 0.08) 1px, transparent 0)',
    backgroundSize: '30px 30px',
    pointerEvents: 'none',
  },
  stage: {
    position: 'relative',
    width: '100%',
    maxWidth: '700px',
    height: '600px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  svgHolo: {
    width: '100%',
    height: '100%',
    filter: 'drop-shadow(0px 0px 15px rgba(63, 208, 201, 0.15))',
  },
  hudOverlay: {
    position: 'absolute',
    textAlign: 'center',
    pointerEvents: 'auto',
    maxWidth: '380px',
    background: 'rgba(6, 9, 12, 0.75)',
    padding: '1.5rem',
    borderRadius: '12px',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(63, 208, 201, 0.25)',
    boxShadow: '0 0 30px rgba(0,0,0,0.8)',
  },
  hudCode: { color: '#3fd0c9', fontSize: '0.7rem', letterSpacing: '2px', marginBottom: '0.2rem' },
  hudTitle: { fontSize: '1.8rem', letterSpacing: '3px', margin: '0.2rem 0', color: '#fff' },
  hudTagline: { color: '#8fa1ac', fontSize: '0.75rem', letterSpacing: '1px', marginBottom: '0.8rem', fontWeight: 'bold' },
  hudDesc: { color: '#b7c5cc', fontSize: '0.85rem', lineHeight: '1.4', marginBottom: '1.2rem', fontFamily: 'sans-serif' },
  hudActions: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  hudBtn: {
    background: 'rgba(63, 208, 201, 0.1)',
    border: '1px solid #3fd0c9',
    color: '#3fd0c9',
    padding: '0.6rem 1rem',
    borderRadius: '4px',
    textDecoration: 'none',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    letterSpacing: '1px',
  },
  footerHud: {
    position: 'absolute',
    bottom: '20px',
    width: '90%',
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.7rem',
    letterSpacing: '2px',
    color: '#5c6b74',
    borderTop: '1px solid #1f2b35',
    paddingTop: '10px',
  },
}
