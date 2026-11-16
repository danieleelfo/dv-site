import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import './NavTest4.css'

const languages = [
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'it', flag: '🇮🇹', label: 'Italiano' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'ca', flag: null, label: 'Català' },
  { code: 'nl', flag: '🇳🇱', label: 'Nederlands' },
]

const groups = [
  {
    id: 'explore', label: 'Explore',
    links: [
      ['Home', '', 'nav.home'], ['Projects', '/projects', 'nav.projects'], ['Games', '/games'],
    ],
  },
  {
    id: 'trial', label: 'AI & Trial',
    links: [
      ['AI Lab', '/ai-lab'], ['B2B', '/b2b'], ['AI News', '/ai-ethics'],
      ['Trial', '/console', 'nav.trial'], ['ImgLab', '/image-lab'],
    ],
  },
  {
    id: 'admin', label: 'Admin',
    links: [
      ['Leles', '/leles'], ['Improve', '/improve'], ['QueryDB', '/querydb'],
      ['API Contracts', '/api-contracts'], ['DAG Admin', '/dag-admin'],
      ['DagForge', '/dagforge'], ['Git Admin', '/git-admin'],
      ['Bar AI Admin', '/bar-ai-admin'], ['News Admin', '/news-admin'],
      ['I18n Admin', '/i18n-admin'],
      ['Test', '/test'], ['Test2', '/test2'], ['Test3', '/test3'],
      ['Test5', '/test5'], ['Test6', '/test6'],
      ['Test7', '/test7'], ['TestBarAI', '/testbarai'],
      ['ImgLab Test · OCR (Test8)', '/test8'],
    ],
  },
]

export default function NavTest4() {
  const { i18n, t } = useTranslation()
  const { lang } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const activeLang = lang || (i18n.language || 'en').slice(0, 2)
  const [openGroup, setOpenGroup] = useState(null)
  const groupsRef = useRef(null)

  // Chiude il menu con un tap/click fuori o con Esc.
  useEffect(() => {
    if (!openGroup) return
    function onPointerDown(e) {
      if (groupsRef.current && !groupsRef.current.contains(e.target)) setOpenGroup(null)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpenGroup(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openGroup])

  function changeLanguage(code) {
    const parts = location.pathname.split('/').filter(Boolean)
    const supported = languages.map(x => x.code)
    if (parts.length && supported.includes(parts[0])) parts[0] = code
    else parts.unshift(code)
    navigate('/' + parts.join('/') + location.search + location.hash)
  }

  return (
    <header className="nav4-header">
      <div className="nav4-main">
        <Link className="nav4-logo" to={'/' + activeLang} aria-label="Home">LELES<span> · DV</span></Link>
        <nav className="nav4-groups" aria-label="Main navigation" ref={groupsRef}>
          {groups.map(group => (
            <div className="nav4-group" key={group.id}>
              <button
                type="button"
                className={openGroup === group.id ? 'nav4-group-btn active' : 'nav4-group-btn'}
                aria-expanded={openGroup === group.id}
                onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}
              >
                {group.label}<span className="nav4-chevron">⌄</span>
              </button>
              {openGroup === group.id && (
                <div className="nav4-panel">
                  {group.links.map(([label, path, key]) => (
                    <Link key={path} to={'/' + activeLang + path} onClick={() => setOpenGroup(null)}>
                      {key ? t(key, label) : label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
      <div className="nav4-language-row" aria-label="Choose language">
        {languages.map(item => (
          <button
            key={item.code}
            type="button"
            className={activeLang === item.code ? 'nav4-language active' : 'nav4-language'}
            aria-label={item.label}
            aria-pressed={activeLang === item.code}
            title={item.label}
            onClick={() => changeLanguage(item.code)}
          >
            {item.code === 'ca' ? (
              <svg className="nav4-senyera" viewBox="0 0 30 20" role="img" aria-label="Senyera catalana">
                <rect width="30" height="20" fill="#FCDD09" />
                {[2, 6, 10, 14].map(y => <rect key={y} y={y} width="30" height="2" fill="#DA121A" />)}
              </svg>
            ) : <span>{item.flag}</span>}
            <small>{item.code.toUpperCase()}</small>
          </button>
        ))}
      </div>
    </header>
  )
}
