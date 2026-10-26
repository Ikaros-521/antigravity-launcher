/* Packs build/raw/<size>.bgra into build/icon.ico using uncompressed 32bpp DIB
   entries. NSIS's makensis rejects PNG-compressed ICO payloads, so the classic
   BMP-in-ICO layout is the one that actually installs. */
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const build = path.join(__dirname, '..', 'build');
const raw = path.join(build, 'raw');

function dibFor(size) {
  const file = path.join(raw, `${size}.bgra`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file} — run tools/make-icon.ps1 first`);
  const src = fs.readFileSync(file);
  const stride = size * 4;
  if (src.length < stride * size) throw new Error(`${file} is ${src.length} bytes, expected >= ${stride * size}`);

  // LockBits hands back top-down rows; ICO wants bottom-up.
  const xor = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    src.copy(xor, y * stride, (size - 1 - y) * stride, (size - y) * stride);
  }

  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size); // fully transparent handled by alpha

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);                       // biSize
  header.writeInt32LE(size, 4);                      // biWidth
  header.writeInt32LE(size * 2, 8);                  // biHeight: XOR + AND
  header.writeUInt16LE(1, 12);                       // biPlanes
  header.writeUInt16LE(32, 14);                      // biBitCount
  header.writeUInt32LE(0, 16);                       // biCompression: BI_RGB
  header.writeUInt32LE(xor.length + mask.length, 20); // biSizeImage

  return Buffer.concat([header, xor, mask]);
}

const images = SIZES.map(size => ({ size, data: dibFor(size) }));

const out = Buffer.alloc(6 + 16 * images.length);
out.writeUInt16LE(0, 0);
out.writeUInt16LE(1, 2);                 // type: icon
out.writeUInt16LE(images.length, 4);

let offset = out.length;
images.forEach(({ size, data }, i) => {
  const e = 6 + 16 * i;                  // write into the reserved slot
  out.writeUInt8(size >= 256 ? 0 : size, e);      // 0 encodes 256
  out.writeUInt8(size >= 256 ? 0 : size, e + 1);
  out.writeUInt8(0, e + 2);                        // colour count
  out.writeUInt8(0, e + 3);                        // reserved
  out.writeUInt16LE(1, e + 4);                     // colour planes
  out.writeUInt16LE(32, e + 6);                    // bits per pixel
  out.writeUInt32LE(data.length, e + 8);           // bytes in resource
  out.writeUInt32LE(offset, e + 12);               // resource offset
  offset += data.length;
});

const target = path.join(build, 'icon.ico');
fs.writeFileSync(target, Buffer.concat([out, ...images.map(({ data }) => data)]));
console.log(`wrote ${target} (${fs.statSync(target).size} bytes, ${images.length} DIB sizes)`);
