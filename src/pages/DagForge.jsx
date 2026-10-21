// ============================================================
// DAGFORGE — editor web per creare e salvare DAG Airflow lunghi
// Riusa POST /api/improve/save del gateway (Google auth, compila il
// Python prima di salvare). Il file viene salvato come
// <nome>.improved.py dentro la root scelta (es. airflow/dags).
// Nato per aggirare il limite dei 4000 caratteri di Telegram.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import bgImage from '../assets/DataInFlames.jpg'

const LELE_API_URL = 'https://api.danielevillanova.com'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const TOKEN_STORAGE_KEY = 'leles_admin_id_token'

// Root accettate dal gateway (IMPROVE_ROOTS in gateway.py).
const ROOTS = [
  { value: 'airflow', label: 'Airflow · dags' },
  { value: 'incoming', label: 'Airflow · incoming_files' },
  { value: 'leles', label: 'Repo Leles' },
  { value: 'dv_site', label: 'Repo dv-site' },
]

// Template pre-caricato: DAG "best_of_day_dag" (giudice qwen2.5vl:3b).
const BEST_OF_DAY_DAG = "\"\"\"Best of Day: valuta le immagini di ieri e sceglie le 3 migliori.\n\nOgni notte alle 02:00:\n  1. legge le immagini di ieri da GraDV/history.db (tabella images);\n  2. le valuta con qwen2.5vl:3b via Ollama (score 1-10 + motivo);\n  3. salva i rating nella tabella ratings (salta quelle gia' valutate);\n  4. copia le 3 migliori in GraDV/best_of/<giorno>/ + verdetto.json;\n  5. manda l'album su Telegram con il riassunto.\n\nVariabili d'ambiente opzionali:\n  GRADV_DB         (default ~/Desktop/Danny/GraDV/history.db)\n  BOD_JUDGE_MODEL  (default qwen2.5vl:3b)\n  OLLAMA_URL       (default http://127.0.0.1:11434)\n  TELEGRAM_BOT_TOKEN  (necessario per l'album Telegram)\n  BOD_CHAT_ID      (default 8733881519)\n\"\"\"\n\nimport os\nimport re\nimport json\nimport sqlite3\nfrom datetime import timedelta\n\nimport pendulum\nimport requests\nfrom airflow import DAG\nfrom airflow.operators.python import PythonOperator\n\nDAG_ID = \"best_of_day_dag\"\nGRADV_DB = os.environ.get(\"GRADV_DB\", os.path.expanduser(\"~/Desktop/Danny/GraDV/history.db\"))\nBEST_DIR = os.path.expanduser(\"~/Desktop/Danny/GraDV/best_of\")\nJUDGE_MODEL = os.environ.get(\"BOD_JUDGE_MODEL\", \"qwen2.5vl:3b\")\nOLLAMA_URL = os.environ.get(\"OLLAMA_URL\", \"http://127.0.0.1:11434\")\nTG_TOKEN = os.environ.get(\"TELEGRAM_BOT_TOKEN\", \"\")\nTG_CHAT_ID = int(os.environ.get(\"BOD_CHAT_ID\", \"8733881519\"))\nTOP_N = 3\nMAX_IMAGES = 60  # tetto di sicurezza: massimo di immagini valutate per notte\n\nJUDGE_PROMPT = (\n    \"Valuta questa immagine generata con AI come giudice di fotografia digitale. \"\n    \"Rispondi SOLO con un oggetto JSON su una riga: \"\n    '{\"score\": <numero da 1 a 10>, \"reason\": \"<motivo breve in italiano>\"} '\n    \"Considera: qualita' artistica, coerenza col prompt, artefatti evidenti, \"\n    \"composizione. Sii severo ma corretto.\"\n)\n\n\ndef _day_of_run(context):\n    \"\"\"Il DAG gira alle 2 di notte: il giorno valutato e' ieri.\"\"\"\n    ts = (context or {}).get(\"data_interval_start\") or (context or {}).get(\"logical_date\")\n    if ts is None:\n        from datetime import datetime\n        ts = datetime.now()\n    return (ts - timedelta(days=1)).strftime(\"%Y-%m-%d\")\n\n\ndef _connect():\n    conn = sqlite3.connect(GRADV_DB)\n    conn.row_factory = sqlite3.Row\n    return conn\n\n\ndef ensure_ratings_table():\n    with _connect() as conn:\n        conn.execute(\n            \"CREATE TABLE IF NOT EXISTS ratings (\"\n            \" image_id INTEGER PRIMARY KEY,\"\n            \" score REAL NOT NULL,\"\n            \" reason TEXT,\"\n            \" model TEXT,\"\n            \" rated_at TEXT NOT NULL)\"\n        )\n\n\ndef fetch_images(day):\n    \"\"\"Immagini del giorno NON ancora valutate (LEFT JOIN ratings).\"\"\"\n    with _connect() as conn:\n        rows = conn.execute(\n            \"SELECT i.id, i.image_data, i.prompt, i.seed\"\n            \" FROM images i\"\n            \" LEFT JOIN ratings r ON r.image_id = i.id\"\n            \" WHERE i.created_at LIKE ? AND r.image_id IS NULL\"\n            \" ORDER BY i.id\"\n            \" LIMIT ?\",\n            (day + \"%\", MAX_IMAGES),\n        ).fetchall()\n    return [dict(r) for r in rows]\n\n\ndef rate_image(item):\n    \"\"\"Chiede il voto al modello VL; ritorna (score, reason).\"\"\"\n    import base64\n    b64 = base64.b64encode(item[\"image_data\"]).decode(\"utf-8\")\n\n    response = requests.post(\n        OLLAMA_URL + \"/api/generate\",\n        json={\n            \"model\": JUDGE_MODEL,\n            \"prompt\": JUDGE_PROMPT,\n            \"images\": [b64],\n            \"stream\": False,\n            \"options\": {\"temperature\": 0.2, \"num_predict\": 200},\n        },\n        timeout=300,\n    )\n    response.raise_for_status()\n    text = (response.json().get(\"response\") or \"\").strip()\n\n    score, reason = None, text[:300]\n    try:\n        match = re.search(r\"\\{.*\\}\", text, re.DOTALL)\n        if match:\n            data = json.loads(match.group(0))\n            score = float(data.get(\"score\"))\n            reason = str(data.get(\"reason\") or reason)\n    except (ValueError, TypeError):\n        score = None\n\n    if score is None:\n        match = re.search(r\"([0-9]{1,2}(?:[.,][0-9])?)\", text)\n        if match:\n            score = float(match.group(1).replace(\",\", \".\"))\n    if score is None:\n        raise ValueError(\"nessuno score nel giudizio: \" + text[:200])\n    return max(1.0, min(10.0, score)), reason\n\n\ndef save_rating(image_id, score, reason):\n    from datetime import datetime\n    with _connect() as conn:\n        conn.execute(\n            \"INSERT OR REPLACE INTO ratings (image_id, score, reason, model, rated_at)\"\n            \" VALUES (?, ?, ?, ?, ?)\",\n            (image_id, score, reason, JUDGE_MODEL, datetime.now().isoformat()),\n        )\n\n\ndef top_rated(day, limit):\n    \"\"\"Le immagini del giorno col rating piu' alto (che hanno il rating).\"\"\"\n    with _connect() as conn:\n        rows = conn.execute(\n            \"SELECT i.id, i.image_data, i.prompt, i.seed, r.score, r.reason\"\n            \" FROM images i\"\n            \" JOIN ratings r ON r.image_id = i.id\"\n            \" WHERE i.created_at LIKE ?\"\n            \" ORDER BY r.score DESC, i.id ASC\"\n            \" LIMIT ?\",\n            (day + \"%\", limit),\n        ).fetchall()\n    return [dict(r) for r in rows]\n\n\ndef _send_text(text):\n    if not TG_TOKEN:\n        print(\"[best_of_day] TELEGRAM_BOT_TOKEN assente, skip messaggio.\")\n        return\n    try:\n        requests.post(\n            \"https://api.telegram.org/bot\" + TG_TOKEN + \"/sendMessage\",\n            json={\"chat_id\": TG_CHAT_ID, \"text\": text, \"parse_mode\": \"HTML\"},\n            timeout=30,\n        )\n    except Exception as exc:\n        print(\"[best_of_day] Telegram sendMessage fallito: \" + str(exc))\n\n\ndef _send_album(day, payload):\n    if not TG_TOKEN:\n        print(\"[best_of_day] TELEGRAM_BOT_TOKEN assente, skip album.\")\n        return\n    if not payload:\n        _send_text(\"Nessuna immagine valutata per il \" + day + \".\")\n        return\n\n    media = []\n    files_payload = {}\n    for i, item in enumerate(payload):\n        caption = (\n            \"#\" + str(i + 1) + \" (score \" + str(round(item[\"score\"], 1)) + \")\"\n            + \"\\n\" + (item[\"prompt\"] or \"\")[:200]\n        )\n        media.append({\"type\": \"photo\", \"media\": \"attach://p\" + str(i), \"caption\": caption})\n        files_payload[\"p\" + str(i)] = open(item[\"file\"], \"rb\")\n\n    try:\n        requests.post(\n            \"https://api.telegram.org/bot\" + TG_TOKEN + \"/sendMediaGroup\",\n            data={\"chat_id\": str(TG_CHAT_ID), \"media\": json.dumps(media)},\n            files=files_payload,\n            timeout=120,\n        )\n    except Exception as exc:\n        print(\"[best_of_day] Telegram album fallito: \" + str(exc))\n    finally:\n        for f in files_payload.values():\n            f.close()\n\n    summary = (\n        \"Immagine <b>Best of Day</b> - \" + day + \"\\n\"\n        \"Valutate con \" + JUDGE_MODEL + \". Top \" + str(len(payload)) + \":\"\n    )\n    for i, item in enumerate(payload):\n        summary += (\n            \"\\n#\" + str(i + 1) + \" score \" + str(round(item[\"score\"], 1))\n            + \" - \" + (item[\"reason\"] or \"\")[:120]\n        )\n    _send_text(summary)\n\n\ndef run_best_of_day(**context):\n    day = _day_of_run(context)\n    print(\"[best_of_day] Giorno valutato: \" + day)\n\n    ensure_ratings_table()\n    items = fetch_images(day)\n    print(\"[best_of_day] Da valutare: \" + str(len(items)))\n\n    if not items and not top_rated(day, 1):\n        msg = \"Immagine <b>Best of Day</b>\\nNessuna immagine trovata per il \" + day + \".\"\n        _send_text(msg)\n        return\n\n    for item in items:\n        try:\n            score, reason = rate_image(item)\n            save_rating(item[\"id\"], score, reason)\n            print(\"[best_of_day] id=\" + str(item[\"id\"]) + \" score=\" + str(score))\n        except Exception as exc:\n            print(\"[best_of_day] rating fallito id=\" + str(item[\"id\"]) + \": \" + str(exc))\n\n    top = top_rated(day, TOP_N)\n\n    out_dir = os.path.join(BEST_DIR, day)\n    os.makedirs(out_dir, exist_ok=True)\n\n    payload = []\n    for rank, row in enumerate(top, 1):\n        dest = os.path.join(out_dir, \"top\" + str(rank) + \"_id\" + str(row[\"id\"]) + \".png\")\n        with open(dest, \"wb\") as f:\n            f.write(row[\"image_data\"])\n        payload.append({\n            \"rank\": rank,\n            \"id\": row[\"id\"],\n            \"score\": row[\"score\"],\n            \"reason\": row[\"reason\"],\n            \"prompt\": row[\"prompt\"],\n            \"seed\": row[\"seed\"],\n            \"file\": dest,\n        })\n\n    with open(os.path.join(out_dir, \"verdetto.json\"), \"w\", encoding=\"utf-8\") as f:\n        json.dump({\"day\": day, \"model\": JUDGE_MODEL, \"top\": payload}, f, ensure_ascii=False, indent=2)\n\n    _send_album(day, payload)\n    print(\"[best_of_day] Fatto: \" + str(len(payload)) + \" top in \" + out_dir)\n\n\nwith DAG(\n    dag_id=DAG_ID,\n    description=\"Valuta le immagini di GraDV del giorno prima e sceglie le 3 migliori.\",\n    schedule=\"0 2 * * *\",\n    start_date=pendulum.datetime(2026, 10, 21, tz=\"Europe/Madrid\"),\n    catchup=False,\n    tags=[\"gradv\", \"immagini\", \"telegram\"],\n) as dag:\n    PythonOperator(\n        task_id=\"run_best_of_day\",\n        python_callable=run_best_of_day,\n    )\n"

function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(window.atob(base64))))
  } catch (e) {
    return null
  }
}

export default function DagForge() {
  const [idToken, setIdToken] = useState(() => {
    try {
      return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || null
    } catch (e) {
      return null
    }
  })
  const [profile, setProfile] = useState(() => (idToken ? decodeJwtPayload(idToken) : null))
  const [authError, setAuthError] = useState('')
  const [gsiReady, setGsiReady] = useState(false)
  const buttonRef = useRef(null)

  const [root, setRoot] = useState('airflow')
  const [path, setPath] = useState('best_of_day_dag.py')
  const [code, setCode] = useState(BEST_OF_DAY_DAG)
  const [status, setStatus] = useState(null) // { ok, text }
  const [busy, setBusy] = useState(false)

  function handleCredentialResponse(credentialResponse) {
    const token = credentialResponse?.credential
    if (!token) {
      setAuthError('Login Google fallito: nessun token ricevuto.')
      return
    }
    setAuthError('')
    setProfile(decodeJwtPayload(token))
    setIdToken(token)
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } catch (e) {
      /* no-op */
    }
  }

  useEffect(() => {
    if (idToken) return
    let cancelled = false
    let attempts = 0

    function tryInit() {
      if (cancelled) return
      if (!window.google?.accounts?.id) {
        if (++attempts > 80) {
          setAuthError('Impossibile caricare il login Google. Controlla adblock e rete, poi ricarica la pagina.')
          return
        }
        setTimeout(tryInit, 150)
        return
      }
      if (!GOOGLE_CLIENT_ID) {
        setAuthError('GOOGLE_CLIENT_ID non configurato nel frontend.')
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
      setGsiReady(true)
    }

    tryInit()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken])

  function logout() {
    setIdToken(null)
    setProfile(null)
    setStatus(null)
    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      window.google?.accounts?.id?.disableAutoSelect()
    } catch (e) {
      /* no-op */
    }
  }

  async function save(e) {
    e?.preventDefault()
    if (!idToken || busy || !code.trim() || !path.trim()) return
    setBusy(true)
    setStatus(null)
    try {
      const res = await fetch(LELE_API_URL + '/api/improve/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + idToken,
        },
        body: JSON.stringify({ root, path, code }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          logout()
          setStatus({ ok: false, text: 'Sessione scaduta: rifai il login. ' + (data.detail || '') })
          return
        }
        setStatus({ ok: false, text: typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail) })
        return
      }
      setStatus({
        ok: true,
        text:
          'Salvato: ' + (data.saved_path || path) + ' (' + (data.bytes || 0) + ' byte). ' +
          'Airflow lo vedrà come ' + DAG_ID_OF(code) + '. Da Telegram: airflow dags unpause ' + DAG_ID_OF(code) + '.',
      })
    } catch (err) {
      setStatus({ ok: false, text: 'Errore di rete: ' + err.message })
    } finally {
      setBusy(false)
    }
  }

  // Estrae il dag_id dal codice (per il promemoria post-salvataggio).
  function DAG_ID_OF(text) {
    const m = (text || '').match(/dag_id\s*=\s*["']([^"']+)["']/)
    return m ? m[1] : '<dag_id>'
  }

  const lines = code.split('\n').length

  const backdrop = (
    <>
      <img src={bgImage} alt="" className="df-bg" />
      <div className="df-shade" />
    </>
  )

  if (!idToken) {
    return (
      <div className="df-page">
        <style>{css}</style>
        {backdrop}
        <div className="df-wrap">
          <div className="df-top">
            <h1 className="df-title">DagForge</h1>
            <div ref={buttonRef} className="df-gbtn" />
          </div>
          <p className="df-dim df-small">Editor DAG riservato: serve il login Google admin.</p>
          {authError && <p className="df-err df-small">{authError}</p>}
          {!gsiReady && !authError && <p className="df-dim df-small">Caricamento login Google…</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="df-page">
      <style>{css}</style>
      {backdrop}

      <div className="df-wrap">
        <div className="df-top">
          <h1 className="df-title">DagForge 🔨</h1>
          <div className="df-session">
            <span className="df-ellipsis">{profile?.email || 'account Google'}</span>
            <button type="button" className="df-btn df-btn--sm" onClick={logout}>
              Logout
            </button>
          </div>
        </div>

        <p className="df-dim df-small df-lead">
          Editor per DAG lunghi (oltre il limite di 4000 caratteri di Telegram). Salva via
          /api/improve/save: il gateway compila il Python e scrive <code>&lt;nome&gt;.improved.py</code> nella
          root scelta. Per Airflow conta il dag_id nel contenuto, non il nome del file.
        </p>

        <form className="df-panel df-pad" onSubmit={save}>
          <div className="df-controls">
            <label>
              <span className="df-dim df-small">Destinazione</span>
              <select className="df-select" value={root} onChange={(e) => setRoot(e.target.value)}>
                {ROOTS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className="df-grow">
              <span className="df-dim df-small">Nome file (es. best_of_day_dag.py)</span>
              <input
                type="text"
                className="df-input"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="nome_dag.py"
              />
            </label>
            <button
              type="button"
              className="df-btn"
              onClick={() => setCode(BEST_OF_DAY_DAG)}
              title="Ricarica il template best_of_day_dag nell'editor"
            >
              📂 Template Best of Day
            </button>
            <button type="submit" className="df-btn df-btn--run" disabled={busy || !code.trim() || !path.trim()}>
              {busy ? 'Salvo…' : '💾 Salva file'}
            </button>
          </div>

          <div className="df-meta">
            <span className="df-dim df-small">{code.length.toLocaleString('it-IT')} caratteri · {lines} righe</span>
            <span className="df-dim df-small">Limite gateway: 120.000 caratteri</span>
          </div>

          <textarea
            className="df-editor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            aria-label="Codice del DAG"
          />

          {status && (
            <p className={status.ok ? 'df-ok df-small' : 'df-err df-small'} role="status">
              {status.text}
            </p>
          )}
        </form>

        <section className="df-panel df-pad">
          <h2>Come si attiva</h2>
          <ol className="df-steps df-small">
            <li>Salva il DAG qui (destinazione Airflow · dags). Il file diventa <code>&lt;nome&gt;.improved.py</code>: è normale.</li>
            <li>Da Telegram: <code>airflow dags list</code> per vedere se Airflow lo ha caricato (dag_id nel contenuto).</li>
            <li>Da Telegram: <code>airflow dags unpause &lt;dag_id&gt;</code> per attivare la schedule.</li>
            <li>Test immediato: <code>airflow dags trigger &lt;dag_id&gt;</code> (verifica prima che il modello giudice sia in <code>ollama list</code>).</li>
          </ol>
          <p className="df-dim df-small">
            Il DAG best_of_day_dag richiede TELEGRAM_BOT_TOKEN nell'env di Airflow e il modello
            qwen2.5vl:3b in Ollama.
          </p>
        </section>
      </div>
    </div>
  )
}

const css = `
.df-page{--glass:rgba(16,23,30,.74);--line:rgba(255,255,255,.1);--ok:#4ade80;--bad:#f87171;
  --mono:ui-monospace,'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;
  position:relative;min-height:calc(100vh - 64px);overflow:hidden;color:var(--ink);font-family:var(--sans)}
.df-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.38}
.df-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,16,21,.25) 0%,rgba(11,16,21,.4) 70%)}
.df-wrap{position:relative;max-width:1080px;margin:0 auto;padding:28px 24px 72px}
.df-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.df-gbtn{min-height:32px;flex:none}
.df-title{font-size:clamp(22px,4vw,30px);font-weight:650;letter-spacing:-.01em}
.df-lead{margin:14px 0 18px;line-height:1.5}
.df-lead code,.df-steps code{font-family:var(--mono);font-size:12px;background:rgba(255,255,255,.08);
  padding:1px 6px;border-radius:6px}
.df-session{display:flex;align-items:center;gap:10px;padding:5px 5px 5px 14px;border:1px solid var(--line);
  border-radius:999px;background:var(--glass);font-size:12px;color:var(--ink-dim)}
.df-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.df-panel{background:var(--glass);border:1px solid var(--line);border-radius:16px;backdrop-filter:blur(14px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.df-pad{padding:16px 18px}
.df-panel+.df-panel{margin-top:18px}
.df-panel h2{font-size:15px;font-weight:650;margin-bottom:8px}
.df-dim{color:var(--ink-dim)}
.df-small{font-size:12px}
.df-ok{color:var(--ok)}
.df-err{color:var(--bad)}
.df-controls{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px}
.df-controls label{display:flex;flex-direction:column;gap:4px}
.df-grow{flex:1;min-width:220px}
.df-select,.df-input{padding:7px 12px;border-radius:8px;border:1px solid var(--line);
  background:rgba(255,255,255,.05);color:var(--ink);font:inherit;font-size:13px}
.df-select option{color:#111}
.df-input:focus,.df-select:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.df-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:8px 14px;border-radius:8px;
  border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--ink);font:inherit;font-size:13px;
  cursor:pointer;transition:background .15s,border-color .15s}
.df-btn:hover:not(:disabled){background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.25)}
.df-btn:disabled{opacity:.45;cursor:not-allowed}
.df-btn--sm{padding:4px 10px;font-size:11px;border-radius:999px}
.df-btn--run{background:var(--accent);border-color:var(--accent);color:#07201f;font-weight:650}
.df-btn--run:hover:not(:disabled){background:#6fe3dd;border-color:#6fe3dd}
.df-meta{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.df-editor{width:100%;box-sizing:border-box;min-height:420px;resize:vertical;padding:12px;border-radius:10px;
  border:1px solid var(--line);background:rgba(0,0,0,.32);color:var(--ink);font-family:var(--mono);
  font-size:12.5px;line-height:1.55;tab-size:4}
.df-editor:focus{outline:none;border-color:rgba(63,208,201,.5)}
.df-steps{margin:0 0 10px;padding-left:20px;line-height:1.7}
.df-page :is(button,input,select,textarea):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:560px){
  .df-wrap{padding:20px 14px 56px}
  .df-controls{align-items:stretch}
}
`

