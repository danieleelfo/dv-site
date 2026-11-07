import { useState } from 'react'
import lelesLogo from '../assets/leles-logo.png'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher.jsx'

export default function Nav() {
  const { t, i18n } = useTranslation()
  const { lang } = useParams()

  // Lang sempre nei link: quella dell'URL se presente, altrimenti quella
  // attiva di i18n. Il nav non produce mai URL senza lingua.
  const l = lang || (i18n.language || 'en').slice(0, 2)

  const [logoImgOk, setLogoImgOk] = useState(true)
  const [adminOpen, setAdminOpen] = useState(false)
  const [labOpen, setLabOpen] = useState(false)

  return (
    <header style={styles.header}>
      {/* Rimosso className="container" per permettere al layout di estendersi fino ai bordi */}
      <div style={styles.bar}>
        <Link to={"/" + l} style={styles.logo}>
          {logoImgOk && (
            <img
              src={lelesLogo}
              alt="LELES"
              style={{
                height: 61,
                width: '130px',
                objectFit: 'contain',
                display: 'block',
                marginTop: '-4px',
                marginBottom: '-4px',
                marginLeft: 0,
              }}
              onError={() => setLogoImgOk(false)}
            />
          )}
          {!logoImgOk && (
            <svg
              width="46"
              height="32"
              viewBox="0 0 110 70"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ display: 'block', marginLeft: '-23px' }}
              aria-label="Human · AI · Data"
            >
              {/* Cerchio centrale (testa) */}
              <circle cx="55" cy="35" r="16" stroke="#3fd0c9" strokeWidth="1.8" fill="#0b1015" />

              {/* Circuiti sulla testa */}
              <path d="M48 29 Q55 24 62 29" stroke="#3fd0c9" strokeWidth="1.2" fill="none" opacity="0.7" />

              {/* Occhio sinistro (benda) */}
              <circle cx="49" cy="33" r="4" stroke="#3fd0c9" strokeWidth="1.5" fill="#0b1015" />
              <circle cx="49" cy="33" r="1.6" fill="#3fd0c9" opacity="0.4" />

              {/* Occhio destro (glow) */}
              <circle cx="61" cy="33" r="3.8" fill="#3fd0c9" />
              <circle cx="61" cy="33" r="1.8" fill="#0b1015" />

              {/* Sorriso */}
              <path d="M50 40 Q55 43.5 60 40" stroke="#3fd0c9" strokeWidth="1.3" fill="none" strokeLinecap="round" />

              {/* Gamba in alto */}
              <path d="M55 19 L55 10 Q55 6 58 6 L61 10 L58 14" stroke="#e0e8ec" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
              <circle cx="55" cy="19" r="2.2" fill="#3fd0c9" />

              {/* Gamba basso sinistra */}
              <path d="M43 47 L32 56 Q29 59 32 62 L39 58 L37 51" stroke="#e0e8ec" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
              <circle cx="43" cy="47" r="2.2" fill="#3fd0c9" />

              {/* Gamba basso destra */}
              <path d="M67 47 L78 56 Q81 59 78 62 L71 58 L73 51" stroke="#e0e8ec" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
              <circle cx="67" cy="47" r="2.2" fill="#3fd0c9" />
            </svg>
          )}
        </Link>

        <div style={styles.right}>
          <nav style={styles.links}>
            <Link to={"/" + l} style={styles.link}>{t('nav.home')}</Link>
            <Link to={"/" + l + "/projects"} style={styles.link}>{t('nav.projects')}</Link>
            <Link to={"/" + l + "/ai-ethics"} style={styles.link}>AI News</Link>
            <Link to={"/" + l + "/console"} style={styles.link}>{t('nav.trial')}</Link>
            <Link to={"/" + l + "/image-lab"} style={styles.link}>ImgLab</Link>
            {/* Menu admin Leles: apre tutte le pagine admin */}
            <div
              style={styles.menuWrap}
              onBlur={() => setTimeout(() => setAdminOpen(false), 150)}
            >
              <button
                type="button"
                style={styles.menuBtn}
                onClick={() => { setAdminOpen(o => !o); setLabOpen(false) }}
              >
                Leles &#9662;
              </button>
              {adminOpen && (
                <div style={styles.menu}>
                  <Link to={"/" + l + "/leles"} style={styles.menuLink} onClick={() => setAdminOpen(false)}>Leles</Link>
                  <Link to={"/" + l + "/improve"} style={styles.menuLink} onClick={() => setAdminOpen(false)}>Improve</Link>
                  <Link to={"/" + l + "/querydb"} style={styles.menuLink} onClick={() => setAdminOpen(false)}>QueryDB</Link>
                  <Link to={"/" + l + "/dag-admin"} style={styles.menuLink} onClick={() => setAdminOpen(false)}>DAG Admin</Link>
                  <Link to={"/" + l + "/dagforge"} style={styles.menuLink} onClick={() => setAdminOpen(false)}>DagForge</Link>
                  <Link to={"/" + l + "/git-admin"} style={styles.menuLink} onClick={() => setAdminOpen(false)}>Git Admin</Link>
                  <Link to={"/" + l + "/bar-ai-admin"} style={styles.menuLink} onClick={() => setAdminOpen(false)}>Bar AI Admin</Link>
                  <Link to={"/" + l + "/api-contracts"} style={styles.menuLink} onClick={() => setAdminOpen(false)}>API Contracts</Link>
                </div>
              )}
            </div>
            {/* LabZone: AI Lab, B2B e pagine di test */}
            <div
              style={styles.menuWrap}
              onBlur={() => setTimeout(() => setLabOpen(false), 150)}
            >
              <button
                type="button"
                style={styles.menuBtn}
                onClick={() => { setLabOpen(o => !o); setAdminOpen(false) }}
              >
                LabZone &#9662;
              </button>
              {labOpen && (
                <div style={styles.menu}>
                  <Link to={"/" + l + "/ai-lab"} style={styles.menuLink} onClick={() => setLabOpen(false)}>AI Lab</Link>
                  <Link to={"/" + l + "/b2b"} style={styles.menuLink} onClick={() => setLabOpen(false)}>B2B</Link>
                  <Link to={"/" + l + "/test"} style={styles.menuLink} onClick={() => setLabOpen(false)}>Test</Link>
                  <Link to={"/" + l + "/test2"} style={styles.menuLink} onClick={() => setLabOpen(false)}>Test2</Link>
                  <Link to={"/" + l + "/test3"} style={styles.menuLink} onClick={() => setLabOpen(false)}>Test3</Link>
                  <Link to={"/" + l + "/test4"} style={styles.menuLink} onClick={() => setLabOpen(false)}>Test4</Link>
                  <Link to={"/" + l + "/test5"} style={styles.menuLink} onClick={() => setLabOpen(false)}>Test5</Link>
                  <Link to={"/" + l + "/test6"} style={styles.menuLink} onClick={() => setLabOpen(false)}>Test6</Link>
                  <Link to={"/" + l + "/test7"} style={styles.menuLink} onClick={() => setLabOpen(false)}>Test7</Link>
                  <Link to={"/" + l + "/testbarai"} style={styles.menuLink} onClick={() => setLabOpen(false)}>TestBarAI</Link>
                  <Link to={"/" + l + "/news-admin"} style={styles.menuLink} onClick={() => setLabOpen(false)}>News Admin</Link>
                  <Link to={"/" + l + "/i18n-admin"} style={styles.menuLink} onClick={() => setLabOpen(false)}>I18n Admin</Link>
                </div>
              )}
            </div>
          </nav>
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  )
}

const styles = {
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    background: 'rgba(11,16,21,0.85)',
    backdropFilter: 'blur(8px)',
    borderBottom: '1px solid #1f2b35',
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 64,
    paddingLeft: '1.5rem',
    paddingRight: '1.5rem',
    width: '100%',
    boxSizing: 'border-box',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.5rem',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    textDecoration: 'none',
  },
  links: {
    display: 'flex',
    gap: '2rem',
    fontSize: '0.9rem',
    color: '#8fa1ac',
  },
  link: {
    transition: 'color 0.2s',
    whiteSpace: 'nowrap',
  },
  menuWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  menuBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    color: '#8fa1ac',
    whiteSpace: 'nowrap',
  },
  menu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '10px',
    background: 'rgba(11,16,21,0.97)',
    border: '1px solid #1f2b35',
    borderRadius: '8px',
    padding: '6px 0',
    minWidth: '150px',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 50,
  },
  menuLink: {
    color: '#8fa1ac',
    padding: '6px 16px',
    fontSize: '0.9rem',
    whiteSpace: 'nowrap',
    textDecoration: 'none',
  },
}
