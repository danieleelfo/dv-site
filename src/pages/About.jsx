// ============================================================
// About: About me + Expertise (spostati dalla Home)
// ============================================================

import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import bgImage from '../assets/hero.png'

export default function About() {
  const { t } = useTranslation()
  const { lang } = useParams()
  const expertiseItems = t('expertise.items', { returnObjects: true }) || []

  return (
    <div style={pageStyles.page}>
      <img src={bgImage} alt="" style={pageStyles.background} />
      <div style={pageStyles.backgroundOverlay} />

      <div style={pageStyles.content}>
        <section className="section container home-section" id="about" style={{ maxWidth: 950, margin: '0 auto' }}>
          <p className="section-label">{t('about.label')}</p>
          <h2 className="section-title">{t('about.title')}</h2>
          <p style={homeStyles.aboutText}>{t('about.text')}</p>
        </section>

        <section className="section container home-section" id="expertise" style={{ maxWidth: 950, margin: '0 auto', borderTop: '1px solid #1f2b35' }}>
          <p className="section-label">{t('expertise.label')}</p>
          <h2 className="section-title">{t('expertise.title')}</h2>
          <div className="home-expertise-grid" style={homeStyles.expertiseGrid}>
            {Array.isArray(expertiseItems) && expertiseItems.map((e, i) => (
              <div key={i} style={homeStyles.expertiseCard}>
                <h3 style={homeStyles.expertiseTitle}>{e.title}</h3>
                <p style={homeStyles.expertiseText}>{e.text}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="container" style={homeStyles.heroActions}>
          <Link to={lang ? `/${lang}` : '/'} style={homeStyles.btnGhost}>
            {t('nav.home')}
          </Link>
          <Link to={lang ? `/${lang}/projects` : '/projects'} style={homeStyles.btnGhost}>
            {t('hero.viewProjects')}
          </Link>
          <Link to={lang ? `/${lang}/contact` : '/contact'} style={homeStyles.btnPrimary}>
            {t('hero.contact')}
          </Link>
        </div>
      </div>
    </div>
  )
}

const pageStyles = {
  page: { position: 'relative', minHeight: '100vh', background: '#0b1015', overflow: 'hidden' },
  background: { position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 35%', zIndex: 0 },
  backgroundOverlay: { position: 'fixed', inset: 0, background: 'linear-gradient(180deg, rgba(11,16,21,0.45) 0%, rgba(11,16,21,0.60) 45%, rgba(11,16,21,0.78) 100%)', zIndex: 1 },
  content: { position: 'relative', zIndex: 2 },
}

const homeStyles = {
  heroActions: { maxWidth: 950, margin: '0 auto', padding: '0 1rem 4rem', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' },
  aboutText: { color: '#b7c5cc', fontSize: '1.05rem', maxWidth: 720 },
  expertiseGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '0.75rem' },
  expertiseCard: { background: 'rgba(18, 26, 34, 0.85)', border: '1px solid #1f2b35', borderRadius: 10, padding: '1.5rem' },
  expertiseTitle: { fontSize: '1rem', marginBottom: '0.6rem', color: '#3fd0c9' },
  expertiseText: { color: '#8fa1ac', fontSize: '0.9rem' },
  btnPrimary: { background: '#3fd0c9', color: '#0b1015', padding: '0.65rem 0.8rem', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem', display: 'inline-block' },
  btnGhost: { border: '1px solid #3fd0c9', color: '#3fd0c9', padding: '0.65rem 0.8rem', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem', display: 'inline-block' },
}
