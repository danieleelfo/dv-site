import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import bgImage from '../assets/DataInFlames.jpg'

const API = 'https://api.danielevillanova.com'
const TOKEN_KEY = 'dv_google_id_token'
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const LANGS = [
  ['it','🇮🇹','Italiano','Italian'],['es','🇪🇸','Español','Spanish'],
  ['en','🇬🇧','English','English'],['fr','🇫🇷','Français','French'],
  ['nl','🇳🇱','Nederlands','Dutch'],['ca','🏴','Català','Catalan'],
  ['ru','🇷🇺','Русский','Russian'],['uk','🇺🇦','Українська','Ukrainian'],
]
const IDEAS = ['idea1','idea2','idea3','idea4']

function decodeToken(token) {
  try {
    const raw = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')
    return JSON.parse(decodeURIComponent(atob(raw).split('').map(c => '%' + ('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('')))
  } catch { return null }
}
function readToken() {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    return decodeToken(token)?.exp * 1000 > Date.now() + 5000 ? token : null
  } catch { return null }
}

export default function StoryTrial() {
  const { t, i18n } = useTranslation()
  const [token,setToken] = useState(readToken)
  const [role,setRole] = useState(() => readToken() ? 'loading' : 'none')
  const [email,setEmail] = useState('')
  const [chatId,setChatId] = useState(null)
  const [lang,setLang] = useState(() => LANGS.some(x=>x[0]===String(i18n.language).slice(0,2)) ? String(i18n.language).slice(0,2) : 'it')
  const [prompt,setPrompt] = useState('')
  const [audio,setAudio] = useState(true)
  const [fresh,setFresh] = useState(false)
  const [busy,setBusy] = useState(false)
  const [elapsed,setElapsed] = useState(0)
  const [story,setStory] = useState('')
  const [audioUrl,setAudioUrl] = useState('')
  const [audioError,setAudioError] = useState(false)
  const [error,setError] = useState('')
  const [copied,setCopied] = useState(false)
  const loginRef = useRef(null)
  const resultRef = useRef(null)
  const abortRef = useRef(null)
  const authorized = ['admin','super','demo'].includes(role)
  const canGenerate = authorized && Number.isSafeInteger(chatId) && chatId > 0

  useEffect(() => {
    const onStorage = e => { if(e.key===TOKEN_KEY) setToken(e.newValue && decodeToken(e.newValue)?.exp*1000>Date.now()+5000 ? e.newValue : null) }
    window.addEventListener('storage',onStorage)
    return () => window.removeEventListener('storage',onStorage)
  },[])

  useEffect(() => {
    if(!token){setRole('none');setEmail('');setChatId(null);return}
    setRole('loading');setChatId(null)
    const controller=new AbortController()
    fetch(API+'/api/users/me',{headers:{Authorization:'Bearer '+token},signal:controller.signal})
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        if(!d?.email){setRole('none');setChatId(null);return}
        setEmail(d.email);setRole(d.role||'none')
        const id=Number(d.chat_id);setChatId(Number.isSafeInteger(id)&&id>0?id:null)
      })
      .catch(()=>{if(!controller.signal.aborted){setRole('none');setChatId(null)}})
    return ()=>controller.abort()
  },[token])

  useEffect(() => {
    if(token||!CLIENT_ID)return
    let cancelled=false,tries=0,timer
    const init=()=>{
      if(cancelled)return
      if(!window.google?.accounts?.id){if(++tries<80)timer=setTimeout(init,150);return}
      window.google.accounts.id.initialize({client_id:CLIENT_ID,callback:r=>{
        const value=r?.credential
        const claims=value?decodeToken(value):null
        if(!claims?.exp||claims.exp*1000<=Date.now()+5000)return
        try{localStorage.setItem(TOKEN_KEY,value)}catch{}
        setToken(value)
      }})
      if(loginRef.current){loginRef.current.innerHTML='';window.google.accounts.id.renderButton(loginRef.current,{theme:'filled_black',size:'large',shape:'pill',text:'signin_with'})}
    }
    init()
    return ()=>{cancelled=true;clearTimeout(timer)}
  },[token])

  useEffect(()=>{if(!busy)return;setElapsed(0);const id=setInterval(()=>setElapsed(x=>x+1),1000);return()=>clearInterval(id)},[busy])
  useEffect(()=>()=>abortRef.current?.abort(),[])

  function logout(){
    try{localStorage.removeItem(TOKEN_KEY);window.google?.accounts?.id?.disableAutoSelect?.()}catch{}
    setToken(null)
  }
  async function submit(e){
    e.preventDefault()
    if(!token||!canGenerate||!prompt.trim()||busy)return
    setBusy(true);setError('');setStory('');setAudioUrl('');setAudioError(false)
    const controller=new AbortController();abortRef.current=controller
    const timeout=setTimeout(()=>controller.abort('timeout'),310000)
    const selected=LANGS.find(x=>x[0]===lang)
    try{
      const r=await fetch(API+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},signal:controller.signal,
        body:JSON.stringify({agent:'Story Whisper',prompt:(audio?'audio and text. ':'')+'Write the story in '+selected[3]+'. '+prompt.trim(),language:lang,fresh_context:fresh})})
      if(!r.ok)throw new Error('HTTP '+r.status)
      const data=await r.json(),answer=String(data.answer||'').trim()
      if(!answer)throw new Error(t('storyTrial.noReply'))
      setStory(answer)
      const path=String(data.audio_filename||data.audio_path||data.audio||'').trim()
      const filename=path.split(/[\\/]/).pop()
      if(audio&&filename)setAudioUrl(API+'/api/chat/tts/Story%20Whisper/'+encodeURIComponent(filename))
      setTimeout(()=>resultRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),50)
    }catch(err){
      if(err.name==='AbortError'){if(controller.signal.reason==='timeout')setError(t('storyTrial.timeout'))}
      else setError(t('storyTrial.error',{error:err.message||String(err)}))
    }finally{clearTimeout(timeout);setBusy(false)}
  }
  async function copy(){
    try{await navigator.clipboard.writeText(story);setCopied(true);setTimeout(()=>setCopied(false),1800)}catch{}
  }
  const styles={
    wrap:{position:'relative',minHeight:'70vh',display:'flex',flexDirection:'column',justifyContent:'center',overflow:'hidden'},
    bg:{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',opacity:.6},
    overlay:{position:'absolute',inset:0,background:'linear-gradient(180deg,rgba(11,16,21,.25),rgba(11,16,21,.88))'},
    content:{position:'relative',width:'100%',maxWidth:760,margin:'0 auto'},
    card:{background:'rgba(255,255,255,.1)',border:'1px solid rgba(255,255,255,.2)',borderRadius:12,padding:22,backdropFilter:'blur(10px)',marginTop:20},
    label:{display:'block',color:'#e2e8f0',fontWeight:600,marginBottom:8},
    hint:{color:'#94a3b8',fontSize:13,margin:0},
    row:{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'},
    chip:{padding:'8px 12px',borderRadius:8,border:'1px solid rgba(255,255,255,.3)',background:'rgba(255,255,255,.08)',color:'#cbd5e1',cursor:'pointer'},
    textarea:{width:'100%',boxSizing:'border-box',padding:14,borderRadius:8,border:'1px solid rgba(255,255,255,.3)',background:'rgba(255,255,255,.1)',color:'#e2e8f0',fontSize:16,resize:'vertical',fontFamily:'inherit'},
    small:{padding:'6px 10px',borderRadius:6,border:'1px solid rgba(255,255,255,.3)',background:'rgba(255,255,255,.08)',color:'#cbd5e1',cursor:'pointer'},
    primary:{padding:'14px 18px',borderRadius:10,border:0,background:'#6366f1',color:'#fff',fontSize:17,fontWeight:600,cursor:'pointer'},
    error:{background:'rgba(255,100,100,.2)',border:'1px solid #ff6b6b',borderRadius:8,padding:12,marginTop:16,color:'#ff8585'},
    story:{color:'#e2e8f0',fontSize:17,lineHeight:1.65,whiteSpace:'pre-wrap',margin:0},
  }
  if(!token||role==='loading')return <section className="section container" style={styles.wrap}><img src={bgImage} alt="" style={styles.bg}/><div style={styles.overlay}/><div style={styles.content}><p className="section-label">🌈 {t('storyTrial.title')}</p><h2 className="section-title">{t('storyTrial.subtitle')}</h2><div style={styles.card}><h3 style={styles.label}>{t('storyTrial.loginTitle')}</h3><p style={styles.hint}>{t('storyTrial.loginHint')}</p>{!CLIENT_ID&&<p style={styles.error}>{t('storyTrial.clientIdMissing')}</p>}<div ref={loginRef} style={{marginTop:12}}/></div></div></section>
  if(!authorized||!chatId)return <section className="section container" style={styles.wrap}><img src={bgImage} alt="" style={styles.bg}/><div style={styles.overlay}/><div style={styles.content}><div style={styles.card}><p style={styles.error} role="alert">{authorized?t('storyTrial.chatIdMissing'):t('storyTrial.notAuthorized')}</p><button onClick={logout} style={styles.small}>{t('storyTrial.logout')}</button></div></div></section>
  return <section className="section container" style={styles.wrap}><img src={bgImage} alt="" style={styles.bg}/><div style={styles.overlay}/><div style={styles.content}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}><div><p className="section-label">🌈 {t('storyTrial.title')}</p><h2 className="section-title">{t('storyTrial.subtitle')}</h2></div><div style={{display:'flex',alignItems:'center',gap:10}}><span title={email} style={{color:'#94a3b8',fontSize:13}}>{email}</span><button onClick={logout} style={styles.small}>{t('storyTrial.logout')}</button></div></div>
    <div style={styles.card}><form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:18}}>
      <div><div style={styles.label}>{t('storyTrial.language')}</div><div style={styles.row}>{LANGS.map(x=><button key={x[0]} type="button" title={x[2]} aria-pressed={lang===x[0]} disabled={busy} onClick={()=>setLang(x[0])} style={{...styles.chip,...(lang===x[0]?{background:'rgba(99,102,241,.4)',borderColor:'#818cf8',color:'#fff'}:{})}}>{x[1]} {x[0].toUpperCase()}</button>)}</div></div>
      <div><div style={styles.label}>{t('storyTrial.ideas')}</div><div style={styles.row}>{IDEAS.map(k=><button key={k} type="button" disabled={busy} onClick={()=>setPrompt(t('storyTrial.'+k))} style={styles.small}>{t('storyTrial.'+k)}</button>)}</div></div>
      <div><label htmlFor="story-trial-prompt" style={styles.label}>{t('storyTrial.promptLabel')}</label><textarea id="story-trial-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={t('storyTrial.promptPlaceholder')} rows={3} maxLength={600} disabled={busy} style={styles.textarea}/></div>
      <label style={{display:'flex',alignItems:'center',gap:8,color:'#e2e8f0'}}><input type="checkbox" checked={audio} onChange={e=>setAudio(e.target.checked)} disabled={busy}/>🔊 {t('storyTrial.withAudio')}</label>
      <label style={{display:'flex',alignItems:'center',gap:8,color:'#e2e8f0'}}><input type="checkbox" checked={fresh} onChange={e=>setFresh(e.target.checked)} disabled={busy}/>{t('storyTrial.freshStory')}</label>
      <button type="submit" disabled={busy||!prompt.trim()} style={{...styles.primary,...(busy||!prompt.trim()?{opacity:.5,cursor:'not-allowed'}:{})}}>{busy?t('storyTrial.writing'):'✨ '+t('storyTrial.tell')}</button>
      {busy&&<p style={styles.hint} aria-live="polite">{t('storyTrial.waitHint',{seconds:elapsed})}</p>}
    </form></div>
    {error&&<div style={styles.error} role="alert">{error}</div>}
    {story&&<div ref={resultRef} style={styles.card}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:12}}><strong style={styles.label}>{t('storyTrial.yourStory')}</strong><div style={styles.row}><button onClick={copy} style={styles.small}>{copied?t('storyTrial.copied'):t('storyTrial.copy')}</button><button onClick={()=>{setStory('');setAudioUrl('');setPrompt('');setError('')}} style={styles.small}>{t('storyTrial.newStory')}</button></div></div>{audioUrl&&!audioError&&<audio controls preload="auto" src={audioUrl} style={{width:'100%',marginBottom:14}} onError={()=>setAudioError(true)}/>}{audioError&&<p style={styles.hint}>{t('storyTrial.audioError')}</p>}<p style={styles.story}>{story}</p></div>}
  </div></section>
}
