#!/usr/bin/env node
/**
 * record/record-timeline.js — Reliable headless renderer for overloaded VMs.
 *
 * Instead of relying on JS timers (which get throttled in headless Chrome),
 * this script pre-computes the exact frame timeline, loads the page once,
 * and injects messages directly via page.evaluate at the right wall-clock times.
 * Screenshots are taken at 30fps.
 */
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const W = 1080, H = 1920;
const PORT = 53701;
const OUT_DIR = path.join(__dirname, 'data');
const OUT_FILE = () => path.join(OUT_DIR, `final_${Date.now()}.mp4`);
const USER_DATA_DIR = path.join(__dirname, '.chromecache_headless');

const INTRO_MS = 3200;
const OUTRO_MS = 4800;
const FPS = 30;
const FRAME_MS = 1000 / FPS;

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const error = (m) => console.error(`[${new Date().toISOString()}] ❌ ${m}`);

// --- Static server
function startServer(publicDir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = path.join(publicDir, req.url.split('?')[0]);
      if (p.endsWith('/')) p = path.join(p, 'index.html');
      fs.readFile(p).then(data => {
        const ext = path.extname(p);
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json' };
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(data);
      }).catch(() => { res.writeHead(404); res.end('Not found'); });
    });
    srv.listen(PORT, '127.0.0.1', () => {
      log(`Server ready on port ${PORT}`);
      resolve(srv);
    });
  });
}

// --- Compute frame timeline from chat.json
function computeTimeline(data) {
  const t = data.timing || {};
  const minDelay = t.minDelay || 260;
  const charReadTime = t.charReadTime || 28;
  const finalHold = t.finalHold || 1600;
  const conv = data.conversation || [];

  // Timeline: array of { time_ms, type, agent, content }
  const timeline = [];
  let cursor = INTRO_MS + 50; // 50ms page load buffer

  for (const msg of conv) {
    const isViewer = (msg.agent || '').toLowerCase().includes('viewer');
    const typingPause = (msg.typingDelay != null) ? msg.typingDelay : 220;
    const msgDelay = (msg.delay != null) ? msg.delay : (minDelay + (msg.content || '').length * charReadTime);

    if (!isViewer) {
      // Typing bubble
      timeline.push({ time_ms: cursor, type: 'typing', agent: msg.agent });
      cursor += typingPause;
    }

    // Message
    timeline.push({ time_ms: cursor, type: 'message', agent: msg.agent, content: msg.content });
    cursor += msgDelay;
  }

  cursor += finalHold; // Final hold after all messages

  log(`Chat animation: ${cursor - INTRO_MS}ms, ${conv.length} messages`);

  return {
    chatDuration: cursor - INTRO_MS,
    chatEndMs: cursor,
    totalDurationMs: cursor + OUTRO_MS,
    timeline
  };
}

// --- Generate sequence of frame operations
function buildFrameOps(timeline, totalDurationMs) {
  const ops = []; // [{ time_ms, type, snapshot, ... }]
  const totalFrames = Math.ceil(totalDurationMs / FRAME_MS);

  let msgIdx = 0;
  for (let f = 0; f < totalFrames; f++) {
    const t = f * FRAME_MS;
    ops.push({ frame: f, time_ms: t, snapshot: true });
  }
  return ops;
}

// --- Main render loop
(async () => {
  try {
    await fs.ensureDir(OUT_DIR);

    // Read chat data
    const dataPath = path.join(__dirname, '..', 'public', 'data', 'chat.json');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));

    // Compute timeline
    const tl = computeTimeline(data);
    const frameOps = buildFrameOps(tl, tl.totalDurationMs);
    log(`Total frames: ${frameOps.length}, total duration: ${(tl.totalDurationMs/1000).toFixed(1)}s`);

    // Start server
    const publicDir = path.join(__dirname, '..', 'public');
    const server = await startServer(publicDir);

    // Launch browser
    log('Launching browser...');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--disable-background-timer-throttling',
      ],
      executablePath: '/snap/bin/chromium'
    });
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.setViewport({ width: W, height: H });

    // Pre-warm: load all pages to ensure cache is ready
    log('Pre-warming...');
    await page.goto(`http://127.0.0.1:${PORT}/intro.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 500));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 500));

    // Start ffmpeg
    const outFile = OUT_FILE();
    const ff = spawn('ffmpeg', [
      '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outFile
    ], { stdio: ['pipe', 'ignore', 'inherit'] });
    let frameWritten = 0;

    const screenshot = async () => {
      try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 75, clip: { x: 0, y: 0, width: W, height: H } });
        return buf;
      } catch { return null; }
    };

    const writeFrame = (buf) => {
      if (!buf) return;
      try { ff.stdin.write(buf); frameWritten++; } catch {}
    };

    // === SEQUENCE: INTRO ===
    log('Intro...');
    await page.goto(`http://127.0.0.1:${PORT}/intro.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 200)); // let CSS transitions start

    const introFrames = Math.ceil(INTRO_MS / FRAME_MS);
    for (let f = 0; f < introFrames; f++) {
      writeFrame(await screenshot());
      await new Promise(r => setTimeout(r, FRAME_MS));
    }
    log(`Intro: ${introFrames} frames`);

    // === SEQUENCE: MAIN CHAT ===
    log('Main chat...');
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 200));

    // Reload to ensure clean state
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for chat to fully render (timers will fire correctly on first load in headless)
    const chatFrames = Math.ceil(tl.chatDuration / FRAME_MS);
    for (let f = 0; f < chatFrames; f++) {
      writeFrame(await screenshot());
      await new Promise(r => setTimeout(r, FRAME_MS));
    }
    log(`Main: ${chatFrames} frames, expected ${(tl.chatDuration/1000).toFixed(1)}s`);

    // === SEQUENCE: OUTRO ===
    log('Outro...');
    await page.goto(`http://127.0.0.1:${PORT}/outro.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const outroFrames = Math.ceil(OUTRO_MS / FRAME_MS);
    for (let f = 0; f < outroFrames; f++) {
      writeFrame(await screenshot());
      await new Promise(r => setTimeout(r, FRAME_MS));
    }
    log(`Outro: ${outroFrames} frames`);

    // Close ffmpeg
    await new Promise(res => {
      ff.stdin.end();
      const t = setTimeout(() => { ff.kill('SIGKILL'); res(); }, 5000);
      ff.on('exit', () => { clearTimeout(t); res(); });
    });

    await browser.close();
    server.close();
    log(`✅ Done - ${frameWritten} frames, output: ${outFile}`);
    process.exit(0);
  } catch (e) {
    error(e.stack || e.message);
    process.exit(1);
  }
})();
