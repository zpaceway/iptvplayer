// Generates public/apple-touch-icon.png (180x180) with zero dependencies.
// Volt rounded square + ink bullseye, matching favicon.svg.
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const S = 180;
const VOLT = [204, 255, 0];
const INK = [10, 15, 0];
const R = 40; // corner radius

function roundedMask(x, y) {
  const cx = Math.min(Math.max(x, R), S - R);
  const cy = Math.min(Math.max(y, R), S - R);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= R * R;
}

const ringR = 52;
const ringW = 19;
const dotR = 20;

const raw = Buffer.alloc((S * 4 + 1) * S);
let o = 0;
for (let y = 0; y < S; y++) {
  raw[o++] = 0; // filter byte
  const py = y + 0.5;
  for (let x = 0; x < S; x++) {
    const px = x + 0.5;
    let r, g, b, a;
    if (!roundedMask(px, py)) {
      r = g = b = 0; a = 0;
    } else {
      const d = Math.hypot(px - S / 2, py - S / 2);
      if (d <= dotR) {
        [r, g, b] = INK;
      } else if (Math.abs(d - ringR) <= ringW / 2) {
        [r, g, b] = INK;
      } else {
        [r, g, b] = VOLT;
      }
      a = 255;
    }
    raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'public', 'apple-touch-icon.png');
fs.writeFileSync(out, png);
console.log('wrote', out, png.length + ' bytes');
