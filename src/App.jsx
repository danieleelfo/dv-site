import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Projects from './pages/Projects.jsx'
import Console from './pages/Console.jsx'
import Nav from './components/Nav.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/console" element={<Console />} />
      </Routes>
    </BrowserRouter>
  )
}
