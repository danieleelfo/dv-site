// Pannello "stato sistema" riutilizzabile: parser di `status sistema`
// + tessere. Estratto da LeleAdmin per integrarlo in qualsiasi pagina.
// ------------------------------------------------------------------
// Dashboard "Sistema": parser del testo di `status sistema` + tessere.
// ------------------------------------------------------------------
const SYS_SECTIONS = {
  'Projects': 'Progetti',
  'Shared Services': 'Servizi',
  'Models': 'Modelli',
}

// Trasforma l'output testuale di "status sistema" in dati per le tessere.
// Ritorna null se il formato non è riconosciuto (si ripiega sul testo).
function parseSystem(text) {
  if (!text) return null
  const sections = []
  let cur = null
  let git = null
  let inGit = false

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || /^[\u2500-]+$/.test(line)) continue

    if (SYS_SECTIONS[line]) {
      cur = { title: SYS_SECTIONS[line], items: [] }
      sections.push(cur)
      inGit = false
      continue
    }
    if (line === 'Git') {
      git = { branch: '', status: '', clean: false, files: [] }
      cur = null
      inGit = true
      continue
    }

    if (inGit && git) {
      if (line.startsWith('Branch:')) git.branch = line.slice(7).trim()
      else if (line.startsWith('Status:')) {
        git.status = line.slice(7).trim()
        git.clean = /clean/i.test(git.status)
      } else git.files.push(line)
      continue
    }

    const m = line.match(/^(✅|❌|🟢|⚠️|⚪️|⚪)\s*(.+)$/u)
    if (m && cur) {
      const state = m[1] === '✅' || m[1] === '🟢' ? 'ok' : m[1] === '❌' ? 'bad' : m[1] === '⚠️' ? 'warn' : 'off'
      const nm = m[2].match(/^(.*?)\s*\((.+)\)$/)
      cur.items.push({
        label: (nm ? nm[1] : m[2]).replace(/_/g, ' '),
        sub: nm ? nm[2] : '',
        state,
      })
    }
  }

  // Leles è sempre su (è lui che risponde): il suo stato diventa quello
  // dell'intestazione "Progetti" e il suo box viene tolto.
  for (const sec of sections) {
    if (sec.title === 'Progetti') {
      const i = sec.items.findIndex((it) => /^leles$/i.test(it.label))
      if (i >= 0) {
        sec.head = sec.items[i].state
        sec.items.splice(i, 1)
      }
    }
  }

  // Ollama: i modelli diventano sotto-box del suo riquadro (a tutta
  // larghezza, in fondo ai servizi). Se Ollama non c'è, i modelli
  // restano una sezione a parte.
  const services = sections.find((sec) => sec.title === 'Servizi')
  const models = sections.find((sec) => sec.title === 'Modelli')
  const ollama = services?.items.find((it) => /^ollama$/i.test(it.label))
  if (ollama && models) {
    ollama.children = models.items
    sections.splice(sections.indexOf(models), 1)
    services.items.splice(services.items.indexOf(ollama), 1)
    services.items.push(ollama)
  }

  const filled = sections.filter((sec) => sec.items.length > 0)
  if (filled.length === 0) return null
  return { sections: filled, git }
}

// Schemino a quadratini: verde = su, rosso = giù, grigio = non caricato.
function SystemTiles({ data }) {
  const label = { ok: 'attivo', bad: 'non attivo', warn: 'parziale', off: 'non caricato' }
  return (
    <div className="lc-sys">
      {data.sections.map((sec) => {
        const up = sec.items.filter((i) => i.state === 'ok').length
        return (
          <div key={sec.title} className="lc-sys-sec">
            <div className="lc-sys-title">
              <span
                className={`lc-sys-name${sec.head ? ` is-${sec.head}` : ''}`}
                title={sec.head ? `Leles: ${label[sec.head]}` : undefined}
              >
                {sec.title}
                {sec.head && <span className="lc-sr"> (Leles {label[sec.head]})</span>}
              </span>
              <span>
                {up}/{sec.items.length}
              </span>
            </div>
            <div className="lc-tiles">
              {sec.items.map((it) =>
                it.children ? (
                  <div
                    key={it.label}
                    className={`lc-tile lc-tile--wide is-${it.state}`}
                    title={`${it.label}: ${label[it.state]}`}
                  >
                    <b>{it.label}</b>
                    <span className="lc-sr">{label[it.state]}</span>
                    <div className="lc-subs">
                      {it.children.map((m) => (
                        <span
                          key={m.label}
                          className={`lc-sub is-${m.state}`}
                          title={`${m.label}: ${label[m.state]}`}
                        >
                          {m.label}
                          <span className="lc-sr"> {label[m.state]}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    key={it.label}
                    className={`lc-tile is-${it.state}`}
                    title={`${it.label}${it.sub ? ` (${it.sub})` : ''}: ${label[it.state]}`}
                  >
                    <b>{it.label}</b>
                    {it.sub && <small>{it.sub}</small>}
                    <span className="lc-sr">{label[it.state]}</span>
                  </div>
                )
              )}
            </div>
          </div>
        )
      })}

      {data.git && (
        <div className="lc-sys-sec">
          <div className="lc-sys-title">
            <span>Git</span>
          </div>
          <div className="lc-sys-git">
            {data.git.branch && <span className="lc-badge">{data.git.branch}</span>}
            <span
              className={`lc-badge ${data.git.clean ? 'is-ok' : 'is-warn'}`}
              title={data.git.files.join('\n') || undefined}
            >
              {data.git.clean ? 'Clean' : data.git.status.replace(/^⚠️\s*/, '')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export { parseSystem }
export default SystemTiles
