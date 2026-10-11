import { useState } from "react";

const API = "https://api.danielevillanova.com";
const USER_ID_KEY = "bar_ai_user_id";

function getUserId() {
  try {
    let id = window.sessionStorage.getItem(USER_ID_KEY);
    if (!id) {
      id = "web_" + Math.random().toString(36).slice(2, 12);
      window.sessionStorage.setItem(USER_ID_KEY, id);
    }
    return id;
  } catch {
    return "web_anonymous";
  }
}

function pretty(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

const EXAMPLES = [
  "Mostrami tutte le ricette con il nome del prodotto, ingrediente e quantità per porzione.",
  "Quali ingredienti sono presenti nel database?",
  "Mostrami le giacenze di magazzino e gli ingredienti sotto la soglia minima.",
  "Quali prodotti hanno una ricetta con più ingredienti?",
];

export default function TestBarAI() {
  const [question, setQuestion] = useState(EXAMPLES[0]);
  const [plan, setPlan] = useState("Premium");
  const [restaurantId, setRestaurantId] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState(null);
  const [history, setHistory] = useState([]);

  async function ask(text = question) {
    const q = text.trim();
    if (!q || loading) return;
    setLoading(true);
    setError("");
    setResponse(null);
    try {
      const res = await fetch(`${API}/api/bar-ai/ask/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          plan,
          restaurant_id: Number(restaurantId),
          user_id: getUserId(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = typeof data.detail === "string"
          ? data.detail
          : data.detail ? JSON.stringify(data.detail) : res.statusText;
        throw new Error(`HTTP ${res.status}: ${detail}`);
      }
      setResponse(data);
      setHistory((items) => [{ question: q, at: new Date().toLocaleTimeString(), data }, ...items].slice(0, 8));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  }

  const rows = Array.isArray(response?.sql_result) ? response.sql_result : [];
  const columns = rows.length ? [...new Set(rows.flatMap((row) => Object.keys(row || {})))] : [];

  return (
    <main className="bat-page">
      <header className="bat-header">
        <div>
          <p className="bat-eyebrow">BAR AI · SANDBOX</p>
          <h1>Ricette e ingredienti</h1>
          <p className="bat-subtitle">Test tramite l'endpoint già esistente <code>/api/bar-ai/ask/</code>.</p>
        </div>
        <a className="bat-back" href="/test6">Apri Test6 →</a>
      </header>

      <section className="bat-notice">
        <strong>Modalità lettura</strong>
        <span>Questa pagina usa solo /ask, che consente query SELECT/WITH. Puoi esplorare ricette, ingredienti e magazzino, ma non aggiungere o modificare righe da qui.</span>
      </section>

      <section className="bat-panel">
        <div className="bat-settings">
          <label>
            Piano
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option>Basic</option><option>Pro</option><option>Premium</option>
            </select>
          </label>
          <label>
            Locale
            <select value={restaurantId} onChange={(e) => setRestaurantId(Number(e.target.value))}>
              <option value={1}>Locale 1</option>
              <option value={2}>Locale 2</option>
              <option value={3}>Locale 3</option>
            </select>
          </label>
        </div>

        <label className="bat-question-label" htmlFor="bat-question">Che cosa vuoi sapere?</label>
        <textarea
          id="bat-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Es. Mostrami tutte le ricette con ingredienti e quantità..."
          rows={4}
        />
        <div className="bat-actions">
          <span className="bat-hint">Invio per inviare · Shift+Invio per andare a capo</span>
          <button onClick={() => ask()} disabled={loading || !question.trim()}>
            {loading ? "Interrogo Bar AI…" : "Chiedi a Bar AI"}
          </button>
        </div>

        <div className="bat-examples">
          <span className="bat-section-label">ESEMPI RAPIDI</span>
          {EXAMPLES.map((example) => (
            <button key={example} className="bat-example" onClick={() => { setQuestion(example); ask(example); }} disabled={loading}>
              {example}
            </button>
          ))}
        </div>
      </section>

      {error && <section className="bat-error"><strong>Errore</strong><pre>{error}</pre></section>}

      {response && (
        <section className="bat-results">
          <div className="bat-result-heading">
            <h2>Risposta</h2>
            {response.agent_type && <span className="bat-chip">Agente: {response.agent_type}</span>}
          </div>
          <div className="bat-answer">{response.answer || "Nessuna risposta testuale."}</div>

          {response.error && <div className="bat-inline-error">Dettaglio: {response.error}</div>}

          {columns.length > 0 && (
            <div className="bat-table-wrap">
              <h3>Risultati SQL · {rows.length} righe</h3>
              <table>
                <thead><tr>{columns.map((col) => <th key={col}>{col}</th>)}</tr></thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>{columns.map((col) => <td key={col}>{row[col] == null ? "—" : typeof row[col] === "object" ? pretty(row[col]) : String(row[col])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {response.sql && (
            <details className="bat-details">
              <summary>Query SQL generata (sola lettura)</summary>
              <pre>{response.sql}</pre>
            </details>
          )}

          {response.kpis && (
            <div className="bat-kpis">
              {Object.entries(response.kpis).map(([key, value]) => (
                <div className="bat-kpi" key={key}><span>{key.replaceAll("_", " ")}</span><strong>{typeof value === "number" ? value.toLocaleString("it-IT", { maximumFractionDigits: 2 }) : String(value)}</strong></div>
              ))}
            </div>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="bat-history">
          <h2>Ultime richieste</h2>
          {history.map((item, i) => (
            <button key={item.at + i} onClick={() => { setQuestion(item.question); setResponse(item.data); setError(""); }}>
              <span>{item.at}</span>{item.question}
            </button>
          ))}
        </section>
      )}

      <style>{`
        .bat-page{max-width:1100px;margin:0 auto;padding:28px 20px 60px;min-height:100vh;background:#0b0e14;color:#e5e7eb;font-family:inherit}
        .bat-header{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:22px;flex-wrap:wrap}
        .bat-eyebrow{font-size:11px;letter-spacing:.16em;color:#34d399;font-weight:800;margin:0 0 8px}
        .bat-header h1{font-size:clamp(25px,4vw,36px);margin:0 0 8px}
        .bat-subtitle{color:#9ca3af;margin:0;font-size:14px}
        .bat-subtitle code{color:#a7f3d0}
        .bat-back{color:#a7f3d0;text-decoration:none;border:1px solid #374151;border-radius:9px;padding:9px 12px;font-size:13px}
        .bat-notice{display:flex;gap:12px;align-items:flex-start;padding:13px 15px;border:1px solid #475569;border-radius:10px;background:#111827;color:#cbd5e1;font-size:13px;line-height:1.5;margin-bottom:18px}
        .bat-notice strong{color:#fbbf24;white-space:nowrap}
        .bat-panel,.bat-results,.bat-history{background:#11151e;border:1px solid #293241;border-radius:14px;padding:18px;margin-bottom:18px}
        .bat-settings{display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap}
        .bat-settings label{display:flex;flex-direction:column;gap:6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af}
        .bat-settings select{min-width:140px}
        .bat-settings select,.bat-page textarea{background:#0b0e14;border:1px solid #374151;border-radius:8px;color:#e5e7eb;padding:10px;font:inherit}
        .bat-question-label{display:block;font-size:12px;color:#9ca3af;margin-bottom:8px}
        .bat-page textarea{width:100%;resize:vertical;box-sizing:border-box;line-height:1.5}
        .bat-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap}
        .bat-hint{font-size:11px;color:#6b7280}
        .bat-page button{cursor:pointer}
        .bat-actions button{border:0;border-radius:8px;background:#34d399;color:#052e22;font-weight:800;padding:11px 16px}
        .bat-page button:disabled{opacity:.5;cursor:not-allowed}
        .bat-examples{display:flex;flex-direction:column;gap:7px;margin-top:20px}
        .bat-section-label{font-size:10px;letter-spacing:.12em;color:#9ca3af;margin-bottom:3px}
        .bat-example{background:#0b0e14;border:1px solid #293241;border-radius:8px;padding:10px;text-align:left;color:#d1d5db;font-size:12px}
        .bat-example:hover,.bat-history button:hover{border-color:#34d399}
        .bat-error{padding:14px;border:1px solid #7f1d1d;background:#2b1117;color:#fecaca;border-radius:10px;margin-bottom:18px;white-space:pre-wrap}
        .bat-error pre{white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:0}
        .bat-results h2,.bat-history h2{font-size:18px;margin:0}
        .bat-result-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap}
        .bat-chip{font-size:11px;color:#a7f3d0;border:1px solid #065f46;border-radius:999px;padding:4px 8px}
        .bat-answer{white-space:pre-wrap;line-height:1.65;font-size:14px}
        .bat-inline-error{margin-top:12px;color:#fca5a5;font-size:12px}
        .bat-table-wrap{overflow:auto;margin-top:22px}
        .bat-table-wrap h3{font-size:14px;margin:0 0 10px}
        .bat-results table{border-collapse:collapse;width:100%;font-size:12px}
        .bat-results th,.bat-results td{text-align:left;padding:9px;border-bottom:1px solid #293241;white-space:nowrap}
        .bat-results th{color:#9ca3af;font-size:10px;text-transform:uppercase;letter-spacing:.08em}
        .bat-details{margin-top:18px}
        .bat-details summary{cursor:pointer;color:#a7f3d0;font-size:12px}
        .bat-details pre{background:#0b0e14;border:1px solid #293241;border-radius:8px;padding:12px;overflow:auto;white-space:pre-wrap}
        .bat-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:18px}
        .bat-kpi{display:flex;flex-direction:column;gap:7px;padding:12px;border:1px solid #293241;border-radius:9px}
        .bat-kpi span{font-size:10px;color:#9ca3af;text-transform:uppercase}
        .bat-kpi strong{font-size:18px;color:#a7f3d0}
        .bat-history h2{margin-bottom:12px}
        .bat-history button{display:flex;gap:12px;align-items:baseline;width:100%;text-align:left;background:transparent;color:#d1d5db;border:1px solid #293241;border-radius:8px;padding:10px;margin-top:7px}
        .bat-history button span{color:#6b7280;font-size:11px;white-space:nowrap}
        @media(max-width:600px){.bat-page{padding:18px 12px 40px}.bat-notice{flex-direction:column;gap:4px}.bat-history button{flex-direction:column;gap:5px}}
      `}</style>
    </main>
  );
}
