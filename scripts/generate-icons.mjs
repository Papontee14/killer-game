import fs from 'node:fs';
import zlib from 'node:zlib';

function createPng(width, height, r, g, b) {
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(4 + 4 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    // CRC calculation
    const crcVal = crc32(buf.subarray(4, 8 + len));
    buf.writeUInt32BE(crcVal, 8 + len);
    return buf;
  }

  // Raw image data: filter byte (0) + width * 4 bytes per scanline
  const scanlineLen = 1 + width * 4;
  const rawData = Buffer.alloc(height * scanlineLen);

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.42;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLen;
    rawData[rowOffset] = 0; // Filter type None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Dark background #0d0f12
      let pr = 13,
        pg = 15,
        pb = 18,
        pa = 255;

      // Outer circle border
      if (dist <= radius && dist >= radius - width * 0.04) {
        // Acid green #bbf438
        pr = 187;
        pg = 244;
        pb = 56;
      } else if (dist < radius - width * 0.04) {
        // Inner fill #171b21
        pr = 23;
        pg = 27;
        pb = 33;

        // Draw crosshair / skull silhouette / 'K'
        // Let's draw stylized 'K'
        // Vertical stem of K: x from 0.32w to 0.40w, y from 0.28h to 0.72h
        const isStem =
          x >= width * 0.33 &&
          x <= width * 0.41 &&
          y >= height * 0.28 &&
          y <= height * 0.72;
        // Upper diagonal: from (0.41w, 0.50h) to (0.67w, 0.28h)
        const d1 = x - width * 0.41 - (height * 0.5 - y);
        const isDiag1 =
          y <= height * 0.52 &&
          y >= height * 0.28 &&
          x >= width * 0.39 &&
          x <= width * 0.68 &&
          Math.abs(d1) <= width * 0.055;
        // Lower diagonal: from (0.41w, 0.50h) to (0.67w, 0.72h)
        const d2 = x - width * 0.41 - (y - height * 0.5);
        const isDiag2 =
          y >= height * 0.48 &&
          y <= height * 0.72 &&
          x >= width * 0.39 &&
          x <= width * 0.68 &&
          Math.abs(d2) <= width * 0.055;

        if (isStem || isDiag1 || isDiag2) {
          pr = 187;
          pg = 244;
          pb = 56; // Acid green #bbf438
        }
      }

      rawData[pxOffset] = pr;
      rawData[pxOffset + 1] = pg;
      rawData[pxOffset + 2] = pb;
      rawData[pxOffset + 3] = pa;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 table & helper
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

fs.writeFileSync('public/icon-192.png', createPng(192, 192));
fs.writeFileSync('public/icon-512.png', createPng(512, 512));
fs.writeFileSync('public/apple-touch-icon.png', createPng(180, 180));
console.log('Icons generated successfully.');
