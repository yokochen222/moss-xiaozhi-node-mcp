import { chromium } from 'playwright';

async function main() {
  console.time('browser');
  const browser = await chromium.launch({ headless: false, timeout: 0 });
  console.timeEnd('browser');
  const page = await browser.newPage();
  console.time('page');
  await page.goto('https://qq.com/');
  console.log(await page.content());
}

main();
