// record.js – Cross-platform Screen+Audio Recording (Linux & macOS)
// -----------------------------------------------------------------------------
const os        = require('os');
const fs        = require('fs-extra');
const path      = require('path');
const cp        = require('child_process');
const puppeteer = require('puppeteer');

// ───────────────────────────── CONFIG ──────────────────────────────
const CFG = {
  URL:          'http://localhost:3000',
  OUT:          'data/chat.mp4',
  VIEWPORT:     { width: 360, height: 640, deviceScaleFactor: 2 },
  FPS:          60,
  QUIET_MS:     4000,
  HARD_TIMEOUT: 120000,
  // macOS-only indices (Linux nutzt PULSE_SOURCE)
};
fs.ensureDirSync(path.dirname(CFG.OUT));

function startFFmpeg() {
  const isLinux = os.platform() === 'linux';
  let args;

  if (isLinux) {
    // Linux: X11 + PulseAudio (Pulse-Source via ENV)
    const w   = CFG.VIEWPORT.width  * CFG.VIEWPORT.deviceScaleFactor; // 720
    const h   = CFG.VIEWPORT.height * CFG.VIEWPORT.deviceScaleFactor; // 1280
    const src = process.env.PULSE_SOURCE || 'default';

    args = [
      '-y',
      '-f', 'x11grab',
      '-framerate', String(CFG.FPS),
      '-video_size', `${w}x${h}`,
      '-i', ':99',               // Xvfb DISPLAY
      '-f', 'pulse',
      '-ac', '2',
      '-i', src,                 // PulseAudio source
      '-vf', `transpose=1,scale=${w}:${h},format=yuv420p`,
      '-vcodec', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-acodec', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      CFG.OUT,
    ];
  } else {
    // macOS: avfoundation
    const w         = CFG.VIEWPORT.width  * CFG.VIEWPORT.deviceScaleFactor;
    const h         = CFG.VIEWPORT.height * CFG.VIEWPORT.deviceScaleFactor;
    const screenIdx = process.env.SCREEN_IDX || 4;
    const audioIdx  = process.env.AUDIO_IDX  || 2;

    args = [
      '-f', 'avfoundation',
      '-capture_cursor', '0',
      '-framerate', String(CFG.FPS),
      '-i', `${screenIdx}:${audioIdx}`, // screen:audio
      '-vf', `transpose=1,scale=${w}:${h},format=yuv420p`,
      '-vcodec', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-acodec', 'aac',
      '-ac', '2',
      '-b:a', '128k',
      '-movflags', '+faststart',
      CFG.OUT,
    ];
  }

  console.log('🎥  FFmpeg', args.join(' '));
  return cp.spawn('ffmpeg', args, { stdio: 'inherit' });
}

// ─────────────────────────── Main Flow ────────────────────────────
;(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    defaultViewport: CFG.VIEWPORT,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--window-size=${CFG.VIEWPORT.width},${CFG.VIEWPORT.height}`,
      `--display=${process.env.DISPLAY || ':99'}`
    ],
  });

  const page = await browser.newPage();

  // Warte, bis der Server bereit ist
  for (let i = 0; i < 30; i++) {
    try {
      await page.goto(CFG.URL, { waitUntil: 'networkidle2', timeout: 5000 });
      console.log('🌐 Seite geladen');
      break;
    } catch {
      console.log(`↪︎ Server nicht bereit – retry ${i + 1}`);
      await new Promise(r => setTimeout(r, 1000));
      if (i === 29) throw new Error('Server unreachable');
    }
  }

  // Starte Recording
  const ff = startFFmpeg();

  // Warte auf Quiet-Period oder Hard-Timeout
  await Promise.race([
    page.evaluate(({ QUIET_MS }) => new Promise(res => {
      let last = Date.now();
      const obs = new MutationObserver(() => { last = Date.now(); });
      obs.observe(document.querySelector('#chat') || document.body, { childList: true, subtree: true });
      const id = setInterval(() => {
        if (Date.now() - last > QUIET_MS) {
          clearInterval(id);
          obs.disconnect();
          res('quiet');
        }
      }, 500);
    }), { QUIET_MS: CFG.QUIET_MS }),
    new Promise(res => setTimeout(() => res('hard'), CFG.HARD_TIMEOUT)),
  ]);

  console.log('⏹ Stoppe FFmpeg …');
  ff.kill('SIGINT');
  await new Promise(r => ff.on('exit', r));

  await browser.close();
  console.log('✅ Video gespeichert →', CFG.OUT);
})();
