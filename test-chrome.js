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
  await page.waitForTimeout(5000);
  const msgCount = await page.$$eval('.message', els => els.length);
  const done = await page.evaluate(() => !!window.__IM_DONE__);
  console.log('Messages after 5s:', msgCount, 'done:', done);
  await page.waitForTimeout(10000);
  const msgCount2 = await page.$$eval('.message', els => els.length);
  const done2 = await page.evaluate(() => !!window.__IM_DONE__);
  console.log('Messages after 15s total:', msgCount2, 'done:', done2);
  await browser.close();
  console.log('Done');
})().catch(e => console.error('Error:', e.message));
