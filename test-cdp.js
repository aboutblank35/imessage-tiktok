const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage'],
    defaultViewport: { width: 1080, height: 1920 }
  });
  const page = await browser.newPage();
  const client = await page.target().createCDPSession();
  
  let frameCount = 0;
  client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frameCount++;
    const buf = Buffer.from(data, 'base64');
    if (frameCount <= 5 || frameCount % 10 === 0) {
      console.log(`Frame #${frameCount}: ${buf.length} bytes, ts=${(metadata && metadata.timestamp) || '?'}`);
    }
    await client.send('Page.screencastFrameAck', { sessionId });
  });
  
  await client.send('Page.startScreencast', {
    format: 'jpeg', quality: 90, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1
  });
  
  await page.goto('http://127.0.0.1:53694/index.html', { waitUntil: 'networkidle0', timeout: 30000 });
  console.log('Page loaded, waiting for frames...');
  
  await new Promise(r => setTimeout(r, 30000));
  console.log('After 30s: total frames received =', frameCount);
  
  await client.send('Page.stopScreencast');
  await browser.close();
  console.log('Done. Total frames:', frameCount);
})().catch(e => console.error('Error:', e.message));
