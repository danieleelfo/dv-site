import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher.jsx'

export default function Nav() {
  const { t } = useTranslation()
  const { lang } = useParams()

  return (
    <header style={styles.header}>
      <div className="container" style={styles.bar}>
        <Link to={lang ? "/" + lang : "/"} style={styles.logo}>
          <svg
            width="180"
            height="42"
            viewBox="0 0 220 70"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block' }}
            aria-label="Human · AI · Data"
          >
            {/* Cerchio centrale (testa) */}
            <circle cx="110" cy="35" r="18" stroke="#3fd0c9" strokeWidth="1.8" fill="#0b1015" />
            
            {/* Circuiti sulla testa */}
            <path d="M102 28 Q110 22 118 28" stroke="#3fd0c9" strokeWidth="1.2" fill="none" opacity="0.7" />
            <path d="M100 35 H120" stroke="#3fd0c9" strokeWidth="1" opacity="0.5" />
            
            {/* Occhio sinistro (benda hi-tech) */}
            <circle cx="103" cy="33" r="4.5" stroke="#3fd0c9" strokeWidth="1.5" fill="#0b1015" />
            <circle cx="103" cy="33" r="1.8" fill="#3fd0c9" opacity="0.4" />
            
            {/* Occhio destro (glow) */}
            <circle cx="117" cy="33" r="4.2" fill="#3fd0c9" />
            <circle cx="117" cy="33" r="2" fill="#0b1015" />
            
            {/* Sorriso leggero */}
            <path d="M105 41 Q110 45 115 41" stroke="#3fd0c9" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            
            {/* Gamba in alto */}
            <path d="M110 17 L110 8 Q110 4 114 4 L118 8 L114 12" stroke="#e0e8ec" strokeWidth="2" fill="none" strokeLinejoin="round" />
            <circle cx="110" cy="17" r="2.5" fill="#3fd0c9" />
            
            {/* Gamba in basso a sinistra */}
            <path d="M95 48 L82 58 Q78 62 82 66 L90 62 L88 54" stroke="#e0e8ec" strokeWidth="2" fill="none" strokeLinejoin="round" />
            <circle cx="95" cy="48" r="2.5" fill="#3fd0c9" />
            
            {/* Gamba in basso a destra */}
            <path d="M125 48 L138 58 Q142 62 138 66 L130 62 L132 54" stroke="#e0e8ec" strokeWidth="2" fill="none" strokeLinejoin="round" />
            <circle cx="125" cy="48" r="2.5" fill="#3fd0c9" />
          </svg>
        </Link>
        <div style={styles.right}>
          <nav style={styles.links}>
            <Link to={lang ? "/" + lang : "/"} style={styles.link}>{t('nav.home')}</Link>
            <Link to={lang ? "/" + lang + "/projects" : "/projects"} style={styles.link}>{t('nav.projects')}</Link>
            <Link to={lang ? "/" + lang + "/console" : "/console"} style={styles.link}>{t('nav.console')}</Link>
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
  },
}