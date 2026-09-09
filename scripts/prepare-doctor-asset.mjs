import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const source = process.argv[2];
if (!source) throw Error('Pass the generated Doctor PNG path');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const data = 'data:image/png;base64,' + (await readFile(source)).toString('base64');
  const output = await page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, 512, 512);
    return canvas.toDataURL('image/webp', .92).split(',')[1];
  }, data);
  await writeFile(new URL('../public/pixel/role-doctor.webp', import.meta.url), Buffer.from(output, 'base64'));
} finally { await browser.close(); }
