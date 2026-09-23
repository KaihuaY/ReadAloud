// Generates public/icon-192.png and public/icon-512.png: a hub icon on a
// dark blue rounded background - a 3x3 mini cube of colored squares in the
// upper-left ~55%, and a 5-white/3-black-key piano strip in the
// lower-right ~40%. Uses only Node's built-in `zlib` (for PNG DEFLATE
// compression) - no image libraries.
//
// PNG is hand-encoded: we build an RGBA raster in memory, then write the
// PNG signature + IHDR + IDAT (zlib-deflated raw scanlines) + IEND chunks.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');

// Practice sticker colors (see src/content/colors.ts) plus background.
const BG = [0x0b, 0x12, 0x2e]; // dark blue
const WHITE = [0xf5, 0xf5, 0xf5];
const BLACK_KEY = [0x10, 0x12, 0x2b];
const CUBE_COLORS = [
  [0xf5, 0xd9, 0x1a], // U yellow
  [0xff, 0x8a, 0x00], // R orange
  [0x1f, 0xa9, 0x53], // F green
  [0xf5, 0xf5, 0xf5], // D white
  [0xe6, 0x2b, 0x2b], // L red
  [0x1f, 0x5f, 0xd9], // B blue
];

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let cc = n;
      for (let k = 0; k < 8; k++) {
        cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
      }
      t[n] = cc >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Rounded-rect fill helper: true if the point (px, py) falls inside the
 * rounded rectangle at (x, y) sized (w, h) with corner radius r. Shared by
 * every shape this script draws (the outer icon mask, cube stickers, and
 * piano keys) so they all round consistently.
 */
function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const rr = Math.min(r, w / 2, h / 2);
  const left = x, top = y, right = x + w, bottom = y + h;
  if (px >= left + rr && px <= right - rr) return true;
  if (py >= top + rr && py <= bottom - rr) return true;
  const cx = px < left + rr ? left + rr : right - rr;
  const cy = py < top + rr ? top + rr : bottom - rr;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= rr * rr;
}

/** The color at pixel (x, y) of a `size`x`size` icon, or `undefined` for fully transparent. */
function pixelColor(x, y, size) {
  // Overall icon shape: a big rounded rect, so the whole thing reads as an
  // app icon rather than a bare square.
  if (!inRoundedRect(x, y, 0, 0, size, size, size * 0.18)) return undefined;

  let color = BG;

  // --- 3x3 mini cube, upper-left ~55% ---------------------------------
  const cubePad = Math.round(size * 0.08);
  const cubeSize = Math.round(size * 0.5);
  const cubeCell = cubeSize / 3;
  const cubeGap = Math.max(1, size * 0.016);
  const cubeCellR = Math.max(1, size * 0.03);
  if (x >= cubePad && x < cubePad + cubeSize && y >= cubePad && y < cubePad + cubeSize) {
    const gx = x - cubePad;
    const gy = y - cubePad;
    const ci = Math.min(2, Math.floor(gx / cubeCell));
    const ri = Math.min(2, Math.floor(gy / cubeCell));
    const cellX = gx - ci * cubeCell;
    const cellY = gy - ri * cubeCell;
    if (inRoundedRect(cellX, cellY, cubeGap, cubeGap, cubeCell - 2 * cubeGap, cubeCell - 2 * cubeGap, cubeCellR)) {
      color = CUBE_COLORS[(ri * 3 + ci) % CUBE_COLORS.length];
    }
  }

  // --- piano keys, lower-right ~40%: 5 white keys, 3 black keys -------
  const pianoW = Math.round(size * 0.44);
  const pianoH = Math.round(size * 0.3);
  const pianoX = size - cubePad - pianoW;
  const pianoY = size - cubePad - pianoH;
  const pianoR = Math.max(1, size * 0.025);
  const whiteKeyCount = 5;
  const whiteKeyGap = Math.max(1, size * 0.006);
  const whiteKeyW = (pianoW - whiteKeyGap * (whiteKeyCount - 1)) / whiteKeyCount;
  if (inRoundedRect(x, y, pianoX, pianoY, pianoW, pianoH, pianoR)) {
    color = WHITE;
  }
  // Black keys sit above the boundaries between white keys 1-2, 2-3, 4-5
  // (skipping 3-4), the way a real keyboard's C/D/E/F/G stretch looks.
  const blackKeyW = whiteKeyW * 0.6;
  const blackKeyH = pianoH * 0.6;
  const blackKeyBoundaries = [1, 2, 4];
  for (const n of blackKeyBoundaries) {
    const boundaryX = pianoX + n * (whiteKeyW + whiteKeyGap) - whiteKeyGap / 2;
    const keyX = boundaryX - blackKeyW / 2;
    if (inRoundedRect(x, y, keyX, pianoY, blackKeyW, blackKeyH, pianoR * 0.6)) {
      color = BLACK_KEY;
    }
  }

  return color;
}

function makeIcon(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const color = pixelColor(x, y, size);
      const o = 1 + x * 4;
      if (!color) {
        raw[rowStart + o] = 0;
        raw[rowStart + o + 1] = 0;
        raw[rowStart + o + 2] = 0;
        raw[rowStart + o + 3] = 0;
        continue;
      }
      raw[rowStart + o] = color[0];
      raw[rowStart + o + 1] = color[1];
      raw[rowStart + o + 2] = color[2];
      raw[rowStart + o + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

for (const size of [192, 512]) {
  const png = makeIcon(size);
  const path = join(outDir, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}
