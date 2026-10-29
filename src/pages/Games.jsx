import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const GAMES = [
  { id: 'snelfa', label: '🐍 SnÆlfa' },
  { id: 'bn2', label: '⚓ Battaglia Navale' },
]

export default function Games() {
  const { t } = useTranslation()
  const [activeGame, setActiveGame] = useState('snelfa')

  return (
    <main className="games-page">
      <header className="games-header">
        <div>
          <p className="games-eyebrow">ARCADE · RETRO GAMING</p>
          <h1>{t('games.title', 'Games')}</h1>
          <p className="games-subtitle">
            A little collection of games. Starting with SnÆlfa.
          </p>
        </div>
      </header>

      <nav className="games-tabs" aria-label="Seleziona gioco">
        {GAMES.map((game) => (
          <button
            key={game.id}
            type="button"
            className={'games-tab' + (activeGame === game.id ? ' active' : '')}
            onClick={() => setActiveGame(game.id)}
            aria-pressed={activeGame === game.id}
          >
            {game.label}
          </button>
        ))}
      </nav>

      {activeGame === 'snelfa' && (
        <section className="games-card" aria-labelledby="snaelfa-title">
          <div className="games-card-header">
            <div>
              <h2 id="snaelfa-title">SnÆlfa 🐍 🐕 🐍 </h2>
              <p>Swipe or use the arrow keys to play.</p>
            </div>
            <span className="games-badge">PLAYER 1</span>
          </div>

          <div className="games-frame-wrap">
            <iframe
              className="games-frame"
              src="/games/snelfa.html"
              title="SnÆlfa — retro snake game"
              loading="eager"
              allow="autoplay"
            />
          </div>
        </section>
      )}

      {activeGame === 'bn2' && (
        <section className="games-card" aria-labelledby="bn2-title">
          <div className="games-card-header">
            <div>
              <h2 id="bn2-title">⚓ Battaglia Navale</h2>
              <p>Sfida un altro giocatore da un telefono o da un computer.</p>
            </div>
            <span className="games-badge games-badge-gold">2 PLAYERS</span>
          </div>

          <div className="games-frame-wrap games-frame-wrap-ocean">
            <iframe
              className="games-frame games-frame-ocean"
              src="https://bn2.danielevillanova.com/"
              title="Battaglia Navale multiplayer"
              loading="eager"
              allow="autoplay"
            />
          </div>
        </section>
      )}

      <style>{`
        .games-page {
          max-width: 1100px;
          margin: 0 auto;
          padding: 32px 20px 48px;
          color: var(--text, inherit);
        }

        .games-header {
          margin-bottom: 28px;
        }

        .games-eyebrow {
          margin: 0 0 8px;
          font-size: 0.75rem;
          letter-spacing: 0.18em;
          opacity: 0.7;
        }

        .games-header h1 {
          margin: 0;
          font-size: clamp(2rem, 5vw, 3rem);
        }

        .games-subtitle {
          opacity: 0.75;
          margin-top: 10px;
        }

        .games-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 24px;
        }

        .games-tab {
          font: inherit;
          padding: 10px 18px;
          border-radius: 10px;
          border: 1px solid var(--border, rgba(128,128,128,.4));
          background: transparent;
          color: inherit;
          cursor: pointer;
          opacity: 0.75;
        }

        .games-tab.active {
          border-color: currentColor;
          opacity: 1;
          font-weight: bold;
        }

        .games-card {
          overflow: hidden;
          border: 1px solid var(--border, rgba(128,128,128,.3));
          border-radius: 16px;
          background: var(--card-bg, rgba(128,128,128,.05));
        }

        .games-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding: 20px 24px;
        }

        .games-card-header h2 {
          margin: 0;
          font-size: 1.5rem;
        }

        .games-card-header p {
          margin: 6px 0 0;
          opacity: 0.7;
          font-size: 0.9rem;
        }

        .games-badge {
          flex-shrink: 0;
          font-size: 0.7rem;
          letter-spacing: 0.1em;
          padding: 6px 10px;
          border: 1px solid rgba(77,255,122,.4);
          border-radius: 999px;
          color: #4dff7a;
        }

        .games-badge-gold {
          border-color: rgba(212,168,67,.5);
          color: #d4a843;
        }

        .games-frame-wrap {
          width: 100%;
          background: #06140a;
          border-top: 1px solid rgba(77,255,122,.2);
        }

        .games-frame-wrap-ocean {
          background: #0d2137;
          border-top: 1px solid rgba(93,173,226,.25);
        }

        .games-frame {
          display: block;
          width: 100%;
          height: 680px;
          border: 0;
          background: #06140a;
        }

        .games-frame-ocean {
          background: #0d2137;
        }

        @media (max-width: 600px) {
          .games-page {
            padding: 22px 12px 32px;
          }

          .games-card-header {
            padding: 16px;
          }

          .games-frame {
            height: 620px;
          }
        }
      `}</style>
    </main>
  )
}
