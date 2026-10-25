// توليد أيقونة تطبيق SOUQAR برمجياً (PNG) — بلا ملفات ثنائية في المستودع
const zlib = require('node:zlib');

const S_GLYPH = ['01110', '10001', '10000', '01110', '00001', '10001', '01110'];
const cache = new Map();

const crcTable = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
function crc(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

function iconPNG(size) {
  if (cache.has(size)) return cache.get(size);
  const fg = [47, 220, 138];
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, c) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const i = (y * size + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const t = y / size; set(x, y, [Math.round(6 + 7 * t), Math.round(57 + 33 * t), Math.round(43 + 22 * t)]); }
  const cell = Math.floor(size / 9), gw = cell * 5, gh = cell * 7;
  const ox = Math.floor((size - gw) / 2), oy = Math.floor((size - gh) / 2) - Math.floor(cell / 2);
  for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (S_GLYPH[r][c] === '1')
    for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) set(ox + c * cell + dx, oy + r * cell + dy, fg);
  const dotR = Math.max(6, Math.floor(size / 28)), cy = oy + gh + cell;
  for (const cx of [ox + cell, ox + gw - cell]) for (let y = -dotR; y <= dotR; y++) for (let x = -dotR; x <= dotR; x++) if (x * x + y * y <= dotR * dotR) set(cx + x, cy + y, fg);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  cache.set(size, png);
  return png;
}

module.exports = { iconPNG };
