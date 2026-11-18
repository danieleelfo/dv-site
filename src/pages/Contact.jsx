// ============================================================
// Contact (spostato dalla Home)
// ============================================================

import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import bgImage from '../assets/hero.png'

export default function Contact() {
  const { t } = useTranslation()
  const { lang } = useParams()
  return (
    <div style={pageStyles.page}>
      <img src={bgImage} alt="" style={pageStyles.background} />
      <div style={pageStyles.backgroundOverlay} />
      <div style={pageStyles.content}>
        <section className="section container home-section" id="contact" style={{ maxWidth: 950, margin: '0 auto' }}>
          <p className="section-label">{t('contact.label')}</p>
          <h2 className="section-title">{t('contact.title')}</h2>
          <p style={homeStyles.aboutText}>{t('contact.text')}</p>
          <a href="mailto:daniele@danielevillanova.com" style={homeStyles.btnPrimary}>
            daniele@danielevillanova.com
          </a>
        </section>

        <div className="container" style={homeStyles.signatureRow}>
          <div style={homeStyles.heroActions}>
          <Link to={lang ? `/${lang}` : '/'} style={homeStyles.btnGhost}>
            {t('nav.home')}
          </Link>
          <Link to={lang ? `/${lang}/projects` : '/projects'} style={homeStyles.btnPrimary}>
            {t('hero.viewProjects')}
          </Link>
          <Link to={lang ? `/${lang}/about` : '/about'} style={homeStyles.btnPrimary}>
            {t('nav.expertise')}
          </Link>
          </div>
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
  signatureRow: {
    marginTop: '1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
  },
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
    padding: '0.65rem 0.8rem',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: '0.8rem',
    display: 'inline-block',
    textDecoration: 'none',
  },
  btnGhost: {
    border: '1px solid #3fd0c9',
    color: '#3fd0c9',
    padding: '0.65rem 0.8rem',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: '0.8rem',
    display: 'inline-block',
    textDecoration: 'none',
  },
  aboutText: { color: '#b7c5cc', fontSize: '1.05rem', maxWidth: 720 },
}
