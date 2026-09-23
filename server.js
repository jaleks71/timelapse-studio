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

// Supported image extensions (filtered to formats reliably supported by image decoders)
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif']);

function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Natural sort helper for file names (e.g. photo_2.jpg before photo_10.jpg)
 */
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// Memory/Disk storage setup for Multer preserving original filename
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
    // Keep original filename sanitized to prevent collisions & maintain exact natural order
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const sessionId = req.body.sessionId || 'default';
    const sessionDir = path.join(UPLOADS_DIR, sessionId);
    let finalName = safeName;

    // If a file with the identical name already exists, suffix with index
    if (fs.existsSync(path.join(sessionDir, finalName))) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      let counter = 1;
      while (fs.existsSync(path.join(sessionDir, `${base}_${counter}${ext}`))) {
        counter++;
      }
      finalName = `${base}_${counter}${ext}`;
    }

    cb(null, finalName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB per single photo
});

// SSE clients for render progress
const sseClients = new Map();

// Active render state
const renderState = new Map();

function broadcastProgress(channelId, state) {
  renderState.set(channelId, state);
  const clientRes = sseClients.get(channelId);
  if (clientRes) {
    clientRes.write(`data: ${JSON.stringify(state)}\n\n`);
  }
}

/**
 * Helper to compute 5 representative keyframes for sequence verification
 */
function extractKeyframes(sortedFiles, urlBuilder) {
  const total = sortedFiles.length;
  if (total === 0) return [];

  const points = [
    { label: 'Start (Oldest)', percent: 0, index: 0 },
    { label: '25% Progress', percent: 25, index: Math.floor((total - 1) * 0.25) },
    { label: 'Midpoint (50%)', percent: 50, index: Math.floor((total - 1) * 0.5) },
    { label: '75% Progress', percent: 75, index: Math.floor((total - 1) * 0.75) },
    { label: 'End (Newest)', percent: 100, index: total - 1 }
  ];

  const seenIndices = new Set();
  const keyframes = [];

  points.forEach(pt => {
    if (!seenIndices.has(pt.index)) {
      seenIndices.add(pt.index);
      const filename = sortedFiles[pt.index];
      keyframes.push({
        label: pt.label,
        percent: pt.percent,
        frameNumber: pt.index + 1,
        filename,
        url: urlBuilder(filename)
      });
    }
  });

  return keyframes;
}

// Upload Endpoint
app.post('/api/upload', (req, res) => {
  upload.array('photos', 100)(req, res, (err) => {
    if (err) {
      console.error('Multer upload error:', err);
      return res.status(400).json({
        success: false,
        error: err.message || 'File upload error',
        code: err.code
      });
    }

    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const sessionDir = path.join(UPLOADS_DIR, sessionId);
    let totalUploaded = 0;
    if (fs.existsSync(sessionDir)) {
      totalUploaded = fs.readdirSync(sessionDir).filter(f => f !== 'concat.txt' && !f.startsWith('.')).length;
    }

    res.json({
      success: true,
      batchCount: req.files ? req.files.length : 0,
      totalUploaded
    });
  });
});

// Session Info & Summary Endpoint
app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const order = req.query.order === 'desc' ? 'desc' : 'asc';
  const sessionDir = path.join(UPLOADS_DIR, sessionId);
  
  if (!fs.existsSync(sessionDir)) {
    return res.json({ count: 0, files: [], keyframes: [], sortOrder: order });
  }

  let files = fs.readdirSync(sessionDir).filter(f => f !== 'concat.txt' && !f.startsWith('.')).sort(naturalSort);
  if (order === 'desc') {
    files.reverse();
  }

  const keyframes = extractKeyframes(files, (file) => `/api/session/${sessionId}/photo/${encodeURIComponent(file)}`);

  res.json({
    count: files.length,
    sortOrder: order,
    first: files.length > 0 ? { name: files[0], index: 1 } : null,
    last: files.length > 0 ? { name: files[files.length - 1], index: files.length } : null,
    keyframes,
    files: files.slice(0, 10)
  });
});

// Session Photo Sequence Verification Endpoint (with pagination and search)
app.get('/api/session/:sessionId/sequence', (req, res) => {
  const { sessionId } = req.params;
  const order = req.query.order === 'desc' ? 'desc' : 'asc';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(req.query.pageSize, 10) || 50));
  const search = (req.query.search || '').trim().toLowerCase();

  const sessionDir = path.join(UPLOADS_DIR, sessionId);
  if (!fs.existsSync(sessionDir)) {
    return res.json({ totalCount: 0, sortOrder: order, keyframes: [], files: [], page: 1, totalPages: 0 });
  }

  let allFiles = fs.readdirSync(sessionDir).filter(f => f !== 'concat.txt' && !f.startsWith('.')).sort(naturalSort);
  if (order === 'desc') {
    allFiles.reverse();
  }

  const keyframes = extractKeyframes(allFiles, (file) => `/api/session/${sessionId}/photo/${encodeURIComponent(file)}`);

  let filtered = allFiles;
  if (search) {
    filtered = allFiles.filter(f => f.toLowerCase().includes(search));
  }

  const totalCount = allFiles.length;
  const filteredCount = filtered.length;
  const totalPages = Math.ceil(filteredCount / pageSize);
  const startIndex = (page - 1) * pageSize;
  const pageFiles = filtered.slice(startIndex, startIndex + pageSize).map((filename) => {
    const originalIndex = allFiles.indexOf(filename) + 1;
    let size = 0;
    try {
      size = fs.statSync(path.join(sessionDir, filename)).size;
    } catch (e) {}
    return {
      index: originalIndex,
      filename,
      size,
      url: `/api/session/${sessionId}/photo/${encodeURIComponent(filename)}`
    };
  });

  res.json({
    totalCount,
    filteredCount,
    sortOrder: order,
    first: allFiles.length > 0 ? { name: allFiles[0], index: 1 } : null,
    last: allFiles.length > 0 ? { name: allFiles[allFiles.length - 1], index: allFiles.length } : null,
    keyframes,
    page,
    totalPages,
    pageSize,
    files: pageFiles
  });
});

// Serve Individual Photo from Session for Visual Verification
app.get('/api/session/:sessionId/photo/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  const filePath = path.join(UPLOADS_DIR, sessionId, filename);

  const resolved = path.resolve(filePath);
  const sessionDir = path.resolve(path.join(UPLOADS_DIR, sessionId));
  if (!resolved.startsWith(sessionDir) || !fs.existsSync(resolved)) {
    return res.status(404).send('Photo not found');
  }

  res.sendFile(resolved);
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

// -------------------------------------------------------------
// Local Folder Direct Mode Endpoints (Instant for 3,000+ photos)
// -------------------------------------------------------------

// Helper to safely clean folder paths (e.g. remove quotes from copy-path)
function sanitizeFolderPath(inputPath) {
  let cleaned = (inputPath || '').trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }
  return path.resolve(cleaned);
}

// Scan Local Folder on Disk
app.post('/api/local-folder/scan', (req, res) => {
  const { folderPath, order = 'asc' } = req.body;
  if (!folderPath) {
    return res.status(400).json({ error: 'folderPath is required' });
  }

  const resolvedPath = sanitizeFolderPath(folderPath);
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: `Directory does not exist: "${resolvedPath}"` });
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isDirectory()) {
    return res.status(400).json({ error: `Specified path is a file, not a directory: "${resolvedPath}"` });
  }

  try {
    const dirEntries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    let imageFiles = dirEntries
      .filter(entry => {
        if (!entry.isFile() || !isImageFile(entry.name)) return false;
        try {
          const s = fs.statSync(path.join(resolvedPath, entry.name));
          return s.size > 0; // Filter out 0-byte corrupt files
        } catch (e) {
          return false;
        }
      })
      .map(entry => entry.name)
      .sort(naturalSort);

    if (order === 'desc') {
      imageFiles.reverse();
    }

    if (imageFiles.length === 0) {
      return res.status(400).json({
        error: `No supported images found in "${resolvedPath}". Supported formats: JPG, PNG, WEBP, BMP, TIFF.`
      });
    }

    const keyframes = extractKeyframes(
      imageFiles,
      (file) => `/api/local-folder/photo?folderPath=${encodeURIComponent(resolvedPath)}&file=${encodeURIComponent(file)}`
    );

    res.json({
      success: true,
      folderPath: resolvedPath,
      totalCount: imageFiles.length,
      sortOrder: order,
      first: { name: imageFiles[0], index: 1 },
      last: { name: imageFiles[imageFiles.length - 1], index: imageFiles.length },
      keyframes,
      sampleFiles: imageFiles.slice(0, 10)
    });
  } catch (err) {
    console.error('Error scanning folder:', err);
    res.status(500).json({ error: `Failed to scan directory: ${err.message}` });
  }
});

// Sequence Info for Local Folder (pagination & search)
app.get('/api/local-folder/sequence', (req, res) => {
  const folderPath = req.query.folderPath;
  if (!folderPath) {
    return res.status(400).json({ error: 'folderPath is required' });
  }

  const resolvedPath = sanitizeFolderPath(folderPath);
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Directory not found' });
  }

  const order = req.query.order === 'desc' ? 'desc' : 'asc';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(req.query.pageSize, 10) || 50));
  const search = (req.query.search || '').trim().toLowerCase();

  try {
    const dirEntries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    let allFiles = dirEntries
      .filter(entry => {
        if (!entry.isFile() || !isImageFile(entry.name)) return false;
        try {
          const s = fs.statSync(path.join(resolvedPath, entry.name));
          return s.size > 0;
        } catch (e) {
          return false;
        }
      })
      .map(entry => entry.name)
      .sort(naturalSort);

    if (order === 'desc') {
      allFiles.reverse();
    }

    const keyframes = extractKeyframes(
      allFiles,
      (file) => `/api/local-folder/photo?folderPath=${encodeURIComponent(resolvedPath)}&file=${encodeURIComponent(file)}`
    );

    let filtered = allFiles;
    if (search) {
      filtered = allFiles.filter(f => f.toLowerCase().includes(search));
    }

    const totalCount = allFiles.length;
    const filteredCount = filtered.length;
    const totalPages = Math.ceil(filteredCount / pageSize);
    const startIndex = (page - 1) * pageSize;

    const pageFiles = filtered.slice(startIndex, startIndex + pageSize).map((filename) => {
      const originalIndex = allFiles.indexOf(filename) + 1;
      let size = 0;
      try {
        size = fs.statSync(path.join(resolvedPath, filename)).size;
      } catch (e) {}
      return {
        index: originalIndex,
        filename,
        size,
        url: `/api/local-folder/photo?folderPath=${encodeURIComponent(resolvedPath)}&file=${encodeURIComponent(filename)}`
      };
    });

    res.json({
      totalCount,
      filteredCount,
      sortOrder: order,
      first: allFiles.length > 0 ? { name: allFiles[0], index: 1 } : null,
      last: allFiles.length > 0 ? { name: allFiles[allFiles.length - 1], index: allFiles.length } : null,
      keyframes,
      page,
      totalPages,
      pageSize,
      files: pageFiles
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve Photo from Local Folder for Visual Verification
app.get('/api/local-folder/photo', (req, res) => {
  const { folderPath, file } = req.query;
  if (!folderPath || !file) {
    return res.status(400).send('folderPath and file parameters required');
  }

  const resolvedFolder = sanitizeFolderPath(folderPath);
  const resolvedFile = path.resolve(resolvedFolder, file);

  if (!resolvedFile.startsWith(resolvedFolder) || !fs.existsSync(resolvedFile)) {
    return res.status(404).send('File not found');
  }

  res.sendFile(resolvedFile);
});

// -------------------------------------------------------------
// SSE Progress Endpoint
// -------------------------------------------------------------
app.get('/api/progress/:channelId', (req, res) => {
  const { channelId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.set(channelId, res);

  const currentState = renderState.get(channelId);
  if (currentState) {
    res.write(`data: ${JSON.stringify(currentState)}\n\n`);
  }

  req.on('close', () => {
    sseClients.delete(channelId);
  });
});

// -------------------------------------------------------------
// Render Endpoint (Supports Session or Direct Local Folder)
// -------------------------------------------------------------
app.post('/api/render', async (req, res) => {
  const {
    channelId: clientChannelId,
    sessionId,
    folderPath,
    sortOrder = 'asc',
    fps = 30,
    resolution = '1080p',
    aspectMode = 'contain',
    format = 'mp4',
    quality = 'medium'
  } = req.body;

  const channelId = clientChannelId || sessionId || 'render_' + Date.now();
  let imageFiles = [];
  let sourceDir = '';

  if (folderPath) {
    sourceDir = sanitizeFolderPath(folderPath);
    if (!fs.existsSync(sourceDir)) {
      return res.status(404).json({ error: `Directory does not exist: "${sourceDir}"` });
    }
    const dirEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
    imageFiles = dirEntries
      .filter(entry => {
        if (!entry.isFile() || !isImageFile(entry.name)) return false;
        try {
          const s = fs.statSync(path.join(sourceDir, entry.name));
          return s.size > 0;
        } catch (e) {
          return false;
        }
      })
      .map(entry => entry.name)
      .sort(naturalSort);
  } else if (sessionId) {
    sourceDir = path.join(UPLOADS_DIR, sessionId);
    if (!fs.existsSync(sourceDir)) {
      return res.status(404).json({ error: 'No uploaded photos found for this session' });
    }
    imageFiles = fs.readdirSync(sourceDir)
      .filter(f => f !== 'concat.txt' && !f.startsWith('.') && isImageFile(f))
      .sort(naturalSort);
  } else {
    return res.status(400).json({ error: 'Either sessionId or folderPath is required' });
  }

  // Apply user-verified sort order (Ascending = Oldest first based on natural sort)
  if (sortOrder === 'desc') {
    imageFiles.reverse();
  }

  if (imageFiles.length === 0) {
    return res.status(400).json({ error: 'No valid photos found in the specified source' });
  }

  const totalFrames = imageFiles.length;
  const frameDuration = (1 / parseFloat(fps)).toFixed(6);

  // Write concat.txt demuxer file for FFmpeg in DATA_DIR or sessionDir
  const concatPath = sessionId 
    ? path.join(sourceDir, 'concat.txt')
    : path.join(DATA_DIR, `concat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.txt`);

  let concatLines = [];
  imageFiles.forEach((file) => {
    const fullPath = path.join(sourceDir, file).replace(/\\/g, '/');
    // In FFmpeg concat demuxer, single quote inside single-quoted string is escaped as \'
    const escaped = fullPath.replace(/'/g, "\\'");
    concatLines.push(`file '${escaped}'`);
    concatLines.push(`duration ${frameDuration}`);
  });
  // Repeat last file as per FFmpeg concat demuxer spec
  if (imageFiles.length > 0) {
    const lastFile = imageFiles[imageFiles.length - 1];
    const fullPath = path.join(sourceDir, lastFile).replace(/\\/g, '/');
    const escaped = fullPath.replace(/'/g, "\\'");
    concatLines.push(`file '${escaped}'`);
  }

  // Write with latin1 encoding to allow Windows ANSI path resolution in FFmpeg
  fs.writeFileSync(concatPath, concatLines.join('\n'), 'latin1');

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

  // Filter building with integer padding offsets
  let vfFilter = '';
  if (targetW && targetH) {
    if (aspectMode === 'cover') {
      vfFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}`;
    } else if (aspectMode === 'stretch') {
      vfFilter = `scale=${targetW}:${targetH}`;
    } else {
      // default contain (letterbox) with trunc to guarantee integer coordinates for pad
      vfFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:trunc((ow-iw)/2):trunc((oh-ih)/2):black`;
    }
    vfFilter += `,format=yuv420p`;
  } else {
    vfFilter = `scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`;
  }

  // Quality CRF mappings
  let crf = '23'; // medium default
  if (quality === 'high') crf = '18';
  if (quality === 'fast') crf = '28';

  const outputFileName = `timelapse_${channelId}_${Date.now()}.${format}`;
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
    ffmpegArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p');
  }

  ffmpegArgs.push(outputPath);

  console.log(`Starting FFmpeg render for ${channelId}...`);
  console.log(`First frame: ${imageFiles[0]} | Last frame: ${imageFiles[imageFiles.length - 1]} | Total: ${totalFrames} frames`);
  console.log(`Command: ffmpeg ${ffmpegArgs.join(' ')}`);

  broadcastProgress(channelId, {
    status: 'rendering',
    percent: 0,
    frame: 0,
    totalFrames,
    fps
  });

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);
  let stderrBuffer = '';

  ffmpeg.stderr.on('data', (data) => {
    const str = data.toString();
    stderrBuffer += str;
    if (stderrBuffer.length > 50000) {
      stderrBuffer = stderrBuffer.substring(stderrBuffer.length - 20000);
    }

    const frameMatch = str.match(/frame=\s*(\d+)/);
    if (frameMatch) {
      const currentFrame = parseInt(frameMatch[1], 10);
      const percent = Math.min(100, Math.round((currentFrame / totalFrames) * 100));
      broadcastProgress(channelId, {
        status: 'rendering',
        percent,
        frame: currentFrame,
        totalFrames,
        fps
      });
    }
  });

  ffmpeg.on('close', (code) => {
    // Clean up temporary concat file for local folders
    if (!sessionId && fs.existsSync(concatPath)) {
      try { fs.unlinkSync(concatPath); } catch (e) {}
    }

    if (code === 0) {
      console.log(`Render complete for ${channelId}: ${outputFileName}`);
      broadcastProgress(channelId, {
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
      const errorLines = stderrBuffer
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('frame=') && !l.startsWith('video:') && !l.startsWith('[libx264'));
      const errorDetail = errorLines.slice(-6).join(' | ') || `FFmpeg process exited with code ${code}`;

      console.error(`FFmpeg failed with exit code ${code}. Detail:`, errorDetail);
      broadcastProgress(channelId, {
        status: 'error',
        error: errorDetail
      });
      if (!res.headersSent) {
        res.status(500).json({ error: errorDetail });
      }
    }
  });

  ffmpeg.on('error', (err) => {
    if (!sessionId && fs.existsSync(concatPath)) {
      try { fs.unlinkSync(concatPath); } catch (e) {}
    }
    console.error(`FFmpeg spawn error:`, err);
    broadcastProgress(channelId, {
      status: 'error',
      error: err.message
    });
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });
});

const server = app.listen(PORT, () => {
  console.log(`Timelapse Maker app listening on http://localhost:${PORT}`);
});

// Configure HTTP timeouts for large file uploads & long connections
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 0; // Disable request timeout to support massive uploads
