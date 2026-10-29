  <section className="games-card" aria-labelledby="snaelfa-title">
    <div className="games-card-header">
      <div>
        <h2 id="snaelfa-title">SnÆlfa 🐍</h2>
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

    .games-frame-wrap {
      width: 100%;
      background: #06140a;
      border-top: 1px solid rgba(77,255,122,.2);
    }

    .games-frame {
      display: block;
      width: 100%;
      height: 680px;
      border: 0;
      background: #06140a;
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
