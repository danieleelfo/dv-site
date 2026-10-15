import { useCallback, useEffect, useRef, useState } from 'react'

const LELE_API_URL = 'https://api.danielevillanova.com'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const TOKEN_STORAGE_KEY = 'bar_ai_admin_id_token'

// Stessa whitelist della Console Leles — stesso account, stesso accesso.
const ALLOWED_EMAILS = [
  'dannybydanny@hotmail.com',
  'salatinodenise@gmail.com',
]

// Config tabelle lato frontend — deve restare in sincrono con TABLES in
// admin_routes.py (bar_ai). Qui solo label/tipo per generare i form,
// la whitelist/validazione vera resta sempre lato backend.
const TABLE_CONFIGS = {
  ingredients: {
    label: 'Ingredienti',
    pk: 'ingredient_id',
    fields: [
      { name: 'name', label: 'Nome', type: 'text' },
      { name: 'unit', label: 'Unità', type: 'text' },
      { name: 'bottle_size_ml', label: 'Bottiglia (ml)', type: 'number' },
    ],
  },
  recipes: {
    label: 'Ricette',
    pk: 'recipe_id',
    fields: [
      { name: 'product_id', label: 'Prodotto', type: 'select', options: 'products' },
      { name: 'ingredient_id', label: 'Ingrediente', type: 'select', options: 'ingredients' },
      { name: 'quantity_per_serving', label: 'Quantità/porzione', type: 'number' },
    ],
  },
  inventory: {
    label: 'Magazzino',
    pk: 'ingredient_id',
    fields: [
      { name: 'ingredient_id', label: 'Ingrediente', type: 'select', options: 'ingredients', pkOnInsert: true },
      { name: 'stock_level', label: 'Scorta attuale', type: 'number' },
      { name: 'min_threshold', label: 'Soglia minima', type: 'number' },
    ],
  },
}

function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(window.atob(base64))))
  } catch (e) {
    return null
  }
}

async function adminJson(idToken, path, init = {}, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${LELE_API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
        Authorization: `Bearer ${idToken}`,
      },
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) {
      const err = new Error(
        res.status === 401
          ? 'Sessione scaduta, effettua di nuovo il login.'
          : 'Accesso non autorizzato per questo account Google. 🏴‍☠️'
      )
      err.status = res.status
      throw err
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.detail || `HTTP ${res.status}: ${res.statusText}`)
    }
    return data
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Timeout: il server non ha risposto in tempo. 😵‍💫')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const emptyForm = (fields) =>
  Object.fromEntries(fields.map((f) => [f.name, '']))

export default function BarAiAdmin() {
  // --- AUTH (stesso pattern di LeleAdmin.jsx) ------------------------------
  const [idToken, setIdToken] = useState(() => {
    try {
      return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || null
    } catch (e) {
      return null
    }
  })
  const [authError, setAuthError] = useState('')
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!idToken) return
    const email = decodeJwtPayload(idToken)?.email?.toLowerCase()
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      logout('Accesso non autorizzato per questo account Google. 🏴‍☠️')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (idToken) return
    let cancelled = false
    let attempts = 0

    function tryInit() {
      if (cancelled) return
      if (!window.google?.accounts?.id) {
        if (++attempts > 80) {
          setAuthError(
            'Impossibile caricare il login Google. Controlla adblock e rete, poi ricarica la pagina.'
          )
          return
        }
        setTimeout(tryInit, 150)
        return
      }
      if (!GOOGLE_CLIENT_ID) {
        setAuthError('GOOGLE_CLIENT_ID non configurato (VITE_GOOGLE_CLIENT_ID mancante).')
        return
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
      })
      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'small',
          text: 'signin',
          shape: 'pill',
        })
      }
    }

    tryInit()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken])

  function handleCredentialResponse(credentialResponse) {
    const token = credentialResponse?.credential
    if (!token) {
      setAuthError('Login Google fallito: nessun token ricevuto.')
      return
    }
    const email = decodeJwtPayload(token)?.email?.toLowerCase()
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      setAuthError('Accesso non autorizzato per questo account Google.')
      try {
        window.google?.accounts?.id?.disableAutoSelect()
      } catch (e) { /* no-op */ }
      return
    }
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } catch (e) { /* no-op */ }
    setAuthError('')
    setIdToken(token)
  }

  function logout(message = '') {
    setIdToken(null)
    setAuthError(message)
    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      window.google?.accounts?.id?.disableAutoSelect()
    } catch (e) { /* no-op */ }
  }

  // --- DATI TABELLE ---------------------------------------------------------
  const [activeTable, setActiveTable] = useState('ingredients')
  const [rows, setRows] = useState([])
  const [options, setOptions] = useState({ products: [], ingredients: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editingPk, setEditingPk] = useState(null) // null = nuovo, valore = editing
  const [form, setForm] = useState({})

  const cfg = TABLE_CONFIGS[activeTable]

  const loadOptions = useCallback(async () => {
    if (!idToken) return
    try {
      const data = await adminJson(idToken, '/api/bar-ai/admin/options')
      setOptions({ products: data.products || [], ingredients: data.ingredients || [] })
    } catch (err) {
      // non bloccante: i dropdown restano vuoti, il resto funziona comunque
      console.error('options:', err)
    }
  }, [idToken])

  const loadRows = useCallback(async () => {
    if (!idToken) return
    setLoading(true)
    setError('')
    try {
      const data = await adminJson(idToken, `/api/bar-ai/admin/tables/${activeTable}`)
      setRows(data.rows || [])
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        logout(err.message)
        return
      }
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [idToken, activeTable])

  useEffect(() => {
    loadOptions()
  }, [loadOptions])

  useEffect(() => {
    loadRows()
    setFormOpen(false)
    setEditingPk(null)
  }, [loadRows])

  function openNewForm() {
    setForm(emptyForm(cfg.fields))
    setEditingPk(null)
    setFormOpen(true)
    setNotice('')
  }

  function openEditForm(row) {
    const f = {}
    cfg.fields.forEach((field) => { f[field.name] = row[field.name] ?? '' })
    setForm(f)
    setEditingPk(row[cfg.pk])
    setFormOpen(true)
    setNotice('')
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    try {
      if (editingPk === null) {
        await adminJson(idToken, `/api/bar-ai/admin/tables/${activeTable}`, {
          method: 'POST',
          body: JSON.stringify({ fields: form }),
        })
        setNotice('✅ Riga creata.')
      } else {
        await adminJson(idToken, `/api/bar-ai/admin/tables/${activeTable}`, {
          method: 'PUT',
          body: JSON.stringify({ pk: editingPk, fields: form }),
        })
        setNotice('✅ Riga aggiornata.')
      }
      setFormOpen(false)
      loadRows()
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        logout(err.message)
        return
      }
      setError(err.message)
    }
  }

  async function handleDelete(row) {
    const pkVal = row[cfg.pk]
    if (!window.confirm(`Eliminare la riga ${cfg.pk}=${pkVal}?`)) return
    setError('')
    try {
      await adminJson(
        idToken,
        `/api/bar-ai/admin/tables/${activeTable}?pk=${encodeURIComponent(pkVal)}`,
        { method: 'DELETE' }
      )
      setNotice('🗑️ Riga eliminata.')
      loadRows()
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        logout(err.message)
        return
      }
      setError(err.message)
    }
  }

  function optionsFor(field) {
    const list = options[field.options] || []
    if (field.options === 'products') {
      return list.map((p) => ({ value: p.ProductID, label: `${p.Category} (#${p.ProductID})` }))
    }
    return list.map((i) => ({ value: i.ingredient_id, label: i.name }))
  }

  // --- LOGIN GATE -------------------------------------------------------
  if (!idToken) {
    return (
      <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 24 }}>
        <h1 style={{ fontSize: 22 }}>🍸 Bar AI — Editor tabelle (demo)</h1>
        <p style={{ opacity: 0.7, maxWidth: 420, textAlign: 'center' }}>
          Accesso riservato — stesso account Google della Console Leles.
        </p>
        <div ref={buttonRef} />
        {authError && <p style={{ color: '#f87171' }}>{authError}</p>}
      </div>
    )
  }

  // --- UI PRINCIPALE ------------------------------------------------------
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22 }}>🍸 Bar AI — Editor tabelle (demo)</h1>
        <button onClick={() => logout('')} style={{ fontSize: 13, opacity: 0.7 }}>Logout</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {Object.entries(TABLE_CONFIGS).map(([key, c]) => (
          <button
            key={key}
            onClick={() => setActiveTable(key)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: key === activeTable ? '2px solid #60a5fa' : '1px solid #444',
              background: key === activeTable ? '#1e3a8a' : 'transparent',
              color: '#fff',
            }}
          >
            {c.label}
          </button>
        ))}
        <button onClick={openNewForm} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 999, background: '#16a34a', color: '#fff', border: 'none' }}>
          + Nuovo
        </button>
      </div>

      {notice && <p style={{ color: '#4ade80', fontSize: 14 }}>{notice}</p>}
      {error && <p style={{ color: '#f87171', fontSize: 14 }}>⚠️ {error}</p>}
      {loading && <p style={{ opacity: 0.6 }}>Carico…</p>}

      {formOpen && (
        <form onSubmit={handleSave} style={{ border: '1px solid #333', borderRadius: 8, padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>{editingPk === null ? `Nuovo in ${cfg.label}` : `Modifica ${cfg.pk}=${editingPk}`}</strong>
          {cfg.fields.map((field) => {
            const disabled = editingPk !== null && field.pkOnInsert
            if (field.type === 'select') {
              return (
                <label key={field.name} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  {field.label}
                  <select
                    value={form[field.name] ?? ''}
                    disabled={disabled}
                    onChange={(e) => setForm({ ...form, [field.name]: e.target.value })}
                    style={{ padding: 6 }}
                    required
                  >
                    <option value="" disabled>— seleziona —</option>
                    {optionsFor(field).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
              )
            }
            return (
              <label key={field.name} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                {field.label}
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  step={field.type === 'number' ? 'any' : undefined}
                  value={form[field.name] ?? ''}
                  disabled={disabled}
                  onChange={(e) => setForm({ ...form, [field.name]: e.target.value })}
                  style={{ padding: 6 }}
                  required
                />
              </label>
            )
          })}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" style={{ padding: '6px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6 }}>
              Salva
            </button>
            <button type="button" onClick={() => setFormOpen(false)} style={{ padding: '6px 14px', opacity: 0.7 }}>
              Annulla
            </button>
          </div>
        </form>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {cfg.fields.map((f) => (
                <th key={f.name} style={{ textAlign: 'left', borderBottom: '1px solid #444', padding: 6 }}>{f.label}</th>
              ))}
              <th style={{ borderBottom: '1px solid #444', padding: 6 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[cfg.pk]}>
                {cfg.fields.map((f) => (
                  <td key={f.name} style={{ padding: 6, borderBottom: '1px solid #222' }}>
                    {String(row[f.name] ?? '')}
                  </td>
                ))}
                <td style={{ padding: 6, borderBottom: '1px solid #222', whiteSpace: 'nowrap' }}>
                  <button onClick={() => openEditForm(row)} style={{ marginRight: 8 }}>✏️</button>
                  <button onClick={() => handleDelete(row)}>🗑️</button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={cfg.fields.length + 1} style={{ padding: 12, opacity: 0.6 }}>Nessuna riga.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
