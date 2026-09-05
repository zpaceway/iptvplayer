// Crop bottom-left 560x220 of a PNG (for toast verification). Zero deps.
const zlib = require('node:zlib');
const fs = require('node:fs');

const [,, src, dst] = process.argv;
const buf = fs.readFileSync(src);
let pos = 8;
let width, height, bitDepth, colorType;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0); height = data.readUInt32BE(4);
    bitDepth = data[8]; colorType = data[9];
  } else if (type === 'IDAT') idat.push(data);
  pos += 12 + len;
}
if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error(`unsupported PNG ${bitDepth}/${colorType}`);
const BPP = colorType === 6 ? 4 : 3;
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width * BPP;
const px = Buffer.alloc(height * stride);
let p = 0;
for (let y = 0; y < height; y++) {
  const f = raw[p++];
  const row = px.subarray(y * stride, (y + 1) * stride);
  raw.copyWithin(0, 0, 0); // no-op clarity
  for (let x = 0; x < stride; x++) {
    const a = x >= BPP ? row[x - BPP] : 0;
    const b = y > 0 ? px[(y - 1) * stride + x] : 0;
    const c = x >= BPP && y > 0 ? px[(y - 1) * stride + x - BPP] : 0;
    const v = raw[p++];
    if (f === 0) row[x] = v;
    else if (f === 1) row[x] = (v + a) & 255;
    else if (f === 2) row[x] = (v + b) & 255;
    else if (f === 3) row[x] = (v + ((a + b) >> 1)) & 255;
    else {
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      row[x] = (v + pr) & 255;
    }
  }
}
const CW = Math.min(560, width), CH = Math.min(220, height);
const y0 = height - CH;
const out = Buffer.alloc((CW * 4 + 1) * CH);
let q = 0;
for (let y = 0; y < CH; y++) {
  out[q++] = 0;
  const srcRow = (y0 + y) * stride;
  for (let x = 0; x < CW; x++) {
    out[q++] = px[srcRow + x * BPP];
    out[q++] = px[srcRow + x * BPP + 1];
    out[q++] = px[srcRow + x * BPP + 2];
    out[q++] = BPP === 4 ? px[srcRow + x * BPP + 3] : 255;
  }
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(CW, 0); ihdr.writeUInt32BE(CH, 4);
ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(dst, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out)), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`src ${width}x${height} -> cropped ${CW}x${CH}`);
