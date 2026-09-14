import { Link } from 'react-router-dom'
import hero from '../assets/hero.png'
import { projects } from '../data/projects.js'

const expertise = [
  {
    title: 'Data Architecture',
    text: 'Progettazione di piattaforme dati scalabili, da ingestion a serving layer, per contesti enterprise e progetti indipendenti.',
  },
  {
    title: 'Data Vault 2.0',
    text: 'Modellazione hub/link/satellite per data warehouse resilienti al cambiamento, storicizzati e auditabili.',
  },
  {
    title: 'BI & Analytics',
    text: 'Power BI, SSAS, dashboard e scorecard per decision-making — dal dato grezzo all\'insight operativo.',
  },
  {
    title: 'AI / Local AI',
    text: 'Sistemi AI locali, orchestrazione di modelli e automazioni che girano su infrastruttura propria, senza dipendere da cloud terzi.',
  },
  {
    title: 'Multi-Agent Systems',
    text: 'Architetture ad agenti persona-driven con memoria persistente, per assistenti e automazioni complesse.',
  },
]

export default function Home() {
  return (
    <div>
      {/* HERO */}
      <section style={styles.hero}>
        <img src={hero} alt="" style={styles.heroImg} />
        <div style={styles.heroOverlay} />
        <div className="container" style={styles.heroContent}>
          <p className="section-label">Data Architect · BI · AI Systems</p>
          <h1 style={styles.heroTitle}>Daniele Villanova</h1>
          <p style={styles.heroSubtitle}>
            Progetto architetture dati e sistemi AI che funzionano — dalla modellazione
            Data Vault agli agenti multi-AI locali.
          </p>
          <div style={styles.heroActions}>
            <Link to="/projects" style={styles.btnPrimary}>Guarda i progetti</Link>
            <a href="#contact" style={styles.btnGhost}>Contatti</a>
          </div>
        </div>
      </section>

      {/* ABOUT */}
      <section className="section container" id="about">
        <p className="section-label">About</p>
        <h2 className="section-title">Chi sono</h2>
        <p style={styles.aboutText}>
          Sono un consulente IT senior con oltre 20 anni di esperienza in data architecture
          e business intelligence. Lavoro su piattaforme dati enterprise — ETL/streaming,
          modellazione Data Vault 2.0, Power BI, SSAS, Azure — e negli ultimi anni ho spostato
          parte della mia curiosità tecnica verso l'AI applicata: sistemi locali, agenti
          multi-AI con memoria persistente, automazioni che orchestrano modelli e dati senza
          dipendere da infrastrutture cloud di terzi. Lavoro in italiano, spagnolo e inglese.
        </p>
      </section>

      {/* EXPERTISE */}
      <section className="section container" id="expertise" style={{ borderTop: '1px solid #1f2b35' }}>
        <p className="section-label">Expertise</p>
        <h2 className="section-title">Aree di competenza</h2>
        <div style={styles.expertiseGrid}>
          {expertise.map((e) => (
            <div key={e.title} style={styles.expertiseCard}>
              <h3 style={styles.expertiseTitle}>{e.title}</h3>
              <p style={styles.expertiseText}>{e.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SELECTED PROJECTS */}
      <section className="section container" id="projects" style={{ borderTop: '1px solid #1f2b35' }}>
        <p className="section-label">Selected Projects</p>
        <h2 className="section-title">Progetti recenti</h2>
        <div style={styles.projectsGrid}>
          {projects.map((p) => (
            <div key={p.slug} style={styles.projectCard}>
              <h3 style={styles.projectTitle}>{p.name}</h3>
              <p style={styles.projectTag}>{p.tag}</p>
              <p style={styles.projectText}>{p.summary}</p>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '2.5rem' }}>
          <Link to="/projects" style={styles.btnGhost}>Vedi tutti i progetti →</Link>
        </div>
      </section>

      {/* CONTACT */}
      <section className="section container" id="contact" style={{ borderTop: '1px solid #1f2b35' }}>
        <p className="section-label">Contact</p>
        <h2 className="section-title">Parliamone</h2>
        <p style={styles.aboutText}>
          Per collaborazioni, consulenze o semplicemente per scambiare due idee su data
          architecture e AI locale, scrivimi.
        </p>
        <a href="mailto:Dannybydanny@hotmail.com" style={styles.btnPrimary}>
          Dannybydanny@hotmail.com
        </a>
      </section>

      <footer style={styles.footer}>
        <div className="container">© {new Date().getFullYear()} Daniele Villanova</div>
      </footer>
    </div>
  )
}

const styles = {
  hero: {
    position: 'relative',
    minHeight: '85vh',
    display: 'flex',
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  heroImg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  heroOverlay: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(11,16,21,0.35) 0%, rgba(11,16,21,0.75) 60%, rgba(11,16,21,0.97) 100%)',
  },
  heroContent: {
    position: 'relative',
    paddingBottom: '4.5rem',
  },
  heroTitle: {
    fontFamily: 'var(--serif)',
    fontWeight: 400,
    fontSize: 'clamp(2.2rem, 6vw, 4rem)',
    marginBottom: '1rem',
  },
  heroSubtitle: {
    color: '#b7c5cc',
    fontSize: '1.05rem',
    maxWidth: 560,
    marginBottom: '2rem',
  },
  heroActions: {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  btnPrimary: {
    background: '#3fd0c9',
    color: '#0b1015',
    padding: '0.75rem 1.5rem',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: '0.9rem',
    display: 'inline-block',
  },
  btnGhost: {
    border: '1px solid #3fd0c9',
    color: '#3fd0c9',
    padding: '0.75rem 1.5rem',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: '0.9rem',
    display: 'inline-block',
  },
  aboutText: {
    color: '#b7c5cc',
    fontSize: '1.05rem',
    maxWidth: 720,
  },
  expertiseGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '1.5rem',
  },
  expertiseCard: {
    background: '#121a22',
    border: '1px solid #1f2b35',
    borderRadius: 10,
    padding: '1.5rem',
  },
  expertiseTitle: {
    fontSize: '1rem',
    marginBottom: '0.6rem',
    color: '#3fd0c9',
  },
  expertiseText: {
    color: '#8fa1ac',
    fontSize: '0.9rem',
  },
  projectsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '1.5rem',
  },
  projectCard: {
    borderLeft: '2px solid #3fd0c9',
    paddingLeft: '1.2rem',
  },
  projectTitle: {
    fontSize: '1.1rem',
    marginBottom: '0.2rem',
  },
  projectTag: {
    fontSize: '0.75rem',
    color: '#3fd0c9',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    marginBottom: '0.6rem',
  },
  projectText: {
    color: '#8fa1ac',
    fontSize: '0.9rem',
  },
  footer: {
    borderTop: '1px solid #1f2b35',
    padding: '2rem 0',
    color: '#5c6b74',
    fontSize: '0.85rem',
  },
}
