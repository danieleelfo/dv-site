import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import Home from './pages/Home.jsx'
import Projects from './pages/Projects.jsx'
import Console from './pages/Console.jsx'
import Nav from './components/Nav.jsx'

// Pagine ufficiali (copie dei sandbox)
import AI_Lab from './pages/AI_Lab.jsx'
import LeleAdmin from './pages/LeleAdmin.jsx'
import Improve from './pages/Improve.jsx'
import B2B from './pages/B2B.jsx'

// Sandbox
import Test from './pages/Test.jsx'
import Test2 from './pages/Test2.jsx'
import Test3 from './pages/Test3.jsx'
import Test4 from './pages/Test4.jsx'
import Test5 from './pages/Test5.jsx'
import Test6 from './pages/Test6.jsx'

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
 *   AI Lab         -> AI_Lab.jsx        (/ai-lab e /:lang/ai-lab)
 *   Leles          -> LeleAdmin.jsx     (/leles e /:lang/leles)
 *   B2B            -> B2B.jsx           (/b2b e /:lang/b2b)
 *   Trial          -> Console.jsx       (/:lang/console)
 *
 * SANDBOX (bottoni test in LeleAdmin)
 *   test   -> Test.jsx      (/test e /:lang/test)
 *   test2  -> Test2.jsx     (/test2 e /:lang/test2)
 *   test3  -> Test3.jsx     (/test3 e /:lang/test3)
 *   test4  -> Test4.jsx     (/test4 e /:lang/test4)  — Bot-to-bot OLD, da archiviare
 *   test5  -> Test5.jsx   (/test5 e /:lang/test5)
 *   test6  -> Test6.jsx   (/test6 e /:lang/test6)
 *
 * ALTRO
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

        {/* ===== IMPROVE — Improve.jsx ===== */}
        <Route
          path="/improve"
          element={
            <>
              <Nav />
              <Improve />
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

        {/* test — Test.jsx */}
        <Route
          path="/test"
          element={
            <>
              <Nav />
              <Test />
            </>
          }
        />
        <Route
          path="/:lang/test"
          element={
            <>
              <Nav />
              <LangWrapper>
                <Test />
              </LangWrapper>
            </>
          }
        />

        {/* test2 — Test2.jsx  */}
        <Route
          path="/test2"
          element={
            <>
              <Nav />
              <Test2 />
            </>
          }
        />
        <Route
          path="/:lang/test2"
          element={
            <>
              <Nav />
              <LangWrapper>
                <Test2 />
              </LangWrapper>
            </>
          }
        />

        {/* test3 — Test3.jsx */}
        <Route
          path="/test3"
          element={
            <>
              <Nav />
              <Test3 />
            </>
          }
        />
        <Route
          path="/:lang/test3"
          element={
            <>
              <Nav />
              <LangWrapper>
                <Test3 />
              </LangWrapper>
            </>
          }
        />

        {/* test4 — Test4.jsx  */}
        <Route
          path="/test4"
          element={
            <>
              <Nav />
              <Test4 />
            </>
          }
        />
        <Route
          path="/:lang/test4"
          element={
            <>
              <Nav />
              <LangWrapper>
                <Test4 />
              </LangWrapper>
            </>
          }
        />

        {/* test5 — Test5.jsx */}
        <Route
          path="/test5"
          element={
            <>
              <Nav />
              <Test5 />
            </>
          }
        />
        <Route
          path="/:lang/test5"
          element={
            <>
              <Nav />
              <LangWrapper>
                <Test5 />
              </LangWrapper>
            </>
          }
        />

        {/* test6 — Test6.jsx */}
        <Route
          path="/test6"
          element={
            <>
              <Nav />
                <Test6 />
            </>
          }
        />
        <Route
          path="/:lang/test6"
          element={
            <>
              <Nav />
              <LangWrapper>
                <Test6 />
              </LangWrapper>
            </>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
