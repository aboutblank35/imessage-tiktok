// chatPlayer.js – Auto‑Replay mit variablem Tipp‑Sound
// ---------------------------------------------------------------
// • Läuft vollautomatisch – keine Tastatur‑Steuerung nötig
// • Tipp‑Sound: Zufälliger Ausschnitt, spielt exakt so lang wie getippt wird
// • Pop‑Sound bei jeder Nachricht
// • Kein Pause/Resume mehr, Nachrichten laufen immer durch
// ---------------------------------------------------------------

(() => {
  // ───────────────────────── SETTINGS ──────────────────────────
  const CFG = {
    DATA_URL:   'data/chat.json',
    VIEWER:     '👀 The Viewer',
    MAX_AVATARS: 5,

    MIN_DELAY:   500,
    CHAR_DELAY:  [25, 35],
    LONG_MSG_THRESHOLD:      120,
    LONG_MSG_PAUSE_PER_CHAR:  30,

    ENABLE_SOUND: true,
    SOUND_SRC: {
      typing: 'sounds/typing.mp3',
      pop:    'sounds/pop.mp3',
    },
    VOLUME: 0.8,
  };

  // ───────────────────────── DOM REFS ──────────────────────────
  const EL = {
    chat:   document.getElementById('chat'),
    avs:    document.getElementById('avatars'),
    title:  document.getElementById('group-title'),
  };
  if (!EL.chat || !EL.avs || !EL.title) {
    console.error('[chatPlayer] benötigte DOM‑Elemente fehlen');
    return;
  }

  // ───────────────────────── UTILITIES ─────────────────────────
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const sleep   = (ms) => new Promise(r => setTimeout(r, ms));

  // -------- Sound‑Preload ----------------------------------------------
  const audioTemplates = {};
  for (const [key, path] of Object.entries(CFG.SOUND_SRC)) {
    const a = new Audio(path);
    a.preload = 'auto';
    a.volume  = CFG.VOLUME;
    audioTemplates[key] = a;
  }

  // Lade Meta‑Daten, damit duration verfügbar ist
  Promise.all(Object.values(audioTemplates).map(a =>
    a.readyState >= 1 ? Promise.resolve() : new Promise(res => a.addEventListener('loadedmetadata', res))
  )).catch(()=>{});

  // Dynamischer Tipp‑Sound
  function playTypingSound(durationMs) {
    if (!CFG.ENABLE_SOUND) return;
    const tpl = audioTemplates.typing;
    if (!tpl) return;

    const a = tpl.cloneNode();
    a.volume = CFG.VOLUME;

    const dur = tpl.duration || 0;
    if (dur) {
      const maxStart = Math.max(0, dur - durationMs / 1000);
      a.currentTime = maxStart ? Math.random() * maxStart : 0;
    }
    a.play().catch(() => {});
    setTimeout(() => { a.pause(); a.remove(); }, durationMs + 50);
  }

  function playPop() {
    if (!CFG.ENABLE_SOUND) return;
    const tpl = audioTemplates.pop;
    if (!tpl) return;
    const a = tpl.cloneNode();
    a.volume = CFG.VOLUME;
    a.play().catch(()=>{});
  }

  // -------- Avatar -------------------------------------------------------
  const createAvatar = (i) => {
    const EMOJIS = ['🤖','🎯','💡','🎲','📚','🦾','🛰','🎭','🧠','⚙️'];
    const span = document.createElement('span');
    span.className = 'avatar';
    span.textContent = EMOJIS[i % EMOJIS.length];
    return span;
  };

  async function fetchData() {
    const res = await fetch(CFG.DATA_URL);
    if (!res.ok) throw new Error('chat.json not found');
    return res.json();
  }

  function renderHeader(agents) {
    EL.avs.innerHTML = '';
    agents.slice(0, CFG.MAX_AVATARS).forEach((_, i) => EL.avs.appendChild(createAvatar(i)));
    if (agents.length > CFG.MAX_AVATARS) {
      const span = document.createElement('span');
      span.className = 'avatar-overflow';
      span.textContent = `+${agents.length - CFG.MAX_AVATARS}`;
      EL.avs.appendChild(span);
    }
    EL.title.textContent = `${agents.length} Personen`;
  }

  // ------------ MESSAGE RENDERING ----------------------------------------
  function appendTyping(side, typingMs) {
    const typing = document.createElement('div');
    typing.className = `message ${side} typing`;
    typing.innerHTML = `
      <div class="bubble">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>`;
    EL.chat.appendChild(typing);
    EL.chat.scrollTop = EL.chat.scrollHeight;
    playTypingSound(typingMs);
    return typing;
  }

  function appendMessage(agent, content, side, avatarIdx) {
    const msg = document.createElement('div');
    msg.className = `message ${side}`;
    msg.innerHTML = !side.includes('right') ? `
      <div class="avatar-container">${createAvatar(avatarIdx).outerHTML}</div>
      <div class="content">
        <div class="sender-name">${agent}</div>
        <div class="bubble pop">${content}</div>
      </div>` : `
      <div class="content" style="align-items:flex-end">
        <div class="bubble pop">${content}</div>
      </div>`;
    EL.chat.appendChild(msg);
    EL.chat.scrollTop = EL.chat.scrollHeight;
    playPop();
  }

  // ---------------------- PLAYER LOGIC ------------------------------------
  async function play(conversation, agents) {
    let idx = 0, prevLen = 0;

    async function run() {
      while (idx < conversation.length) {
        const { agent, content } = conversation[idx];
        const side = agent === CFG.VIEWER ? 'right' : 'left';
        const avatarIdx = agents.findIndex(a => a.name === agent);

        const extra = prevLen > CFG.LONG_MSG_THRESHOLD
          ? (prevLen - CFG.LONG_MSG_THRESHOLD) * CFG.LONG_MSG_PAUSE_PER_CHAR : 0;

        const typingMs = Math.max(CFG.MIN_DELAY, content.length * randInt(...CFG.CHAR_DELAY) + extra);
        const typingNode = appendTyping(side, typingMs);
        await sleep(typingMs);
        typingNode.remove();
        appendMessage(agent, content, side, avatarIdx);

        prevLen = content.length;
        idx++;
      }
    }
    await run();
  }

  // --------------------------- INIT ---------------------------------------
  (async () => {
    try {
      const { agents, conversation } = await fetchData();
      if (!conversation.length) return;
      window.__MESSAGE_COUNT__ = conversation.length;
      renderHeader(agents);
      await play(conversation, agents);
    } catch (e) {
      console.error('[chatPlayer]', e.message);
    }
  })();
})();
