// Slot di test libero.
// La pagina che viveva in questo slot (/test, /test4, /test6) è stata
// promossa a progetto con nome e rotta propria.
// Usa questo slot per il prossimo esperimento.

export default function TestSlot({ slot }) {
  return (
    <section className="section container">
      <h2 style={styles.title}>Slot di test {slot} — libero</h2>
      <p style={styles.text}>
        Questo slot è vuoto: la pagina che ci viveva è stata promossa a progetto.
        Percorso disponibile per il prossimo esperimento.
      </p>
    </section>
  )
}

const styles = {
  title: {
    fontSize: '1.4rem',
    marginBottom: '0.6rem',
  },
  text: {
    color: '#8fa1ac',
    fontSize: '0.9rem',
  },
}
