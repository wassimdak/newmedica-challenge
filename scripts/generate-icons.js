// Génère les icônes PWA (public/icons/*.png) en Node pur, sans dépendance ni navigateur :
// fond dégradé aux couleurs de la marque + étoile blanche, avec anti-aliasing par sur-échantillonnage.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const COLOR_A = [0x3b, 0x2d, 0x6b]; // #3B2D6B
const COLOR_B = [0x6d, 0x4f, 0xa0]; // #6D4FA0
const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtre "None"
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur 8 bits
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function roundedRectSdf(x, y, size, r) {
  // distance signee approx a un rectangle aux coins arrondis centre sur size/2
  const hx = size / 2, hy = size / 2;
  const qx = Math.abs(x - hx) - (hx - r);
  const qy = Math.abs(y - hy) - (hy - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function starContains(px, py, cx, cy, outerR, innerR, points = 5) {
  const vertices = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    vertices.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function drawIcon(size, { maskable = false, starRatio } = {}) {
  const S = 4; // sur-echantillonnage pour l'anti-aliasing
  const big = size * S;
  const cornerR = maskable ? 0 : size * 0.22 * S;
  const starOuter = (starRatio != null ? starRatio : maskable ? 0.24 : 0.30) * size * S;
  const starInner = starOuter * 0.42;
  const cx = big / 2, cy = big / 2;

  const cell = size; // pixels de sortie
  const buf = Buffer.alloc(cell * cell * 4);

  for (let oy = 0; oy < cell; oy++) {
    for (let ox = 0; ox < cell; ox++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, samples = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = ox * S + sx + 0.5;
          const y = oy * S + sy + 0.5;
          samples++;
          const insideRect = maskable ? true : roundedRectSdf(x, y, big, cornerR) <= 0;
          if (!insideRect) continue; // transparent hors du rectangle arrondi
          const t = (x + y) / (2 * big);
          const bgR = COLOR_A[0] + (COLOR_B[0] - COLOR_A[0]) * t;
          const bgG = COLOR_A[1] + (COLOR_B[1] - COLOR_A[1]) * t;
          const bgB = COLOR_A[2] + (COLOR_B[2] - COLOR_A[2]) * t;
          const inStar = starContains(x, y, cx, cy, starOuter, starInner);
          if (inStar) {
            rSum += 255; gSum += 255; bSum += 255; aSum += 255;
          } else {
            rSum += bgR; gSum += bgG; bSum += bgB; aSum += 255;
          }
        }
      }
      const covered = aSum > 0 ? 1 : 0;
      const denom = S * S;
      const idx = (oy * cell + ox) * 4;
      buf[idx] = Math.round(rSum / denom);
      buf[idx + 1] = Math.round(gSum / denom);
      buf[idx + 2] = Math.round(bSum / denom);
      buf[idx + 3] = Math.round(aSum / denom);
    }
  }
  return encodePng(cell, cell, buf);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const specs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  // iOS applique lui-même le masque (coins arrondis) : image pleine, opaque, sans transparence.
  ['apple-touch-icon.png', 180, { maskable: true, starRatio: 0.30 }],
];
for (const [name, size, opts] of specs) {
  const png = drawIcon(size, opts);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`✓ ${name} (${(png.length / 1024).toFixed(1)} Ko)`);
}
