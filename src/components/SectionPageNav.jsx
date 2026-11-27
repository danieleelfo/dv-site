import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const items = [
  { id: 'home', path: '', label: 'nav.home' },
  { id: 'projects', path: '/projects', label: 'hero.viewProjects' },
  { id: 'about', path: '/about', label: 'nav.expertise' },
  { id: 'contact', path: '/contact', label: 'hero.contact' },
]

export default function SectionPageNav({ active }) {
  const { t } = useTranslation()
  const { lang } = useParams()

  return (
    <nav className="section-page-nav" aria-label="Section navigation">
      {items.map((item) => {
        const selected = item.id === active
        const to = lang
          ? (item.path ? `/${lang}${item.path}` : `/${lang}`)
          : (item.path || '/')

        return (
          <Link
            key={item.id}
            to={to}
            className={`section-page-nav__link${selected ? ' is-active' : ''}`}
            aria-current={selected ? 'page' : undefined}
          >
            {t(item.label)}
          </Link>
        )
      })}
    </nav>
  )
}
