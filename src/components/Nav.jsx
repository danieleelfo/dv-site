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
            width="52"
            height="36"
            viewBox="0 0 110 70"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block' }}
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