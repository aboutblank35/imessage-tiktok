#!/usr/bin/env node
/**
 * Record: runs the full animation once, screenshots as fast as possible,
 * uses actual wall-clock duration for ffmpeg framerate calculation.
 * This avoids trying to hit a specific FPS — just capture everything.
 */
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const HOST = '127.0.0.1';
const PORT = 53695; // Different port to avoid conflicts
const W = 1080, H = 1920;
const OUT_DIR = path.join(__dirname, '..', 'record', 'data');
const OUT_FILE = () => path.join(OUT_DIR, `final_${Date.now()}.mp4`);
const USER_DATA_DIR = path.join(__dirname, '..', 'record', '.chromecache_headless');
const INTRO_MS = 3200;
const OUTRO_MS = 4800;

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const error = (m) => console.error(`[${new Date().toISOString()}] ❌ ${m}`);

(async () => {
  try {
    await fs.ensureDir(OUT_DIR);

    // Start static server
    const ROOT = path.join(__dirname, '..', 'public');
    const server = http.createServer((req, res) => {
      let p = path.join(ROOT, req.url.split('?')[0]);
      if (p.endsWith('/')) p = path.join(p, 'index.html');
      fs.readFile(p).then(data => {
        const ext = path.extname(p);
        const mime = {
          '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
          '.json': 'application/json'
        };
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(data);
      }).catch(() => { res.writeHead(404); res.end('Not found'); });
    });
    server.listen(PORT, () => log(`Server ready on port ${PORT}`));
    await new Promise(res => { const t = setInterval(() => {
      http.get(`http://${HOST}:${PORT}/index.html`, r => { r.resume(); clearInterval(t); res(); });
    }, 200); });

    log('Launching browser...');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
      executablePath: '/snap/bin/chromium'
    });
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.setViewport({ width: W, height: H });

    // Use CDP virtual time for reliable timeout handling in headless
    const cdp = await page.target().createCDPSession();
    await cdp.send('Page.disable');

    // Start ffmpeg with pipe
    const outFile = OUT_FILE();
    const ff = spawn('ffmpeg', [
      '-y', '-f', 'image2pipe', '-framerate', '60', '-i', '-',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outFile
    ], { stdio: ['pipe', 'ignore', 'inherit'] });
    let frameCount = 0;
    const screenshot = async () => {
      try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: W, height: H } });
        frameCount++;
        return buf;
      } catch { return null; }
    };

    // === Sequence ===
    log('Intro...');
    await page.goto(`http://${HOST}:${PORT}/intro.html`, { waitUntil: 'networkidle0', timeout: 30000 });
    const introFrames = Math.ceil(INTRO_MS / 50);
    for (let i = 0; i < introFrames; i++) {
      const buf = await screenshot();
      if (buf) { try { ff.stdin.write(buf); } catch {} }
      await new Promise(r => setTimeout(r, 50));
    }
    log(`Intro: ${introFrames} frames`);

    log('Main chat...');
    await page.goto(`http://${HOST}:${PORT}/index.html`, { waitUntil: 'networkidle0', timeout: 30000 });
    const chatStart = Date.now();
    let chatFrames = 0;
    while (true) {
      const elapsed = Date.now() - chatStart;
      if (elapsed > 35000) break;
      const buf = await screenshot();
      if (buf) {
        try { ff.stdin.write(buf); chatFrames++; }
        catch { await new Promise(r => setTimeout(r, 100)); }
      }
      await new Promise(r => setTimeout(r, 50));
    }
    const chatDuration = Date.now() - chatStart;
    log(`Main: ${chatFrames} frames in ${(chatDuration/1000).toFixed(1)}s`);

    log('Outro...');
    await page.goto(`http://${HOST}:${PORT}/outro.html`, { waitUntil: 'networkidle0', timeout: 30000 });
    const outroFrames = Math.ceil(OUTRO_MS / 50);
    for (let i = 0; i < outroFrames; i++) {
      const buf = await screenshot();
      if (buf) { try { ff.stdin.write(buf); } catch {} }
      await new Promise(r => setTimeout(r, 50));
    }
    log(`Outro: ${outroFrames} frames`);

    // Close ffmpeg — use SIGINT for clean close
    await new Promise(res => {
      ff.stdin.end();
      const t = setTimeout(() => { ff.kill('SIGKILL'); res(); }, 5000);
      ff.on('exit', () => { clearTimeout(t); res(); });
    });

    await browser.close();
    server.close();
    log(`✅ Done - ${frameCount} frames total, output: ${outFile}`);
    process.exit(0);
  } catch (e) {
    error(e.stack || e.message);
    process.exit(1);
  }
})();
