#!/usr/bin/env node
/**
 * Ultra-simple render: starts server, opens page, waits for chat to finish,
 * uses CDP screencast → ffmpeg with fastest possible encoding.
 */
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const HOST = '127.0.0.1';
const PORT = 53694;
const W = 1080, H = 1920, FPS = 30; // 30fps = half the frames, faster encode

const OUT_DIR = path.join(__dirname, '..', 'record', 'data');
const OUT_FILE = () => path.join(OUT_DIR, `final_${Date.now()}.mp4`);
const USER_DATA_DIR = path.join(__dirname, '..', 'record', '.chromecache_headless');
const INTRO_MS = 3200;
const OUTRO_MS = 4800;
const MIN_MAIN_MS = 8000;
const MAX_MAIN_MS = 120000;

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const error = (m) => console.error(`[${new Date().toISOString()}] ❌ ${m}`);

(async () => {
  try {
    await fs.ensureDir(OUT_DIR);

    // Start simple static file server
    const ROOT = path.join(__dirname, '..', 'public');
    const server = http.createServer((req, res) => {
      let p = path.join(ROOT, req.url.split('?')[0]);
      if (p.endsWith('/')) p = path.join(p, 'index.html');
      fs.readFile(p).then(data => {
        const ext = path.extname(p);
        const mime = {
          '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
          '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
          '.mp4': 'video/mp4', '.svg': 'image/svg+xml'
        };
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(data);
      }).catch(() => { res.writeHead(404); res.end('Not found'); });
    });
    server.listen(PORT, () => log(`Server ready on port ${PORT}`));

    // Wait for server
    await new Promise(res => { const t = setInterval(() => {
      http.get(`http://${HOST}:${PORT}/index.html`, r => { r.resume(); clearInterval(t); res(); });
    }, 200); });

    log('Launching browser...');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      executablePath: '/usr/bin/chromium-browser'
    });
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.setViewport({ width: W, height: H });

    // Go to intro, wait, main, wait for done, outro, wait
    log('Intro...');
    await page.goto(`http://${HOST}:${PORT}/intro.html`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForTimeout(INTRO_MS);

    log('Main chat...');
    await page.goto(`http://${HOST}:${PORT}/index.html`, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for chat to render all messages + final hold
    const t0 = Date.now();
    let done = false;
    while (!done && (Date.now() - t0) < MAX_MAIN_MS) {
      done = await page.evaluate(() => window.__IM_DONE__).catch(() => false);
      if (!done) await page.waitForTimeout(100);
    }
    log(`Chat done at ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    log('Outro...');
    await page.goto(`http://${HOST}:${PORT}/outro.html`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForTimeout(OUTRO_MS);

    // Now record with page.screenshot → ffmpeg (simpler)
    log('Recording...');
    const outFile = OUT_FILE();
    
    // Go back to main chat for recording
    await page.goto(`http://${HOST}:${PORT}/index.html`, { waitUntil: 'networkidle0', timeout: 30000 });

    // Start ffmpeg with simplest possible settings
    const ff = spawn('ffmpeg', [
      '-y',
      '-f', 'image2pipe',
      '-framerate', String(FPS),
      '-i', '-',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outFile
    ], { stdio: ['pipe', 'ignore', 'inherit'] });

    let frameCount = 0;
    const recordStart = Date.now();
    const totalTime = INTRO_MS + (Date.now() - t0) + OUTRO_MS + 1000;
    const targetFrames = Math.ceil(totalTime / 1000 * FPS);

    log(`Recording ${(totalTime/1000).toFixed(1)}s ≈ ${targetFrames} frames at ${FPS}fps`);

    // Refresh the page and wait for chat again
    await page.goto(`http://${HOST}:${PORT}/intro.html`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForTimeout(INTRO_MS);

    await page.goto(`http://${HOST}:${PORT}/index.html`, { waitUntil: 'networkidle0', timeout: 30000 });

    // Screenshot loop — take screenshots every 1/FPS seconds
    const frameInterval = 1000 / FPS;
    const endTime = Date.now() + totalTime;

    while (Date.now() < endTime) {
      const before = Date.now();
      try {
        const buf = await page.screenshot({
          type: 'jpeg',
          quality: 70,
          clip: { x: 0, y: 0, width: W, height: H }
        });
        ff.stdin.write(buf);
        frameCount++;
      } catch (e) {
        // If pipe is full, skip this frame
        if (e.message.includes('write')) {
          await new Promise(r => setTimeout(r, 50));
        }
      }
      const elapsed = Date.now() - before;
      const wait = Math.max(0, frameInterval - elapsed);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }

    // Close ffmpeg
    await new Promise(res => {
      ff.stdin.end();
      const t = setTimeout(() => { ff.kill('SIGKILL'); res(); }, 3000);
      ff.on('exit', () => { clearTimeout(t); res(); });
    });

    await browser.close();
    log(`✅ Done - ${frameCount} frames, ${outFile}`);
    process.exit(0);
  } catch (e) {
    error(e.stack || e.message);
    process.exit(1);
  }
})();
