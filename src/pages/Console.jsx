export default function Console() {
  return (
    <section className="section container" style={styles.wrap}>
      <p className="section-label">Private</p>
      <h2 className="section-title">Leles Console</h2>
      <p style={styles.text}>
        Area riservata in costruzione. Presto disponibile con autenticazione dedicata.
      </p>
    </section>
  )
}

const styles = {
  wrap: {
    minHeight: '50vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  },
  text: {
    color: '#8fa1ac',
  },
}
