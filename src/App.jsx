import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import Home from './pages/Home.jsx'
import Projects from './pages/Projects.jsx'
import Console from './pages/Console.jsx'
import Nav from './components/Nav.jsx'

import HomeTest from './pages/HomeTest.jsx'
import HomeTest2 from './pages/HomeTest2.jsx'
import HomeTest3 from './pages/HomeTest3.jsx'
import HomeTest4 from './pages/HomeTest4.jsx'

import ProjectTest from './pages/ProjectTest.jsx'
import LeleAdmin from './pages/LeleAdmin.jsx'
import ConsoleTest from './pages/ConsoleTest.jsx'

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

        {/* ROTTA DI TEST CON LINGUA */}
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
          path="/test4"
          element={
            <>
              <Nav />
              <HomeTest4 />
            </>
          }
        />

        <Route
          path="/:lang/test4"
          element={
            <>
              <Nav />
              <LangWrapper>
                <HomeTest4 />
              </LangWrapper>
            </>
          }
        />

        {/* =========================================================
            TEST 5 — NUOVA CONSOLE LELES
            ========================================================= */}
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

        {/* TEST 6 -> ProjectTest */}
        <Route
          path="/test6"
          element={
            <>
              <Nav />
              <ProjectTest />
            </>
          }
        />

        <Route
          path="/:lang/test6"
          element={
            <>
              <Nav />
              <LangWrapper>
                <ProjectTest />
              </LangWrapper>
            </>
          }
        />

        {/* =========================================================
            LELE ADMIN ORIGINALE — NON TOCCATO
            ========================================================= */}
        <Route
          path="/leles"
          element={
            <>
              <Nav />
              <LeleAdmin />
            </>
          }
        />

        {/* alias per comodità */}
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