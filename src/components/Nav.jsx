import { Link } from 'react-router-dom'

export default function Nav() {
  return (
    <header style={styles.header}>
      <div className="container" style={styles.bar}>
        <Link to="/" style={styles.logo}>
          D. VILLANOVA
        </Link>
        <nav style={styles.links}>
          <Link to="/" style={styles.link}>Home</Link>
          <Link to="/projects" style={styles.link}>Projects</Link>
          <Link to="/console" style={styles.link}>Console</Link>
        </nav>
      </div>
    </header>
  )
}

const styles = {
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    background: 'rgba(11,16,21,0.85)',
    backdropFilter: 'blur(8px)',
    borderBottom: '1px solid #1f2b35',
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 64,
  },
  logo: {
    fontSize: '0.9rem',
    letterSpacing: '0.1em',
    fontWeight: 600,
  },
  links: {
    display: 'flex',
    gap: '2rem',
    fontSize: '0.9rem',
    color: '#8fa1ac',
  },
  link: {
    transition: 'color 0.2s',
  },
}
