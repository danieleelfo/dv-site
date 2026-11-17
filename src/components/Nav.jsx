import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import lelesLogo from '../assets/leles-logo.png'
import './Nav.css'

const languages = [
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
  { code: 'ca', flag: null, label: 'Català' },
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'it', flag: '🇮🇹', label: 'Italiano' },
  { code: 'nl', flag: '🇳🇱', label: 'Nederlands' },
]

const groups = [
  {
    id: 'explore', label: 'Explore', key: 'nav.group.explore',
    links: [
      ['Home', '', 'nav.home'], ['Projects', '/projects', 'nav.projects'], ['Games', '/games', 'nav.games'],
      ['About', '/about', 'about.label'], ['Contact', '/contact', 'contact.label'],
    ],
  },
  {
    id: 'trial', label: 'AI & Trial', key: 'nav.group.trial',
    links: [
      ['AI Lab', '/ai-lab', 'nav.aiLab'], ['B2B', '/b2b', 'nav.b2b'], ['AI News', '/ai-ethics', 'nav.aiNews'],
      ['Trial', '/console', 'nav.trial'], ['ImgLab', '/image-lab', 'nav.imgLab'],
    ],
  },
  {
    id: 'qa', label: 'QA', key: 'nav.group.qa',
    links: [
      ['Test', '/test', 'nav.test'], ['Test2', '/test2', 'nav.test2'], ['Test3', '/test3', 'nav.test3'], ['Test4', '/test4', 'nav.test4'],
      ['Test5', '/test5', 'nav.test5'], ['Test6', '/test6', 'nav.test6'],
      ['Test7', '/test7', 'nav.test7'], ['TestBarAI', '/testbarai', 'nav.testBarAI'],
    ],
  },
  {
    id: 'admin', label: 'Admin', key: 'nav.group.admin',
    links: [
      ['Leles', '/leles', 'nav.leles'], ['Improve', '/improve', 'nav.improve'], ['QueryDB', '/querydb', 'nav.querydb'],
      ['API Contracts', '/api-contracts', 'nav.apiContracts'], ['DAG Admin', '/dag-admin', 'nav.dagAdmin'],
      ['DagForge', '/dagforge', 'nav.dagForge'], ['Git Admin', '/git-admin', 'nav.gitAdmin'],
      ['Bar AI Admin', '/bar-ai-admin', 'nav.barAiAdmin'], ['News Admin', '/news-admin', 'nav.newsAdmin'],
      ['I18n Admin', '/i18n-admin', 'nav.i18nAdmin'],
    ],
  },
]

export default function Nav() {
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
      <div className="nav4-language-row" aria-label="Choose language">
        <Link to={'/' + activeLang} className="nav4-logo" aria-label="Home">
          <img src={lelesLogo} alt="LELES" onError={e => { e.currentTarget.style.display = 'none' }} />
        </Link>
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
      <div className="nav4-main">
        <nav className="nav4-groups" aria-label="Main navigation" ref={groupsRef}>
          {groups.map(group => (
            <div className="nav4-group" key={group.id}>
              <button
                type="button"
                className={openGroup === group.id ? 'nav4-group-btn active' : 'nav4-group-btn'}
                aria-expanded={openGroup === group.id}
                onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}
              >
                {t(group.key, group.label)}<span className="nav4-chevron">⌄</span>
              </button>
              {openGroup === group.id && (
                <div className="nav4-panel">
                  {group.links.map(([label, path, key]) => (
                    <Link key={path} to={'/' + activeLang + path} onClick={() => setOpenGroup(null)}>
                      {t(key, label)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
    </header>
  )
}
