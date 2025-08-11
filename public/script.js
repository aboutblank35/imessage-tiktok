// ===== KONFIGURATION =====
const CFG = {
  DATA_URL: 'data/chat.json',
  VIEWER: '👀 The Viewer',
  
  BASE_DELAY: 200,
  FAST_DELAY: 100,
  SLOW_DELAY: 400,
  CHAR_DELAY: 8,
  MIN_TYPING_DURATION: 800,
  MAX_TYPING_DURATION: 2500,
  REACTION_DELAY: 800,
  
  EMOTION_DELAYS: {
    '🔥': 100,
    '😢': 500,
    '😂': 300,
    '😐': 400
  },
  
  LONG_MESSAGE_THRESHOLD: 120,
  READING_TIME_PER_CHAR: 12,
  READING_TIME_MIN: 1000,
  READING_TIME_MAX: 3000,
  TYPING_ABORT_CHANCE: 0.15,
  TYPING_ABORT_MIN_DELAY: 800,
  TYPING_ABORT_MAX_DELAY: 2000,

  // TikTok-Optimierungen
  TIKTOK_MODE: true,
  EMOJI_EFFECTS: true,
  FOMO_EFFECTS: true,
  HIGHLIGHT_EMOJIS: ['🔥', '❤️', '😂', '✨', '💀']
};

// ===== HELPER FUNKTIONEN =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scrollToBottom() {
  const chatContainer = document.querySelector('.chat-container');
  if (chatContainer) {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
  }
}

// ===== TIKTOK-SPEZIFISCHE FUNKTIONEN =====
function addEmojiEffects(content, parentElement) {
  const emojiMatches = content.matchAll(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/gu);
  const usedEmojis = new Set();

  for (const match of emojiMatches) {
    const emoji = match[0];
    if (CFG.HIGHLIGHT_EMOJIS.includes(emoji) && !usedEmojis.has(emoji)) {
      const effect = document.createElement('div');
      effect.className = `emoji-effect effect-${emoji}`;
      effect.textContent = emoji;

      const bubble = parentElement.querySelector('.bubble');
      if (bubble) {
        const bubbleRect = bubble.getBoundingClientRect();
        const parentRect = document.body.getBoundingClientRect();

        effect.style.left = `${bubbleRect.left + bubbleRect.width / 2 - parentRect.left}px`;
        effect.style.top = `${bubbleRect.top - parentRect.top}px`;

        effect.style.position = 'absolute';
        document.body.appendChild(effect);

        usedEmojis.add(emoji);
        setTimeout(() => effect.remove(), 1000);
      }
    }
  }
}


function addFomoNotification() {
  if (!CFG.FOMO_EFFECTS || Math.random() > 0.3) return;
  const notifications = [
    `${Math.floor(Math.random() * 99) + 1} Leute tippen...`,
    "Trending in DE",
    "1.2M Aufrufe"
  ];
  const fomo = document.createElement('div');
  fomo.className = 'fomo-notification';
  fomo.textContent = notifications[Math.floor(Math.random() * notifications.length)];
  document.getElementById('chat').appendChild(fomo);
  setTimeout(() => fomo.remove(), 2000);
}

function calculateTikTokDelay(content, position) {
  let delay = Math.min(2000, Math.max(300, content.length * 8));
  if (position < 3) delay *= 0.6;
  if (content.match(new RegExp(`[${CFG.HIGHLIGHT_EMOJIS.join('')}]`))) {
    delay *= 1.4;
  }
  return delay;
}

// ===== NACHRICHTEN-LOGIK =====
function createMessage(agent, content, position = 0) {
  const chatElement = document.getElementById('chat');
  if (!chatElement) return;

  const isViewer = agent === CFG.VIEWER;
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isViewer ? 'right' : 'left'}`;

  const messageContent = document.createElement('div');
  messageContent.className = 'message-content';

  if (!isViewer) {
    const nameDiv = document.createElement('div');
    nameDiv.className = 'sender-name';
    nameDiv.textContent = agent;
    messageContent.appendChild(nameDiv);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;

  if (content.match(/[🔥🚨]/)) bubble.setAttribute('data-emotion', 'angry');
  else if (content.match(/[💔😢]/)) bubble.setAttribute('data-emotion', 'sad');
  else if (content.match(/[😂😆]/)) bubble.setAttribute('data-emotion', 'funny');

  messageContent.appendChild(bubble);
  messageDiv.appendChild(messageContent);
  chatElement.appendChild(messageDiv);

  scrollToBottom();

  if (CFG.TIKTOK_MODE) {
    if (position % 5 === 0) addFomoNotification();
    setTimeout(() => {
      if (CFG.EMOJI_EFFECTS && content.match(new RegExp(`[${CFG.HIGHLIGHT_EMOJIS.join('')}]`))) {
        addEmojiEffects(content, messageDiv);
      }
    }, 50);
  }
}

function calculateTypingDuration(content) {
  const wordCount = content.split(/\s+/).length;
  const charCount = content.length;
  let duration = (wordCount * 50) + (charCount * 10);

  if (content.match(/[🔥🚨]/)) duration *= 0.7;
  else if (content.match(/[💔😢]/)) duration *= 1.2;
  else if (content.match(/[😂😆]/)) duration *= 0.9;

  if (content.includes('?') && content.includes('!')) duration *= 1.4;
  else if (content.includes('?')) duration *= 1.3;
  else if (content.includes('!')) duration *= 1.1;

  const punctuationCount = (content.match(/[.,;:!?]/g) || []).length;
  duration += punctuationCount * 50;

  return Math.max(CFG.MIN_TYPING_DURATION, Math.min(duration, CFG.MAX_TYPING_DURATION));
}

async function showTypingOrAbort(content) {
  const chatElement = document.getElementById('chat');
  if (!chatElement) return false;

  const willAbort = Math.random() < CFG.TYPING_ABORT_CHANCE &&
                   !content.includes('?') &&
                   !content.includes('!') &&
                   !content.match(/[🔥🚨💔😢]/);

  const typingHTML = `
    <div class="message left" style="margin-bottom: 4px;">
      <div class="typing-indicator">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>
  `;

  chatElement.insertAdjacentHTML('beforeend', typingHTML);
  scrollToBottom();

  if (willAbort) {
    const abortDelay = CFG.TYPING_ABORT_MIN_DELAY + Math.random() * (CFG.TYPING_ABORT_MAX_DELAY - CFG.TYPING_ABORT_MIN_DELAY);
    await sleep(abortDelay);
    const typingElements = document.querySelectorAll('.message.left:last-child');
    if (typingElements.length > 0) {
      typingElements[typingElements.length - 1].remove();
    }
    return true;
  }

  const duration = calculateTypingDuration(content);
  await sleep(duration);
  const typingElements = document.querySelectorAll('.message.left:last-child');
  if (typingElements.length > 0) {
    typingElements[typingElements.length - 1].remove();
  }
  return false;
}

function calculateReadingTime(content) {
  if (content.length < CFG.LONG_MESSAGE_THRESHOLD) return 0;
  let readingTime = Math.min(CFG.READING_TIME_MAX, Math.max(CFG.READING_TIME_MIN, content.length * CFG.READING_TIME_PER_CHAR));
  if (content.includes('?')) readingTime *= 1.3;
  if (content.includes('!')) readingTime *= 1.2;
  if (content.match(/[😢💔]/)) readingTime *= 1.4;
  if (content.match(/[😂😆]/)) readingTime *= 0.9;
  return readingTime;
}

function calculateMessageDelay(agent, content) {
  let delay = CFG.BASE_DELAY + (content.length * CFG.CHAR_DELAY);
  const emojis = content.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/gu) || [];

  if (agent.includes('🔥') || agent.includes('BLAZE')) {
    delay = Math.min(delay, CFG.FAST_DELAY + (content.length * 5));
  } else if (agent.includes('😢') || agent.includes('sad')) {
    delay = Math.max(delay, CFG.SLOW_DELAY + (content.length * 10));
  }

  if (emojis.includes('🔥') || emojis.includes('🚨')) delay *= 0.7;
  else if (emojis.includes('😢') || emojis.includes('💔')) delay *= 1.3;

  return Math.max(100, Math.min(delay, 2000));
}

// ===== CHAT-STEUERUNG =====
async function playChat(conversation) {
  if (!Array.isArray(conversation)) return;

  let lastMessageWasLong = false;

  for (let i = 0; i < conversation.length; i++) {
    const { agent, content } = conversation[i];
    const isViewer = agent === CFG.VIEWER;

    if (lastMessageWasLong && !isViewer && i > 0) {
      const readingTime = calculateReadingTime(conversation[i - 1].content);
      if (readingTime > 0) await sleep(readingTime);
    }

    if (!isViewer) {
      const didAbort = await showTypingOrAbort(content);
      if (didAbort) {
        await sleep(CFG.BASE_DELAY + Math.random() * 1000);
        continue;
      }
    }

    createMessage(agent, content, i);
    lastMessageWasLong = content.length >= CFG.LONG_MESSAGE_THRESHOLD;

    let delay = CFG.TIKTOK_MODE
      ? calculateTikTokDelay(content, i)
      : calculateMessageDelay(agent, content);

    if (lastMessageWasLong && i > 0 && conversation[i - 1].agent === agent) {
      delay *= 1.5;
    }

    await sleep(delay);
  }
}

// ===== INITIALISIERUNG =====
async function initChat() {
  try {
    const response = await fetch(CFG.DATA_URL);
    if (!response.ok) throw new Error('Network response was not ok');

    const data = await response.json();
    if (!data.conversation || !Array.isArray(data.conversation)) {
      throw new Error('Invalid conversation data');
    }

    const theme = data.theme || 'gossip';
    document.body.classList.add(`theme-${theme}`);

    await playChat(data.conversation);
    window.__IM_DONE__ = true;
  } catch (error) {
    console.error("Fehler beim Laden des Chats:", error);
    createMessage("System", "⚠️ Chat konnte nicht geladen werden");
  }
}

document.addEventListener('DOMContentLoaded', initChat);
setInterval(() => {
  const el = document.getElementById("time");
  if (el) {
    const d = new Date();
    el.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}, 1000);
