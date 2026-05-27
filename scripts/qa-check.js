#!/usr/bin/env node
/**
 * Pre-render QA validator for AI Council chat.json candidates.
 *
 * Usage: node scripts/qa-check.js [path/to/chat.json]
 *
 * Checks:
 *   - All bubbles ≤ 55 characters
 *   - Total chat runtime estimate (not including intro/outro)
 *   - Hook format (first 2 messages are viewer setup)
 *   - Council message count (should have 5+ council responses)
 *   - No banned words (betrayal, red flag, boundary, trust)
 *   - Pix doesn't say "I see a pattern"
 *   - Final message is from byte.fm (punchline)
 *   - Recommended timing overrides present
 */

const fs = require('fs');
const path = require('path');

const MAX_BUBBLE_CHARS = 55;
const MIN_COUNCIL_MSGS = 5;
const BANNED_WORDS = ['betrayal', 'red flag', 'boundary', 'trust'];
const PIX_BANNED_PHRASE = 'i see a pattern';

let filePath = process.argv[2] || path.join(__dirname, '..', 'public', 'data', 'chat.json');

if (!fs.existsSync(filePath)) {
  console.error(`❌ File not found: ${filePath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const conversation = data.conversation || [];
const timing = data.timing || {};
const minDelay = timing.minDelay || 260;
const charReadTime = timing.charReadTime || 28;
const finalHold = timing.finalHold || 1600;

console.log(`\n📋 AI Council Pre-Render QA — ${filePath}`);
console.log('='.repeat(55));

const errors = [];
const warnings = [];
let totalScore = 0;

// --- Bubble length check
let maxBubbleLen = 0;
let maxBubbleContent = '';
let longBubbles = 0;
for (const msg of conversation) {
  const len = (msg.content || '').length;
  if (len > MAX_BUBBLE_CHARS) {
    longBubbles++;
    errors.push(`✗ Bubble too long (${len} chars): "${msg.content}" — ${msg.agent}`);
  }
  if (len > maxBubbleLen) {
    maxBubbleLen = len;
    maxBubbleContent = msg.content;
  }
}
if (longBubbles === 0) {
  console.log(`✅ All messages ≤ ${MAX_BUBBLE_CHARS} chars (max: ${maxBubbleLen})`);
  totalScore += 5;
} else {
  console.log(`❌ ${longBubbles} message(s) exceed ${MAX_BUBBLE_CHARS} chars`);
}

// --- Hook format check (first 2 messages from viewer)
const viewerMsgs = conversation.filter(m => m.agent === 'The Viewer' || m.agent.toLowerCase().includes('viewer'));
if (viewerMsgs.length >= 2 && conversation[0].agent.includes('Viewer') && conversation[1].agent.includes('Viewer')) {
  const totalSetupChars = viewerMsgs.slice(0, 2).reduce((s, m) => s + (m.content || '').length, 0);
  if (totalSetupChars <= 30) {
    console.log(`✅ Viewer setup: ${viewerMsgs.length} messages, ${totalSetupChars} total chars`);
    totalScore += 4;
  } else {
    warnings.push(`⚠️ Viewer setup may be too verbose: ${totalSetupChars} chars (target ≤ 30)`);
    totalScore += 2;
  }
} else {
  warnings.push('⚠️ First 2 messages should be from The Viewer');
}

// --- Council message count
const councilMsgs = conversation.filter(m => !m.agent.includes('Viewer'));
if (councilMsgs.length >= MIN_COUNCIL_MSGS) {
  console.log(`✅ ${councilMsgs.length} council messages (min ${MIN_COUNCIL_MSGS})`);
  totalScore += 4;
} else {
  errors.push(`✗ Only ${councilMsgs.length} council messages, need at least ${MIN_COUNCIL_MSGS}`);
}

// --- Banned words check (council members)
for (const msg of councilMsgs) {
  const content = (msg.content || '').toLowerCase();
  for (const word of BANNED_WORDS) {
    if (content.includes(word.toLowerCase())) {
      errors.push(`✗ Banned word "${word}" in ${msg.agent}: "${msg.content}"`);
    }
  }
}
if (errors.filter(e => e.includes('Banned word')).length === 0) {
  console.log(`✅ No banned words found`);
  totalScore += 4;
}

// --- Pix pattern check
for (const msg of conversation) {
  if (msg.agent.toLowerCase().includes('pix')) {
    const content = (msg.content || '').toLowerCase();
    if (content.includes(PIX_BANNED_PHRASE)) {
      errors.push(`✗ pix says "${msg.content}" — should not say "I see a pattern"`);
    }
  }
}
if (errors.filter(e => e.includes('pix')).length === 0) {
  console.log(`✅ pix avoids "I see a pattern"`);
  totalScore += 3;
}

// --- Final message is from byte.fm (punchline)
const lastMsg = conversation[conversation.length - 1];
if (lastMsg && lastMsg.agent.includes('byte')) {
  console.log(`✅ Final message by byte.fm: "${lastMsg.content}"`);
  totalScore += 4;
} else {
  warnings.push(`⚠️ Final message should be by byte.fm, got: ${lastMsg?.agent}`);
}

// --- Timing estimate
const totalChars = conversation.reduce((s, m) => s + (m.content || '').length, 0);
const baseDelay = conversation.length * (minDelay || 260);
const readDelay = totalChars * (charReadTime || 28);
const finalHoldMs = finalHold || 1600;
const typedelay = (conversation.length - viewerMsgs.length) * 310; // ~310ms per typing bubble
// intro + outro
const introMs = 2000;
const outroMs = 3000;
const estimatedMain = baseDelay + readDelay + typedelay + finalHoldMs;
const estimatedTotal = introMs + estimatedMain + outroMs;
const seconds = (estimatedTotal / 1000).toFixed(1);

if (estimatedTotal >= 17000 && estimatedTotal <= 24000) {
  console.log(`✅ Estimated runtime: ${seconds}s (within 14-24s target)`);
  totalScore += 5;
} else if (estimatedTotal < 17000) {
  warnings.push(`⚠️ Estimated runtime only ${seconds}s — may be too fast (target 14-24s)`);
  totalScore += 2;
} else {
  warnings.push(`⚠️ Estimated runtime ${seconds}s — may be too long (target 14-24s)`);
  totalScore += 2;
}

// --- Per-message delay overrides on punchline
const hasPerMsgDelays = conversation.some(m => m.delay != null);
if (hasPerMsgDelays) {
  console.log(`✅ Per-message timing overrides present`);
  totalScore += 3;
} else {
  warnings.push('⚠️ No per-message timing overrides — consider adding delay/typingDelay to punchline');
}

// --- Final message length
if (lastMsg) {
  const lastLen = (lastMsg.content || '').length;
  if (lastLen >= 25 && lastLen <= MAX_BUBBLE_CHARS) {
    console.log(`✅ Punchline length: ${lastLen} chars (good range)`);
    totalScore += 3;
  } else {
    warnings.push(`⚠️ Punchline is ${lastLen} chars — ideal is 25-55`);
  }
}

// --- Results
console.log('');
console.log('='.repeat(55));
console.log(`Total score: ${totalScore}/40 (target: ≥ 30)`);

if (errors.length > 0) {
  console.error(`\n❌ ERRORS (${errors.length}):`);
  errors.forEach(e => console.error(`  ${e}`));
}

if (warnings.length > 0) {
  console.warn(`\n⚠️ WARNINGS (${warnings.length}):`);
  warnings.forEach(w => console.warn(`  ${w}`));
}

if (errors.length === 0) {
  console.log('\n✅ All checks passed — candidate is render-ready');
} else {
  console.log(`\n❌ ${errors.length} error(s) must be fixed before render`);
  process.exit(1);
}

if (warnings.length > 0 && totalScore < 30) {
  console.log('⚠️ Low QA score — consider addressing warnings before render');
}
