// ============================================================
// ADMIN AUTH BRIDGE — token Google condiviso tra le pagine admin
// ============================================================
// Problema: le pagine admin usavano chiavi/storage diversi:
//   - leles_admin_id_token  (Test2/LeleAdmin in sessionStorage,
//                            ApiContracts/GitAdmin/DagAdmin in localStorage)
//   - dv_google_id_token    (Improve, Test3, Test4, Test5, Test6, ImageLab)
//   - bar_ai_admin_id_token (BarAiAdmin)
// Risultato: navigando tra le pagine il login Google veniva richiesto
// di nuovo. Questo modulo tiene il token sincronizzato su TUTTE le
// chiavi e su localStorage + sessionStorage, senza toccare le pagine.
// Le pagine continuano a leggere la loro chiave: troveranno il token.
// ============================================================

const KEYS = [
  'leles_admin_id_token',
  'dv_google_id_token',
  'bar_ai_admin_id_token',
]

const LAST_PROMPT_KEY = 'dv_admin_auth_last_prompt'
const ADMIN_PATH_RE = /(leles|improve|image-lab|dag-admin|git-admin|api-contracts|bar-ai-admin|\/test\d?|testbarai)/i

function parseJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(
      decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join('')
      )
    )
  } catch {
    return null
  }
}

function isValid(token) {
  const p = token ? parseJwt(token) : null
  return !!p?.exp && p.exp * 1000 > Date.now() + 5000
}

function readAll() {
  const out = []
  if (typeof window === 'undefined') return out
  for (const key of KEYS) {
    for (const store of [window.localStorage, window.sessionStorage]) {
      try {
        const t = store.getItem(key)
        if (t) out.push(t)
      } catch {}
    }
  }
  return out
}

function writeAll(token) {
  for (const key of KEYS) {
    for (const store of [window.localStorage, window.sessionStorage]) {
      try {
        if (store.getItem(key) !== token) store.setItem(key, token)
      } catch {}
    }
  }
}

let lastSynced = ''

function sync() {
  const tokens = readAll().filter(isValid)
  if (tokens.length === 0) return null
  const token = tokens[0]
  if (token !== lastSynced) {
    writeAll(token)
    lastSynced = token
  }
  return token
}

// Rinnovo silenzioso: se il token scade entro 10 minuti (o e' appena
// scaduto) e siamo su una pagina admin, chiediamo a Google Identity
// Services un prompt One Tap. GIS lo mostra al massimo una volta
// all'ora e rispetta il dismiss dell'utente. Il credential torna alla
// callback della pagina corrente (che salva la sua chiave), poi il
// sync lo propaga ovunque.
function maybeRenew() {
  if (typeof window === 'undefined') return
  if (!ADMIN_PATH_RE.test(window.location.pathname)) return
  let exp = 0
  let hasToken = false
  for (const t of readAll()) {
    const p = parseJwt(t)
    if (p?.exp) {
      hasToken = true
      if (p.exp > exp) exp = p.exp
    }
  }
  if (!hasToken) return
  const msLeft = exp * 1000 - Date.now()
  if (msLeft > 10 * 60 * 1000) return          // ancora valido per un pezzo
  if (msLeft < -60 * 60 * 1000) return         // token vecchissimo: sessione abbandonata
  try {
    const last = Number(window.localStorage.getItem(LAST_PROMPT_KEY) || 0)
    if (Date.now() - last < 30 * 60 * 1000) return
  } catch {}
  try {
    const gid = window.google?.accounts?.id
    if (!gid?.prompt) return
    window.localStorage.setItem(LAST_PROMPT_KEY, String(Date.now()))
    gid.prompt()
  } catch {}
}

export function adminAuthInit() {
  if (typeof window === 'undefined') return
  sync()
  window.addEventListener('storage', (e) => {
    if (e.key && KEYS.includes(e.key)) {
      lastSynced = ''
      sync()
    }
  })
  window.setInterval(sync, 2000)
  window.setInterval(maybeRenew, 5 * 60 * 1000)
  window.setTimeout(maybeRenew, 8000)
}
