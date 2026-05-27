const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH,
    args: ['--no-sandbox','--disable-gpu','--disable-software-rasterizer','--disable-dev-shm-usage'],
    defaultViewport: { width: 1080, height: 1920 }
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:53694/index.html', { waitUntil: 'networkidle0', timeout: 30000 });
  console.log('Page loaded, measuring screenshot time...');
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
    const t1 = Date.now();
    console.log(`Screenshot ${i+1}: ${t1-t0}ms, ${buf.length} bytes`);
  }
  await browser.close();
})().catch(e => console.error('Error:', e.message));
