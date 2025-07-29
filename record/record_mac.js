const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync, spawn } = require('child_process');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');

// Konfiguration
const CFG = {
  URL: 'http://localhost:3000',
  OUT_DIR: 'data',
  FPS: 60,
  VIEWPORT: { width: 360, height: 640, scale: 2 },
  INACTIVITY_DELAY: 5000,
  MIN_DURATION: 10000,
  MAX_DURATION: 300000,
  AUDIO_DEVICES: [
    "BlackHole 2ch",
    "MacBook Pro-Mikrofon",
    ":0"
  ]
};

// Hilfsfunktionen
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const error = (msg) => console.error(`[${new Date().toISOString()}] ❌ ${msg}`);

async function getAudioDevices() {
  try {
    return execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', { 
      encoding: 'utf-8',
      stdio: 'pipe'
    });
  } catch (err) {
    return err.stderr || err.stdout || '';
  }
}

async function findWorkingAudioDevice() {
  const devicesOutput = await getAudioDevices();
  log('Verfügbare Audio-Devices:\n' + devicesOutput);

  for (const device of CFG.AUDIO_DEVICES) {
    if (devicesOutput.includes(device)) {
      const deviceStr = device.startsWith(':') ? device : `:${device}`;
      log(`✅ Verwende Audio-Device: ${deviceStr}`);
      return deviceStr;
    }
  }
  
  error('Kein funktionierendes Audio-Device gefunden!');
  process.exit(1);
}

async function getVideoDuration(file) {
  try {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`;
    return parseFloat(execSync(cmd).toString()).toFixed(1);
  } catch {
    return 'unbekannt';
  }
}

(async () => {
  let browser;
  let audioProcess;
  let tempVideo, tempAudio, finalOutput;

  try {
    // 1. Audio-Device finden
    const audioDevice = await findWorkingAudioDevice();
    await fs.ensureDir(CFG.OUT_DIR);
    const timestamp = Date.now();
    tempVideo = path.join(CFG.OUT_DIR, `temp_${timestamp}.mp4`);
    tempAudio = path.join(CFG.OUT_DIR, `temp_${timestamp}.m4a`);
    finalOutput = path.join(CFG.OUT_DIR, `final_${timestamp}.mp4`);

    // 2. Audio-Aufnahme starten (mit zusätzlichem Monitoring)
    log(`🔊 Starte Audio-Aufnahme mit ${audioDevice}...`);
    audioProcess = spawn('ffmpeg', [
      '-f', 'avfoundation',
      '-i', audioDevice,
      '-c:a', 'aac',
      '-y', tempAudio
    ], { stdio: 'pipe', shell: true });

    // Audio-Prozess-Überwachung
    audioProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Input/output error')) {
        error('FFmpeg Audio-Fehler: Device nicht erreichbar');
      }
    });

    // 3. Browser starten
    log('🚀 Starte Browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-gpu'
      ],
      timeout: 30000
    });

    const page = await browser.newPage();
    await page.setViewport(CFG.VIEWPORT);

    // 4. Seite laden
    log(`🌐 Lade ${CFG.URL}...`);
    await page.goto(CFG.URL, { 
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // 5. Warte auf initiale Nachrichten
    log('👀 Warte auf erste Nachricht...');
    await page.waitForSelector('.message', { timeout: 10000 });
    let messageCount = await page.evaluate(() => document.querySelectorAll('.message').length);
    log(`📜 Initiale Nachrichten gefunden: ${messageCount}`);

    // 6. Video-Recorder starten
    log('🎥 Starte Videoaufnahme...');
    const recorder = new PuppeteerScreenRecorder(page, {
      fps: CFG.FPS,
      videoFormat: 'mp4',
      videoCodec: 'libx264',
      videoBitrate: 8000,
      videoFrame: {
        width: CFG.VIEWPORT.width * CFG.VIEWPORT.scale,
        height: CFG.VIEWPORT.height * CFG.VIEWPORT.scale
      }
    });
    await recorder.start(tempVideo);
    const startTime = Date.now();
    let lastMsgTime = Date.now();

    // 7. Nachrichtenüberwachung
    log('⏱️ Überwache Chat-Aktivität...');
    while (true) {
      const currentTime = Date.now();
      const activeDuration = currentTime - startTime;
      const inactiveDuration = currentTime - lastMsgTime;

      // Neue Nachrichten prüfen
      const newCount = await page.evaluate(() => document.querySelectorAll('.message').length);
      if (newCount > messageCount) {
        messageCount = newCount;
        lastMsgTime = currentTime;
        log(`📩 Neue Nachricht erkannt (${messageCount} total)`);
      }

      // Beendigungskriterien
      if (activeDuration >= CFG.MAX_DURATION) {
        log(`🕒 Maximale Dauer erreicht (${CFG.MAX_DURATION/1000}s)`);
        break;
      } else if (activeDuration >= CFG.MIN_DURATION && inactiveDuration >= CFG.INACTIVITY_DELAY) {
        log(`💤 Inaktivität erkannt (${CFG.INACTIVITY_DELAY/1000}s ohne Änderung)`);
        break;
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    // 8. Aufnahme stoppen
    log('🛑 Beende Aufnahmen...');
    await recorder.stop();
    audioProcess.kill('SIGINT');
    await browser.close();

    // 9. Überprüfen ob Audio-Datei existiert
    const audioExists = fs.existsSync(tempAudio) && fs.statSync(tempAudio).size > 0;
    
    if (audioExists) {
      log('🔗 Kombiniere Medien...');
      try {
        execSync(
          `ffmpeg -i ${tempVideo} -i ${tempAudio} ` +
          `-c:v copy -c:a aac -map 0:v -map 1:a ` +
          `-shortest -y ${finalOutput}`,
          { stdio: 'ignore' }
        );
        log(`✅ Finale Datei: ${finalOutput}`);
      } catch (mergeErr) {
        error(`Fehler beim Merging: ${mergeErr.message}`);
        fs.copyFileSync(tempVideo, finalOutput);
        log(`⚠️ Nur Video gespeichert: ${finalOutput}`);
      }
    } else {
      error('❌ Audio-Aufnahme fehlgeschlagen - nur Video wird gespeichert');
      fs.copyFileSync(tempVideo, finalOutput);
      log(`⚠️ Nur Video gespeichert: ${finalOutput}`);
    }

    log(`⏳ Dauer: ${await getVideoDuration(finalOutput)}s`);
    log(`📁 Größe: ${(fs.statSync(finalOutput).size / (1024 * 1024)).toFixed(2)}MB`);

  } catch (err) {
    error(`Hauptprozess fehlgeschlagen: ${err.message}`);
  } finally {
    // Aufräumen
    try {
      if (fs.existsSync(tempVideo)) fs.unlinkSync(tempVideo);
      if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio);
    } catch (cleanupErr) {
      error(`Bereinigung fehlgeschlagen: ${cleanupErr.message}`);
    }
  }
})();