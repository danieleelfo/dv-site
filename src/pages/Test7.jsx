// ============================================================
// TEST7 — GraDV Archive (read-only)
// Catalogo delle immagini presenti nel database principale GraDV.
// Usa il login Google condiviso e gli endpoint protetti del gateway.
// Nessuna funzione di modifica o cancellazione.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const API = 'https://api.danielevillanova.com'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const TOKEN_STORAGE_KEY = 'dv_google_id_token'
const PAGE_SIZE = 24

function parseJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(base64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

function readToken() {
  try {
    const token = window.localStorage.getItem(TOKEN_STORAGE_KEY)
      || window.sessionStorage.getItem(TOKEN_STORAGE_KEY)
    const payload = token ? parseJwt(token) : null
    return payload?.exp && payload.exp * 1000 > Date.now() + 5000 ? token : null
  } catch {
    return null
  }
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `HTTP ${response.status}`
    throw new Error(detail)
  }
  return data
}

function formatDate(value) {
  if (!value) return 'Data non disponibile'
  const date = new Date(value.includes?.('T') ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function Test7() {
  const [idToken, setIdToken] = useState(readToken)
  const [profile, setProfile] = useState(() => {
    const token = readToken()
    return token ? parseJwt(token) : null
  })
  const [authError, setAuthError] = useState('')
  const [gsiReady, setGsiReady] = useState(false)
  const buttonRef = useRef(null)

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [thumbs, setThumbs] = useState({})
  const [selected, setSelected] = useState(null)
  const [fullImage, setFullImage] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)

  const revokeThumbs = useCallback((map) => {
    Object.values(map || {}).forEach((url) => URL.revokeObjectURL(url))
  }, [])

  const logout = useCallback((message = '') => {
    setIdToken(null)
    setProfile(null)
    setItems([])
    setThumbs((old) => {
      revokeThumbs(old)
      return {}
    })
    setSelected(null)
    setFullImage((old) => {
      if (old) URL.revokeObjectURL(old)
      return ''
    })
    setAuthError(message)
    try {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY)
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      window.google?.accounts?.id?.disableAutoSelect()
    } catch {
      /* no-op */
    }
  }, [revokeThumbs])

  useEffect(() => {
    if (idToken) return
    let cancelled = false
    let attempts = 0

    function tryInit() {
      if (cancelled) return
      if (!window.google?.accounts?.id) {
        if (++attempts > 80) {
          setAuthError('Impossibile caricare il login Google. Controlla rete e blocchi del browser.')
          return
        }
        setTimeout(tryInit, 150)
        return
      }
      if (!GOOGLE_CLIENT_ID) {
        setAuthError('VITE_GOOGLE_CLIENT_ID non configurato nel frontend.')
        return
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          const token = response?.credential
          if (!token) {
            setAuthError('Login Google fallito: token mancante.')
            return
          }
          setProfile(parseJwt(token))
          setIdToken(token)
          setAuthError('')
          try { window.localStorage.setItem(TOKEN_STORAGE_KEY, token) } catch { /* no-op */ }
        },
      })
      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill',
        })
      }
      setGsiReady(true)
    }

    tryInit()
    return () => { cancelled = true }
  }, [idToken])

  const loadArchive = useCallback(async (targetPage = 1, targetQuery = query) => {
    if (!idToken) return
    setLoading(true)
    setError('')
    setSelected(null)
    setFullImage((old) => {
      if (old) URL.revokeObjectURL(old)
      return ''
    })
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        page_size: String(PAGE_SIZE),
      })
      if (targetQuery.trim()) params.set('q', targetQuery.trim())

      const response = await fetch(`${API}/api/gradv/archive?${params}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (response.status === 401 || response.status === 403) {
        logout(response.status === 401 ? 'Sessione scaduta, accedi di nuovo.' : 'Accesso non autorizzato.')
        return
      }
      const data = await readJson(response)
      setItems(data.items || [])
      setTotal(Number(data.total || 0))
      setPages(Math.max(1, Number(data.pages || 1)))
      setPage(Number(data.page || targetPage))

      const nextThumbs = {}
      await Promise.all((data.items || []).map(async (item) => {
        try {
          const imageResponse = await fetch(
            `${API}/api/gradv/archive/${item.id}/image?thumbnail=true`,
            { headers: { Authorization: `Bearer ${idToken}` } }
          )
          if (!imageResponse.ok) throw new Error(`Anteprima HTTP ${imageResponse.status}`)
          nextThumbs[item.id] = URL.createObjectURL(await imageResponse.blob())
        } catch {
          /* Una miniatura fallita non blocca l'intera galleria. */
        }
      }))
      setThumbs((old) => {
        revokeThumbs(old)
        return nextThumbs
      })
    } catch (err) {
      setError(err.message || String(err))
      setItems([])
      setTotal(0)
      setPages(1)
    } finally {
      setLoading(false)
    }
  }, [idToken, query, logout, revokeThumbs])

  useEffect(() => {
    if (idToken) loadArchive(1, '')
  }, [idToken, loadArchive])

  useEffect(() => () => revokeThumbs(thumbs), [thumbs, revokeThumbs])

  async function openImage(item) {
    setSelected(item)
    setDetailLoading(true)
    setFullImage((old) => {
      if (old) URL.revokeObjectURL(old)
      return ''
    })
    try {
      const response = await fetch(`${API}/api/gradv/archive/${item.id}/image`, {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (response.status === 401 || response.status === 403) {
        logout('Sessione scaduta, accedi di nuovo.')
        return
      }
      if (!response.ok) throw new Error(`Immagine non disponibile (HTTP ${response.status})`)
      setFullImage(URL.createObjectURL(await response.blob()))
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setDetailLoading(false)
    }
  }

  function closeImage() {
    setSelected(null)
    setFullImage((old) => {
      if (old) URL.revokeObjectURL(old)
      return ''
    })
  }

  function submitSearch(event) {
    event.preventDefault()
    setQuery(searchInput)
    loadArchive(1, searchInput)
  }

  if (!idToken) {
    return (
      <main className="ga-page">
        <style>{CSS}</style>
        <div className="ga-login">
          <p className="ga-eyebrow">D. VILLANOVA · AI SYSTEMS</p>
          <h1>GraDV Archive</h1>
          <p>Archivio immagini — accesso riservato</p>
          {authError && <p className="ga-error">{authError}</p>}
          <div ref={buttonRef} />
          {!gsiReady && !authError && <p className="ga-muted">Caricamento login…</p>}
          <Link className="ga-button" to="/image-lab">← Image Lab</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="ga-page">
      <style>{CSS}</style>
      <div className="ga-container">
        <header className="ga-header">
          <div>
            <p className="ga-eyebrow">D. VILLANOVA · AI SYSTEMS / TEST 07</p>
            <h1>GraDV Archive</h1>
            <p className="ga-subtitle">Archivio completo delle immagini — database principale GraDV</p>
          </div>
          <div className="ga-account">
            <span title={profile?.email}>{profile?.email || 'account'}</span>
            <Link className="ga-button" to="/image-lab">Image Lab ↗</Link>
            <button className="ga-button" onClick={() => logout()}>Logout</button>
          </div>
        </header>

        <section className="ga-toolbar">
          <div>
            <strong>{total.toLocaleString()} immagini</strong>
            <span className="ga-muted"> · sola lettura · 24 per pagina</span>
          </div>
          <form className="ga-search" onSubmit={submitSearch}>
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cerca nel prompt…" aria-label="Cerca nel prompt" />
            <button className="ga-button ga-primary" type="submit" disabled={loading}>Cerca</button>
            {query && <button className="ga-button" type="button" onClick={() => {
              setSearchInput(''); setQuery(''); loadArchive(1, '')
            }}>Reset</button>}
          </form>
        </section>

        {error && <div className="ga-error" role="alert">{error}</div>}
        {loading && <div className="ga-loading"><span className="ga-spinner" /> Caricamento archivio GraDV…</div>}

        {!loading && !error && items.length === 0 && (
          <div className="ga-empty">Nessuna immagine trovata.</div>
        )}

        <section className="ga-grid" aria-label="Archivio immagini">
          {items.map((item) => (
            <button className="ga-card" key={item.id} onClick={() => openImage(item)}
              type="button" title={item.prompt || `Immagine #${item.id}`}>
              <div className="ga-thumb">
                {thumbs[item.id]
                  ? <img src={thumbs[item.id]} alt={item.prompt || `GraDV #${item.id}`} loading="lazy" />
                  : <span>Anteprima…</span>}
              </div>
              <div className="ga-card-meta">
                <strong>#{item.id}</strong>
                <span>{item.width && item.height ? `${item.width} × ${item.height}` : '—'}</span>
              </div>
              <p>{item.prompt || 'Prompt non disponibile'}</p>
              <small>{formatDate(item.created_at)}</small>
            </button>
          ))}
        </section>

        {!loading && pages > 1 && (
          <nav className="ga-pagination" aria-label="Paginazione">
            <button className="ga-button" disabled={page <= 1} onClick={() => loadArchive(page - 1)}>← Precedente</button>
            <span>Pagina <strong>{page}</strong> di <strong>{pages}</strong></span>
            <button className="ga-button" disabled={page >= pages} onClick={() => loadArchive(page + 1)}>Successiva →</button>
          </nav>
        )}

        <footer className="ga-footer">
          <span>Test7 · GraDV Archive</span>
          <span>SQLite read-only · nessuna modifica alle immagini originali</span>
        </footer>
      </div>

      {selected && (
        <div className="ga-modal-backdrop" role="presentation" onClick={closeImage}>
          <section className="ga-modal" role="dialog" aria-modal="true"
            aria-label={`Dettaglio immagine ${selected.id}`} onClick={(e) => e.stopPropagation()}>
            <div className="ga-modal-head">
              <div><strong>GraDV image #{selected.id}</strong><small>{formatDate(selected.created_at)}</small></div>
              <button className="ga-button" onClick={closeImage}>Chiudi ✕</button>
            </div>
            <div className="ga-full-image">
              {detailLoading && <span className="ga-muted">Caricamento immagine originale…</span>}
              {fullImage && <img src={fullImage} alt={selected.prompt || `GraDV #${selected.id}`} />}
            </div>
            <div className="ga-details">
              <p><b>Prompt</b><br />{selected.prompt || '—'}</p>
              <div className="ga-detail-grid">
                <span><b>Seed</b><br />{selected.seed ?? '—'}</span>
                <span><b>Dimensioni</b><br />{selected.width || '—'} × {selected.height || '—'}</span>
                <span><b>Steps</b><br />{selected.steps ?? '—'}</span>
              </div>
              {fullImage && <a className="ga-button" href={fullImage} download={`gradv-${selected.id}.png`}>Scarica originale ↓</a>}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

const CSS = `
.ga-page{min-height:100vh;padding:2rem 1.2rem 3rem;color:#e7edf1;background:radial-gradient(1100px 560px at 75% -10%,rgba(63,208,201,.09),transparent),#0b1015;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
.ga-container{max-width:1320px;margin:0 auto}
.ga-header{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;flex-wrap:wrap;margin-bottom:1.4rem}
.ga-header h1,.ga-login h1{margin:.25rem 0;font-size:2rem;letter-spacing:-.03em}
.ga-eyebrow{margin:0;color:#3fd0c9;font-size:.7rem;font-weight:700;letter-spacing:.14em}
.ga-subtitle,.ga-muted{color:#8fa1ac;font-size:.84rem}
.ga-account{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;color:#8fa1ac;font-size:.82rem}
.ga-account span{max-width:220px;overflow:hidden;text-overflow:ellipsis}
.ga-toolbar{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;padding:1rem;margin-bottom:1rem;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(16,23,30,.7)}
.ga-search{display:flex;gap:.5rem;flex-wrap:wrap}
.ga-search input{min-width:220px;padding:.55rem .75rem;border:1px solid rgba(255,255,255,.16);border-radius:8px;background:#101820;color:#e7edf1;font:inherit}
.ga-button{display:inline-flex;align-items:center;justify-content:center;gap:.3rem;padding:.48rem .8rem;border:1px solid rgba(255,255,255,.17);border-radius:8px;background:rgba(255,255,255,.06);color:#e7edf1;font:inherit;font-size:.8rem;text-decoration:none;cursor:pointer}
.ga-button:hover:not(:disabled){background:rgba(255,255,255,.13)}
.ga-button:disabled{opacity:.4;cursor:not-allowed}
.ga-primary{background:#3fd0c9;color:#071212;border-color:#3fd0c9;font-weight:700}
.ga-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:.85rem}
.ga-card{min-width:0;padding:0;overflow:hidden;text-align:left;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(16,23,30,.78);color:inherit;cursor:pointer}
.ga-card:hover{border-color:rgba(63,208,201,.65);transform:translateY(-2px)}
.ga-thumb{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;background:#080c10;color:#71818b;overflow:hidden}
.ga-thumb img{width:100%;height:100%;object-fit:contain}
.ga-card-meta{display:flex;justify-content:space-between;gap:.5rem;padding:.65rem .7rem .15rem;font-size:.75rem;color:#aebdc5}
.ga-card-meta strong{color:#3fd0c9}
.ga-card p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.5em;margin:.25rem .7rem;color:#d5dfe4;font-size:.78rem;line-height:1.35}
.ga-card small{display:block;padding:0 .7rem .7rem;color:#82939d;font-size:.68rem}
.ga-pagination{display:flex;justify-content:center;align-items:center;gap:1rem;margin:1.5rem 0}
.ga-pagination span{font-size:.82rem;color:#aebdc5}
.ga-loading,.ga-empty{display:flex;justify-content:center;align-items:center;gap:.7rem;padding:3rem;color:#9aabb4}
.ga-spinner{width:20px;height:20px;border:2px solid rgba(63,208,201,.2);border-top-color:#3fd0c9;border-radius:50%;animation:ga-spin .8s linear infinite}
@keyframes ga-spin{to{transform:rotate(360deg)}}
.ga-error{margin:1rem 0;padding:.8rem 1rem;border:1px solid rgba(248,113,113,.4);border-radius:9px;background:rgba(248,113,113,.1);color:#fca5a5;font-size:.85rem}
.ga-footer{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-top:2rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,.08);color:#82939d;font-size:.75rem}
.ga-login{min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8rem;text-align:center}
.ga-modal-backdrop{position:fixed;z-index:1000;inset:0;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}
.ga-modal{width:min(1050px,100%);max-height:94vh;overflow:auto;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:#10171e;box-shadow:0 20px 80px rgba(0,0,0,.6)}
.ga-modal-head{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.8rem 1rem;background:#10171e;border-bottom:1px solid rgba(255,255,255,.1)}
.ga-modal-head small{display:block;margin-top:.2rem;color:#82939d;font-size:.72rem}
.ga-full-image{display:flex;justify-content:center;align-items:center;min-height:120px;max-height:65vh;padding:.6rem;background:#080c10}
.ga-full-image img{max-width:100%;max-height:62vh;object-fit:contain}
.ga-details{padding:1rem;color:#cbd6dc;font-size:.84rem;line-height:1.5}
.ga-details p{white-space:pre-wrap;overflow-wrap:anywhere}
.ga-detail-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem;margin:1rem 0;color:#aebdc5}
.ga-login .ga-button{margin-top:.8rem}
@media(max-width:600px){.ga-page{padding:1rem .65rem 2rem}.ga-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem}.ga-card-meta{font-size:.68rem}.ga-card p{font-size:.72rem}.ga-search{width:100%}.ga-search input{flex:1;min-width:0}.ga-detail-grid{grid-template-columns:1fr 1fr}.ga-pagination{gap:.5rem}.ga-pagination .ga-button{padding:.45rem .55rem;font-size:.72rem}}
`
