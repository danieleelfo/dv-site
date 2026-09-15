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
          Website under construction... 🏴‍☠️
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
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
    fontWeight: 600,
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
