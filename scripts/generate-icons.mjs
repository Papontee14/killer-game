import fs from 'node:fs';
import { chromium } from '@playwright/test';

// Resize the approved image with nearest-neighbour sampling to retain pixel edges.
const source = 'data:image/png;base64,' + fs.readFileSync('public/pixel/killer-icon-8bit-source.png').toString('base64');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [file, size, maskable] of [
    ['icon-192.png', 192, false], ['icon-512.png', 512, false],
    ['apple-touch-icon.png', 180, false], ['icon-maskable-512.png', 512, true],
  ]) {
    const png = await page.evaluate(async ({ source, size, maskable }) => {
      const img = new Image(); img.src = source; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#030706'; ctx.fillRect(0, 0, size, size);
      // Fit the entire square artwork inside the central maskable safe circle.
      const edge = maskable ? Math.floor(size * .56) : size;
      const inset = Math.floor((size - edge) / 2);
      ctx.drawImage(img, inset, inset, edge, edge);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { source, size, maskable });
    fs.writeFileSync('public/' + file, Buffer.from(png, 'base64'));
  }
  // Android status-bar badges use a white alpha silhouette, not a full-colour square.
  const badge = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const ctx = c.getContext('2d'); ctx.scale(3, 3); ctx.fillStyle = '#fff';
    const rows = ['............................', '.......................###..', '......................####..', '.....................#####..', '....................######..', '...................#######..', '..................########..', '.................#########..', '................##########..', '...............###########..', '..............###########...', '.............############...', '............############....', '...........#############....', '..........#############.....', '.........#############......', '........#############.......', '.......#############........', '......#############.........', '.......###########..........', '......###########...........', '.....#####.#####............', '....#####...###.............', '...#####....................', '..#####.....................', '..####......................', '...##.......................', '............................'];
    rows.forEach((row,y) => [...row].forEach((pixel,x) => { if (pixel === '#') ctx.fillRect(x+2,y+2,1,1); }));
    return c.toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync('public/notification-badge.png', Buffer.from(badge, 'base64'));
} finally { await browser.close(); }
console.log('Generated 8-bit app icons, maskable icon and notification badge.');
