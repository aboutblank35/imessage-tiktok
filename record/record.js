// record.js – Dynamic Chat Recording via Xvfb
// -----------------------------------------------------------
const os        = require('os');
const fs        = require('fs-extra');
const cp        = require('child_process');
const puppeteer = require('puppeteer');

// CONFIG
const CFG = {
  URL:      'http://localhost:3000',
  OUT:      'data/chat.mp4',
  WIDTH:    360,
  HEIGHT:   640,
  DSF:      2,
  FPS:      60,
  QUIET_MS: 4000,
  HARD_TIMEOUT: 120000,
};
fs.ensureDirSync('data');

async function getRegion(page) {
  const rect = await page.$eval('#chat', el => el.getBoundingClientRect());
  const dsf = CFG.DSF;
  return {
    x: Math.round(rect.x * dsf),
    y: Math.round(rect.y * dsf),
    w: Math.round(rect.width * dsf),
    h: Math.round(rect.height * dsf),
  };
}

function startFFmpeg(r) {
  const src = process.env.PULSE_SOURCE;
  const args = [
    '-y',
    '-f', 'x11grab',
    '-framerate', String(CFG.FPS),
    '-video_size', `${r.w}x${r.h}`,
    '-i', `:99+${r.x},${r.y}`,
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
  console.log('🎥 FFmpeg', args.join(' '));
  return cp.spawn('ffmpeg', args, { stdio: 'inherit' });
}

(async () => {
  const disp = process.env.DISPLAY || ':99';
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    defaultViewport: { width: CFG.WIDTH, height: CFG.HEIGHT, deviceScaleFactor: CFG.DSF },
    args: [
      `--app=${CFG.URL}`,
      '--kiosk',
      '--start-fullscreen',
      '--disable-infobars',
      '--hide-scrollbars',
      '--disable-translate',
      '--no-first-run',
      '--noerrdialogs',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--window-size=${CFG.WIDTH},${CFG.HEIGHT}`,
      `--display=${disp}`
    ],
  });

  const [page] = await browser.pages();
  // hide page scrollbars
  await page.addStyleTag({ content: `
    html, body, #chat { overflow:hidden!important; }
    ::-webkit-scrollbar { display:none!important; }
  `});

  await page.goto(CFG.URL, { waitUntil: 'networkidle2' });
  console.log('🌐 Seite geladen');

  // calc region
  const region = await getRegion(page);
  console.log('🔲 Region:', region);

  // start capture
  const ff = startFFmpeg(region);
  // wait
  await Promise.race([
    new Promise(res => setTimeout(res, CFG.HARD_TIMEOUT)),
    page.evaluate(({ QUIET_MS }) => new Promise(res => {
      let last = Date.now();
      const obs = new MutationObserver(() => last = Date.now());
      obs.observe(document.querySelector('#chat'), { childList:true, subtree:true });
      const interval = setInterval(() => {
        if (Date.now() - last > QUIET_MS) { clearInterval(interval); obs.disconnect(); res(); }
      }, 500);
    }), { QUIET_MS: CFG.QUIET_MS }),
  ]);

  console.log('⏹ Stop FFmpeg');
  ff.kill('SIGINT'); await new Promise(r=>ff.on('exit',r));
  await browser.close();
  console.log('✅ Saved:', CFG.OUT);
})();
