/* Split the approved 4x8 generated character sheet into production WebP avatars. */
const fs = require("node:fs");
const { chromium } = require("@playwright/test");
// The TypeScript module is deliberately not loaded by Node. Keep this ordered list
// beside the catalog when replacing the generated sheet.
const ids = [
  "m-sea-01","f-sea-01","m-sea-02","f-sea-02","m-sea-03","f-sea-03","m-sea-04","f-sea-04",
  "m-sea-05","f-sea-05","m-sea-06","f-sea-06","m-ea-01","f-ea-01","m-ea-02","f-ea-02",
  "m-ea-03","f-ea-03","m-ea-04","f-ea-04","m-sa-01","f-sa-01","m-sa-02","f-sa-02",
  "m-world-01","f-world-01","m-world-02","f-world-02","m-world-03","f-world-03","m-world-04","f-world-04",
];

(async () => {
  const source = "artifacts/character-source.png";
  if (!fs.existsSync(source)) throw new Error(`Missing ${source}`);
  fs.mkdirSync("public/pixel/characters", { recursive: true });
  const image = `data:image/png;base64,${fs.readFileSync(source).toString("base64")}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const files = await page.evaluate(async ({ image, ids }) => {
    const source = new Image(); source.src = image; await source.decode();
    return Promise.all(ids.map(async (id, index) => {
      const col = index % 4, row = Math.floor(index / 4);
      const left = Math.round(col * source.width / 4), right = Math.round((col + 1) * source.width / 4);
      const top = Math.round(row * source.height / 8), bottom = Math.round((row + 1) * source.height / 8);
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, left, top, right-left, bottom-top, 0, 0, 256, 256);
      return [id, (await new Promise(resolve => canvas.toBlob(blob => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(blob);
      }, "image/webp", .92)))];
    }));
  }, { image, ids });
  for (const [id, data] of files) fs.writeFileSync(`public/pixel/characters/${id}.webp`, Buffer.from(data, "base64"));
  await browser.close();
  console.log(`Prepared ${files.length} character WebP files.`);
})();
