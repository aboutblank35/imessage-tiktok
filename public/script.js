(() => {
  // Konfiguration
  const CFG = {
    DATA_URL: 'data/chat.json',
    VIEWER: '👀 The Viewer',
    
    // Timing
    BASE_READ_TIME: 1500,
    CHAR_READ_TIME: 25,
    MIN_DELAY: 400,
    TYPING_DURATION: 1000
  };

  // DOM-Elemente
  const EL = {
    chat: document.getElementById('chat'),
    typingContainer: document.createElement('div')
  };

  EL.typingContainer.className = 'typing-container';
  EL.typingContainer.innerHTML = `
    <div class="typing-indicator">
      <div class="dots">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    </div>
  `;

  // Hilfsfunktionen
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Nachricht erstellen
  function createMessage(agent, content) {
    const isViewer = agent === CFG.VIEWER;
    const msg = document.createElement('div');
    msg.className = `message ${isViewer ? 'right' : 'left'}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    if (!isViewer) {
      const nameDiv = document.createElement('div');
      nameDiv.className = 'sender-name';
      nameDiv.textContent = agent;
      contentDiv.appendChild(nameDiv);
    }
    
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = content;
    contentDiv.appendChild(bubble);
    
    msg.appendChild(contentDiv);
    EL.chat.appendChild(msg);
    
    // Scrollen zur Nachricht
    setTimeout(() => {
      EL.chat.scrollTo({
        top: EL.chat.scrollHeight,
        behavior: 'smooth'
      });
    }, 10);
  }

  // Typing-Indicator anzeigen
  async function showTyping() {
    EL.chat.appendChild(EL.typingContainer);
    EL.chat.scrollTo({
      top: EL.chat.scrollHeight,
      behavior: 'smooth'
    });
    await sleep(CFG.TYPING_DURATION);
    if (EL.typingContainer.parentNode) {
      EL.chat.removeChild(EL.typingContainer);
    }
  }

  // Chat abspielen
  async function playChat(conversation) {
    // Initial scroll
    await sleep(50);
    EL.chat.scrollTo(0, EL.chat.scrollHeight);
    
    for (const {agent, content} of conversation) {
      const isViewer = agent === CFG.VIEWER;
      
      if (!isViewer) {
        await showTyping();
      }
      
      createMessage(agent, content);
      await sleep(CFG.MIN_DELAY + (content.length * CFG.CHAR_READ_TIME));
    }
  }

  // Initialisierung
  (async () => {
    try {
      const response = await fetch(CFG.DATA_URL);
      const {conversation} = await response.json();
      await playChat(conversation);
      window.__IM_DONE__ = true;
    } catch (e) {
      console.error('Fehler:', e);
    }
  })();

  setInterval(() => {
    const el = document.getElementById("time");
    if (el) {
      const d = new Date();
      el.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }, 1000);
})();