const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 table for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const toCrc = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(toCrc);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, toCrc, crcBuf]);
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Deflate
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace: None
  const ihdrChunk = makePngChunk('IHDR', ihdrData);

  // Scanlines with filter byte 0 (None)
  const scanlineLength = width * 4;
  const filtered = Buffer.alloc((scanlineLength + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (scanlineLength + 1);
    filtered[rowOffset] = 0; // Filter type None
    rgbaBuffer.copy(filtered, rowOffset + 1, y * scanlineLength, (y + 1) * scanlineLength);
  }

  const compressedData = zlib.deflateSync(filtered, { level: 9 });
  const idatChunk = makePngChunk('IDAT', compressedData);
  const iendChunk = makePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Signed distance functions for crisp subpixel anti-aliasing
function sdRoundedBox(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - halfW + r;
  const qy = Math.abs(py - cy) - halfH + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay;
  const bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / 512;

  // Design coordinates on 512 grid:
  // Squircle base
  const bgHalfW = 240 * scale;
  const bgHalfH = 240 * scale;
  const bgRadius = 96 * scale;
  const center = size / 2;

  // Step capsules:
  const capHalfW = 88 * scale;
  const capHalfH = 27 * scale;
  const capRadius = 27 * scale;

  const steps = [
    { cx: 218 * scale, cy: 156 * scale, dotX: 162 * scale, lineX1: 194 * scale, lineX2: 278 * scale },
    { cx: 256 * scale, cy: 256 * scale, dotX: 200 * scale, lineX1: 232 * scale, lineX2: 316 * scale },
    { cx: 294 * scale, cy: 356 * scale, dotX: 238 * scale, lineX1: 270 * scale, lineX2: 354 * scale },
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // 1. Background squircle
      const dBg = sdRoundedBox(x, y, center, center, bgHalfW, bgHalfH, bgRadius);
      const bgAlpha = Math.max(0, Math.min(1, 0.5 - dBg));

      if (bgAlpha <= 0) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Background color: obsidian black #09090b
      let r = 9;
      let g = 9;
      let b = 11;
      let a = bgAlpha;

      // Outer border highlight (subtle hairline)
      const dBorder = Math.abs(dBg + 1 * scale) - 1.2 * scale;
      if (dBorder < 1) {
        const borderAlpha = Math.max(0, Math.min(1, 0.5 - dBorder)) * 0.45;
        r = r * (1 - borderAlpha) + 39 * borderAlpha;
        g = g * (1 - borderAlpha) + 39 * borderAlpha;
        b = b * (1 - borderAlpha) + 42 * borderAlpha;
      }

      // 2. Render each white step capsule
      for (const step of steps) {
        const dCap = sdRoundedBox(x, y, step.cx, step.cy, capHalfW, capHalfH, capRadius);
        const capAlpha = Math.max(0, Math.min(1, 0.5 - dCap));

        if (capAlpha > 0) {
          // Inside capsule: Pure crisp white #ffffff
          let capR = 255;
          let capG = 255;
          let capB = 255;

          // Black circular badge dot inside capsule
          const dDot = sdCircle(x, y, step.dotX, step.cy, 13 * scale);
          const dotAlpha = Math.max(0, Math.min(1, 0.5 - dDot));
          if (dotAlpha > 0) {
            capR = capR * (1 - dotAlpha) + 9 * dotAlpha;
            capG = capG * (1 - dotAlpha) + 9 * dotAlpha;
            capB = capB * (1 - dotAlpha) + 11 * dotAlpha;
          }

          // Black procedure line inside capsule
          const dLine = sdSegment(x, y, step.lineX1, step.cy, step.lineX2, step.cy) - 4 * scale;
          const lineAlpha = Math.max(0, Math.min(1, 0.5 - dLine));
          if (lineAlpha > 0) {
            capR = capR * (1 - lineAlpha) + 9 * lineAlpha;
            capG = capG * (1 - lineAlpha) + 9 * lineAlpha;
            capB = capB * (1 - lineAlpha) + 11 * lineAlpha;
          }

          // Composite capsule over background
          r = r * (1 - capAlpha) + capR * capAlpha;
          g = g * (1 - capAlpha) + capG * capAlpha;
          b = b * (1 - capAlpha) + capB * capAlpha;
        }
      }

      buf[idx] = Math.round(r);
      buf[idx + 1] = Math.round(g);
      buf[idx + 2] = Math.round(b);
      buf[idx + 3] = Math.round(a * 255);
    }
  }

  return encodePng(size, size, buf);
}

// Generate Windows .ico file containing 16, 32, 48, 64, 128, 256 PNG images
function generateIco(pngBuffers) {
  // ICO Header: 6 bytes
  // Reserved: 2 bytes (0)
  // Type: 2 bytes (1 = ICO)
  // Count: 2 bytes (number of images)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBuffers.length, 4);

  // Directory entries: 16 bytes per image
  const dirSize = 16 * pngBuffers.length;
  let offset = 6 + dirSize;
  const dirEntries = [];

  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // Width (0 = 256)
    entry[1] = size >= 256 ? 0 : size; // Height (0 = 256)
    entry[2] = 0; // Color count (0 for >=8bpp)
    entry[3] = 0; // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // Image size in bytes
    entry.writeUInt32LE(offset, 12); // Offset to image data
    offset += buffer.length;
    dirEntries.push(entry);
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers.map(p => p.buffer)]);
}

// Ensure build/ directory exists
const buildDir = path.join(__dirname, '../build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

console.log('Rendering minimalist Black & White StepFlow icon...');
const png512 = renderIcon(512);
fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
console.log('Created build/icon.png (512x512)');

const png256 = renderIcon(256);
const png128 = renderIcon(128);
const png64 = renderIcon(64);
const png48 = renderIcon(48);
const png32 = renderIcon(32);
const png16 = renderIcon(16);

const icoBuffer = generateIco([
  { size: 256, buffer: png256 },
  { size: 128, buffer: png128 },
  { size: 64, buffer: png64 },
  { size: 48, buffer: png48 },
  { size: 32, buffer: png32 },
  { size: 16, buffer: png16 },
]);

fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
console.log('Created build/icon.ico with multi-resolution 16, 32, 48, 64, 128, 256');
