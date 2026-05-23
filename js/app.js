/**
 * app.js — Main Application Orchestrator
 * Manages UI states, file handling, and coordinates Scanner + Corners modules.
 */

const App = (() => {
  'use strict';

  // ======== State ========
  let currentState = 'upload'; // 'upload' | 'editor' | 'result'
  let originalImage = null;    // HTMLImageElement
  let originalMat = null;      // cv.Mat of the original image
  let warpedMat = null;        // cv.Mat of the warped result
  let currentFilter = 'bw';
  let opencvReady = false;

  // ======== DOM Elements ========
  const dom = {};

  function cacheDom() {
    dom.uploadZone = document.getElementById('upload-zone');
    dom.editorZone = document.getElementById('editor-zone');
    dom.resultZone = document.getElementById('result-zone');
    dom.controlsBar = document.getElementById('controls-bar');
    dom.editorControls = document.getElementById('editor-controls');
    dom.resultControls = document.getElementById('result-controls');
    dom.fileInput = document.getElementById('file-input');
    dom.btnSelectFile = document.getElementById('btn-select-file');
    dom.btnCancel = document.getElementById('btn-cancel');
    dom.btnScan = document.getElementById('btn-scan');
    dom.btnReadjust = document.getElementById('btn-readjust');
    dom.btnDownload = document.getElementById('btn-download');
    dom.btnNewScan = document.getElementById('btn-new-scan');
    dom.canvasInput = document.getElementById('canvasInput');
    dom.canvasOverlay = document.getElementById('canvasOverlay');
    dom.canvasOutput = document.getElementById('canvasOutput');
    dom.canvasWrapper = document.getElementById('canvas-wrapper');
    dom.opencvLoader = document.getElementById('opencv-loader');
    dom.toastContainer = document.getElementById('toast-container');
    dom.filterSelector = document.getElementById('filter-selector');
    dom.filterBtns = document.querySelectorAll('.filter-option');
  }

  // ======== Initialization ========

  function init() {
    cacheDom();
    bindEvents();

    // Check if OpenCV was already loaded before app.js
    if (window._opencvReady || (typeof cv !== 'undefined' && cv.Mat)) {
      onOpenCvReady();
    }
  }

  function onOpenCvReady() {
    opencvReady = true;
    // Fade out the loader
    dom.opencvLoader.classList.add('hidden');
    showToast('Motor de visión listo', 'success');
    console.log('[App] OpenCV ready, version:', cv.getBuildInformation ? 'available' : 'loaded');
  }

  // ======== Event Binding ========

  function bindEvents() {
    // File selection
    dom.btnSelectFile.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.fileInput.click();
    });

    dom.uploadZone.addEventListener('click', () => {
      dom.fileInput.click();
    });

    dom.fileInput.addEventListener('change', handleFileSelect);

    // Drag & drop
    dom.uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dom.uploadZone.classList.add('drag-over');
    });

    dom.uploadZone.addEventListener('dragleave', () => {
      dom.uploadZone.classList.remove('drag-over');
    });

    dom.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dom.uploadZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        loadImage(file);
      } else {
        showToast('Por favor, selecciona una imagen válida', 'warning');
      }
    });

    // Action buttons
    dom.btnCancel.addEventListener('click', goToUpload);
    dom.btnScan.addEventListener('click', performScan);
    dom.btnReadjust.addEventListener('click', goToEditor);
    dom.btnDownload.addEventListener('click', downloadResult);
    dom.btnNewScan.addEventListener('click', goToUpload);

    // Filter buttons
    dom.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        if (filter === currentFilter) return;
        currentFilter = filter;
        dom.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyCurrentFilter();
      });
    });
  }

  // ======== File Handling ========

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Formato de archivo no soportado', 'error');
      return;
    }

    loadImage(file);
    // Reset input so same file can be re-selected
    dom.fileInput.value = '';
  }

  function loadImage(file) {
    if (!opencvReady) {
      showToast('Espera a que se cargue el motor de visión', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        goToEditor();
      };
      img.onerror = () => {
        showToast('Error al cargar la imagen', 'error');
      };
      img.src = e.target.result;
    };
    reader.onerror = () => {
      showToast('Error al leer el archivo', 'error');
    };
    reader.readAsDataURL(file);
  }

  // ======== State Management ========

  function setState(state) {
    currentState = state;

    // Hide all zones
    dom.uploadZone.classList.add('hidden');
    dom.editorZone.classList.add('hidden');
    dom.resultZone.classList.add('hidden');
    dom.controlsBar.classList.add('hidden');
    dom.editorControls.classList.add('hidden');
    dom.resultControls.classList.add('hidden');

    switch (state) {
      case 'upload':
        dom.uploadZone.classList.remove('hidden');
        break;

      case 'editor':
        dom.editorZone.classList.remove('hidden');
        dom.controlsBar.classList.remove('hidden');
        dom.editorControls.classList.remove('hidden');
        break;

      case 'result':
        dom.resultZone.classList.remove('hidden');
        dom.controlsBar.classList.remove('hidden');
        dom.resultControls.classList.remove('hidden');
        break;
    }
  }

  function goToUpload() {
    cleanupMats();
    Corners.destroy();
    originalImage = null;
    currentFilter = 'bw';

    // Reset filter buttons
    dom.filterBtns.forEach(b => b.classList.remove('active'));
    document.getElementById('filter-bw').classList.add('active');

    setState('upload');
  }

  function goToEditor() {
    // Clean up previous warped result
    if (warpedMat) {
      warpedMat.delete();
      warpedMat = null;
    }

    setState('editor');
    setupEditor();
  }

  // ======== Editor ========

  function setupEditor() {
    if (!originalImage) return;

    const img = originalImage;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;

    // Calculate display size (fit within container)
    const wrapper = dom.canvasWrapper;
    const maxDisplayWidth = wrapper.clientWidth;
    const scale = Math.min(maxDisplayWidth / imgW, 1);
    const displayW = Math.round(imgW * scale);
    const displayH = Math.round(imgH * scale);

    // Setup input canvas
    dom.canvasInput.width = displayW;
    dom.canvasInput.height = displayH;
    const ctxInput = dom.canvasInput.getContext('2d');
    ctxInput.drawImage(img, 0, 0, displayW, displayH);

    // Read original image into OpenCV Mat (at full resolution)
    // We create a temporary canvas at full resolution for the Mat
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imgW;
    tempCanvas.height = imgH;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0, imgW, imgH);

    if (originalMat) originalMat.delete();
    originalMat = cv.imread(tempCanvas);

    // Detect edges on a downscaled version for speed
    let detectedPoints = null;
    try {
      const detectMat = cv.imread(dom.canvasInput);
      const result = Scanner.detectEdges(detectMat);
      if (result && result.points) {
        // Scale detected points back to original image coords
        detectedPoints = result.points.map(p => ({
          x: p.x * (imgW / displayW),
          y: p.y * (imgH / displayH)
        }));
        showToast('Documento detectado automáticamente', 'success');
      } else {
        showToast('No se detectó documento. Ajusta las esquinas manualmente.', 'info');
      }
      detectMat.delete();
    } catch (err) {
      console.warn('[App] Edge detection error:', err);
      showToast('Ajusta las esquinas manualmente', 'info');
    }

    // Initialize corner handles
    Corners.init(
      dom.canvasOverlay,
      detectedPoints,
      displayW,
      displayH,
      imgW,
      imgH
    );
  }

  // ======== Scanning ========

  function performScan() {
    if (!originalMat) {
      showToast('No hay imagen cargada', 'error');
      return;
    }

    try {
      const cornerPoints = Corners.getPoints();

      // Warp perspective
      if (warpedMat) warpedMat.delete();
      warpedMat = Scanner.warpPerspective(originalMat, cornerPoints);

      // Apply filter and show result
      currentFilter = 'bw';
      dom.filterBtns.forEach(b => b.classList.remove('active'));
      document.getElementById('filter-bw').classList.add('active');

      applyCurrentFilter();

      Corners.destroy();
      setState('result');
      showToast('¡Escaneo completado!', 'success');
    } catch (err) {
      console.error('[App] Scan error:', err);
      showToast('Error al escanear. Intenta ajustar las esquinas.', 'error');
    }
  }

  function applyCurrentFilter() {
    if (!warpedMat) return;

    try {
      const filtered = Scanner.applyFilter(warpedMat, currentFilter);
      Scanner.drawToCanvas(filtered, dom.canvasOutput);
      filtered.delete();
    } catch (err) {
      console.error('[App] Filter error:', err);
      showToast('Error al aplicar filtro', 'error');
    }
  }

  // ======== Download ========

  function downloadResult() {
    try {
      const dataUrl = Scanner.exportImage(dom.canvasOutput, 'png');
      const link = document.createElement('a');
      link.download = `pablito-leans-scan-${Date.now()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Imagen descargada', 'success');
    } catch (err) {
      console.error('[App] Download error:', err);
      showToast('Error al descargar', 'error');
    }
  }

  // ======== Cleanup ========

  function cleanupMats() {
    if (originalMat) {
      originalMat.delete();
      originalMat = null;
    }
    if (warpedMat) {
      warpedMat.delete();
      warpedMat = null;
    }
  }

  // ======== Toast System ========

  function showToast(message, type = 'info') {
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <span class="toast__icon">${icons[type] || icons.info}</span>
      <span>${message}</span>
    `;

    dom.toastContainer.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
  }

  // ======== Public API ========

  return {
    init,
    onOpenCvReady
  };
})();

// Boot the application
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

// Expose to global scope for OpenCV callback
window.App = App;
