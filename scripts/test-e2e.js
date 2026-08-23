const fs = require('fs');
const path = require('path');
const http = require('http');

// Helper to make HTTP POST requests with multipart form-data
async function uploadBatch(sessionId, filePaths) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const postDataChunks = [];

    // sessionId field
    postDataChunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\n${sessionId}\r\n`
    ));

    // file fields
    filePaths.forEach(filePath => {
      const filename = path.basename(filePath);
      const fileData = fs.readFileSync(filePath);
      postDataChunks.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="${filename}"\r\nContent-Type: image/bmp\r\n\r\n`
      ));
      postDataChunks.push(fileData);
      postDataChunks.push(Buffer.from('\r\n'));
    });

    postDataChunks.push(Buffer.from(`--${boundary}--\r\n`));
    const fullBuffer = Buffer.concat(postDataChunks);

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBuffer.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Upload failed with code ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(fullBuffer);
    req.end();
  });
}

// Helper to make JSON HTTP requests
async function jsonPost(endpoint, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`POST ${endpoint} failed with code ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runE2ETest() {
  console.log('=== Starting E2E Test for Timelapse Maker (700 Photos) ===');
  const photosDir = path.join(__dirname, '..', 'test_photos');
  const allPhotos = fs.readdirSync(photosDir).map(f => path.join(photosDir, f));

  console.log(`Found ${allPhotos.length} test photos.`);
  if (allPhotos.length < 700) {
    throw new Error(`Expected 700 photos, found ${allPhotos.length}`);
  }

  const testSessionId = `e2e_test_${Date.now()}`;
  console.log(`Test Session ID: ${testSessionId}`);

  // Step 1: Upload 700 photos in batches of 50
  console.log('\n--- Step 1: Uploading 700 photos in batches of 50 ---');
  const BATCH_SIZE = 50;
  let totalUploaded = 0;

  for (let i = 0; i < allPhotos.length; i += BATCH_SIZE) {
    const chunk = allPhotos.slice(i, i + BATCH_SIZE);
    const result = await uploadBatch(testSessionId, chunk);
    totalUploaded = result.totalUploaded;
    console.log(`Uploaded batch ${i / BATCH_SIZE + 1}: ${chunk.length} photos. Total on server: ${totalUploaded}`);
  }

  if (totalUploaded !== 700) {
    throw new Error(`Expected 700 photos uploaded, server reports ${totalUploaded}`);
  }
  console.log('✅ Upload verification passed: All 700 photos stored on server!');

  // Step 2: Render 1080p @ 30 FPS
  console.log('\n--- Step 2: Testing Render 1080p @ 30 FPS ---');
  const render1 = await jsonPost('/api/render', {
    sessionId: testSessionId,
    fps: 30,
    resolution: '1080p',
    aspectMode: 'contain',
    format: 'mp4',
    quality: 'medium'
  });

  console.log('Render 1 result:', render1);
  const outPath1 = path.join(__dirname, '..', 'data', 'outputs', render1.filename);
  if (!fs.existsSync(outPath1) || fs.statSync(outPath1).size === 0) {
    throw new Error(`Render 1 output video file missing or empty at ${outPath1}`);
  }
  const sizeMb1 = (fs.statSync(outPath1).size / (1024 * 1024)).toFixed(2);
  console.log(`✅ Render 1 (1080p 30fps) created video file successfully (${sizeMb1} MB)`);

  // Step 3: Render 4K @ 60 FPS
  console.log('\n--- Step 3: Testing Render 4K @ 60 FPS ---');
  const render2 = await jsonPost('/api/render', {
    sessionId: testSessionId,
    fps: 60,
    resolution: '4k',
    aspectMode: 'cover',
    format: 'mp4',
    quality: 'high'
  });

  console.log('Render 2 result:', render2);
  const outPath2 = path.join(__dirname, '..', 'data', 'outputs', render2.filename);
  if (!fs.existsSync(outPath2) || fs.statSync(outPath2).size === 0) {
    throw new Error(`Render 2 output video file missing or empty at ${outPath2}`);
  }
  const sizeMb2 = (fs.statSync(outPath2).size / (1024 * 1024)).toFixed(2);
  console.log(`✅ Render 2 (4K 60fps) created video file successfully (${sizeMb2} MB)`);

  console.log('\n==================================================');
  console.log('🎉 ALL END-TO-END TESTS PASSED SUCCESSFULLY! 🎉');
  console.log('==================================================');
}

runE2ETest().catch(err => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
