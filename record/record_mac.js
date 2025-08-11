const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync, spawn } = require('child_process');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');

// Konfiguration
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
  AUDIO_DEVICE: ":BlackHole 2ch",
  MESSAGE_SELECTOR: '.message',
  TYPING_SELECTOR: '.typing-indicator'
};

// Hilfsfunktionen
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const error = (msg) => console.error(`[${new Date().toISOString()}] ❌ ${msg}`);

async function ensureDirectory(dir) {
  try {
    await fs.ensureDir(dir);
    log(`Verzeichnis sichergestellt: ${dir}`);
  } catch (err) {
    error(`Verzeichnis konnte nicht erstellt werden: ${dir}`);
    throw err;
  }
}

async function recordPage(url, outputPath, duration, isMainPage = false) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--autoplay-policy=no-user-gesture-required"
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

  try {
    log(`🌐 Lade Seite: ${url}`);
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    if (isMainPage) {
      log("👀 Warte auf Nachrichten...");
      try {
        await page.waitForSelector(CFG.MESSAGE_SELECTOR, { 
          timeout: 30000,
          visible: true 
        });
      } catch (err) {
        log("⚠️ Keine Nachrichten gefunden, füge Platzhalter ein");
        await page.evaluate((sel) => {
          const chat = document.querySelector('#chat') || document.body;
          chat.innerHTML += `<div class="${sel.replace('.','')}">System: Chat started</div>`;
        }, CFG.MESSAGE_SELECTOR);
      }
    }

    log(`🎥 Starte Aufnahme: ${outputPath}`);
    await recorder.start(outputPath);
    const startTime = Date.now();
    let messageCount = isMainPage ? await page.$$eval(CFG.MESSAGE_SELECTOR, els => els.length) : 0;
    let lastActivity = Date.now();

    // Aktivitätsüberwachung nur für Hauptseite
    while (isMainPage) {
      const currentTime = Date.now();
      const duration = currentTime - startTime;
      const inactiveFor = currentTime - lastActivity;

      // Neue Nachrichten prüfen
      const newCount = await page.$$eval(CFG.MESSAGE_SELECTOR, els => els.length);
      const isTyping = await page.$(CFG.TYPING_SELECTOR) !== null;

      if (newCount > messageCount || isTyping) {
        messageCount = newCount;
        lastActivity = currentTime;
        log(`💬 Aktivität: ${messageCount} Nachrichten` + (isTyping ? " (Typing...)" : ""));
      }

      const done = await page.evaluate(() => !!window.__IM_DONE__);
      if (done) break;

      // Beendigungskriterien
      if (duration >= CFG.MAX_DURATION) {
        log(`⏱ Maximale Dauer erreicht (${CFG.MAX_DURATION/1000}s)`);
        break;
      }
      if (duration >= CFG.MIN_DURATION && inactiveFor >= CFG.INACTIVITY_DELAY) {
        log(`💤 Inaktivität (${CFG.INACTIVITY_DELAY/1000}s)`);
        break;
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    // Standard-Dauer für Intro
    if (!isMainPage) {
      await new Promise(resolve => setTimeout(resolve, duration));
    }

    return outputPath;
  } catch (err) {
    error(`${isMainPage ? 'Chat' : 'Intro'}-Aufnahme fehlgeschlagen: ${err.message}`);
    throw err;
  } finally {
    await recorder.stop();
    await browser.close();
  }
}

async function mergeVideos(videoPaths, audioPath, outputPath) {
  const tempList = path.join(CFG.OUT_DIR, 'merge_list.txt');
  
  try {
    // Absolute Pfade für FFmpeg
    const absolutePaths = videoPaths.map(v => path.resolve(v));
    fs.writeFileSync(tempList, absolutePaths.map(v => `file '${v}'`).join('\n'));

    log("🔄 Videos zusammenfügen...");
    await execSync(`ffmpeg -f concat -safe 0 -i "${tempList}" -c copy "${outputPath}"`, {
      stdio: 'inherit'
    });

    if (audioPath && fs.existsSync(audioPath)) {
      log("🔊 Audio hinzufügen...");
      const tempOutput = `${outputPath}.temp.mp4`;
      await execSync(
        `ffmpeg -i "${outputPath}" -i "${audioPath}" ` +
        `-c:v copy -c:a aac -map 0:v -map 1:a ` +
        `-shortest -y "${tempOutput}"`,
        { stdio: 'inherit' }
      );
      fs.renameSync(tempOutput, outputPath);
    }

    return outputPath;
  } catch (err) {
    error(`Fehler beim Zusammenfügen: ${err.message}`);
    throw err;
  } finally {
    if (fs.existsSync(tempList)) fs.unlinkSync(tempList);
  }
}

async function recordAudio(outputPath) {
  return new Promise((resolve) => {
    log("🔊 Starte Audio-Aufnahme");
    const process = spawn('ffmpeg', [
      '-f', 'avfoundation',
      '-i', CFG.AUDIO_DEVICE,
      '-c:a', 'aac',
      '-y', outputPath
    ], { stdio: 'pipe' });

    process.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Input/output error')) {
        error('Audio-Aufnahmefehler');
      }
    });

    resolve({ 
      process,
      promise: new Promise(res => process.on('exit', res)),
      outputPath
    });
  });
}

async function getVideoDuration(file) {
  try {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`;
    const seconds = parseFloat(execSync(cmd).toString());
    return `${Math.floor(seconds/60)}m ${Math.round(seconds%60)}s`;
  } catch {
    return 'unbekannt';
  }
}

(async () => {
  let introVideo, mainVideo, outroVideo, finalVideo;
  let audioProcess;

  try {
    await ensureDirectory(CFG.OUT_DIR);
    const timestamp = Date.now();
    finalVideo = path.join(CFG.OUT_DIR, `final_${timestamp}.mp4`);

    const audioResult = await recordAudio(path.join(CFG.OUT_DIR, `audio_${timestamp}.m4a`));
    audioProcess = audioResult.process;

    introVideo = await recordPage(
      CFG.INTRO_URL,
      path.join(CFG.OUT_DIR, `intro_${timestamp}.mp4`),
      CFG.INTRO_DURATION
    );

    mainVideo = await recordPage(
      CFG.MAIN_URL,
      path.join(CFG.OUT_DIR, `main_${timestamp}.mp4`),
      0,
      true
    );

    outroVideo = await recordPage(
      CFG.OUTRO_URL,
      path.join(CFG.OUT_DIR, `outro_${timestamp}.mp4`),
      CFG.OUTRO_DURATION
    );

    audioProcess.kill('SIGINT');
    await audioResult.promise;

    await mergeVideos([introVideo, mainVideo, outroVideo], audioResult.outputPath, finalVideo);

    log(`
✅ Aufnahme erfolgreich!
📂 Ausgabedatei: ${finalVideo}
⏳ Dauer: ${await getVideoDuration(finalVideo)}s
    `);

  } catch (err) {
    error(`Hauptprozess fehlgeschlagen: ${err.message}`);
    process.exit(1);
  } finally {
    if (audioProcess) audioProcess.kill();
    [introVideo, mainVideo, outroVideo].forEach(file => {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    });
  }
})();