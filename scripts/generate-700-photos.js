const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'test_photos');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function createBMP(width, height, r, g, b, frameNum) {
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
  let offset = 54;
  const barPos = Math.floor((frameNum / 700) * width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let pr = r;
      let pg = g;
      let pb = b;

      // Add a moving white progress vertical bar across the image
      if (Math.abs(x - barPos) < 15) {
        pr = 255;
        pg = 255;
        pb = 255;
      }

      // Add a small square indicator at bottom left
      if (x < 40 && y < 40) {
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

console.log('Generating 700 test photo frames in test_photos/...');
const totalFrames = 700;
const width = 320;
const height = 240;

const startTime = Date.now();

for (let i = 1; i <= totalFrames; i++) {
  const padIndex = String(i).padStart(5, '0');
  const filename = `photo_${padIndex}.bmp`;
  const filePath = path.join(OUTPUT_DIR, filename);

  // Smooth color shift across 700 frames
  const hue = (i / totalFrames) * 360;
  // Simple RGB color calculation from hue
  const r = Math.floor(128 + 127 * Math.sin((i / totalFrames) * 2 * Math.PI));
  const g = Math.floor(128 + 127 * Math.sin((i / totalFrames) * 2 * Math.PI + (2 * Math.PI / 3)));
  const b = Math.floor(128 + 127 * Math.sin((i / totalFrames) * 2 * Math.PI + (4 * Math.PI / 3)));

  const bmpBuffer = createBMP(width, height, r, g, b, i);
  fs.writeFileSync(filePath, bmpBuffer);

  if (i % 100 === 0) {
    console.log(`Generated ${i} / ${totalFrames} frames...`);
  }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`Successfully generated 700 test frames in ${elapsed}s at ${OUTPUT_DIR}`);
