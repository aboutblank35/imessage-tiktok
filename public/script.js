(() => {
/**
 * ──────────────────────────────────────────────────────────────────────────────
 * CFG — Runtime-Konfiguration für Tempo, Effekte, Avatare & Aufnahme
 * ──────────────────────────────────────────────────────────────────────────────
 * OVERRIDES AUS chat.json:
 *  - Du kannst in data/chat.json zusätzlich "reducedMotion": true|false
 *    und "poppiness": "subtle"|"juicy"|"saga" setzen. Das wird beim Init übernommen.
 *
 * AUFNAHME-MODUS (Performance-Trim):
 *  - Füge dem <body> die Klasse "recording" hinzu, um die FX-Menge leicht zu drosseln.
 *    → Die Logik nutzt das intern (IS_RECORDING), um Mikroruckler zu vermeiden.
 *
 * RECHTS/LINKS-AUSRICHTUNG:
 *  - Alle Agenten, deren Name in VIEWERS steht (oder deren Name "viewer" enthält),
 *    werden als "du" interpretiert → rechte Chat-Seite (grüne Bubble).
 *
 * WICHTIGSTE DREHKNÖPFE:
 *  - MIN_DELAY, CHAR_READ_TIME          → Abspieltempo der Nachrichten
 *  - REDUCED_MOTION, EMOJI_EFFECTS      → Menge/Art der Animationen
 *  - POPPINESS, REACTION_BASE, SUPER_RATIO → "Dopamin-Level" der Reaktionen
 *  - AVATARS, AVATAR_COLORS             → Aussehen der Avatare
 */
  const CFG = {
    DATA_URL: 'data/chat.json',
    VIEWERS: [],
    MIN_DELAY: 260,
    CHAR_READ_TIME: 28,
    FINAL_HOLD: 1600,

    REDUCED_MOTION: null,
    POPPINESS: 'juicy',               // 'subtle' | 'juicy' | 'saga'
    REACTION_BASE: 1.0,
    SUPER_RATIO: { subtle: 0.08, juicy: 0.17, saga: 0.24 },

    EMOJI_EFFECTS: true,
    TIKTOK_MODE: true,

    AVATARS: {},
    AVATAR_COLORS: ['#ef4444','#f59e0b','#84cc16','#10b981','#06b6d4','#3b82f6','#8b5cf6','#ec4899']
  };

  const IS_RECORDING = () => document.body.classList.contains('recording');

  const HIGHLIGHT_EMOJIS = ['🔥','❤️','😂','✨','💀','🚨','💥','🎉','😱'];
  const HIGHLIGHT_RE = new RegExp('(' + HIGHLIGHT_EMOJIS.map(e=>e.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')','u');

  // --- helpers
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const $ = (s,r=document)=>r.querySelector(s);
  const hash = (s)=>[...(s||'')].reduce((a,c)=>((a<<5)-a)+c.charCodeAt(0)|0,0);
  const norm = (s='') => (s||'').toLowerCase().replace(/\p{Extended_Pictographic}/gu,'').replace(/[^a-z0-9\s]/gi,' ').replace(/\s+/g,' ').trim();
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const effectiveReducedMotion = () => (CFG.REDUCED_MOTION !== null ? !!CFG.REDUCED_MOTION
    : (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));

  // rAF-basiertes, ruckelfreies Auto-Scroll (kein CSS smooth dabei)
  function createScrollToBottom() {
    const sc = $('.chat-container');
    let raf = null;
    return () => {
      if (!sc) return;
      if (raf) cancelAnimationFrame(raf);
      const prev = sc.style.scrollBehavior;
      sc.style.scrollBehavior = 'auto';
      raf = requestAnimationFrame(() => {
        sc.scrollTop = sc.scrollHeight + 9999;
        sc.style.scrollBehavior = prev || 'smooth';
        raf = null;
      });
    };
  }
  const scrollToBottom = createScrollToBottom();

  // --- Agents
  const AgentMeta = { map:new Map(), get(n){ return this.map.get(norm(n)); } };
  function isViewer(agent){
    const a=norm(agent);
    return CFG.VIEWERS.some(v=>{ const n=norm(v); return a===n || a.includes(n); });
  }
  function avatarTokenFor(name){
    if(!name) return {char:'?',bg:'#6b7280'};
    const custom=CFG.AVATARS[name];
    const char = custom ? custom : (name.match(/\p{Extended_Pictographic}/u)?.[0] || name.trim()[0]?.toUpperCase() || '?');
    const idx=Math.abs(hash(name))%CFG.AVATAR_COLORS.length;
    return { char, bg: CFG.AVATAR_COLORS[idx] };
  }

  // --- Poppiness (mit Recording-Light)
  function getPops() {
    const base0 = Math.max(0.6, CFG.REACTION_BASE);
    const level = CFG.POPPINESS;
    const prof = {
      subtle: { base:base0,      sparks:6,  floaters:2, confetti:0,  cascade:false, flash:false,  shake:false,  superChance: CFG.SUPER_RATIO.subtle },
      juicy:  { base:base0,      sparks:14, floaters:5, confetti:12, cascade:true,  flash:true,   shake:true,   superChance: CFG.SUPER_RATIO.juicy  },
      saga:   { base:base0*1.2,  sparks:18, floaters:7, confetti:22, cascade:true,  flash:true,   shake:true,   superChance: CFG.SUPER_RATIO.saga   }
    }[level] || { base:base0, sparks:10, floaters:4, confetti:8, cascade:true, flash:true, shake:true, superChance: CFG.SUPER_RATIO.juicy };

    if (IS_RECORDING()) {
      const f = 0.85;
      prof.sparks   = Math.round(prof.sparks * f);
      prof.floaters = Math.round(prof.floaters * f);
      prof.confetti = Math.round(prof.confetti * f);
      prof.base *= 0.95;
    }
    return prof;
  }

  // --- Smart gating
  const REACT_CFG = { MIN_GAP_MS: 1100, WINDOW_MS: 8000, MAX_PER_WINDOW: 4, NO_BACK_TO_BACK: true, FORCE_AFTER_SUPPRESSED: 3 };
  class ReactionGate {
    constructor(){ this.lastTs=0; this.lastMsgIndex=-2; this.window=[]; this.suppressed=0; this.prevAgent=''; }
    _inWindow(now){ this.window=this.window.filter(t=>now-t<=REACT_CFG.WINDOW_MS); return this.window.length; }
    decide({ level, agent, content, index, isViewer }) {
      const now=Date.now();
      if (level<=0 || effectiveReducedMotion()) return { do:false };

      if (now - this.lastTs < REACT_CFG.MIN_GAP_MS) return { do:false };
      if (this._inWindow(now) >= REACT_CFG.MAX_PER_WINDOW) return { do:false };

      let prob = [0.0, 0.35, 0.7, 1.0][level] || 0.35;
      const shortMsg = (content||'').length < 6 && !HIGHLIGHT_RE.test(content||'');
      if (isViewer) prob *= 0.75;
      if (shortMsg) prob *= 0.5;
      if (REACT_CFG.NO_BACK_TO_BACK && index - this.lastMsgIndex < 1 && level < 3) prob *= 0.35;
      if (norm(agent) === norm(this.prevAgent)) prob *= 0.8;

      prob *= (1 + this.suppressed * 0.22);

      let forced=false;
      if (this.suppressed >= REACT_CFG.FORCE_AFTER_SUPPRESSED) { forced=true; prob=1.0; level=Math.max(1,level); }

      const pops = getPops();
      const doReact = forced || Math.random() < prob;
      const superHit = doReact && (Math.random() < pops.superChance) && level >= 2;

      if (doReact) { this.lastTs=now; this.lastMsgIndex=index; this.window.push(now); this.suppressed=0; }
      else { this.suppressed+=1; }
      this.prevAgent = agent || '';
      return { do:doReact, level, superHit };
    }
  }
  const Gate = new ReactionGate();

  // --- UI
  function createMessage(agent, content){
    const chat = $('#chat'); if(!chat) return null;
    const mine = isViewer(agent);

    const row = document.createElement('div');
    row.className = `message ${mine ? 'right':'left'}`;

    if(!mine){
      const meta = AgentMeta.get(agent) || {};
      const tok = meta?.avatarChar ? {char:meta.avatarChar,bg:meta.color} : avatarTokenFor(agent);
      const av = document.createElement('div');
      av.className='avatar'; av.textContent=tok.char; av.style.background=tok.bg;
      row.appendChild(av);
    }

    const wrap = document.createElement('div'); wrap.className='bubble-wrap';
    const label = document.createElement('div'); label.className='name-label';
    label.textContent = (AgentMeta.get(agent)?.display) || (mine?'You':(agent||'Agent'));
    wrap.appendChild(label);

    const bubble = document.createElement('div'); bubble.className='bubble'; bubble.textContent=content||'';
    wrap.appendChild(bubble);

    // Lokaler FX-Container (clipped an die Bubble)
    const fx = document.createElement('div'); fx.className='fx-local';
    wrap.appendChild(fx);

    row.appendChild(wrap); chat.appendChild(row); scrollToBottom();
    return { row, bubble, fx, mine };
  }

  async function showTyping(agent){
    const chat=$('#chat'); if(!chat) return null;
    const row=document.createElement('div'); row.className='message left';

    const meta = AgentMeta.get(agent) || {};
    const tok = meta?.avatarChar ? {char:meta.avatarChar,bg:meta.color} : avatarTokenFor(agent||'Agent');
    const av=document.createElement('div'); av.className='avatar'; av.textContent=tok.char; av.style.background=tok.bg; row.appendChild(av);

    const wrap=document.createElement('div'); wrap.className='bubble-wrap';
    const label=document.createElement('div'); label.className='name-label'; label.textContent=agent||'Agent'; wrap.appendChild(label);
    const ti=document.createElement('div'); ti.className='typing-indicator'; ti.innerHTML='<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>'; wrap.appendChild(ti);

    // FX-Container schon anlegen (optional)
    const fx=document.createElement('div'); fx.className='fx-local'; wrap.appendChild(fx);

    row.appendChild(wrap); chat.appendChild(row); scrollToBottom(); return row;
  }

  // --- intensity
  function reactionIntensity(text){
    if(!text) return 0;
    const emojis=(text.match(/\p{Extended_Pictographic}/gu)||[]).length;
    const bangs=(text.match(/!/g)||[]).length;
    const uppers=(text.match(/[A-Z]/g)||[]).length;
    const letters=(text.match(/[A-Za-z]/g)||[]).length||1;
    const capsRatio=uppers/letters;
    let lvl=0;
    if (HIGHLIGHT_RE.test(text)) lvl+=1;
    if (bangs>=2 || capsRatio>0.55) lvl+=1;
    if (emojis>=2) lvl+=1;
    return Math.min(3, Math.max(0, lvl));
  }

  /* ---------------- Local-FX Helpers ---------------- */
  function getLocalAnchor(rowEl){
    const bubble = rowEl.querySelector('.bubble') || rowEl;
    const wrap   = rowEl.querySelector('.bubble-wrap') || rowEl;
    const fx     = rowEl.querySelector('.fx-local') || wrap;

    const br = bubble.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    if (br.width <= 0 || br.height <= 0) return null;

    const isRight = rowEl.classList.contains('right');
    const x = (br.left - wr.left) + br.width * (isRight ? 0.1 : 0.9);
    const y = (br.top  - wr.top ) + br.height * 0.5;

    return {
      fx,
      x: clamp(x, 6, wr.width  - 6),
      y: clamp(y, 6, wr.height - 6),
      wrapRect: wr,
      bubbleRect: br
    };
  }
  function addNodeLocal(container, cls, x, y, text){
    const n = document.createElement('div');
    n.className = cls;
    if (text) n.textContent = text;
    n.style.left = `${x}px`;
    n.style.top  = `${y}px`;
    container.appendChild(n);
    n.addEventListener('animationend', ()=> n.remove(), { once:true });
    return n;
  }

  // --- FX (lokal; nur screenFlash & phoneShake nutzen .phone) ---
  function addBurstLocal(fx,x,y,content){
    const m=content.match(HIGHLIGHT_RE); const emoji=m?m[0]:'✨';
    addNodeLocal(fx,'emoji-burst',x,y,emoji);
  }
  function addRippleLocal(fx,x,y){ addNodeLocal(fx,'emoji-ripple',x,y); }
  function addSparksLocal(fx,x,y,content,count){
    const m=content.match(HIGHLIGHT_RE); const emoji=m?m[0]:'✨';
    for(let i=0;i<count;i++){
      const s=addNodeLocal(fx,'emoji-spark',x,y,emoji);
      const ang=(Math.PI*2)*(i/count)+(Math.random()*0.8-0.4);
      const dist=28+Math.random()*60; const dx=Math.cos(ang)*dist; const dy=Math.sin(ang)*dist-10;
      s.style.setProperty('--dx', dx.toFixed(1)+'px');
      s.style.setProperty('--dy', dy.toFixed(1)+'px');
      s.style.setProperty('--rot',(Math.random()*30-15)+'deg');
      s.style.fontSize=(15+Math.random()*10)+'px';
    }
  }
  function addConfettiLocal(fx,x,y,count){
    const colors=['#FF6B6B','#FFD166','#06D6A0','#118AB2','#9B5DE5','#F15BB5','#FEE440'];
    for(let i=0;i<count;i++){
      const c=addNodeLocal(fx,'confetti',x,y);
      const ang=(Math.PI*2)*Math.random(); const dist=40+Math.random()*120;
      const dx=Math.cos(ang)*dist; const dy=Math.sin(ang)*dist+30;
      c.style.setProperty('--dx',dx.toFixed(1)+'px');
      c.style.setProperty('--dy',dy.toFixed(1)+'px');
      c.style.setProperty('--rot',(Math.random()*360)+'deg');
      c.style.setProperty('--spin',(Math.random()>0.5?180:-180)+'deg');
      c.style.setProperty('--c',colors[i%colors.length]);
    }
  }
  function addFloatersLocal(fx,x,y,content,count){
    const set=(content.match(/\p{Extended_Pictographic}/gu) || ['✨']);
    for(let i=0;i<count;i++){
      const f=addNodeLocal(fx,'float-emoji', x+(Math.random()*20-10), y+(Math.random()*6-3), set[i%set.length]);
      f.style.setProperty('--fx',(Math.random()*30-15).toFixed(1)+'px');
      f.style.setProperty('--lift',(Math.random()*30).toFixed(1)+'px');
      f.style.setProperty('--dur',(1200+Math.random()*700).toFixed(0)+'ms');
    }
  }
  function cascadePopsLocal(rowEl, content, steps=4){
    const wrap = rowEl.querySelector('.bubble-wrap') || rowEl;
    const fx   = rowEl.querySelector('.fx-local') || wrap;
    const br   = (rowEl.querySelector('.bubble')||rowEl).getBoundingClientRect();
    const wr   = wrap.getBoundingClientRect();
    const emoji=(content.match(HIGHLIGHT_RE)||['✨'])[0];
    for(let i=1;i<=steps;i++){
      const x = (br.left - wr.left) + (br.width*(i/(steps+1)));
      const y = (br.top  - wr.top ) - 6;
      const n=document.createElement('div'); n.className='cascade-pop'; n.dataset.emoji=emoji;
      n.style.left=`${x}px`; n.style.top=`${y}px`;
      setTimeout(()=>{ fx.appendChild(n); setTimeout(()=>n.remove(),520); }, 60*i);
    }
  }

  function screenFlash(){
    const phone=$('.phone'); if(!phone) return;
    const f=document.createElement('div'); f.className='screen-flash'; phone.appendChild(f); setTimeout(()=>f.remove(),450);
  }
  function comboBadgeGlobal(cx, cy){
    const phone=$('.phone'); if(!phone) return;
    const b=document.createElement('div'); b.className='combo-badge'; b.textContent='Combo!';
    b.style.left=`${cx}px`; b.style.top=`${cy-6}px`; phone.appendChild(b); setTimeout(()=>b.remove(),800);
  }
  function bubbleGlow(b, ms=600){ b.classList.add('react-glow'); setTimeout(()=>b.classList.remove('react-glow'), ms); }
  function phoneShake(ms=260){ const p=$('.phone'); if(!p) return; p.classList.add('shake'); setTimeout(()=>p.classList.remove('shake'), ms); }

  // --- FX Orchestrator (nutzt lokale Koords)
  function orchestrateReactions(level, content, row, bubbleEl, superOverride){
    if (effectiveReducedMotion()) { bubbleGlow(bubbleEl, 350); return; }

    const anchor = getLocalAnchor(row);
    if (!anchor) return;
    const { fx, x, y, wrapRect, bubbleRect } = anchor;

    const pops = getPops();
    const superHit = (typeof superOverride==='boolean') ? superOverride : (Math.random()<pops.superChance);
    const mult = pops.base * (1 + 0.25*level) * (superHit ? 1.4 : 1.0);

    bubbleGlow(bubbleEl, 420 + 120*level);
    if (pops.shake && level>=1) phoneShake(260);

    addBurstLocal(fx, x, y, content);
    addRippleLocal(fx, x, y);
    addSparksLocal(fx, x, y, content, Math.round((10 + level*4) * mult));
    addFloatersLocal(fx, x, y, content, Math.round((3 + level) * mult));

    if (pops.confetti && level>=2) addConfettiLocal(fx, x, y, Math.round(pops.confetti * (superHit?1.5:1)));
    if (pops.flash && (level>=2 || superHit)) screenFlash();
    if (pops.cascade && (level>=1)) cascadePopsLocal(row, content, 3 + Math.round(level*mult));

    if (superHit) {
      // Combo-Badge mittig über der Bubble → in Phone-Koords umrechnen
      const phoneRect = $('.phone').getBoundingClientRect();
      const cx = bubbleRect.left + bubbleRect.width/2 - phoneRect.left;
      const cy = bubbleRect.top - phoneRect.top;
      comboBadgeGlobal(cx, cy);
    }
  }

  // --- delays
  function calculateMessageDelay(agent, content){
    let d = CFG.MIN_DELAY + Math.max(0,(content||'').length)*CFG.CHAR_READ_TIME;
    if (reactionIntensity(content||'') >= 2) d *= 1.25;
    return d;
  }

  // --- conversation
  async function playChat(conversation){
    await sleep(50); scrollToBottom();

    for(let i=0;i<conversation.length;i++){
      const {agent, content} = conversation[i] || {};
      const mine = isViewer(agent);

      let typingRow = null;
      if(!mine) typingRow = await showTyping(agent);
      await sleep(220 + Math.random()*180);
      if (typingRow?.isConnected) typingRow.remove();

      const msg = createMessage(agent, content);
      const level = reactionIntensity(content || '');

      const decision = Gate.decide({ level, agent, content, index:i, isViewer: mine });
      if (CFG.EMOJI_EFFECTS && decision.do) {
        // Einen Frame warten, damit Layout stabil ist (verhindert Jank beim 1. Effekt)
        requestAnimationFrame(()=> {
          orchestrateReactions(decision.level, content || '', msg.row, msg.bubble, decision.superHit);
        });
      }

      const prevLong = i>0 && conversation[i-1]?.agent===agent && (conversation[i-1]?.content||'').length>60;
      let delay = calculateMessageDelay(agent, content);
      if (prevLong) delay *= 1.5;
      await sleep(delay);
    }
  }

  // --- status bar clock
  function startClock(){
    const up=()=>{ const t=$('#time'); if(!t) return; const d=new Date(); t.textContent=d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); };
    up(); setInterval(up, 1000);
  }

  // --- init + rAF-throttled fades
  async function init(){
    try {
      startClock();

      const res = await fetch(CFG.DATA_URL);
      if(!res.ok) throw new Error('Network error');
      const data = await res.json();

      if(Array.isArray(data.agents)){
        data.agents.forEach(a=>{
          const display=a?.name||'Agent';
          const tok=avatarTokenFor(display);
          AgentMeta.map.set(norm(display), { display, avatarChar: tok.char, color: tok.bg });
          if (norm(display).includes('viewer')) CFG.VIEWERS.push(display);
        });
      }

      const theme = data.theme || 'gossip';
      document.body.classList.add(`theme-${theme}`);
      if (typeof data.reducedMotion === 'boolean') CFG.REDUCED_MOTION = data.reducedMotion;
      if (typeof data.poppiness === 'string') CFG.POPPINESS = data.poppiness;
      const timing = data.timing || data.playback || {};
      if (Number.isFinite(timing.minDelay)) CFG.MIN_DELAY = clamp(timing.minDelay, 120, 3000);
      if (Number.isFinite(timing.charReadTime)) CFG.CHAR_READ_TIME = clamp(timing.charReadTime, 10, 140);
      if (Number.isFinite(timing.finalHold)) CFG.FINAL_HOLD = clamp(timing.finalHold, 0, 6000);

      // rAF-throttled scroll fades / glass
      const phoneEl = document.querySelector('.phone');
      const sc = document.querySelector('.chat-container');
      if (sc && phoneEl) {
        let ticking = false;
        const updateFades = () => {
          const atTop = sc.scrollTop <= 2;
          const atBottom = sc.scrollHeight - sc.clientHeight - sc.scrollTop <= 2;
          sc.style.setProperty('--fade-top', atTop ? 0 : 1);
          sc.style.setProperty('--fade-bottom', atBottom ? 0 : 1);
          phoneEl.classList.toggle('scrolled', !atTop);
          ticking = false;
        };
        sc.addEventListener('scroll', () => {
          if (!ticking) { ticking = true; requestAnimationFrame(updateFades); }
        }, { passive: true });
        requestAnimationFrame(updateFades);
      }

      await playChat(data.conversation || []);
      await sleep(CFG.FINAL_HOLD);
      window.__IM_DONE__ = true;
    } catch(e){
      console.error('Chat error:', e);
      const c = $('#chat'); if (c) c.textContent = '⚠️ Could not load chat';
      window.__IM_DONE__ = true;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
