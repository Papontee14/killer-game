const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const assets = require('./pixel-assets.json');
(async () => {
  fs.mkdirSync('public/pixel', { recursive: true });
  fs.mkdirSync('artifacts/pixel-review', { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const asset of assets) {
    const data = 'data:image/png;base64,' + fs.readFileSync(asset.source).toString('base64');
    const limit = asset.key.startsWith('avatar') ? 128 : asset.key.startsWith('role') ? 512 : 1200;
    const encoded = await page.evaluate(async ({ data, limit }) => {
      const img = new Image(); img.src=data; await img.decode();
      const ratio = Math.min(1,limit / img.width);
      const canvas = document.createElement('canvas'); canvas.width=Math.round(img.width*ratio); canvas.height=Math.round(img.height*ratio);
      const ctx=canvas.getContext('2d'); ctx.imageSmoothingEnabled=false; ctx.drawImage(img,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/webp',.92).split(',')[1];
    },{data,limit});
    fs.writeFileSync(asset.output,Buffer.from(encoded,'base64'));
  }
  // A code-native pixel K mark stays legible inside the maskable safe area.
  for (const [file,size] of [['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180]]) {
    const png = await page.evaluate(size => {
      const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');
      ctx.fillStyle='#061210';ctx.fillRect(0,0,size,size);
      const unit=size/32;ctx.fillStyle='#A3FF72';
      const rows=['1100011','1100110','1101100','1111000','1111000','1101100','1100110','1100011'];
      rows.forEach((row,y)=>[...row].forEach((bit,x)=>{if(bit==='1')ctx.fillRect((9+x*2)*unit,(7+y*2)*unit,unit*2,unit*2)}));
      ctx.fillStyle='#FF3347';ctx.fillRect(8*unit,25*unit,16*unit,2*unit);
      return c.toDataURL('image/png').split(',')[1];
    },size);
    fs.writeFileSync('public/'+file,Buffer.from(png,'base64'));
  }
  await page.setViewportSize({width:1200,height:1200});
  const cards=assets.map(a=>`<article><img src="data:image/webp;base64,${fs.readFileSync(a.output).toString('base64')}"><p>${a.key}</p></article>`).join('');
  await page.setContent(`<style>body{background:#061210;color:#f3f5e9;font:16px monospace;margin:24px;display:grid;grid-template-columns:repeat(5,1fr);gap:16px}article{margin:0;min-width:0}img{width:100%;height:200px;object-fit:cover;image-rendering:pixelated}p{margin:6px 0 16px}</style>${cards}`);
  await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
  await page.screenshot({path:'artifacts/pixel-review/assets.png',fullPage:true});
  await browser.close();
  console.log('Prepared '+assets.length+' WebP assets and 3 PWA icons.');
})();
