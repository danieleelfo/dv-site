import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import Home from './pages/Home.jsx'
import Projects from './pages/Projects.jsx'
import Console from './pages/Console.jsx'
import Nav from './components/Nav.jsx'

// Pagine ufficiali
import AI_Lab from './pages/AI_Lab.jsx'
import LeleAdmin from './pages/LeleAdmin.jsx'
import Improve from './pages/Improve.jsx'
import DagAdmin from './pages/DagAdmin.jsx'
import GitAdmin from './pages/GitAdmin.jsx'
import B2B from './pages/B2B.jsx'
import ImageLab from './pages/ImageLab.jsx'
import QueryDb from './pages/QueryDb.jsx'
import DagForge from './pages/DagForge.jsx'

// Sandbox
import Test from './pages/Test.jsx'
import Test2 from './pages/Test2.jsx'
import Test7 from './pages/Test7.jsx'
import ApiContracts from './pages/ApiContracts.jsx'
import BarAiAdmin from './pages/BarAiAdmin.jsx'
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
    return null
  }

  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<><Nav /><Home /></>} />

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

        <Route path="/ai-lab" element={<><Nav /><AI_Lab /></>} />
        <Route path="/:lang/ai-lab" element={<><Nav /><LangWrapper><AI_Lab /></LangWrapper></>} />

        <Route path="/leles" element={<><Nav /><LeleAdmin /></>} />
        <Route path="/:lang/leles" element={<><Nav /><LangWrapper><LeleAdmin /></LangWrapper></>} />
        <Route path="/LeleAdmin" element={<><Nav /><LeleAdmin /></>} />

        <Route path="/b2b" element={<><Nav /><B2B /></>} />
        <Route path="/:lang/b2b" element={<><Nav /><LangWrapper><B2B /></LangWrapper></>} />

        <Route path="/improve" element={<><Nav /><Improve /></>} />
        <Route path="/:lang/improve" element={<><Nav /><LangWrapper><Improve /></LangWrapper></>} />

        {/* AI Image Lab: generazione locale con Z-Image-Turbo */}
        <Route path="/image-lab" element={<><Nav /><ImageLab /></>} />
        <Route path="/:lang/image-lab" element={<><Nav /><LangWrapper><ImageLab /></LangWrapper></>} />

        {/* DAG Admin: pannello Airflow */}
        <Route path="/dag-admin" element={<><Nav /><DagAdmin /></>} />
        <Route path="/:lang/dag-admin" element={<><Nav /><LangWrapper><DagAdmin /></LangWrapper></>} />

        {/* Git Admin: console Git con preview e conferma */}

        {/* QueryDB: browser read-only dei database (Leles, Emergence) */}
        <Route path="/querydb" element={<><Nav /><QueryDb /></>} />
        <Route path="/:lang/querydb" element={<><Nav /><LangWrapper><QueryDb /></LangWrapper></>} />

        {/* DagForge: editor per salvare DAG Airflow lunghi (via /api/improve/save) */}
        <Route path="/dagforge" element={<><Nav /><DagForge /></>} />
        <Route path="/:lang/dagforge" element={<><Nav /><LangWrapper><DagForge /></LangWrapper></>} />
        <Route path="/git-admin" element={<><Nav /><GitAdmin /></>} />
        <Route path="/:lang/git-admin" element={<><Nav /><LangWrapper><GitAdmin /></LangWrapper></>} />

        <Route path="/console" element={<><Nav /><Console /></>} />
        <Route path="/:lang/console" element={<><Nav /><LangWrapper><Console /></LangWrapper></>} />

        <Route path="/test" element={<><Nav /><Test /></>} />
        <Route path="/:lang/test" element={<><Nav /><LangWrapper><Test /></LangWrapper></>} />

        <Route path="/test2" element={<><Nav /><Test2 /></>} />
        <Route path="/:lang/test2" element={<><Nav /><LangWrapper><Test2 /></LangWrapper></>} />

        {/* Test7: admin preview isolata, senza modificare Test2 */}
        <Route path="/test7" element={<><Nav /><Test7 /></>} />
        <Route path="/:lang/test7" element={<><Nav /><LangWrapper><Test7 /></LangWrapper></>} />

        {/* API Contracts: riferimento dei contratti API del gateway */}
        <Route path="/api-contracts" element={<><Nav /><ApiContracts /></>} />
        <Route path="/:lang/api-contracts" element={<><Nav /><LangWrapper><ApiContracts /></LangWrapper></>} />

        <Route path="/bar-ai-admin" element={<><Nav /><BarAiAdmin /></>} />
        <Route path="/:lang/bar-ai-admin" element={<><Nav /><LangWrapper><BarAiAdmin /></LangWrapper></>} />

        <Route path="/test3" element={<><Nav /><Test3 /></>} />
        <Route path="/:lang/test3" element={<><Nav /><LangWrapper><Test3 /></LangWrapper></>} />

        <Route path="/test4" element={<><Nav /><Test4 /></>} />
        <Route path="/:lang/test4" element={<><Nav /><LangWrapper><Test4 /></LangWrapper></>} />

        <Route path="/test5" element={<><Nav /><Test5 /></>} />
        <Route path="/:lang/test5" element={<><Nav /><LangWrapper><Test5 /></LangWrapper></>} />

        {/* Test6 resta dedicato agli endpoint admin futuri. */}
        <Route path="/test6" element={<><Nav /><Test6 /></>} />
        <Route path="/:lang/test6" element={<><Nav /><LangWrapper><Test6 /></LangWrapper></>} />

        {/* Bar AI sandbox */}
        <Route path="/testbarai" element={<><Nav /><TestBarAI /></>} />
        <Route path="/:lang/testbarai" element={<><Nav /><LangWrapper><TestBarAI /></LangWrapper></>} />
      </Routes>
    </BrowserRouter>
  )
}
