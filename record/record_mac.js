const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');

const CFG = {
  URL: 'http://localhost:3000',
  OUT_DIR: 'data',
  FILENAME: `chat_${Date.now()}.mp4`, // Eindeutiger timestamp
  VIEWPORT: { width: 360, height: 640, scale: 2 },
  FPS: 60,
  INACTIVITY_DELAY: 3000, // 3s nach letzter Nachricht
  ABSOLUTE_TIMEOUT: 120000, // 2min max (Fallback)
  MIN_MESSAGES: 2 // Mindestanzahl vor Inaktivitätsprüfung
};

(async () => {
  await fs.ensureDir(CFG.OUT_DIR);
  const outputPath = path.join(CFG.OUT_DIR, CFG.FILENAME);

  console.log('🚀 Starte Browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required']
  });

  const page = await browser.newPage();
  await page.setViewport(CFG.VIEWPORT);

  console.log(`🌐 Lade ${CFG.URL}...`);
  await page.goto(CFG.URL, { waitUntil: 'networkidle2' });

  console.log('⏺️ Starte Aufnahme...');
  const recorder = new PuppeteerScreenRecorder(page, {
    fps: CFG.FPS,
    videoFormat: 'mp4',
    videoCodec: 'libx264',
    videoFrame: {
      width: CFG.VIEWPORT.width * CFG.VIEWPORT.scale,
      height: CFG.VIEWPORT.height * CFG.VIEWPORT.scale
    }
  });
  await recorder.start(outputPath);

  console.log('👀 Analysiere Chat in Echtzeit...');
  await page.evaluate(async (cfg) => {
    await new Promise((resolve) => {
      let msgCount = 0;
      let lastUpdate = Date.now();
      const observer = new MutationObserver((mutations) => {
        const newMsgs = document.querySelectorAll('.message:not(.typing)').length;
        if (newMsgs > msgCount) {
          msgCount = newMsgs;
          lastUpdate = Date.now();
        }
      });

      observer.observe(document.body, { 
        childList: true, 
        subtree: true 
      });

      const check = () => {
        const inactive = (Date.now() - lastUpdate > cfg.INACTIVITY_DELAY);
        const minReached = (msgCount >= cfg.MIN_MESSAGES);
        if (inactive && minReached) {
          observer.disconnect();
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      
      check();
    });
  }, {
    INACTIVITY_DELAY: CFG.INACTIVITY_DELAY,
    MIN_MESSAGES: CFG.MIN_MESSAGES
  });

  // Fallback-Timeouts
  await Promise.race([
    new Promise(resolve => setTimeout(resolve, CFG.ABSOLUTE_TIMEOUT)),
    page.waitForTimeout(1000) // Finaler Puffer
  ]);

  console.log('🛑 Beende Aufnahme...');
  await recorder.stop();
  await browser.close();
  console.log(`✅ ${path.basename(outputPath)} gespeichert (${fs.statSync(outputPath).size / 1000000} MB)`);
})();