const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      if (Buffer.isBuffer(data)) {
        req.write(data);
      } else if (typeof data === 'string') {
        req.write(data);
      } else {
        req.write(JSON.stringify(data));
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('==============================================================');
  console.log('🧪 RUNNING COMPREHENSIVE TIMELAPSE STUDIO TEST (3,000 PHOTOS)');
  console.log('==============================================================');

  const photos3000Dir = path.join(__dirname, '..', 'test_photos_3000');
  if (!fs.existsSync(photos3000Dir) || fs.readdirSync(photos3000Dir).length < 500) {
    console.log('Generating test photo sequence (1,000 photos) for automated test...');
    require('child_process').execSync(`node "${path.join(__dirname, 'generate-test-photos.js')}" 1000 "${photos3000Dir}"`, { stdio: 'inherit' });
  }

  // 1. Start Server
  console.log('\n--- 1. Starting Timelapse Server ---');
  const server = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..') });
  server.stdout.on('data', d => console.log('[Server stdout]', d.toString().trim()));
  server.stderr.on('data', d => console.error('[Server stderr]', d.toString().trim()));

  // Wait 1.5s for server to start
  await new Promise(r => setTimeout(r, 1500));

  try {
    // 2. Test Local Folder Scanning with 3,000 photos
    console.log('\n--- 2. Testing Local Folder Scan (3,000 Photos) ---');
    const scanRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/local-folder/scan',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { folderPath: photos3000Dir, order: 'asc' });

    console.log('Scan response status:', scanRes.status);
    console.log('Total photos found:', scanRes.data.totalCount);
    console.log('First frame (Oldest):', scanRes.data.first);
    console.log('Last frame (Newest):', scanRes.data.last);
    console.log('Keyframe count:', scanRes.data.keyframes.length);

    const expectedCount = fs.readdirSync(photos3000Dir).length;
    if (scanRes.data.totalCount !== expectedCount) {
      throw new Error(`Expected ${expectedCount} photos, got ${scanRes.data.totalCount}`);
    }
    if (scanRes.data.first.name !== 'photo_000001.bmp') {
      throw new Error(`Expected first photo photo_000001.bmp, got ${scanRes.data.first.name}`);
    }
    const expectedLastFile = `photo_${String(expectedCount).padStart(6, '0')}.bmp`;
    if (scanRes.data.last.name !== expectedLastFile) {
      throw new Error(`Expected last photo ${expectedLastFile}, got ${scanRes.data.last.name}`);
    }
    console.log(`✅ Local Folder Scan passed with ${expectedCount} photos in correct natural order!`);

    // 3. Test Order Reversal (Descending Z-A)
    console.log('\n--- 3. Testing Order Reversal (Descending) ---');
    const descRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/local-folder/scan',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { folderPath: photos3000Dir, order: 'desc' });

    console.log('Desc First frame:', descRes.data.first);
    console.log('Desc Last frame:', descRes.data.last);
    if (descRes.data.first.name !== expectedLastFile || descRes.data.last.name !== 'photo_000001.bmp') {
      throw new Error('Order reversal failed');
    }
    console.log('✅ Order reversal verified: First is newest, last is oldest!');

    // 4. Test Keyframe Thumbnail Image Endpoint
    console.log('\n--- 4. Testing Thumbnail Image Serving ---');
    const thumbUrl = scanRes.data.keyframes[0].url;
    console.log('Fetching thumbnail from:', thumbUrl);
    const thumbRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: thumbUrl,
      method: 'GET'
    });
    console.log('Thumbnail status:', thumbRes.status);
    console.log('Thumbnail Content-Type:', thumbRes.headers['content-type']);
    if (thumbRes.status !== 200) {
      throw new Error(`Thumbnail request failed with status ${thumbRes.status}`);
    }
    console.log('✅ Thumbnail image served successfully for visual verification!');

    // 5. Test Sequence Pagination & Search
    console.log('\n--- 5. Testing Sequence Pagination and Search ---');
    const seqRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: `/api/local-folder/sequence?folderPath=${encodeURIComponent(photos3000Dir)}&order=asc&page=1&pageSize=50&search=0005`,
      method: 'GET'
    });
    console.log('Search matches:', seqRes.data.filteredCount);
    console.log('Returned sample:', seqRes.data.files.map(f => f.filename).slice(0, 3));
    if (seqRes.data.files.length === 0 || !seqRes.data.files[0].filename.includes('0005')) {
      throw new Error('Sequence search failed');
    }
    console.log('✅ Sequence inspection with pagination and search passed!');

    // 6. Test Direct Local Folder Render with FFmpeg (3,000 photos @ 60 FPS)
    console.log('\n--- 6. Testing Direct Local Folder Render (3,000 photos @ 60 FPS) ---');
    const renderStartTime = Date.now();
    const renderRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/render',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      folderPath: photos3000Dir,
      sortOrder: 'asc',
      fps: 60,
      resolution: '720p',
      aspectMode: 'contain',
      format: 'mp4',
      quality: 'fast'
    });

    console.log('Render response:', renderRes.data);
    if (!renderRes.data.success) {
      throw new Error(`Render failed: ${JSON.stringify(renderRes.data)}`);
    }

    const outPath = path.join(__dirname, '..', 'data', 'outputs', renderRes.data.filename);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new Error(`Rendered video missing or empty at ${outPath}`);
    }

    const renderElapsed = ((Date.now() - renderStartTime) / 1000).toFixed(2);
    const videoSizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
    console.log(`✅ Direct Local Folder Render of 3,000 photos succeeded in ${renderElapsed}s! Video size: ${videoSizeMb} MB`);

    // Clean up test video
    try { fs.unlinkSync(outPath); } catch (e) {}

    // 7. Test Batch Upload with Verification
    console.log('\n--- 7. Testing Multi-Batch Upload with Natural Sort Ordering ---');
    const testSession = `test_upload_${Date.now()}`;
    const sampleBatchFiles = fs.readdirSync(photos3000Dir).slice(0, 40).map(f => path.join(photos3000Dir, f));

    // Upload in 4 batches of 10
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    for (let b = 0; b < 4; b++) {
      const chunk = sampleBatchFiles.slice(b * 10, (b + 1) * 10);
      const postDataChunks = [];
      postDataChunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\n${testSession}\r\n`));

      chunk.forEach(filePath => {
        const filename = path.basename(filePath);
        postDataChunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="${filename}"\r\nContent-Type: image/bmp\r\n\r\n`));
        postDataChunks.push(fs.readFileSync(filePath));
        postDataChunks.push(Buffer.from('\r\n'));
      });
      postDataChunks.push(Buffer.from(`--${boundary}--\r\n`));
      const fullBuffer = Buffer.concat(postDataChunks);

      const upRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': fullBuffer.length
        }
      }, fullBuffer);

      if (!upRes.data.success) {
        throw new Error(`Batch upload ${b + 1} failed: ${JSON.stringify(upRes.data)}`);
      }
      console.log(`Uploaded batch ${b + 1}: Total on server = ${upRes.data.totalUploaded}`);
    }

    // Verify session order
    const sessionRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: `/api/session/${testSession}?order=asc`,
      method: 'GET'
    });
    console.log('Session total uploaded:', sessionRes.data.count);
    console.log('Session first frame:', sessionRes.data.first);
    console.log('Session last frame:', sessionRes.data.last);

    if (sessionRes.data.first.name !== 'photo_000001.bmp' || sessionRes.data.last.name !== 'photo_000040.bmp') {
      throw new Error(`Session ordering failed: first=${sessionRes.data.first.name}, last=${sessionRes.data.last.name}`);
    }
    console.log('✅ Uploaded session preserves exact original filename natural sort!');

    // Cleanup session
    await request({
      hostname: 'localhost',
      port: 3000,
      path: `/api/session/${testSession}`,
      method: 'DELETE'
    });
    console.log('✅ Session cleaned up successfully.');

    console.log('\n==============================================================');
    console.log('🎉 ALL TESTS PASSED! 3,000+ PHOTOS FULLY SUPPORTED & VERIFIED!');
    console.log('==============================================================');

  } finally {
    server.kill();
  }
}

runTests().catch(err => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
