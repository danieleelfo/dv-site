import React from "react";

const OPTIONS = [
  { id: "grid", key: "layoutGrid2", fallback: "Griglia 2 colonne", shape: "grid" },
  { id: "vertical", key: "layoutVertical", fallback: "Striscia verticale", shape: "vertical" },
  { id: "horizontal", key: "layoutHorizontal", fallback: "Striscia orizzontale", shape: "horizontal" },
  { id: "grid3", key: "layoutGrid3", fallback: "Griglia 3 colonne", shape: "grid3" },
  { id: "diagonal", key: "layoutDiagonal", fallback: "Strisce diagonali", shape: "diagonal" },
  { id: "single", key: "layoutCover", fallback: "Copertina", shape: "single" },
];

function Preview({ shape }) {
  return (
    <div className={`cld-preview cld-preview-${shape}`} aria-hidden="true">
      {shape === "grid" && <><i /><i /><i /><i /></>}
      {shape === "vertical" && <><i /><i /><i /></>}
      {shape === "horizontal" && <><i /><i /><i /></>}
      {shape === "grid3" && <><i /><i /><i /><i /><i /><i /></>}
      {shape === "diagonal" && <><i /><i /><i /></>}
      {shape === "single" && <i />}
    </div>
  );
}

export default function ComicLayoutPicker({ value, onChange, panelCount = 0, t }) {
  return (
    <section className="cld-picker" aria-labelledby="cld-title">
      <div className="cld-heading">
        <div>
          <span className="cld-eyebrow">05 / PAGE DESIGN</span>
          <h3 id="cld-title">Layout della pagina</h3>
          <p>Scegli una struttura: potrai cambiare layout senza modificare foto e balloon.</p>
        </div>
        <span className="cld-count">{panelCount} vignette</span>
      </div>
      <div className="cld-options" role="group" aria-label="Layout disponibili">
        {OPTIONS.map(option => {
          const disabled = option.id === "single" && panelCount !== 1;
          const selected = value === option.id;
          const label = t ? t(`img.comics.${option.key}`, option.fallback) : option.fallback;
          return (
            <button
              key={option.id}
              type="button"
              className={`cld-option${selected ? " is-selected" : ""}`}
              onClick={() => onChange(option.id)}
              disabled={disabled}
              aria-pressed={selected}
              title={disabled ? "Disponibile con una sola vignetta" : label}
            >
              <Preview shape={option.shape} />
              <span className="cld-option-label">{label}</span>
              {selected && <span className="cld-selected-mark" aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
      <p className="cld-note">
        {value === "diagonal"
          ? "Le vignette vengono disposte in strisce con tagli obliqui."
          : value === "single"
            ? "Una singola immagine a tutta pagina."
            : "La composizione usa le proporzioni delle immagini originali."}
      </p>
      <style>{STYLES}</style>
    </section>
  );
}

const STYLES = `
.cld-picker{margin:1rem 0;padding:1rem;border:1px solid var(--border,#26333e);border-radius:11px;background:var(--bg-alt,#0f151c);color:var(--ink,#e7edf1)}
.cld-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:.8rem;margin-bottom:.9rem}
.cld-heading h3{margin:.18rem 0 .25rem;font-size:1rem}
.cld-heading p,.cld-note{margin:0;color:var(--ink-dim,#8fa1ac);font-size:.72rem;line-height:1.5}
.cld-eyebrow{color:var(--accent,#3fd0c9);font-size:.62rem;font-weight:700;letter-spacing:.13em}
.cld-count{flex:none;padding:.3rem .55rem;border:1px solid var(--border,#33414c);border-radius:20px;color:var(--ink-dim,#9aabb5);font-size:.68rem}
.cld-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem}
.cld-option{position:relative;display:grid;gap:.45rem;min-width:0;padding:.55rem;border:1px solid var(--border,#33414c);border-radius:9px;background:var(--panel,#121a22);color:inherit;text-align:left;cursor:pointer;font:inherit;transition:border-color .15s,background .15s}
.cld-option:hover:not(:disabled){border-color:var(--accent,#3fd0c9)}
.cld-option.is-selected{border:2px solid var(--accent,#3fd0c9);padding:calc(.55rem - 1px);background:color-mix(in srgb,var(--accent,#3fd0c9) 7%,var(--panel,#121a22))}
.cld-option:disabled{opacity:.35;cursor:not-allowed}
.cld-option-label{font-size:.72rem;font-weight:600;overflow-wrap:anywhere}
.cld-selected-mark{position:absolute;right:.4rem;top:.35rem;display:grid;place-items:center;width:19px;height:19px;border-radius:50%;background:var(--accent,#3fd0c9);color:#071212;font-size:.7rem;font-weight:800}
.cld-preview{display:grid;gap:3px;width:100%;height:76px;padding:5px;border:1px solid #46515b;border-radius:5px;background:#090e13;overflow:hidden}
.cld-preview i{display:block;min-width:0;min-height:0;background:#526d78;border:1px solid #9ab0b8;border-radius:1px}
.cld-preview-grid{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
.cld-preview-vertical{grid-template-columns:1fr;grid-template-rows:repeat(3,1fr)}
.cld-preview-horizontal{grid-template-columns:repeat(3,1fr);grid-template-rows:1fr}
.cld-preview-grid3{grid-template-columns:repeat(3,1fr);grid-template-rows:1fr 1fr}
.cld-preview-single{grid-template-columns:1fr;grid-template-rows:1fr;padding:8px 18%}
.cld-preview-diagonal{display:flex;flex-direction:column;gap:3px}
.cld-preview-diagonal i{flex:1;clip-path:polygon(0 0,100% 16%,100% 84%,0 100%)}
.cld-note{margin-top:.7rem}
@media(max-width:520px){.cld-picker{padding:.75rem}.cld-options{grid-template-columns:repeat(2,minmax(0,1fr))}.cld-preview{height:68px}}
`;
