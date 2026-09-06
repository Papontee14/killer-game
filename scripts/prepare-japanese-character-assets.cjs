/* Convert individually generated Japanese lobby portraits to runtime WebP files. */
const fs = require("node:fs");
const { chromium } = require("@playwright/test");

const ids = [
  "m-jp-01", "f-jp-01", "m-jp-02", "f-jp-02", "m-jp-03", "f-jp-03",
  "m-jp-04", "f-jp-04", "m-jp-05", "f-jp-05", "m-jp-06", "f-jp-06",
];

(async () => {
  fs.mkdirSync("public/pixel/characters", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const id of ids) {
    const source = `artifacts/character-sources/${id}.png`;
    if (!fs.existsSync(source)) throw new Error(`Missing ${source}`);
    const data = `data:image/png;base64,${fs.readFileSync(source).toString("base64")}`;
    const encoded = await page.evaluate(async (dataUrl) => {
      const image = new Image(); image.src = dataUrl; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
      const context = canvas.getContext("2d"); context.imageSmoothingEnabled = false;
      const side = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256);
      return await new Promise((resolve) => canvas.toBlob((blob) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(blob);
      }, "image/webp", .92));
    }, data);
    fs.writeFileSync(`public/pixel/characters/${id}.webp`, Buffer.from(encoded, "base64"));
  }
  await browser.close();
  console.log(`Prepared ${ids.length} Japanese character WebP files.`);
})();
