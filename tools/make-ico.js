/* Packs build/icon_<size>.png into build/icon.ico using PNG-compressed entries.
   Windows Vista and later accept PNG payloads inside an ICO container, which
   keeps the file small while still covering 16px through 256px. */
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const dir = path.join(__dirname, '..', 'build');

const images = SIZES.map(s => {
  const file = path.join(dir, `icon_${s}.png`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file} — run tools/make-icon.ps1 first`);
  return { size: s, data: fs.readFileSync(file) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);          // reserved
header.writeUInt16LE(1, 2);          // type: icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + 16 * images.length;
const entries = Buffer.concat(images.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0);   // 0 means 256
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt8(0, 2);                        // reserved
  e.writeUInt16LE(1, 3);                     // colour planes
  e.writeUInt16LE(32, 5);                    // bits per pixel
  e.writeUInt32LE(data.length, 7);
  e.writeUInt32LE(offset, 11);
  offset += data.length;
  return e;
}));

const out = path.join(dir, 'icon.ico');
fs.writeFileSync(out, Buffer.concat([header, entries, ...images.map(i => i.data)]));
console.log(`wrote ${out} (${fs.statSync(out).size} bytes, ${images.length} sizes)`);
