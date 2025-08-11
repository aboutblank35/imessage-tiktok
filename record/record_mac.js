const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync, spawn } = require('child_process');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');

const CFG = {
  INTRO_URL: 'http://localhost:53694/intro.html',
  MAIN_URL: 'http://localhost:53694/index.html',
  OUTRO_URL: 'http://localhost:53694/outro.html',
  OUT_DIR: path.join(__dirname, 'data'),
  FPS: 60,
  VIEWPORT: { width: 360, height: 640, deviceScaleFactor: 2 },
  INTRO_DURATION: 3400,
  OUTRO_DURATION: 5200,
  MIN_DURATION: 10000,
  MAX_DURATION: 300000,
  INACTIVITY_DELAY: 5000,
  AUDIO_DEVICE: ':BlackHole 2ch',
  MESSAGE_SELECTOR: '.message',
  TYPING_SELECTOR: '.typing-indicator'
};

const log = m => console.log(`[${new Date().toISOString()}] ${m}`);

async function ensureDir(dir) {
  await fs.ensureDir(dir);
}

async function recordPage(url, out, duration, main = false) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  const page = await browser.newPage();
  await page.setViewport(CFG.VIEWPORT);
  const recorder = new PuppeteerScreenRecorder(page, {
    fps: CFG.FPS,
    videoCodec: 'libx264',
    videoFrame: {
      width: CFG.VIEWPORT.width * CFG.VIEWPORT.deviceScaleFactor,
      height: CFG.VIEWPORT.height * CFG.VIEWPORT.deviceScaleFactor
    }
  });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await recorder.start(out);
  const start = Date.now();
  let last = Date.now();
  let count = 0;
  while (main) {
    const done = await page.evaluate(() => !!window.__IM_DONE__);
    if (done) break;
    const c = await page.$$eval(CFG.MESSAGE_SELECTOR, e => e.length);
    const t = await page.$(CFG.TYPING_SELECTOR) !== null;
    if (c > count || t) {
      count = c;
      last = Date.now();
    }
    const now = Date.now();
    if (now - start >= CFG.MAX_DURATION) break;
    if (now - start >= CFG.MIN_DURATION && now - last >= CFG.INACTIVITY_DELAY) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!main && duration > 0) await new Promise(r => setTimeout(r, duration));
  await recorder.stop();
  await browser.close();
  return out;
}

async function mergeVideos(videos, audio, out) {
  const list = path.join(CFG.OUT_DIR, `list_${Date.now()}.txt`);
  fs.writeFileSync(list, videos.map(v => `file '${v}'`).join('\n'));
  execSync(`ffmpeg -f concat -safe 0 -i "${list}" -c copy "${out}"`, { stdio: 'inherit' });
  if (audio && fs.existsSync(audio)) {
    const temp = `${out}.tmp.mp4`;
    execSync(`ffmpeg -i "${out}" -i "${audio}" -c:v copy -c:a aac -map 0:v -map 1:a -shortest -y "${temp}"`, { stdio: 'inherit' });
    fs.renameSync(temp, out);
  }
  fs.unlinkSync(list);
}

function recordAudio(out) {
  return new Promise(res => {
    const p = spawn('ffmpeg', ['-f', 'avfoundation', '-i', CFG.AUDIO_DEVICE, '-c:a', 'aac', '-y', out], { stdio: 'pipe' });
    res({ process: p, promise: new Promise(r => p.on('exit', r)), outputPath: out });
  });
}

(async () => {
  await ensureDir(CFG.OUT_DIR);
  const ts = Date.now();
  const introPath = path.join(CFG.OUT_DIR, `intro_${ts}.mp4`);
  const mainPath = path.join(CFG.OUT_DIR, `main_${ts}.mp4`);
  const outroPath = path.join(CFG.OUT_DIR, `outro_${ts}.mp4`);
  const audioPath = path.join(CFG.OUT_DIR, `audio_${ts}.m4a`);
  const finalPath = path.join(CFG.OUT_DIR, `final_${ts}.mp4`);
  const audioRec = await recordAudio(audioPath);
  let introVideo, mainVideo, outroVideo;
  try {
    introVideo = await recordPage(CFG.INTRO_URL, introPath, CFG.INTRO_DURATION);
    mainVideo = await recordPage(CFG.MAIN_URL, mainPath, 0, true);
    outroVideo = await recordPage(CFG.OUTRO_URL, outroPath, CFG.OUTRO_DURATION);
    audioRec.process.kill('SIGINT');
    await audioRec.promise;
    await mergeVideos([introVideo, mainVideo, outroVideo], audioRec.outputPath, finalPath);
    log(`output: ${finalPath}`);
  } catch (e) {
    log(`error: ${e.message}`);
    process.exit(1);
  } finally {
    try { audioRec.process.kill('SIGINT'); } catch {}
    [introVideo, mainVideo, outroVideo].forEach(f => { if (f && fs.existsSync(f)) fs.unlinkSync(f); });
  }
})();
