import { projects } from '../data/projects.js'

export default function Projects() {
  return (
    <section className="section container">
      <p className="section-label">Portfolio</p>
      <h2 className="section-title">Progetti</h2>
      <div style={styles.list}>
        {projects.map((p) => (
          <article key={p.slug} style={styles.card}>
            <h3 style={styles.title}>{p.name}</h3>
            <p style={styles.tag}>{p.tag}</p>
            <p style={styles.text}>{p.summary}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

const styles = {
  list: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '1.75rem',
  },
  card: {
    background: '#121a22',
    border: '1px solid #1f2b35',
    borderRadius: 10,
    padding: '1.75rem',
  },
  title: {
    fontSize: '1.2rem',
    marginBottom: '0.3rem',
  },
  tag: {
    fontSize: '0.75rem',
    color: '#3fd0c9',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    marginBottom: '0.8rem',
  },
  text: {
    color: '#8fa1ac',
    fontSize: '0.9rem',
  },
}
