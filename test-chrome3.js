const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH,
    args: ['--no-sandbox','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage'],
    defaultViewport: { width: 1080, height: 1920 }
  });
  const page = await browser.newPage();
  console.log('Page created');
  await page.goto('http://127.0.0.1:53694/index.html', { waitUntil: 'networkidle0', timeout: 30000 });
  console.log('Page loaded');
  
  // Wait longer, check every 2s
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    const msgCount = await page.$$eval('.message', els => els.length);
    const done = await page.evaluate(() => !!window.__IM_DONE__);
    const elapsed = (i + 1) * 2;
    console.log(`t=${elapsed}s  msgs=${msgCount}  done=${done}`);
    if (done) break;
  }
  
  await browser.close();
  console.log('All done');
})().catch(e => console.error('Error:', e.message));
