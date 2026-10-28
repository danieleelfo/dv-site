// ============================================================
// AI ETHICS — sezione editoriale (indice + articolo)
// Data-driven: i contenuti vivono in src/content/aiEthics.js.
// Il rendering dell'articolo legge i blocchi dal data file,
// quindi aggiungere un articolo NON richiede toccare questo
// componente. I testi dell'interfaccia sono in i18n (ethics.*),
// i contenuti degli articoli hanno fallback inglese.
//
// Tipi di blocco supportati nel body:
//   { type: 'p',     text }
//   { type: 'h3',    text }
//   { type: 'list',  items: [] }
//   { type: 'video', id, title, caption }   <- embed YouTube ufficiale
// Campo opzionale a livello di articolo:
//   video: { id, title, caption }  -> anteprima nell'indice + player in cima all'articolo
// L'indice ordina per data (più recente in alto); il primo mostra anche l'inizio del testo.
// ============================================================

import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ARTICLES, getArticle, getArticleContent } from '../content/aiEthics'

function fmtDate(iso, lang) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(lang === 'en' ? 'en-GB' : lang, {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch {
    return iso
  }
}

// ------------------------------------------------------------
// Indice della sezione
// ------------------------------------------------------------
export function AIEthicsIndex() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language || 'en'

  useEffect(() => {
    document.title = t('ethics.docTitle')
  }, [t])

  // Più recente in alto
  const sorted = [...ARTICLES].sort((x, y) => y.date.localeCompare(x.date))

  return (
    <section className="ae-page">
      <style>{`
.ae-page{min-height:100vh;background:#0b1015;color:#e8edf2;padding:56px 20px 80px}
.ae-wrap{max-width:760px;margin:0 auto}
.ae-kicker{font-family:var(--mono,monospace);font-size:12px;letter-spacing:.18em;color:#5eead4;text-transform:uppercase}
.ae-h1{font-size:clamp(30px,5vw,44px);line-height:1.1;font-weight:800;margin:10px 0 14px;color:#fff}
.ae-sub{color:#9fb0c0;font-size:16.5px;line-height:1.6;max-width:620px}
.ae-note{margin:26px 0 0;padding:14px 16px;border:1px solid #1e2a36;border-left:3px solid #5eead4;border-radius:10px;background:#0e1620;color:#8ea0b3;font-size:13.5px;line-height:1.6}
.ae-list{margin-top:44px;display:flex;flex-direction:column;gap:20px}
.ae-card{border:1px solid #1e2a36;border-radius:14px;padding:24px;background:#0e1620;transition:border-color .2s,transform .2s}
.ae-card:hover{border-color:#31485e;transform:translateY(-2px)}
.ae-featured{border-color:#1f4d47}
.ae-thumb{position:relative;display:block;aspect-ratio:16/9;margin-top:16px;border-radius:10px;overflow:hidden;background:#000}
.ae-thumb img{width:100%;height:100%;object-fit:cover;display:block;opacity:.9}
.ae-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.6)}
.ae-card .ae-intro{margin-top:10px;color:#b8c6d4}
.ae-card-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.ae-chip{font-family:var(--mono,monospace);font-size:11px;letter-spacing:.14em;color:#5eead4;border:1px solid #1f4d47;border-radius:999px;padding:4px 10px}
.ae-date{font-size:12.5px;color:#75879a}
.ae-card h2{font-size:21px;line-height:1.3;color:#fff;margin:14px 0 10px;font-weight:700}
.ae-card p{color:#9fb0c0;font-size:15px;line-height:1.65;margin:0}
.ae-more{display:inline-block;margin-top:16px;color:#5eead4;font-size:14px;font-weight:600;text-decoration:none}
.ae-more:hover{text-decoration:underline}
.ae-foot{margin-top:56px;color:#5b6b7d;font-size:12.5px}
      `}</style>
      <div className="ae-wrap">
        <div className="ae-kicker">Editorial</div>
        <h1 className="ae-h1">{t('ethics.title')}</h1>
        <p className="ae-sub">{t('ethics.subtitle')}</p>
        <div className="ae-note">{t('ethics.method')}</div>

        <div className="ae-list">
          {sorted.map((a, idx) => {
            const c = getArticleContent(a, lang)
            const featured = idx === 0
            const intro = featured ? c.body?.find((b) => b.type === 'p')?.text : null
            return (
              <article key={a.slug} className={`ae-card${featured ? ' ae-featured' : ''}`}>
                <div className="ae-card-top">
                  <span className="ae-chip">{a.category} #{a.number}</span>
                  <span className="ae-date">
                    {fmtDate(a.date, lang)} · {t('ethics.minRead', { count: a.readTime })}
                  </span>
                </div>
                {a.video && (
                  <Link className="ae-thumb" to={`/ai-ethics/${a.slug}`} aria-label={c.title}>
                    <img
                      src={`https://i.ytimg.com/vi/${a.video.id}/hqdefault.jpg`}
                      alt=""
                      loading="lazy"
                    />
                    <span className="ae-play">▶</span>
                  </Link>
                )}
                <h2>{c.title}</h2>
                <p>{c.dek}</p>
                {intro && <p className="ae-intro">{intro}</p>}
                <Link className="ae-more" to={`/ai-ethics/${a.slug}`}>{t('ethics.read')} →</Link>
              </article>
            )
          })}
        </div>

        <div className="ae-foot">{t('ethics.footNote')}</div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------
// Blocco del body
// ------------------------------------------------------------
function renderBlock(block, i) {
  if (block.type === 'h3') return <h3 key={i}>{block.text}</h3>

  if (block.type === 'list') {
    return (
      <ul key={i}>
        {block.items.map((item, j) => <li key={j}>{item}</li>)}
      </ul>
    )
  }

  if (block.type === 'video') {
    // Embed del player ufficiale: il video resta sul canale del titolare dei diritti.
    // youtube-nocookie = meno tracciamento finché l'utente non avvia il video.
    return (
      <figure key={i} className="ae-video">
        <div className="ae-video-frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${block.id}`}
            title={block.title}
            loading="lazy"
            allow="encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <figcaption>
          {block.caption}{' '}
          <a
            href={`https://www.youtube.com/watch?v=${block.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            YouTube
          </a>
        </figcaption>
      </figure>
    )
  }

  return <p key={i}>{block.text}</p>
}

// ------------------------------------------------------------
// Articolo
// ------------------------------------------------------------
export function AIEthicsArticle() {
  const { slug } = useParams()
  const { t, i18n } = useTranslation()
  const lang = i18n.language || 'en'
  const article = getArticle(slug)
  // Guard: con uno slug inesistente non chiamiamo getArticleContent
  const c = article ? getArticleContent(article, lang) : null

  useEffect(() => {
    if (c) document.title = c.title + ' — AI Ethics'
  }, [c])

  if (!article || !c) {
    return (
      <section className="ae-page">
        <style>{AE_STYLE}</style>
        <div className="ae-wrap">
          <h1 className="ae-h1">{t('ethics.notFound')}</h1>
          <Link className="ae-more" to="/ai-ethics">{t('ethics.back')}</Link>
        </div>
      </section>
    )
  }

  return (
    <section className="ae-page">
      <style>{AE_STYLE}</style>
      <article className="ae-wrap">
        <Link className="ae-backlink" to="/ai-ethics">← {t('ethics.back')}</Link>
        <div className="ae-kicker">{article.category} #{article.number}</div>
        <h1 className="ae-h1">{c.title}</h1>
        <div className="ae-meta">
          {fmtDate(article.date, lang)} · {t('ethics.minRead', { count: article.readTime })} · AI Ethics
        </div>
        <p className="ae-dek">{c.dek}</p>

        {article.video && renderBlock({ type: 'video', ...article.video }, 'top-video')}

        <div className="ae-body">
          {c.body.map(renderBlock)}
        </div>

        <h3 className="ae-sources-title">{t('ethics.sources')}</h3>
        <ul className="ae-sources">
          {article.sources.map((s, i) => (
            <li key={i}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>
            </li>
          ))}
        </ul>

        <div className="ae-foot">{t('ethics.footNote')}</div>
      </article>
    </section>
  )
}

const AE_STYLE = `
.ae-page{min-height:100vh;background:#0b1015;color:#e8edf2;padding:48px 20px 80px}
.ae-wrap{max-width:700px;margin:0 auto}
.ae-kicker{font-family:var(--mono,monospace);font-size:12px;letter-spacing:.18em;color:#5eead4;text-transform:uppercase}
.ae-h1{font-size:clamp(28px,4.6vw,40px);line-height:1.15;font-weight:800;margin:12px 0 12px;color:#fff}
.ae-meta{font-size:13px;color:#75879a;margin-bottom:18px}
.ae-dek{font-size:17px;line-height:1.6;color:#b8c6d4;font-weight:500;margin:0 0 30px}
.ae-body p{font-size:16px;line-height:1.75;color:#c8d3de;margin:0 0 20px}
.ae-body h3{font-size:21px;color:#fff;font-weight:700;margin:38px 0 14px}
.ae-body ul{margin:0 0 22px;padding-left:22px}
.ae-body li{font-size:15.5px;line-height:1.7;color:#c8d3de;margin-bottom:10px}
.ae-video{margin:0 0 24px}
.ae-video-frame{position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;border:1px solid #1e2a36;background:#000}
.ae-video-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.ae-video figcaption{font-size:12.5px;color:#75879a;margin-top:8px}
.ae-video a{color:#5eead4;text-decoration:none}
.ae-video a:hover{text-decoration:underline}
.ae-sources-title{font-size:18px;color:#fff;font-weight:700;margin:44px 0 14px;border-top:1px solid #1e2a36;padding-top:30px}
.ae-sources{margin:0;padding-left:22px}
.ae-sources li{font-size:13.5px;line-height:1.6;color:#8ea0b3;margin-bottom:8px}
.ae-sources a{color:#5eead4;text-decoration:none}
.ae-sources a:hover{text-decoration:underline}
.ae-backlink{display:inline-block;font-size:13.5px;color:#8ea0b3;text-decoration:none;margin-bottom:26px}
.ae-backlink:hover{color:#5eead4}
.ae-more{color:#5eead4}
.ae-foot{margin-top:52px;color:#5b6b7d;font-size:12.5px}
`
