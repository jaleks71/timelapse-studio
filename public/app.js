document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Source Selection & Tabs
  const tabBrowserUpload = document.getElementById('tabBrowserUpload');
  const tabLocalFolder = document.getElementById('tabLocalFolder');
  const paneBrowserUpload = document.getElementById('paneBrowserUpload');
  const paneLocalFolder = document.getElementById('paneLocalFolder');

  // DOM Elements - Browser Upload
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const folderInput = document.getElementById('folderInput');
  const btnBrowseFiles = document.getElementById('btnBrowseFiles');
  const btnBrowseFolder = document.getElementById('btnBrowseFolder');
  const uploadProgressBox = document.getElementById('uploadProgressBox');
  const uploadStatusText = document.getElementById('uploadStatusText');
  const uploadPercent = document.getElementById('uploadPercent');
  const uploadBarFill = document.getElementById('uploadBarFill');
  const uploadSubStatus = document.getElementById('uploadSubStatus');
  const btnCancelUpload = document.getElementById('btnCancelUpload');

  // DOM Elements - Local Folder
  const localFolderPathInput = document.getElementById('localFolderPathInput');
  const btnScanFolder = document.getElementById('btnScanFolder');

  // DOM Elements - Session Summary & Verification
  const sessionSummary = document.getElementById('sessionSummary');
  const statFrameCount = document.getElementById('statFrameCount');
  const btnClearSession = document.getElementById('btnClearSession');
  const sequenceVerificationCard = document.getElementById('sequenceVerificationCard');
  const sequenceOrderBadge = document.getElementById('sequenceOrderBadge');
  const keyframeFilmstrip = document.getElementById('keyframeFilmstrip');
  const btnSortAsc = document.getElementById('btnSortAsc');
  const btnSortDesc = document.getElementById('btnSortDesc');
  const btnInspectSequence = document.getElementById('btnInspectSequence');

  // DOM Elements - Settings
  const fpsButtons = document.querySelectorAll('.pill-btn');
  const customFpsInput = document.getElementById('customFpsInput');
  const resSelect = document.getElementById('resSelect');
  const formatSelect = document.getElementById('formatSelect');
  const aspectSelect = document.getElementById('aspectSelect');
  const qualitySelect = document.getElementById('qualitySelect');
  const estimatedDuration = document.getElementById('estimatedDuration');
  const btnRender = document.getElementById('btnRender');
  const appStatus = document.getElementById('appStatus');

  // DOM Elements - Preview & Output
  const emptyState = document.getElementById('emptyState');
  const renderProgressBox = document.getElementById('renderProgressBox');
  const renderPhaseText = document.getElementById('renderPhaseText');
  const renderDetailsText = document.getElementById('renderDetailsText');
  const renderBarFill = document.getElementById('renderBarFill');
  const videoContainer = document.getElementById('videoContainer');
  const videoPlayer = document.getElementById('videoPlayer');
  const btnDownload = document.getElementById('btnDownload');

  // DOM Elements - Sequence Modal
  const sequenceModal = document.getElementById('sequenceModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnCloseModalFooter = document.getElementById('btnCloseModalFooter');
  const modalTotalBadge = document.getElementById('modalTotalBadge');
  const modalSearchInput = document.getElementById('modalSearchInput');
  const sequenceTableBody = document.getElementById('sequenceTableBody');
  const btnPrevPage = document.getElementById('btnPrevPage');
  const btnNextPage = document.getElementById('btnNextPage');
  const pageInfoText = document.getElementById('pageInfoText');

  // Application State
  let sourceType = 'session'; // 'session' or 'local_folder'
  let sessionId = getOrCreateSessionId();
  let localFolderPath = '';
  let uploadedPhotosCount = 0;
  let sortOrder = 'asc'; // 'asc' (oldest first) or 'desc' (newest first)
  let selectedFps = 30;
  let eventSource = null;
  let uploadAbortController = null;
  let modalCurrentPage = 1;
  let modalTotalPages = 1;

  const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.heic']);

  function isImage(filename) {
    if (!filename) return false;
    const dotIdx = filename.lastIndexOf('.');
    if (dotIdx === -1) return false;
    return IMAGE_EXTENSIONS.has(filename.substring(dotIdx).toLowerCase());
  }

  // Initialize
  checkExistingSession();

  function getOrCreateSessionId() {
    let id = localStorage.getItem('timelapse_session_id');
    if (!id) {
      id = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      localStorage.setItem('timelapse_session_id', id);
    }
    return id;
  }

  function resetSessionId() {
    sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('timelapse_session_id', sessionId);
  }

  // Natural sort helper for File array or filename strings
  function sortFilesNaturally(fileList) {
    const files = Array.from(fileList);
    return files.sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  }

  // Check if session has uploaded photos on server
  async function checkExistingSession() {
    try {
      const res = await fetch(`/api/session/${sessionId}?order=${sortOrder}`);
      const data = await res.json();
      if (data.count > 0) {
        sourceType = 'session';
        uploadedPhotosCount = data.count;
        updateSessionUI();
        loadSequenceVerification();
      }
    } catch (err) {
      console.error('Error checking session:', err);
    }
  }

  // Source Tabs Switching
  tabBrowserUpload.addEventListener('click', () => {
    tabBrowserUpload.classList.add('active');
    tabLocalFolder.classList.remove('active');
    paneBrowserUpload.classList.remove('hidden');
    paneLocalFolder.classList.add('hidden');
  });

  tabLocalFolder.addEventListener('click', () => {
    tabLocalFolder.classList.add('active');
    tabBrowserUpload.classList.remove('active');
    paneLocalFolder.classList.remove('hidden');
    paneBrowserUpload.classList.add('hidden');
  });

  // File and Folder Button Triggers
  btnBrowseFiles.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  btnBrowseFolder.addEventListener('click', (e) => {
    e.stopPropagation();
    folderInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleBatchUpload(fileInput.files);
    }
  });

  folderInput.addEventListener('change', () => {
    if (folderInput.files.length > 0) {
      handleBatchUpload(folderInput.files);
    }
  });

  // Drag and Drop Event Handling with Directory Support
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    }, false);
  });

  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = await extractFilesFromDataTransfer(e.dataTransfer);
    if (files.length > 0) {
      handleBatchUpload(files);
    } else {
      alert('No supported image files found in the dropped selection.');
    }
  });

  /**
   * Recursively extract all image files from DataTransfer (supports dropped folders)
   */
  async function extractFilesFromDataTransfer(dataTransfer) {
    const files = [];
    const items = dataTransfer.items;

    if (items && items.length > 0 && items[0].webkitGetAsEntry) {
      const queue = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) queue.push(entry);
      }

      while (queue.length > 0) {
        const entry = queue.shift();
        if (entry.isFile) {
          const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
          if (file && isImage(file.name)) {
            files.push(file);
          }
        } else if (entry.isDirectory) {
          const dirFiles = await readDirectoryEntries(entry);
          queue.push(...dirFiles);
        }
      }
    } else {
      // Fallback
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const f = dataTransfer.files[i];
        if (isImage(f.name)) files.push(f);
      }
    }

    return files;
  }

  function readDirectoryEntries(directoryEntry) {
    return new Promise((resolve) => {
      const dirReader = directoryEntry.createReader();
      let entries = [];

      function readBatch() {
        dirReader.readEntries((batch) => {
          if (!batch || batch.length === 0) {
            resolve(entries);
          } else {
            entries = entries.concat(batch);
            readBatch(); // Keep reading until empty batch
          }
        }, () => resolve(entries));
      }

      readBatch();
    });
  }

  // -------------------------------------------------------------
  // Robust, Resilient Batch Upload for 3,000+ Photos
  // Sized by file count AND total byte payload, with auto-retries
  // -------------------------------------------------------------
  async function handleBatchUpload(fileList) {
    sourceType = 'session';
    const validFiles = Array.from(fileList).filter(f => isImage(f.name));
    if (validFiles.length === 0) {
      alert('No supported image files found in selection.');
      return;
    }

    const sortedFiles = sortFilesNaturally(validFiles);
    const totalFiles = sortedFiles.length;

    uploadProgressBox.classList.remove('hidden');
    appStatus.textContent = 'Uploading...';
    appStatus.style.borderColor = '#6366f1';
    appStatus.style.color = '#6366f1';

    uploadAbortController = new AbortController();
    btnCancelUpload.disabled = false;

    // Partition into adaptive batches: max 10 files or max 25MB per batch
    const batches = [];
    const MAX_FILES_PER_BATCH = 10;
    const MAX_BYTES_PER_BATCH = 25 * 1024 * 1024; // 25MB

    let currentBatch = [];
    let currentBatchBytes = 0;

    for (const file of sortedFiles) {
      if (currentBatch.length >= MAX_FILES_PER_BATCH || (currentBatchBytes + file.size > MAX_BYTES_PER_BATCH && currentBatch.length > 0)) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchBytes = 0;
      }
      currentBatch.push(file);
      currentBatchBytes += file.size;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    const totalBatches = batches.length;
    let uploadedFilesCount = 0;
    let isCancelled = false;

    for (let bIndex = 0; bIndex < totalBatches; bIndex++) {
      if (uploadAbortController.signal.aborted) {
        isCancelled = true;
        break;
      }

      const chunk = batches[bIndex];
      const chunkBytes = chunk.reduce((sum, f) => sum + f.size, 0);

      uploadStatusText.textContent = `Uploading ${uploadedFilesCount} / ${totalFiles} photos...`;
      uploadSubStatus.textContent = `Batch ${bIndex + 1} of ${totalBatches} (${chunk.length} photos, ${formatBytes(chunkBytes)})`;

      const formData = new FormData();
      formData.append('sessionId', sessionId);
      chunk.forEach(file => formData.append('photos', file));

      // Attempt upload with up to 3 retries on network hiccups
      const MAX_RETRIES = 3;
      let uploadSuccess = false;
      let lastErrorMessage = '';

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (uploadAbortController.signal.aborted) {
          isCancelled = true;
          break;
        }

        try {
          if (attempt > 1) {
            uploadSubStatus.textContent = `Retrying batch ${bIndex + 1} (attempt ${attempt} of ${MAX_RETRIES})...`;
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }

          const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
            signal: uploadAbortController.signal
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({ error: `Server error ${response.status}` }));
            throw new Error(errData.error || `HTTP ${response.status}`);
          }

          const result = await response.json();
          if (result.success) {
            uploadSuccess = true;
            uploadedFilesCount += chunk.length;
            uploadedPhotosCount = result.totalUploaded;

            const percent = Math.round((uploadedFilesCount / totalFiles) * 100);
            uploadStatusText.textContent = `Uploaded ${uploadedFilesCount} / ${totalFiles} photos...`;
            uploadPercent.textContent = `${percent}%`;
            uploadBarFill.style.width = `${percent}%`;
            break;
          } else {
            throw new Error(result.error || 'Server reported upload failure');
          }
        } catch (err) {
          if (err.name === 'AbortError') {
            isCancelled = true;
            break;
          }
          lastErrorMessage = err.message;
          console.warn(`Batch ${bIndex + 1} attempt ${attempt} failed:`, err);
        }
      }

      if (isCancelled) break;

      if (!uploadSuccess) {
        alert(`Upload error on batch ${bIndex + 1} of ${totalBatches}: ${lastErrorMessage}\nUpload paused. You can retry or verify uploaded photos.`);
        break;
      }
    }

    uploadProgressBox.classList.add('hidden');
    uploadAbortController = null;

    if (isCancelled) {
      alert('Upload cancelled by user.');
    }

    updateSessionUI();
    if (uploadedPhotosCount > 0) {
      loadSequenceVerification();
    }
  }

  // Cancel Upload handler
  btnCancelUpload.addEventListener('click', () => {
    if (uploadAbortController) {
      uploadAbortController.abort();
      btnCancelUpload.disabled = true;
      uploadSubStatus.textContent = 'Cancelling upload...';
    }
  });

  // -------------------------------------------------------------
  // Local Folder Direct Mode (Instant for 3000+ photos)
  // -------------------------------------------------------------
  btnScanFolder.addEventListener('click', async () => {
    const folderPath = localFolderPathInput.value.trim();
    if (!folderPath) {
      alert('Please enter or paste a valid folder path on your computer.');
      return;
    }

    btnScanFolder.disabled = true;
    btnScanFolder.textContent = 'Scanning...';
    appStatus.textContent = 'Scanning Folder...';

    try {
      const response = await fetch('/api/local-folder/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath, order: sortOrder })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to scan folder');
      }

      sourceType = 'local_folder';
      localFolderPath = data.folderPath;
      uploadedPhotosCount = data.totalCount;

      updateSessionUI();
      renderKeyframes(data.keyframes);
      sequenceVerificationCard.classList.remove('hidden');

      appStatus.textContent = `${uploadedPhotosCount} Photos Ready`;
      appStatus.style.borderColor = '#10b981';
      appStatus.style.color = '#10b981';
    } catch (err) {
      console.error('Scan folder error:', err);
      alert('Error scanning folder: ' + err.message);
      appStatus.textContent = 'Ready';
    } finally {
      btnScanFolder.disabled = false;
      btnScanFolder.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        Scan Folder
      `;
    }
  });

  // -------------------------------------------------------------
  // Sequence Verification & Ordering Logic
  // -------------------------------------------------------------
  async function loadSequenceVerification() {
    if (uploadedPhotosCount === 0) return;

    try {
      let url = '';
      if (sourceType === 'local_folder') {
        url = `/api/local-folder/sequence?folderPath=${encodeURIComponent(localFolderPath)}&order=${sortOrder}&page=1&pageSize=5`;
      } else {
        url = `/api/session/${sessionId}/sequence?order=${sortOrder}&page=1&pageSize=5`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (data.keyframes && data.keyframes.length > 0) {
        renderKeyframes(data.keyframes);
        sequenceVerificationCard.classList.remove('hidden');
        sequenceOrderBadge.textContent = sortOrder === 'asc' ? 'Oldest First (A → Z)' : 'Newest First (Z → A)';
      }
    } catch (err) {
      console.error('Error loading sequence verification:', err);
    }
  }

  function renderKeyframes(keyframes) {
    keyframeFilmstrip.innerHTML = '';
    if (!keyframes || keyframes.length === 0) return;

    keyframes.forEach((kf, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === keyframes.length - 1;

      const card = document.createElement('div');
      card.className = `keyframe-card ${isFirst ? 'first-frame' : ''} ${isLast ? 'last-frame' : ''}`;

      const badgeText = isFirst 
        ? (sortOrder === 'asc' ? 'Start (Oldest)' : 'Start (Newest)')
        : isLast 
          ? (sortOrder === 'asc' ? 'End (Newest)' : 'End (Oldest)')
          : `${kf.percent}% Progress`;

      card.innerHTML = `
        <div class="keyframe-badge">${badgeText}</div>
        <img class="keyframe-thumb" src="${kf.url}" alt="Frame ${kf.frameNumber}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 75%22 fill=%22%231e293b%22><text x=%2250%%22 y=%2250%%22 fill=%22%2394a3b8%22 font-size=%2210%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22>Frame</text></svg>'">
        <div class="keyframe-info">
          <div class="keyframe-frame-num">Frame #${kf.frameNumber}</div>
          <span class="keyframe-filename" title="${kf.filename}">${kf.filename}</span>
        </div>
      `;
      keyframeFilmstrip.appendChild(card);
    });
  }

  // Sort Order Toggles
  btnSortAsc.addEventListener('click', () => {
    if (sortOrder === 'asc') return;
    sortOrder = 'asc';
    btnSortAsc.classList.add('active');
    btnSortDesc.classList.remove('active');
    loadSequenceVerification();
  });

  btnSortDesc.addEventListener('click', () => {
    if (sortOrder === 'desc') return;
    sortOrder = 'desc';
    btnSortDesc.classList.add('active');
    btnSortAsc.classList.remove('active');
    loadSequenceVerification();
  });

  // -------------------------------------------------------------
  // Sequence Inspection Modal
  // -------------------------------------------------------------
  btnInspectSequence.addEventListener('click', () => {
    sequenceModal.classList.remove('hidden');
    modalCurrentPage = 1;
    modalSearchInput.value = '';
    loadModalSequencePage();
  });

  btnCloseModal.addEventListener('click', () => sequenceModal.classList.add('hidden'));
  btnCloseModalFooter.addEventListener('click', () => sequenceModal.classList.add('hidden'));
  sequenceModal.addEventListener('click', (e) => {
    if (e.target === sequenceModal) sequenceModal.classList.add('hidden');
  });

  let searchTimeout = null;
  modalSearchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      modalCurrentPage = 1;
      loadModalSequencePage();
    }, 250);
  });

  btnPrevPage.addEventListener('click', () => {
    if (modalCurrentPage > 1) {
      modalCurrentPage--;
      loadModalSequencePage();
    }
  });

  btnNextPage.addEventListener('click', () => {
    if (modalCurrentPage < modalTotalPages) {
      modalCurrentPage++;
      loadModalSequencePage();
    }
  });

  async function loadModalSequencePage() {
    const search = modalSearchInput.value.trim();
    let url = '';
    if (sourceType === 'local_folder') {
      url = `/api/local-folder/sequence?folderPath=${encodeURIComponent(localFolderPath)}&order=${sortOrder}&page=${modalCurrentPage}&pageSize=50&search=${encodeURIComponent(search)}`;
    } else {
      url = `/api/session/${sessionId}/sequence?order=${sortOrder}&page=${modalCurrentPage}&pageSize=50&search=${encodeURIComponent(search)}`;
    }

    try {
      const res = await fetch(url);
      const data = await res.json();

      modalTotalBadge.textContent = `${data.totalCount} photos total (${data.filteredCount} matches)`;
      modalTotalPages = data.totalPages || 1;
      pageInfoText.textContent = `Page ${data.page} of ${modalTotalPages}`;

      btnPrevPage.disabled = data.page <= 1;
      btnNextPage.disabled = data.page >= modalTotalPages;

      sequenceTableBody.innerHTML = '';
      if (!data.files || data.files.length === 0) {
        sequenceTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 30px;">No photos matched your search.</td></tr>`;
        return;
      }

      data.files.forEach((file) => {
        const isStart = file.index === 1;
        const isEnd = file.index === data.totalCount;

        const row = document.createElement('tr');
        row.innerHTML = `
          <td style="font-weight: 600; color: var(--text-muted);">${file.index}</td>
          <td style="font-weight: 500;">
            <a href="${file.url}" target="_blank" style="color: var(--text-main); text-decoration: none;">
              ${file.filename}
            </a>
          </td>
          <td>
            ${isStart 
              ? `<span class="role-tag start">${sortOrder === 'asc' ? 'Start (Oldest)' : 'Start (Newest)'}</span>` 
              : isEnd 
                ? `<span class="role-tag end">${sortOrder === 'asc' ? 'End (Newest)' : 'End (Oldest)'}</span>` 
                : `<span class="role-tag middle">Frame ${file.index}</span>`
            }
          </td>
          <td style="color: var(--text-muted); font-size: 0.82rem;">${formatBytes(file.size)}</td>
        `;
        sequenceTableBody.appendChild(row);
      });
    } catch (err) {
      console.error('Error loading modal page:', err);
    }
  }

  // -------------------------------------------------------------
  // UI Updates & Session Cleanup
  // -------------------------------------------------------------
  function updateSessionUI() {
    if (uploadedPhotosCount > 0) {
      sessionSummary.classList.remove('hidden');
      const sourceDesc = sourceType === 'local_folder' ? `Folder: ${pathBasename(localFolderPath)}` : 'Uploaded';
      statFrameCount.textContent = `${uploadedPhotosCount} Photos Loaded (${sourceDesc})`;
      btnRender.disabled = false;
      appStatus.textContent = `${uploadedPhotosCount} Photos Ready`;
      appStatus.style.borderColor = '#10b981';
      appStatus.style.color = '#10b981';
    } else {
      sessionSummary.classList.add('hidden');
      sequenceVerificationCard.classList.add('hidden');
      btnRender.disabled = true;
      appStatus.textContent = 'Ready';
      appStatus.style.borderColor = '#6366f1';
      appStatus.style.color = '#6366f1';
    }
    recalculateDuration();
  }

  function pathBasename(fullPath) {
    if (!fullPath) return '';
    const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : fullPath;
  }

  // Clear / Change Session
  btnClearSession.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear photos and reset selection?')) return;
    if (sourceType === 'session') {
      try {
        await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
      } catch (e) {}
      resetSessionId();
    }
    sourceType = 'session';
    localFolderPath = '';
    localFolderPathInput.value = '';
    uploadedPhotosCount = 0;
    fileInput.value = '';
    folderInput.value = '';
    videoContainer.classList.add('hidden');
    emptyState.classList.remove('hidden');
    renderProgressBox.classList.add('hidden');
    updateSessionUI();
  });

  // FPS Selector Handling
  fpsButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      fpsButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFps = parseInt(btn.dataset.fps, 10);
      customFpsInput.value = '';
      recalculateDuration();
    });
  });

  customFpsInput.addEventListener('input', () => {
    const val = parseInt(customFpsInput.value, 10);
    if (val && val > 0) {
      fpsButtons.forEach(b => b.classList.remove('active'));
      selectedFps = val;
      recalculateDuration();
    }
  });

  function recalculateDuration() {
    if (uploadedPhotosCount === 0 || !selectedFps) {
      estimatedDuration.textContent = '0.0 seconds';
      return;
    }
    const seconds = (uploadedPhotosCount / selectedFps).toFixed(1);
    estimatedDuration.textContent = `${seconds} seconds (${(seconds / 60).toFixed(1)} mins)`;
  }

  // -------------------------------------------------------------
  // Render Trigger & SSE Subscription
  // -------------------------------------------------------------
  btnRender.addEventListener('click', async () => {
    if (uploadedPhotosCount === 0) return;

    btnRender.disabled = true;
    emptyState.classList.add('hidden');
    videoContainer.classList.add('hidden');
    renderProgressBox.classList.remove('hidden');

    renderPhaseText.textContent = 'Initializing FFmpeg Encoder...';
    renderDetailsText.textContent = 'Preparing image frames sequence in verified order';
    renderBarFill.style.width = '0%';

    const channelId = sourceType === 'session' ? sessionId : 'local_' + Date.now();

    // Connect Server-Sent Events (SSE)
    if (eventSource) {
      eventSource.close();
    }
    eventSource = new EventSource(`/api/progress/${channelId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === 'rendering') {
        renderPhaseText.textContent = `Encoding Video (${data.percent}%)`;
        renderDetailsText.textContent = `Frame ${data.frame} of ${data.totalFrames} @ ${data.fps} FPS`;
        renderBarFill.style.width = `${data.percent}%`;
      } else if (data.status === 'completed') {
        eventSource.close();
        renderProgressBox.classList.add('hidden');
        videoContainer.classList.remove('hidden');
        videoPlayer.src = data.videoUrl;
        btnDownload.href = data.videoUrl;
        btnDownload.setAttribute('download', data.filename);
        btnRender.disabled = false;
        appStatus.textContent = 'Render Complete';
      } else if (data.status === 'error') {
        eventSource.close();
        renderProgressBox.classList.add('hidden');
        emptyState.classList.remove('hidden');
        alert('Render error: ' + data.error);
        btnRender.disabled = false;
      }
    };

    // Send render request to API
    try {
      const payload = {
        channelId,
        fps: selectedFps,
        resolution: resSelect.value,
        aspectMode: aspectSelect.value,
        format: formatSelect.value,
        quality: qualitySelect.value,
        sortOrder: sortOrder
      };

      if (sourceType === 'local_folder') {
        payload.folderPath = localFolderPath;
      } else {
        payload.sessionId = sessionId;
      }

      const response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Failed to start render');
      }
    } catch (err) {
      console.error('Render request error:', err);
      if (eventSource) eventSource.close();
      renderProgressBox.classList.add('hidden');
      emptyState.classList.remove('hidden');
      alert('Error triggering render: ' + err.message);
      btnRender.disabled = false;
    }
  });
});
