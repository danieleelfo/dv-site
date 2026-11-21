import { useEffect, useMemo, useRef } from "react";

const FORMATS = {
  "a4-portrait": { label: "A4 · Portrait", ratio: 210 / 297 },
  "a4-landscape": { label: "A4 · Landscape", ratio: 297 / 210 },
  square: { label: "Quadrato", ratio: 1 },
  "comic-portrait": { label: "Comic · Verticale", ratio: 2 / 3 },
  "comic-landscape": { label: "Comic · Orizzontale", ratio: 3 / 2 },
};
const SHAPES = [["rect","Rettangolo"],["diagonal-right","Diagonale ↘"],["diagonal-left","Diagonale ↙"],["trapezoid","Trapezio"],["diamond","Rombo"]];
export function defaultGeometry(index,count){
  const cols=count<=1?1:2, rows=Math.ceil(count/cols), gap=.018;
  const w=(1-gap*(cols+1))/cols, h=(1-gap*(rows+1))/rows;
  return {x:gap+(index%cols)*(w+gap),y:gap+Math.floor(index/cols)*(h+gap),w,h};
}
function shapeStyle(shape){
  if(shape==="diamond")return {clipPath:"polygon(50% 0,100% 50%,50% 100%,0 50%)"};
  if(shape==="trapezoid")return {clipPath:"polygon(18% 0,82% 0,100% 100%,0 100%)"};
  if(shape==="diagonal"||shape==="diagonal-right")return {clipPath:"polygon(0 0,100% 12%,100% 100%,0 88%)"};
  if(shape==="diagonal-left")return {clipPath:"polygon(0 12%,100% 0,100% 88%,0 100%)"};
  return {};
}
export default function ComicPageEditor({panels,onPanelsChange,pageFormat,onPageFormatChange,activeId,onActiveIdChange}){
  const dragStopRef=useRef(null);
  // Se il componente sparisce durante un trascinamento, rimuovo i listener sulla finestra.
  useEffect(()=>()=>{dragStopRef.current?.();},[]);
  const pageRef=useRef(null), format=FORMATS[pageFormat]||FORMATS["a4-portrait"];
  const geometries=useMemo(()=>panels.map((p,i)=>p.geometry||defaultGeometry(i,panels.length)),[panels]);
  const cropOf=p=>({x:.5,y:.5,zoom:1,...(p.crop||{})});
  function patchPanel(id,patch){onPanelsChange(old=>old.map(p=>p.id===id?{...p,...patch}:p));}
  function drag(event,panel,index,resize=false){
    if(event.button!==undefined&&event.button!==0)return;
    event.preventDefault();event.stopPropagation();onActiveIdChange(panel.id);
    const bounds=pageRef.current?.getBoundingClientRect();if(!bounds)return;
    const sx=event.clientX,sy=event.clientY,initial=panel.geometry||geometries[index];
    const move=e=>{
      const dx=(e.clientX-sx)/bounds.width,dy=(e.clientY-sy)/bounds.height;
      if(resize){
        patchPanel(panel.id,{geometry:{...initial,w:Math.max(.08,Math.min(1-initial.x,initial.w+dx)),h:Math.max(.08,Math.min(1-initial.y,initial.h+dy))}});
      }else{
        patchPanel(panel.id,{geometry:{...initial,x:Math.max(0,Math.min(1-initial.w,initial.x+dx)),y:Math.max(0,Math.min(1-initial.h,initial.y+dy))}});
      }
    };
    const stop=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",stop);window.removeEventListener("pointercancel",stop);dragStopRef.current=null;};
    dragStopRef.current=stop;
    window.addEventListener("pointermove",move);window.addEventListener("pointerup",stop);window.addEventListener("pointercancel",stop);
  }
  function autoArrange(mode){
    const n=panels.length,gap=.018,cols=mode==="vertical"?1:mode==="horizontal"?n:Math.min(2,n),rows=Math.ceil(n/cols);
    const w=(1-gap*(cols+1))/cols,h=(1-gap*(rows+1))/rows;
    onPanelsChange(old=>old.map((p,i)=>({ ...p,geometry:{x:gap+(i%cols)*(w+gap),y:gap+Math.floor(i/cols)*(h+gap),w,h}})));
  }
  const active=panels.find(p=>p.id===activeId)||panels[0]||null;
  return <section className="fb-panel fb-page-editor">
    <div className="fb-editor-heading"><div><h2>Image Layout</h2><p className="fb-hint">Sposta e ridimensiona le vignette direttamente sulla pagina. Ogni foto resta un elemento indipendente.</p></div>
      <label className="fb-format-control">Formato pagina<select className="fb-input" value={pageFormat} onChange={e=>onPageFormatChange(e.target.value)}>{Object.entries(FORMATS).map(([v,f])=><option key={v} value={v}>{f.label}</option>)}</select></label>
    </div>
    <div className="fb-arrange-actions"><span>Disposizione iniziale:</span>
      <button type="button" className="fb-btn fb-mini" disabled={!panels.length} onClick={()=>autoArrange("grid")}>Griglia</button>
      <button type="button" className="fb-btn fb-mini" disabled={!panels.length} onClick={()=>autoArrange("vertical")}>Verticale</button>
      <button type="button" className="fb-btn fb-mini" disabled={!panels.length} onClick={()=>autoArrange("horizontal")}>Orizzontale</button>
    </div>
    <div className="fb-page-stage"><div ref={pageRef} className="fb-page-canvas" style={{aspectRatio:String(format.ratio)}}>
      {panels.map((p,i)=>{const g=geometries[i],selected=p.id===active?.id;return <div key={p.id} className={"fb-page-panel"+(selected?" is-selected":"")}
        style={{left:g.x*100+"%",top:g.y*100+"%",width:g.w*100+"%",height:g.h*100+"%",...shapeStyle(p.shape)}}
        onPointerDown={e=>drag(e,p,i)} onClick={()=>onActiveIdChange(p.id)}>
        <img src={p.preview} alt={"Vignetta "+(i+1)} draggable={false} style={{objectPosition:((p.crop?.x??.5)*100)+"% "+((p.crop?.y??.5)*100)+"%",transform:"scale("+(p.crop?.zoom||1)+")"}}/>
        <span className="fb-page-panel-number">{i+1}</span>
        {selected&&<button type="button" className="fb-page-resize" aria-label="Ridimensiona vignetta" onPointerDown={e=>drag(e,p,i,true)}>↘</button>}
      </div>;})}
      {!panels.length&&<p className="fb-page-empty">Aggiungi delle foto per iniziare a comporre la pagina.</p>}
    </div></div>
    {active&&<div className="fb-page-tools"><b>Vignetta {panels.findIndex(p=>p.id===active.id)+1}</b>
      <label>Forma<select className="fb-input" value={active.shape==="diagonal"?"diagonal-right":(active.shape||"rect")} onChange={e=>patchPanel(active.id,{shape:e.target.value})}>{SHAPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Zoom immagine · {Number(active.crop?.zoom||1).toFixed(2)}×<input type="range" min="1" max="2.5" step=".05" value={active.crop?.zoom||1} onChange={e=>patchPanel(active.id,{crop:{...cropOf(active),zoom:Number(e.target.value)}})}/></label>
      <label>Inquadratura ↔ · {Math.round(cropOf(active).x*100)}%<input type="range" min="0" max="1" step=".01" value={cropOf(active).x} onChange={e=>patchPanel(active.id,{crop:{...cropOf(active),x:Number(e.target.value)}})}/></label>
      <label>Inquadratura ↕ · {Math.round(cropOf(active).y*100)}%<input type="range" min="0" max="1" step=".01" value={cropOf(active).y} onChange={e=>patchPanel(active.id,{crop:{...cropOf(active),y:Number(e.target.value)}})}/></label>
      <button type="button" className="fb-btn fb-mini" onClick={()=>patchPanel(active.id,{geometry:null,shape:"rect",crop:{x:.5,y:.5,zoom:1}})}>Reset vignetta</button>
    </div>}
    <style>{`
      .fb-page-editor{display:grid;gap:.8rem}.fb-editor-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap}.fb-editor-heading h2{margin-bottom:.3rem}
      .fb-format-control,.fb-page-tools label{display:grid;gap:.35rem;min-width:170px;color:var(--ink-dim,#9aabb5);font-size:.74rem}
      .fb-arrange-actions{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;color:var(--ink-dim,#9aabb5);font-size:.75rem}
      .fb-page-stage{display:flex;justify-content:center;align-items:flex-start;max-height:75vh;overflow:auto;padding:.6rem;background:var(--bg,#0b1015);border-radius:9px}
      .fb-page-canvas{position:relative;width:min(100%,680px);min-width:260px;max-height:70vh;background:#000;border:1px solid #68717a;box-shadow:0 8px 26px #0005;overflow:hidden}
      .fb-page-panel{position:absolute;box-sizing:border-box;overflow:hidden;background:#20252b;border:2px solid #111;cursor:move;touch-action:none;user-select:none}.fb-page-panel.is-selected{outline:3px solid #3fd0c9;outline-offset:1px;z-index:5}
      .fb-page-panel img{display:block;width:100%;height:100%;object-fit:cover;pointer-events:none}.fb-page-panel-number{position:absolute;left:5px;top:5px;padding:2px 6px;border-radius:4px;background:#080c10bb;color:white;font-size:11px;pointer-events:none}
      .fb-page-resize{position:absolute;right:0;bottom:0;width:30px;height:30px;border:1px solid #fff;border-radius:7px 0 0 0;background:#3fd0c9;color:#071212;font-weight:bold;cursor:nwse-resize;touch-action:none}
      .fb-page-empty{position:absolute;inset:0;display:grid;place-items:center;color:#38434b;font-size:.85rem}.fb-page-tools{display:flex;align-items:end;gap:.8rem;flex-wrap:wrap}.fb-page-tools label{flex:1 1 160px}
      @media(max-width:650px){.fb-page-stage{padding:.25rem}.fb-page-canvas{min-width:240px}.fb-editor-heading{display:grid}}
    `}</style>
  </section>;
}
