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

/*
 * MAPPING PAGINE (definitivo):
 *   Home           -> Home.jsx                 (rotta /:lang)
 *   Projects       -> Projects.jsx             (rotta /:lang/projects)
 *   Trial          -> Console.jsx              (rotta /:lang/console)
 *   Leles          -> HomeTest.jsx             (rotta /test e /:lang/test)
 *   AI Lab         -> HomeTest2.jsx            (rotta /test2 e /:lang/test2)
 *   B2B            -> HomeTest3.jsx            (rotta /test3 e /:lang/test3)
 *   Bot-to-bot OLD -> HomeTest4.jsx            (rotta /test4 e /:lang/test4) — da archiviare
 *   Console Leles  -> ConsoleTest.jsx          (rotta /test5 e /:lang/test5) — da confrontare con Leles
 *   Console old    -> ConsoleTestALL.jsx       (NON importata) — da archiviare
 *   ProjectTest    -> ProjectTest.jsx          (rotta /test6 e /:lang/test6)
 *   Lele Admin     -> LeleAdmin.jsx            (rotta /leles e /LeleAdmin)
 */

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/en" replace />} />

        {/* ===== LELES — HomeTest.jsx ===== */}
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

        {/* ===== AI LAB — HomeTest2.jsx ===== */}
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

        {/* ===== B2B — HomeTest3.jsx ===== */}
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

        {/* ===== BOT-TO-BOT (OLD) — HomeTest4.jsx ===== */}
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

        {/* ===== CONSOLE LELES — ConsoleTest.jsx ===== */}
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

        {/* ===== PROJECT TEST — ProjectTest.jsx ===== */}
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

        {/* ===== LELE ADMIN ORIGINLE — LeleAdmin.jsx ===== */}
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

        {/* ===== PROJECTS — Projects.jsx ===== */}
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

        {/* ===== TRIAL — Console.jsx ===== */}
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
