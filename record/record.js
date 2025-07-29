// record.js – In‑Tab Video+Audio Recording via Puppeteer‑stream
// -----------------------------------------------------------
// Setup: `npm install puppeteer puppeteer‑stream fs‑extra`

const fs        = require('fs‑extra');
const puppeteer = require('puppeteer');
const { getStream } = require('puppeteer‑stream');

(async () => {
  const CFG = {
    URL:        'http://localhost:3000',
    OUT:        'data/chat.webm',
    FPS:        60,
    QUIET_MS:   4000,
    HARD_TIMEOUT: 120000,
  };
  await fs.ensureDir('data');

  // Launch Chromium
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--autoplay‑policy=no‑user‑gesture‑required']
  });
  const page = await browser.newPage();
  await page.goto(CFG.URL, { waitUntil: 'networkidle2' });
  console.log('🌐 Seite geladen');

  // Hide UI elements & scrollbars
  await page.addStyleTag({ content: `
    html, body, #chat { overflow:hidden !important; }
    ::-webkit-scrollbar { display:none !important; }
  `});

  // Start streaming video+audio
  console.log('🎥 Starte Aufnahme');
  const stream = await getStream(page, { audio: true, video: true, fps: CFG.FPS });
  const fileStream = fs.createWriteStream(CFG.OUT);
  stream.pipe(fileStream);

  // Stop on silence (quiet) or timeout
  await Promise.race([
    new Promise(res => setTimeout(res, CFG.HARD_TIMEOUT)),
    page.evaluate(({ QUIET_MS }) => new Promise(res => {
      let last = Date.now();
      const obs = new MutationObserver(() => { last = Date.now(); });
      obs.observe(document.querySelector('#chat'), { childList: true, subtree: true });
      const id = setInterval(() => {
        if (Date.now() - last > QUIET_MS) {
          clearInterval(id);
          obs.disconnect();
          res();
        }
      }, 500);
    }), { QUIET_MS: CFG.QUIET_MS }),
  ]);

  console.log('⏹ Stoppe Aufnahme');
  stream.destroy();
  fileStream.close();
  await browser.close();
  console.log('✅ Video gespeichert →', CFG.OUT);
})();
