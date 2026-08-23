document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const uploadProgressBox = document.getElementById('uploadProgressBox');
  const uploadStatusText = document.getElementById('uploadStatusText');
  const uploadPercent = document.getElementById('uploadPercent');
  const uploadBarFill = document.getElementById('uploadBarFill');
  const sessionSummary = document.getElementById('sessionSummary');
  const statFrameCount = document.getElementById('statFrameCount');
  const btnClearSession = document.getElementById('btnClearSession');

  const fpsButtons = document.querySelectorAll('.pill-btn');
  const customFpsInput = document.getElementById('customFpsInput');
  const resSelect = document.getElementById('resSelect');
  const formatSelect = document.getElementById('formatSelect');
  const aspectSelect = document.getElementById('aspectSelect');
  const qualitySelect = document.getElementById('qualitySelect');
  const estimatedDuration = document.getElementById('estimatedDuration');
  const btnRender = document.getElementById('btnRender');
  const appStatus = document.getElementById('appStatus');

  const emptyState = document.getElementById('emptyState');
  const renderProgressBox = document.getElementById('renderProgressBox');
  const renderPhaseText = document.getElementById('renderPhaseText');
  const renderDetailsText = document.getElementById('renderDetailsText');
  const renderBarFill = document.getElementById('renderBarFill');
  const videoContainer = document.getElementById('videoContainer');
  const videoPlayer = document.getElementById('videoPlayer');
  const btnDownload = document.getElementById('btnDownload');

  // Application State
  let sessionId = getOrCreateSessionId();
  let uploadedPhotosCount = 0;
  let selectedFps = 30;
  let eventSource = null;

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

  // Check if session has uploaded photos on server
  async function checkExistingSession() {
    try {
      const res = await fetch(`/api/session/${sessionId}`);
      const data = await res.json();
      if (data.count > 0) {
        uploadedPhotosCount = data.count;
        updateSessionUI();
      }
    } catch (err) {
      console.error('Error checking session:', err);
    }
  }

  // Natural sort helper for File array
  function sortFilesNaturally(fileList) {
    const files = Array.from(fileList);
    return files.sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
  }

  // Drag and Drop Event Listeners
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

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleBatchUpload(files);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
      handleBatchUpload(fileInput.files);
    }
  });

  // Batch Upload Logic for 700+ photos
  async function handleBatchUpload(fileList) {
    const sortedFiles = sortFilesNaturally(fileList);
    const totalFiles = sortedFiles.length;
    
    if (totalFiles === 0) return;

    uploadProgressBox.classList.remove('hidden');
    appStatus.textContent = 'Uploading...';
    appStatus.style.borderColor = '#6366f1';
    appStatus.style.color = '#6366f1';

    const BATCH_SIZE = 35; // Upload in chunks of 35 files
    let uploadedSoFar = 0;

    for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
      const chunk = sortedFiles.slice(i, i + BATCH_SIZE);
      const formData = new FormData();
      formData.append('sessionId', sessionId);
      chunk.forEach(file => formData.append('photos', file));

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const result = await response.json();
        
        if (result.success) {
          uploadedSoFar += chunk.length;
          uploadedPhotosCount = result.totalUploaded;
          
          const percent = Math.round((uploadedSoFar / totalFiles) * 100);
          uploadStatusText.textContent = `Uploaded ${uploadedSoFar} / ${totalFiles} photos...`;
          uploadPercent.textContent = `${percent}%`;
          uploadBarFill.style.width = `${percent}%`;
        }
      } catch (err) {
        console.error('Batch upload error:', err);
        alert(`Upload error on batch starting at index ${i}: ` + err.message);
        break;
      }
    }

    uploadProgressBox.classList.add('hidden');
    updateSessionUI();
  }

  function updateSessionUI() {
    if (uploadedPhotosCount > 0) {
      sessionSummary.classList.remove('hidden');
      statFrameCount.textContent = `${uploadedPhotosCount} Photos Uploaded`;
      btnRender.disabled = false;
      appStatus.textContent = `${uploadedPhotosCount} Photos Ready`;
      appStatus.style.borderColor = '#10b981';
      appStatus.style.color = '#10b981';
    } else {
      sessionSummary.classList.add('hidden');
      btnRender.disabled = true;
      appStatus.textContent = 'Ready';
      appStatus.style.borderColor = '#6366f1';
      appStatus.style.color = '#6366f1';
    }
    recalculateDuration();
  }

  // Clear Session
  btnClearSession.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear uploaded photos?')) return;
    try {
      await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    } catch (e) {}
    resetSessionId();
    uploadedPhotosCount = 0;
    fileInput.value = '';
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

  // Render Trigger & SSE Subscription
  btnRender.addEventListener('click', async () => {
    if (uploadedPhotosCount === 0) return;

    // Update UI for rendering state
    btnRender.disabled = true;
    emptyState.classList.add('hidden');
    videoContainer.classList.add('hidden');
    renderProgressBox.classList.remove('hidden');

    renderPhaseText.textContent = 'Initializing FFmpeg Encoder...';
    renderDetailsText.textContent = 'Preparing image frames sequence';
    renderBarFill.style.width = '0%';

    // Connect Server-Sent Events (SSE)
    if (eventSource) {
      eventSource.close();
    }
    eventSource = new EventSource(`/api/progress/${sessionId}`);

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
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          fps: selectedFps,
          resolution: resSelect.value,
          aspectMode: aspectSelect.value,
          format: formatSelect.value,
          quality: qualitySelect.value
        })
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
