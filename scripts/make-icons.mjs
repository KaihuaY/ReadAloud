// Generates public/icon-192.png and public/icon-512.png: an open book with
// a little sun above it on a dark blue rounded background. Uses only Node's
// built-in `zlib` (for PNG DEFLATE compression) - no image libraries.
//
// PNG is hand-encoded: we build an RGBA raster in memory, then write the
// PNG signature + IHDR + IDAT (zlib-deflated raw scanlines) + IEND chunks.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');

const BG = [0x0b, 0x12, 0x2e]; // dark blue
const WHITE = [0xf5, 0xf5, 0xf5];
const LINE = [0xc7, 0xca, 0xd9]; // page text lines
const SUN = [0xff, 0xd6, 0x4a]; // the "tricky word" sun

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

  // --- open book: two pages meeting at a spine, lower ~60% ---------------
  const pad = size * 0.1;
  const bookTop = size * 0.4;
  const bookH = size * 0.5;
  const pageW = (size - 2 * pad) / 2;
  const spineGap = Math.max(1, size * 0.02);
  const pageR = Math.max(1, size * 0.05);
  const leftPage = inRoundedRect(x, y, pad, bookTop, pageW - spineGap / 2, bookH, pageR);
  const rightPage = inRoundedRect(x, y, pad + pageW + spineGap / 2, bookTop, pageW - spineGap / 2, bookH, pageR);
  if (leftPage || rightPage) {
    color = WHITE;
    // Grey text lines on each page.
    const lineH = Math.max(1, size * 0.035);
    const lineGap = size * 0.075;
    const inset = size * 0.06;
    const pageX = leftPage ? pad : pad + pageW + spineGap / 2;
    for (let n = 0; n < 4; n++) {
      const ly = bookTop + inset + n * lineGap;
      const lw = (pageW - spineGap / 2 - 2 * inset) * (n === 3 ? 0.6 : 1);
      if (x >= pageX + inset && x < pageX + inset + lw && y >= ly && y < ly + lineH) color = LINE;
    }
  }

  // --- sun, upper-right --------------------------------------------------
  const sunR = size * 0.12;
  const sunX = size * 0.7;
  const sunY = size * 0.18;
  const dx = x - sunX;
  const dy = y - sunY;
  if (dx * dx + dy * dy <= sunR * sunR) color = SUN;
  // Eight short rays.
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const rx = sunX + Math.cos(a) * sunR * 1.45;
    const ry = sunY + Math.sin(a) * sunR * 1.45;
    const ex = x - rx;
    const ey = y - ry;
    if (ex * ex + ey * ey <= (sunR * 0.22) ** 2) color = SUN;
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
