const fs = require('fs');
const path = require('path');

const countArg = parseInt(process.argv[2], 10);
const totalFrames = (!isNaN(countArg) && countArg > 0) ? countArg : 3000;
const OUTPUT_DIR = process.argv[3] 
  ? path.resolve(process.argv[3]) 
  : path.join(__dirname, '..', 'test_photos_3000');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function createBMP(width, height, r, g, b, frameNum, total) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;

  const buffer = Buffer.alloc(fileSize);

  // File Header
  buffer.write('BM', 0);
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);

  // DIB Header
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(pixelArraySize, 34);

  // Pixel Data (Bottom-up, BGR format)
  const offset = 54;
  const barPos = Math.floor((frameNum / total) * width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let pr = r;
      let pg = g;
      let pb = b;

      // Add a moving white progress vertical bar across the image
      if (Math.abs(x - barPos) < 10) {
        pr = 255;
        pg = 255;
        pb = 255;
      }

      // Add a small square indicator at bottom left
      if (x < 30 && y < 30) {
        pr = 255;
        pg = 240;
        pb = 0;
      }

      const pixelOffset = offset + (height - 1 - y) * rowSize + x * 3;
      buffer[pixelOffset] = pb;     // Blue
      buffer[pixelOffset + 1] = pg; // Green
      buffer[pixelOffset + 2] = pr; // Red
    }
  }

  return buffer;
}

console.log(`Generating ${totalFrames} test photo frames in ${OUTPUT_DIR}...`);
const width = 160;
const height = 120;
const startTime = Date.now();

for (let i = 1; i <= totalFrames; i++) {
  const padIndex = String(i).padStart(6, '0');
  const filename = `photo_${padIndex}.bmp`;
  const filePath = path.join(OUTPUT_DIR, filename);

  const hueFraction = i / totalFrames;
  const r = Math.floor(128 + 127 * Math.sin(hueFraction * 2 * Math.PI));
  const g = Math.floor(128 + 127 * Math.sin(hueFraction * 2 * Math.PI + (2 * Math.PI / 3)));
  const b = Math.floor(128 + 127 * Math.sin(hueFraction * 2 * Math.PI + (4 * Math.PI / 3)));

  const bmpBuffer = createBMP(width, height, r, g, b, i, totalFrames);
  fs.writeFileSync(filePath, bmpBuffer);

  if (i % 500 === 0 || i === totalFrames) {
    console.log(`Generated ${i} / ${totalFrames} frames...`);
  }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`Successfully generated ${totalFrames} test frames in ${elapsed}s at ${OUTPUT_DIR}`);
