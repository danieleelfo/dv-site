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
import DagAdmin from './pages/DagAdmin.jsx'
import B2B from './pages/B2B.jsx'

// Sandbox
import Test from './pages/Test.jsx'
import Test2 from './pages/Test2.jsx'
import Test3 from './pages/Test3.jsx'
import Test4 from './pages/Test4.jsx'
import Test5 from './pages/Test5.jsx'
import Test6 from './pages/Test6.jsx'
import TestBarAI from './pages/TestBarAI.jsx'

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

        <Route path="/:lang" element={<><Nav /><LangWrapper><Home /></LangWrapper></>} />
        <Route path="/:lang/projects" element={<><Nav /><LangWrapper><Projects /></LangWrapper></>} />

        <Route path="/ai-lab" element={<><Nav /><AI_Lab /></>} />
        <Route path="/:lang/ai-lab" element={<><Nav /><LangWrapper><AI_Lab /></LangWrapper></>} />

        <Route path="/leles" element={<><Nav /><LeleAdmin /></>} />
        <Route path="/:lang/leles" element={<><Nav /><LangWrapper><LeleAdmin /></LangWrapper></>} />
        <Route path="/LeleAdmin" element={<><Nav /><LeleAdmin /></>} />

        <Route path="/b2b" element={<><Nav /><B2B /></>} />
        <Route path="/:lang/b2b" element={<><Nav /><LangWrapper><B2B /></LangWrapper></>} />

        <Route path="/improve" element={<><Nav /><Improve /></>} />

        {/* DAG Admin: pannello Airflow (già Test2), raggiungibile anche dalla tab in Improve */}
        <Route path="/dag-admin" element={<><Nav /><DagAdmin /></>} />
        <Route path="/:lang/dag-admin" element={<><Nav /><LangWrapper><DagAdmin /></LangWrapper></>} />
        <Route path="/:lang/console" element={<><Nav /><LangWrapper><Console /></LangWrapper></>} />

        <Route path="/test" element={<><Nav /><Test /></>} />
        <Route path="/:lang/test" element={<><Nav /><LangWrapper><Test /></LangWrapper></>} />

        <Route path="/test2" element={<><Nav /><Test2 /></>} />
        <Route path="/:lang/test2" element={<><Nav /><LangWrapper><Test2 /></LangWrapper></>} />

        <Route path="/test3" element={<><Nav /><Test3 /></>} />
        <Route path="/:lang/test3" element={<><Nav /><LangWrapper><Test3 /></LangWrapper></>} />

        <Route path="/test4" element={<><Nav /><Test4 /></>} />
        <Route path="/:lang/test4" element={<><Nav /><LangWrapper><Test4 /></LangWrapper></>} />

        <Route path="/test5" element={<><Nav /><Test5 /></>} />
        <Route path="/:lang/test5" element={<><Nav /><LangWrapper><Test5 /></LangWrapper></>} />

        {/* Test6 resta dedicato agli endpoint admin futuri. */}
        <Route path="/test6" element={<><Nav /><Test6 /></>} />
        <Route path="/:lang/test6" element={<><Nav /><LangWrapper><Test6 /></LangWrapper></>} />

        {/* Bar AI sandbox: usa solo il proxy /api/bar-ai/ask già presente. */}
        <Route path="/testbarai" element={<><Nav /><TestBarAI /></>} />
        <Route path="/:lang/testbarai" element={<><Nav /><LangWrapper><TestBarAI /></LangWrapper></>} />
      </Routes>
    </BrowserRouter>
  )
}
