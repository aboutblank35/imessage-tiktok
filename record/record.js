// record.js – Dynamic Region & Audio Recording via Xvfb
// ---------------------------------------------------------
const os        = require('os');
const fs        = require('fs-extra');
const path      = require('path');
const cp        = require('child_process');
const puppeteer = require('puppeteer');

// ───────────────────────── CONFIG ──────────────────────────
const CFG = {
  URL:      'http://localhost:3000',
  OUT:      'data/chat.mp4',
  FPS:      60,
  QUIET_MS: 4000,
  HARD_TIMEOUT: 120000,
};
fs.ensureDirSync(path.dirname(CFG.OUT));

async function getChatRegion(page) {
  const rect = await page.evaluate(() => {
    const el = document.querySelector('#chat');
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  });
  // account for deviceScaleFactor
  const dsf = page.viewport().deviceScaleFactor;
  return {
    x: Math.round(rect.x * dsf),
    y: Math.round(rect.y * dsf),
    w: Math.round(rect.width * dsf),
    h: Math.round(rect.height * dsf),
  };
}

function startFFmpeg(region) {
  const src = process.env.PULSE_SOURCE;
  const { x, y, w, h } = region;
  const args = [
    '-y',
    '-f', 'x11grab',
    '-framerate', String(CFG.FPS),
    '-video_size', `${w}x${h}`,
    '-i', `:99+${x},${y}`,
    '-f', 'pulse',
    '-ac', '2',
    '-i', src,
    '-vcodec', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-acodec', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    CFG.OUT,
  ];
  console.log('🎥 FFmpeg args:', args.join(' '));
  return cp.spawn('ffmpeg', args, { stdio: 'inherit' });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      `--app=${CFG.URL}`,
      '--kiosk',
      '--start-fullscreen',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--display=${process.env.DISPLAY || ':99'}`
    ],
    defaultViewport: null,
  });

  const [page] = await browser.pages();
  // force viewport to full screen of Xvfb
  await page.setViewport({ width: 720, height: 1280, deviceScaleFactor: 2 });
  await page.goto(CFG.URL, { waitUntil: 'networkidle2' });
  console.log('🌐 Seite geladen');

  // hide scrollbars/styles
  await page.addStyleTag({ content: `
    html, body, #chat { overflow: hidden !important; }
    ::-webkit-scrollbar { display: none !important; }
  `});

  // compute region to capture
  const region = await getChatRegion(page);
  console.log('🔲 Capture region:', region);

  // start ffmpeg with region
  const ff = startFFmpeg(region);

  // wait for quiet or timeout
  await Promise.race([
    page.evaluate(({ QUIET_MS }) => new Promise(res => {
      let last = Date.now();
      const obs = new MutationObserver(() => last = Date.now());
      obs.observe(document.body, { childList: true, subtree: true });
      const id = setInterval(() => {
        if (Date.now() - last > QUIET_MS) {
          clearInterval(id);
          obs.disconnect();
          res();
        }
      }, 500);
    }), { QUIET_MS: CFG.QUIET_MS }),
    new Promise(res => setTimeout(res, CFG.HARD_TIMEOUT)),
  ]);

  console.log('⏹ Stoppe FFmpeg');
  ff.kill('SIGINT');
  await new Promise(r => ff.on('exit', r));
  await browser.close();
  console.log('✅ Gespeichert:', CFG.OUT);
})();
