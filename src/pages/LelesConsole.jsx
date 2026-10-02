import { Link } from 'react-router-dom'

// Temporary stub — full file will be restored from commit 186d3f6 (ProjectTest.jsx).
// QUICK_LINKS targets: /en/arena, /en/leles-console, /en/emergence

export default function LelesConsole() {
  return (
    <section className="section container" style={{ paddingTop: '5.5rem', textAlign: 'center' }}>
      <h2 style={{ color: '#e8f1f5' }}>Leles Console</h2>
      <p style={{ color: '#8fa1ac', maxWidth: 420, margin: '1rem auto' }}>
        File in ripristino dal commit integro. Nel frattempo usa{' '}
        <Link to="/test5" style={{ color: '#3fd0c9' }}>/test5</Link>
        {' '}o attendi il push completo di ProjectTest.jsx → LelesConsole.jsx.
      </p>
    </section>
  )
}
