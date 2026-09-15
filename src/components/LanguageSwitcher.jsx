import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'it', label: 'IT' },
  { code: 'es', label: 'ES' },
  { code: 'fr', label: 'FR' },
  { code: 'ca', label: 'CA' },
  { code: 'nl', label: 'NL' },
]

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const current = languages.find((l) => l.code === i18n.language)?.label
    || languages.find((l) => i18n.language.startsWith(l.code))?.label
    || 'EN'

  function selectLang(code) {
    const pathParts = location.pathname.split('/').filter(Boolean)
    pathParts[0] = code
    navigate('/' + pathParts.join('/'))
    setOpen(false)
  }

  return (
    <div ref={ref} style={styles.wrap}>
      <button onClick={() => setOpen(!open)} style={styles.button}>
        {current} ▾
      </button>
      {open && (
        <div style={styles.dropdown}>
          {languages.map((l) => (
            <button
              key={l.code}
              onClick={() => selectLang(l.code)}
              style={{
                ...styles.item,
                color: l.code === i18n.language ? '#3fd0c9' : '#b7c5cc',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const styles = {
  wrap: { position: 'relative' },
  button: {
    background: 'transparent',
    border: '1px solid #1f2b35',
    color: '#b7c5cc',
    borderRadius: 6,
    padding: '0.4rem 0.7rem',
    fontSize: '0.85rem',
    cursor: 'pointer',
  },
  dropdown: {
    position: 'absolute',
    top: '110%',
    right: 0,
    background: '#121a22',
    border: '1px solid #1f2b35',
    borderRadius: 8,
    overflow: 'hidden',
    minWidth: 70,
    zIndex: 20,
  },
  item: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: '0.5rem 0.8rem',
    fontSize: '0.85rem',
    cursor: 'pointer',
  },
}
