import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Home from './pages/Home.jsx'
import HomeTest from './pages/HomeTest.jsx'
import Projects from './pages/Projects.jsx'
import Console from './pages/Console.jsx'
import Nav from './components/Nav.jsx'

const SUPPORTED_LANGS = ['en', 'it', 'es', 'fr', 'ca', 'nl']

function LangWrapper({ children }) {
  const { lang } = useParams()
  const { i18n } = useTranslation()

  useEffect(() => {
    if (lang && SUPPORTED_LANGS.includes(lang) && i18n.language !== lang) {
      i18n.changeLanguage(lang)
    }
  }, [lang, i18n])

  if (lang && !SUPPORTED_LANGS.includes(lang)) {
    return <Navigate to="/en" replace />
  }

  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/en" replace />} />
        
        {/* ROTTA DI TEST SENZA PREFISSO DI LINGUA */}
        <Route
          path="/test"
          element={
            <>
              <Nav />
              <HomeTest />
            </>
          }
        />

        <Route
          path="/:lang"
          element={
            <>
              <Nav />
              <LangWrapper>
                <Home />
              </LangWrapper>
            </>
          }
        />

        {/* ROTTA DI TEST CON LINGUA (es. /en/test, /it/test) */}
        <Route
          path="/:lang/test"
          element={
            <>
              <Nav />
              <LangWrapper>
                <HomeTest />
              </LangWrapper>
            </>
          }
        />

        <Route
          path="/:lang/projects"
          element={
            <>
              <Nav />
              <LangWrapper>
                <Projects />
              </LangWrapper>
            </>
          }
        />
        <Route
          path="/:lang/console"
          element={
            <>
              <Nav />
              <LangWrapper>
                <Console />
              </LangWrapper>
            </>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
