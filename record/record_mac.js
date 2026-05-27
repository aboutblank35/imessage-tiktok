// record/record_mac.js
/* eslint-disable no-console */
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const HOST = '127.0.0.1';
const PORT = 53694;

const W = 1080;                 // feste Breite
const H = 1920;                 // feste Höhe
const FPS = 60;                 // Ziel-Framerate

const CFG = {
  INTRO_URL: `http://${HOST}:${PORT}/intro.html`,
  MAIN_URL:  `http://${HOST}:${PORT}/index.html`,
  OUTRO_URL: `http://${HOST}:${PORT}/outro.html`,

  // Zeiten (ms) – nur Intro/Outro werden gewartet
  INTRO_MS: 3200,
  OUTRO_MS: 4800,

  // Haupt-Sequenz: frühestens nach 8s aussteigen, wenn seit 2.5s nichts passierte
  MIN_MAIN_MS: 8000,
  IDLE_MS: 5000,
  MAX_MAIN_MS: 300000,

  OUT_DIR: path.join(__dirname, 'data'),
  OUT_FILE: () => path.join(__dirname, 'data', `final_${Date.now()}.mp4`),

  USER_DATA_DIR: path.join(__dirname, '.chromecache_headless'), // persistenter Cache (SW, Fonts, etc.)
};

// -------------------------------------------------------------

const log   = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const error = (m) => console.error(`[${new Date().toISOString()}] ❌ ${m}`);

async function ensureDir(d){ await fs.ensureDir(d); }

async function waitForServer(url, timeoutMs=90000, interval=300){
  const start = Date.now(); const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject)=>{
    const tick = ()=>{
      const req = lib.request({ method:'GET', hostname:u.hostname, port:u.port, path:u.pathname, timeout:2000 }, res=>{
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 500) return resolve();
        if (Date.now()-start > timeoutMs) return reject(new Error(`Server status ${res.statusCode}`));
        setTimeout(tick, interval);
      });
      req.on('error', ()=>{
        if (Date.now()-start > timeoutMs) return reject(new Error('Server not reachable'));
        setTimeout(tick, interval);
      });
      req.end();
    };
    tick();
  });
}

function rmSingletonLock(dir){
  try {
    const p = path.join(dir, 'SingletonLock');
    if (fs.existsSync(p)) fs.removeSync(p);
  } catch {}
}

async function gotoSafe(page, url, label){
  for (const wu of ['domcontentloaded','load']) {
    try {
      log(`➡️  goto(${label}) → ${wu}`);
      await page.goto(url, { waitUntil: wu, timeout: 120000 });
      return;
    } catch (e) {
      log(`⚠️ goto ${label} (${wu}) failed: ${e.message}`);
    }
  }
  // Fallback ohne Timeout
  log(`➡️  goto(${label}) fallback → load (no-timeout)`);
  try { await page.goto(url, { waitUntil: 'load', timeout: 0 }); } catch {}
}

async function lockViewport1080x1920(page) {
  const client = await page.target().createCDPSession();

  // 1) sichtbare Größe (sehr wichtig für Screencast)
  await client.send('Emulation.setVisibleSize', { width: W, height: H });

  // 2) Device Metrics + Portrait
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
    screenWidth: W, screenHeight: H,
    screenOrientation: { type: 'portraitPrimary', angle: 0 }
  });

  // 3) Puppeteer-Viewport (Kosmetik/Fonts)
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

  // 4) Page Scale = 1
  await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });

  // 5) Scroll an den Start (falls alter State)
  await page.evaluate(() => { window.scrollTo(0, 0); });
}

async function prewarm(page) {
  log('🧊 Pre-Warm: Intro → Main → Outro …');
  await gotoSafe(page, CFG.INTRO_URL, 'pre:intro');
  await page.waitForTimeout(CFG.INTRO_MS);

  await gotoSafe(page, CFG.MAIN_URL, 'pre:main');
  await waitMain(page, 'pre');

  await gotoSafe(page, CFG.OUTRO_URL, 'pre:outro');
  await page.waitForTimeout(CFG.OUTRO_MS);
}

async function waitMain(page, phase='record') {
  const t0 = Date.now();
  let last = t0;
  let count = 0;

  // auf erstes Render/Message warten (max 30s)
  const tStart = Date.now();
  while (Date.now() - tStart < 30000) {
    const n = await page.$$eval('.message', els => els.length).catch(()=>0);
    if (n > 0) { count = n; break; }
    await page.waitForTimeout(100);
  }

  // laufen lassen, bis done/idle/min/max
  while (true) {
    const now = Date.now();
    const done = await page.evaluate(()=> !!window.__IM_DONE__).catch(()=>false);
    const n = await page.$$eval('.message', els => els.length).catch(()=>count);

    if (n > count) { count = n; last = now; }

    if (done) break;
    if (now - t0 > CFG.MAX_MAIN_MS) break;
    if ((now - t0) > CFG.MIN_MAIN_MS && (now - last) > CFG.IDLE_MS) break;

    await page.waitForTimeout(120);
  }
}

// ---- ffmpeg: image2pipe (mjpeg) → h264 ------------------------------------

function startFFmpegPipe(outFile) {
  const args = [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',           // wir schicken JPEGs
    '-framerate', String(FPS),    // konstante Eingabe-Framerate
    '-i', 'pipe:0',
    '-vf', `fps=${FPS},format=yuv420p`, // sichert CFR + H.264-Kompatibilität
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-profile:v', 'high',
    '-level', '4.1',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outFile
  ];
  log(`🎬 ffmpeg ${args.join(' ')}`);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.on('error', (e)=> error(`ffmpeg error: ${e.message}`));
  return ff;
}

// ---- Realtime Screencast Steuerung ------------------------------------------
// CDP Screencast emits frames mainly when pixels change. Static intro/outro
// holds then collapse to a few frames because ffmpeg receives too little input.
// Keep the cheap CDP source, but write the latest frame on a wall-clock timer so
// static holds and bubble dwell time survive in the final MP4.
async function startRealtimeScreencast(page, ff) {
  const client = await page.target().createCDPSession();
  let stopped = false;
  let lastFrame = null;
  const start = Date.now();
  let written = 0;
  let firstOk = false;

  const writeFrame = (buf) => {
    if (!buf || !ff?.stdin?.writable) return false;
    try {
      const ok = ff.stdin.write(buf);
      if (ok) written += 1;
      return ok;
    } catch {
      return false;
    }
  };
  // Suppress EPIPE errors — harmless, happens when ffmpeg is already closing
  ff.stdin.on('error', () => {});

  client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    try {
      const vr = metadata && metadata['visibleRect'];
      if (!firstOk && vr) {
        const ok = Math.round(vr.width) === W && Math.round(vr.height) === H;
        if (!ok) {
          log(`⚠️ visibleRect ist ${vr.width}×${vr.height}, stelle erneut ein …`);
          await lockViewport1080x1920(page);
        } else {
          firstOk = true;
        }
      }
      lastFrame = Buffer.from(data, 'base64');
      await client.send('Page.screencastFrameAck', { sessionId });
    } catch {}
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    maxWidth: W,
    maxHeight: H,
    everyNthFrame: 1
  });

  const timer = setInterval(() => {
    if (stopped || !lastFrame) return;
    const target = Math.floor(((Date.now() - start) / 1000) * FPS);
    while (written < target && ff?.stdin?.writable) {
      if (!writeFrame(lastFrame)) break;
    }
  }, Math.max(4, Math.floor(1000 / FPS / 2)));

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      try {
        await client.send('Page.stopScreencast');
      } catch {}
      const target = Math.floor(((Date.now() - start) / 1000) * FPS);
      while (written < target && lastFrame && ff?.stdin?.writable) {
        if (!writeFrame(lastFrame)) break;
      }
      log(`🧾 Realtime screencast wrote ${written} frames`);
    }
  };
}

// ---------------------------------------------------------------------------

(async ()=>{
  try {
    await ensureDir(CFG.OUT_DIR);
    await waitForServer(CFG.MAIN_URL);

    rmSingletonLock(CFG.USER_DATA_DIR);

    // System-Chrome (arm64) bevorzugen
    let launchOptions = {
      headless: 'new',
      userDataDir: CFG.USER_DATA_DIR,
      defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        '--force-color-profile=srgb'
      ]
    };

    // Versuche Chrome-Kanal, sonst Puppeteer Chromium
    let browser;
    try {
      log('🧭 Nutze System-Chrome (falls verfügbar) …');
      browser = await puppeteer.launch({ ...launchOptions, channel: 'chrome' });
    } catch {
      log('⚠️ Chrome-Kanal nicht verfügbar, nutze bundled Chromium …');
      browser = await puppeteer.launch(launchOptions);
    }

    const page = (await browser.pages())[0] || await browser.newPage();

    // webdriver-Flag verstecken (kosmetisch)
    try {
      await page.evaluateOnNewDocument(() =>
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      );
    } catch {}

    // Fester Headless-Viewport (vor JEDEM goto!)
    await lockViewport1080x1920(page);

    // ---------- PASS 1: PREWARM (Cache & SW laden) ----------
    await prewarm(page);

    // ---------- PASS 2: RECORD (Screencast → ffmpeg) ----------
    log('🎥 Record via realtime CDP screencast (wall-clock→ffmpeg)…');
    await lockViewport1080x1920(page); // sicherheitshalber nochmal

    const outFile = CFG.OUT_FILE();
    const ff = startFFmpegPipe(outFile);
    const sc = await startRealtimeScreencast(page, ff);

    // Sequenz fahren
    await gotoSafe(page, CFG.INTRO_URL, 'rec:intro');
    await page.waitForTimeout(CFG.INTRO_MS);

    await gotoSafe(page, CFG.MAIN_URL, 'rec:main');
    await waitMain(page, 'rec');

    await gotoSafe(page, CFG.OUTRO_URL, 'rec:outro');
    await page.waitForTimeout(CFG.OUTRO_MS);

    // Screencast + ffmpeg sauber beenden
    await sc.stop();
    // Give ffmpeg time to process buffered frames before killing
    try { ff.stdin.end(); } catch {}
    await new Promise(res => setTimeout(res, 500)); // kleines Flush
    try { ff.kill('SIGINT'); } catch {}
    // Wait for ffmpeg to exit cleanly
    await new Promise(res => {
      let done = false;
      const finish = () => { if (!done) { done = true; res(); } };
      const t = setTimeout(() => { finish(); }, 3000);
      ff.on('exit', (code) => { clearTimeout(t); log(`ffmpeg exit code: ${code}`); finish(); });
    });

    await browser.close();
    log(`✅ Fertig: ${outFile}`);
  } catch (e) {
    error(e.stack || e.message);
    process.exit(1);
  }
})();
