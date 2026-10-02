import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import Home from './pages/Home.jsx'
import Projects from './pages/Projects.jsx'
import Console from './pages/Console.jsx'
import Nav from './components/Nav.jsx'

// --- PROGETTI PROMOSI (nome e rotta veri) ---
import EmergenceLab from './pages/EmergenceLab.jsx'   // ex HomeTest  (/test)
import AgentArena from './pages/AgentArena.jsx'        // ex HomeTest4 (/test4)
import LelesConsole from './pages/LelesConsole.jsx'   // ex ProjectTest (/test6)

// --- SLOT DI TEST LIBERI (ex pagine promosse) ---
import TestSlot from './pages/TestSlot.jsx'

// --- SLOT DI TEST ATTIVI ---
import HomeTest2 from './pages/HomeTest2.jsx'
import HomeTest3 from './pages/HomeTest3.jsx'
import ConsoleTest from './pages/ConsoleTest.jsx'

import LeleAdmin from './pages/LeleAdmin.jsx'

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

        {/* ============ PROGETTI PROMOSI ============ */}
        <Route
          path="/:lang/emergence"
          element={
            <>
              <Nav />
              <LangWrapper>
                <EmergenceLab />
              </LangWrapper>
            </>
          }
        />

        <Route
          path="/:lang/arena"
          element={
            <>
              <Nav />
              <LangWrapper>
                <AgentArena />
              </LangWrapper>
            </>
          }
        />

        <Route
          path="/:lang/leles-console"
          element={
            <>
              <Nav />
              <LangWrapper>
                <LelesConsole />
              </LangWrapper>
            </>
          }
        />

        {/* ============ SLOT DI TEST LIBERI ============ */}
        <Route
          path="/test"
          element={
            <>
              <Nav />
              <TestSlot slot={1} />
            </>
          }
        />
        <Route
          path="/:lang/test"
          element={
            <>
              <Nav />
              <LangWrapper>
                <TestSlot slot={1} />
              </LangWrapper>
            </>
          }
        />

        <Route
          path="/test4"
          element={
            <>
              <Nav />
              <TestSlot slot={4} />
            </>
          }
        />
        <Route
          path="/:lang/test4"
          element={
            <>
              <Nav />
              <LangWrapper>
                <TestSlot slot={4} />
              </LangWrapper>
            </>
          }
        />

        <Route
          path="/test6"
          element={
            <>
              <Nav />
              <TestSlot slot={6} />
            </>
          }
        />
        <Route
          path="/:lang/test6"
          element={
            <>
              <Nav />
              <LangWrapper>
                <TestSlot slot={6} />
              </LangWrapper>
            </>
          }
        />

        {/* ============ SLOT DI TEST ATTIVI ============ */}
        <Route
          path="/test2"
          element={
            <>
              <Nav />
              <HomeTest2 />
            </>
          }
        />
        <Route
          path="/:lang/test2"
          element={
            <>
              <Nav />
              <LangWrapper>
                <HomeTest2 />
              </LangWrapper>
            </>
          }
        />

        <Route
          path="/test3"
          element={
            <>
              <Nav />
              <HomeTest3 />
            </>
          }
        />
        <Route
          path="/:lang/test3"
          element={
            <>
              <Nav />
              <LangWrapper>
                <HomeTest3 />
              </LangWrapper>
            </>
          }
        />

        <Route
          path="/test5"
          element={
            <>
              <Nav />
              <ConsoleTest />
            </>
          }
        />
        <Route
          path="/:lang/test5"
          element={
            <>
              <Nav />
              <LangWrapper>
                <ConsoleTest />
              </LangWrapper>
            </>
          }
        />

        {/* ============ LELE ADMIN ============ */}
        <Route
          path="/leles"
          element={
            <>
              <Nav />
              <LeleAdmin />
            </>
          }
        />
        <Route
          path="/LeleAdmin"
          element={
            <>
              <Nav />
              <LeleAdmin />
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
