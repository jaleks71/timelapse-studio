const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const OUTPUTS_DIR = path.join(DATA_DIR, 'outputs');

[DATA_DIR, UPLOADS_DIR, OUTPUTS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/outputs', express.static(OUTPUTS_DIR));

// Memory/Disk storage setup for Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.body.sessionId || 'default';
    const sessionDir = path.join(UPLOADS_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    // Keep original filename or sanitize to prevent collisions
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB per single photo
});

// SSE clients for render progress
const sseClients = new Map();

// Active render state
const renderState = new Map();

/**
 * Natural sort helper for file names
 */
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// Upload Endpoint (Supports Batched Multi-file uploads)
app.post('/api/upload', upload.array('photos', 100), (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const sessionDir = path.join(UPLOADS_DIR, sessionId);
  let totalUploaded = 0;
  if (fs.existsSync(sessionDir)) {
    totalUploaded = fs.readdirSync(sessionDir).length;
  }

  res.json({
    success: true,
    batchCount: req.files ? req.files.length : 0,
    totalUploaded
  });
});

// Session Info Endpoint
app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const sessionDir = path.join(UPLOADS_DIR, sessionId);
  
  if (!fs.existsSync(sessionDir)) {
    return res.json({ count: 0, files: [] });
  }

  const files = fs.readdirSync(sessionDir).filter(f => f !== 'concat.txt').sort(naturalSort);
  res.json({
    count: files.length,
    files: files.slice(0, 10) // return preview sample of first 10
  });
});

// Session Cleanup Endpoint
app.delete('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const sessionDir = path.join(UPLOADS_DIR, sessionId);
  
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
  
  res.json({ success: true });
});

// SSE Progress Endpoint
app.get('/api/progress/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.set(sessionId, res);

  // Send current state if available
  const currentState = renderState.get(sessionId);
  if (currentState) {
    res.write(`data: ${JSON.stringify(currentState)}\n\n`);
  }

  req.on('close', () => {
    sseClients.delete(sessionId);
  });
});

function broadcastProgress(sessionId, state) {
  renderState.set(sessionId, state);
  const clientRes = sseClients.get(sessionId);
  if (clientRes) {
    clientRes.write(`data: ${JSON.stringify(state)}\n\n`);
  }
}

// Render Endpoint
app.post('/api/render', async (req, res) => {
  const {
    sessionId,
    fps = 30,
    resolution = '1080p',
    aspectMode = 'contain',
    format = 'mp4',
    quality = 'medium'
  } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const sessionDir = path.join(UPLOADS_DIR, sessionId);
  if (!fs.existsSync(sessionDir)) {
    return res.status(404).json({ error: 'No uploaded photos found for this session' });
  }

  const files = fs.readdirSync(sessionDir).filter(f => f !== 'concat.txt').sort(naturalSort);
  if (files.length === 0) {
    return res.status(400).json({ error: 'Session directory is empty' });
  }

  const totalFrames = files.length;
  const frameDuration = (1 / parseFloat(fps)).toFixed(6);

  // Write concat.txt demuxer file for FFmpeg
  const concatPath = path.join(sessionDir, 'concat.txt');
  let concatLines = [];
  
  files.forEach((file) => {
    const fullPath = path.join(sessionDir, file).replace(/\\/g, '/');
    concatLines.push(`file '${fullPath}'`);
    concatLines.push(`duration ${frameDuration}`);
  });
  // Repeat last file as per FFmpeg concat demuxer spec
  if (files.length > 0) {
    const lastFile = files[files.length - 1];
    const fullPath = path.join(sessionDir, lastFile).replace(/\\/g, '/');
    concatLines.push(`file '${fullPath}'`);
  }

  fs.writeFileSync(concatPath, concatLines.join('\n'));

  // Target Resolution calculation
  let targetW, targetH;
  if (resolution === '4k') {
    targetW = 3840;
    targetH = 2160;
  } else if (resolution === '720p') {
    targetW = 1280;
    targetH = 720;
  } else if (resolution === 'original') {
    targetW = null;
    targetH = null;
  } else {
    // default 1080p
    targetW = 1920;
    targetH = 1080;
  }

  // Filter building
  let vfFilter = '';
  if (targetW && targetH) {
    if (aspectMode === 'cover') {
      vfFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}`;
    } else if (aspectMode === 'stretch') {
      vfFilter = `scale=${targetW}:${targetH}`;
    } else {
      // default contain (letterbox)
      vfFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`;
    }
    // Ensure even dimensions for H.264
    vfFilter += `,format=yuv420p`;
  } else {
    // Original resolution scaled to even numbers
    vfFilter = `scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`;
  }

  // Quality CRF mappings
  let crf = '23'; // medium default
  if (quality === 'high') crf = '18';
  if (quality === 'fast') crf = '28';

  const outputFileName = `timelapse_${sessionId}_${Date.now()}.${format}`;
  const outputPath = path.join(OUTPUTS_DIR, outputFileName);

  // Build FFmpeg command arguments
  const ffmpegArgs = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-vf', vfFilter
  ];

  if (format === 'webm') {
    ffmpegArgs.push('-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0');
  } else {
    // mp4 H.264
    ffmpegArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p');
  }

  ffmpegArgs.push(outputPath);

  console.log(`Starting FFmpeg render for session ${sessionId}...`);
  console.log(`Command: ffmpeg ${ffmpegArgs.join(' ')}`);

  broadcastProgress(sessionId, {
    status: 'rendering',
    percent: 0,
    frame: 0,
    totalFrames,
    fps
  });

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stderr.on('data', (data) => {
    const str = data.toString();
    // Parse progress: frame= 120 fps= 45 ...
    const frameMatch = str.match(/frame=\s*(\d+)/);
    if (frameMatch) {
      const currentFrame = parseInt(frameMatch[1], 10);
      const percent = Math.min(100, Math.round((currentFrame / totalFrames) * 100));
      broadcastProgress(sessionId, {
        status: 'rendering',
        percent,
        frame: currentFrame,
        totalFrames,
        fps
      });
    }
  });

  ffmpeg.on('close', (code) => {
    if (code === 0) {
      console.log(`Render complete for session ${sessionId}: ${outputFileName}`);
      broadcastProgress(sessionId, {
        status: 'completed',
        percent: 100,
        frame: totalFrames,
        totalFrames,
        videoUrl: `/outputs/${outputFileName}`,
        filename: outputFileName
      });
      res.json({
        success: true,
        videoUrl: `/outputs/${outputFileName}`,
        filename: outputFileName
      });
    } else {
      console.error(`FFmpeg failed with exit code ${code}`);
      broadcastProgress(sessionId, {
        status: 'error',
        error: `FFmpeg process exited with code ${code}`
      });
      res.status(500).json({ error: `Rendering failed with exit code ${code}` });
    }
  });

  ffmpeg.on('error', (err) => {
    console.error(`FFmpeg spawn error:`, err);
    broadcastProgress(sessionId, {
      status: 'error',
      error: err.message
    });
    res.status(500).json({ error: err.message });
  });
});

app.listen(PORT, () => {
  console.log(`Timelapse Maker app listening on http://localhost:${PORT}`);
});
