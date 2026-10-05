import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import Home from './pages/Home.jsx'
import Projects from './pages/Projects.jsx'
import Console from './pages/Console.jsx'
import Nav from './components/Nav.jsx'

// Pagine ufficiali (copie dei sandbox)
import AI_Lab from './pages/AI_Lab.jsx'
import B2B from './pages/B2B.jsx'

// Sandbox
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
 *
 * UFFICIALI (nella nav)
 *   Home           -> Home.jsx          (/:lang)
 *   Projects       -> Projects.jsx      (/:lang/projects)
 *   AI Lab         -> AI_Lab.jsx        (/ai-lab e /:lang/ai-lab)   [sandbox: HomeTest2 su /test2]
 *   Leles          -> LeleAdmin.jsx     (/leles e /:lang/leles)
 *   B2B            -> B2B.jsx           (/b2b e /:lang/b2b)         [sandbox: HomeTest3 su /test3]
 *   Trial          -> Console.jsx       (/:lang/console)
 *
 * SANDBOX (bottoni test in LeleAdmin)
 *   test   -> HomeTest.jsx      (/test e /:lang/test)
 *   test2  -> HomeTest2.jsx     (/test2 e /:lang/test2)
 *   test3  -> HomeTest3.jsx     (/test3 e /:lang/test3)
 *   test4  -> HomeTest4.jsx     (/test4 e /:lang/test4)  — Bot-to-bot OLD, da archiviare
 *   test5  -> ConsoleTest.jsx   (/test5 e /:lang/test5)
 *   test6  -> ProjectTest.jsx   (/test6 e /:lang/test6)
 *
 * ALTRO
 *   ConsoleTestALL.jsx (NON importata) — da archiviare
 *   LeleAdmin alias: /LeleAdmin
 */

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/en" replace />} />

        {/* ===== HOME ===== */}
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

        {/* ===== AI LAB (ufficiale) — AI_Lab.jsx ===== */}
        <Route
          path="/ai-lab"
          element={
            <>
              <Nav />
              <AI_Lab />
            </>
          }
        />
        <Route
          path="/:lang/ai-lab"
          element={
            <>
              <Nav />
              <LangWrapper>
                <AI_Lab />
              </LangWrapper>
            </>
          }
        />

        {/* ===== LELES (ufficiale) — LeleAdmin.jsx ===== */}
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
          path="/:lang/leles"
          element={
            <>
              <Nav />
              <LangWrapper>
                <LeleAdmin />
              </LangWrapper>
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

        {/* ===== B2B (ufficiale) — B2B.jsx ===== */}
        <Route
          path="/b2b"
          element={
            <>
              <Nav />
              <B2B />
            </>
          }
        />
        <Route
          path="/:lang/b2b"
          element={
            <>
              <Nav />
              <LangWrapper>
                <B2B />
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

        {/* ================= SANDBOX ================= */}

        {/* test — HomeTest.jsx */}
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

        {/* test2 — HomeTest2.jsx (AI Lab sandbox) */}
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

        {/* test3 — HomeTest3.jsx (B2B sandbox) */}
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

        {/* test4 — HomeTest4.jsx (Bot-to-bot OLD) */}
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

        {/* test5 — ConsoleTest.jsx */}
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

        {/* test6 — ProjectTest.jsx */}
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
      </Routes>
    </BrowserRouter>
  )
}
