// Pannello "stato sistema" riutilizzabile: parser di `status sistema`
// + tessere. Estratto da LeleAdmin per integrarlo in qualsiasi pagina.
// ------------------------------------------------------------------
// Dashboard "Sistema": parser del testo di `status sistema` + tessere.
// ------------------------------------------------------------------
const SYS_SECTIONS = {
  'Projects': 'Progetti',
  'Shared Services': 'Servizi',
  'Models': 'Modelli',
  'B2B Arena': 'B2B Arena',
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
      if (line.startsWith('Branch:')) {
        git.branch = line.slice(7).trim()
      } else if (line.startsWith('Status:')) {
        git.status = line.slice(7).trim()
        git.clean = /clean/i.test(git.status)
      } else {
        git.files.push(line)
      }
      continue
    }

    const m = line.match(/^(✅|❌|🟢|⚠️|⚪️|⚪)\s*(.+)$/u)

    if (m && cur) {
      const state =
        m[1] === '✅' || m[1] === '🟢'
          ? 'ok'
          : m[1] === '❌'
            ? 'bad'
            : m[1] === '⚠️'
              ? 'warn'
              : 'off'

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

  // Ollama è una sezione separata.
  // Il servizio Ollama viene tolto da "Servizi" e la sezione
  // "Modelli" viene rinominata "Ollama".
  const services = sections.find((sec) => sec.title === 'Servizi')
  const models = sections.find((sec) => sec.title === 'Modelli')

  if (services && models) {
    const ollamaIndex = services.items.findIndex(
      (it) => /^ollama$/i.test(it.label)
    )

    if (ollamaIndex >= 0) {
      services.items.splice(ollamaIndex, 1)
      models.title = 'Ollama'

      // I 3 gruppi di modelli sono tutti alimentati da Ollama.
      // Lo stato viene mantenuto sugli item; non mostriamo
      // "Leles attivo" nell'intestazione Ollama.
    }
  }

  const filled = sections.filter((sec) => sec.items.length > 0)

  if (filled.length === 0) return null

  return { sections: filled, git }
}

// Schemino a quadratini: verde = su, rosso = giù, grigio = non caricato.
function SystemTiles({ data }) {
  const label = {
    ok: 'attivo',
    bad: 'non attivo',
    warn: 'parziale',
    off: 'non caricato',
  }

  return (
    <div className="lc-sys">
      {data.sections.map((sec) => {
        const isOllama = sec.title === 'Ollama'

        // Per Ollama vogliamo 7 box:
        // 1. Gemma4
        // 2. Llama3
        // 3. Qwen2.5
        // 4. Deepseek-R1
        // 5. Mistral
        // 6. Qwen Coder
        // 7. Super Leles available only -->      GPT-OSS:20b
        //
        // Il backend continua a fornire i modelli raggruppati in 3 righe.
        // Qui li spacchettiamo solo per la visualizzazione.

        let ollamaItems = []

        if (isOllama) {
          const baseModels = [
            ['Gemma4', 'Llama3', 'Qwen2.5'],
            ['Deepseek-R1', 'Mistral', 'Qwen Coder'],
          ]

          const states = sec.items.reduce((acc, item) => {
            const names = item.label.split(' · ')

            names.forEach((name) => {
              acc[name] = item.state
            })

            return acc
          }, {})

          for (const name of baseModels.flat()) {
            ollamaItems.push({
              label: name,
              state: states[name] || 'off',
              sub: '',
            })
          }

          // Senza ^ : l'etichetta è "Superleles available only: GPT-OSS",
          // quindi GPT-OSS non è all'inizio della stringa.
          const gpt = sec.items.find((item) =>
            /GPT[-\s]?OSS/i.test(item.label)
          )

          ollamaItems.push({
            label: 'Superleles available only: -->  GPT-OSS',
            state: gpt?.state || 'off',
            sub: '',
            wide: true,
          })
        }

        const displayItems = isOllama ? ollamaItems : sec.items
        const up = displayItems.filter((i) => i.state === 'ok').length

        // verde se tutto su, arancione altrimenti (vale per Progetti, Servizi, Ollama)
        const secState = up === displayItems.length ? 'ok' : 'warn'

        return (
          <div key={sec.title} className="lc-sys-sec">
            <div className="lc-sys-title">
              <span
                className={`lc-sys-name is-${secState}`}
                title={sec.head ? `Leles: ${label[sec.head]}` : undefined}
              >
                {sec.title}
                {sec.head && (
                  <span className="lc-sr"> (Leles {label[sec.head]})</span>
                )}
              </span>

              <span className={`lc-sys-count is-${secState}`}>
                {up}/{displayItems.length}
              </span>
            </div>

            {isOllama ? (
              <div className="lc-ollama-grid">
                {ollamaItems.map((it) => (
                  <div
                    key={it.label}
                    className={`lc-ollama-box is-${it.state}${
                      it.wide ? ' lc-ollama-wide' : ''
                    }`}
                    title={it.label}
                  >
                    <b>{it.label}</b>
                  </div>
                ))}
              </div>
            ) : (
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
                            <span className="lc-sr">
                              {' '}
                              {label[m.state]}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={it.label}
                      className={`lc-tile is-${it.state}`}
                      title={`${it.label}${
                        it.sub ? ` (${it.sub})` : ''
                      }: ${label[it.state]}`}
                    >
                      <b>{it.label}</b>
                      {it.sub && <small>{it.sub}</small>}
                      <span className="lc-sr">{label[it.state]}</span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )
      })}

      {data.git && (
        <div className="lc-sys-sec">
          <div className="lc-sys-title">
            <span>Git</span>
          </div>

          <div className="lc-sys-git">
            {data.git.branch && (
              <span className="lc-badge">{data.git.branch}</span>
            )}

            <span
              className={`lc-badge ${
                data.git.clean ? 'is-ok' : 'is-warn'
              }`}
              title={data.git.files.join('\n') || undefined}
            >
              {data.git.clean
                ? 'Clean'
                : data.git.status.replace(/^⚠️\s*/, '')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- OS: KPI con icone ----------------
const levelOf = (pct) => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok')

// Legge il testo di `status os`. Ignora la lista modelli Ollama.
function parseOs(text) {
  if (!text) return null
  const cpu = text.match(/CPU:\s*(\d+(?:\.\d+)?)\s*%/i)
  const mem = (label) => {
    const m = text.match(
      new RegExp(label + ':\\s*([\\d.]+)\\s*/\\s*([\\d.]+)\\s*GB\\s*\\((\\d+)%\\)', 'i')
    )
    return m ? { used: m[1], total: m[2], pct: Number(m[3]) } : null
  }
  const ram = mem('RAM')
  const disk = mem('Disco')
  const up = text.match(/Uptime[^:\n]*:\s*(.+)/i)
  if (!cpu && !ram && !disk && !up) return null
  return {
    cpu: cpu ? Number(cpu[1]) : null,
    ram,
    disk,
    uptime: up ? up[1].trim() : null,
  }
}

function OsKpis({ data }) {
  const items = []
  if (data.cpu != null)
    items.push({ icon: '🖥️', label: 'CPU', value: `${Math.round(data.cpu)}%`, pct: data.cpu })
  if (data.ram)
    items.push({
      icon: '🧠', label: 'RAM',
      value: `${data.ram.used}/${data.ram.total} GB`,
      sub: `${data.ram.pct}%`, pct: data.ram.pct,
    })
  if (data.disk)
    items.push({
      icon: '💾', label: 'Disco',
      value: `${data.disk.used}/${data.disk.total} GB`,
      sub: `${data.disk.pct}%`, pct: data.disk.pct,
    })
  if (data.uptime)
    items.push({ icon: '⏱️', label: 'Uptime', value: data.uptime, pct: null })

  return (
    <div className="lc-kpis">
      {items.map((it) => (
        <div
          key={it.label}
          className={`lc-kpi${it.pct != null ? ` is-${levelOf(it.pct)}` : ''}`}
        >
          <div className="lc-kpi-top">
            <span aria-hidden="true">{it.icon}</span>
            <span>{it.label}</span>
          </div>
          <b className="lc-kpi-val">{it.value}</b>
          {it.sub && <small>{it.sub}</small>}
          {it.pct != null && (
            <div className="lc-kpi-bar">
              <i style={{ width: `${Math.min(100, it.pct)}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------- RAM: solo la parte Ollama ----------------
// Toglie recinti ```, riga "RAM totale" (già nei KPI) e nota Piper/TTS.
function cleanRam(text) {
  if (!text) return null
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('```'))
    .filter((l) => !/piper|tts/i.test(l))
    .filter((l) => !/RAM totale/i.test(l))
  return lines.length ? lines.join('\n') : null
}

export { parseSystem, parseOs, cleanRam, OsKpis }
export default SystemTiles
