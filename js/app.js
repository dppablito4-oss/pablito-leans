/**
 * app.js — Main Application Orchestrator
 * Manages UI states, multi-page scanning, bulk upload, re-adjusting, and D&D reordering.
 */

const App = (() => {
  'use strict';

  // ======== State ========
  let currentState = 'upload'; // 'upload' | 'editor' | 'result'
  let originalImage = null;    // HTMLImageElement
  let originalMat = null;      // cv.Mat of the original image
  let warpedMat = null;        // cv.Mat of the warped result (current page being edited)
  let currentFilter = 'color';
  let opencvReady = false;

  // Multi-page state
  // Each page: { originalDataUrl, corners, warpedDataUrl, dataUrl, width, height, filter }
  let scannedPages = [];
  let activePageIndex = -1;
  let isReAdjusting = false; // Flag to know if we are overriding an existing page

  // Bulk processing state
  let bulkQueue = [];
  let isProcessingBulk = false;

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
    dom.btnDownloadPdf = document.getElementById('btn-download-pdf');
    dom.btnNewScan = document.getElementById('btn-new-scan');
    dom.btnAddPage = document.getElementById('btn-add-page');
    dom.btnDeletePage = document.getElementById('btn-delete-page');
    dom.canvasInput = document.getElementById('canvasInput');
    dom.canvasOverlay = document.getElementById('canvasOverlay');
    dom.canvasOutput = document.getElementById('canvasOutput');
    dom.canvasWrapper = document.getElementById('canvas-wrapper');
    dom.opencvLoader = document.getElementById('opencv-loader');
    dom.toastContainer = document.getElementById('toast-container');
    dom.filterSelector = document.getElementById('filter-selector');
    dom.filterBtns = document.querySelectorAll('.filter-option');
    dom.pagesStrip = document.getElementById('pages-strip');
    dom.pagesStripList = document.getElementById('pages-strip-list');
    dom.pageCounter = document.getElementById('page-counter');
  }

  // ======== Initialization ========

  function init() {
    cacheDom();
    bindEvents();

    if (window._opencvReady || (typeof cv !== 'undefined' && cv.Mat)) {
      onOpenCvReady();
    }
  }

  function onOpenCvReady() {
    opencvReady = true;
    dom.opencvLoader.classList.add('hidden');
    showToast('Motor de visión listo', 'success');
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
      handleFiles(e.dataTransfer.files);
    });

    // Action buttons
    dom.btnCancel.addEventListener('click', handleCancel);
    dom.btnScan.addEventListener('click', performScan);
    dom.btnReadjust.addEventListener('click', startReAdjust);
    dom.btnDownload.addEventListener('click', downloadAllImages);
    dom.btnDownloadPdf.addEventListener('click', downloadPdf);
    dom.btnNewScan.addEventListener('click', goToUpload);
    dom.btnAddPage.addEventListener('click', addAnotherPage);
    dom.btnDeletePage.addEventListener('click', deleteActivePage);

    // Filter buttons
    dom.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        if (filter === currentFilter) return;
        currentFilter = filter;
        dom.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        reapplyFilterToActivePage();
      });
    });
  }

  // ======== File Handling (Bulk & Single) ========

  function handleFileSelect(e) {
    handleFiles(e.target.files);
    dom.fileInput.value = '';
  }

  function handleFiles(files) {
    if (!opencvReady) {
      showToast('Espera a que se cargue el motor de visión', 'warning');
      return;
    }
    
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    if (validFiles.length === 0) {
      showToast('No se encontraron imágenes válidas', 'error');
      return;
    }

    if (validFiles.length === 1) {
      // Single file -> go to editor
      isReAdjusting = false;
      loadSingleImageToEditor(validFiles[0]);
    } else {
      // Multiple files -> bulk auto-scan
      bulkQueue = validFiles;
      isProcessingBulk = true;
      processBulkQueue();
    }
  }

  function loadSingleImageToEditor(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        // The original image DataUrl will be grabbed from img.src when saving the page
        goToEditor();
      };
      img.onerror = () => showToast('Error al cargar la imagen', 'error');
      img.src = e.target.result;
    };
    reader.onerror = () => showToast('Error al leer el archivo', 'error');
    reader.readAsDataURL(file);
  }

  // ======== Bulk Processing ========

  async function processBulkQueue() {
    if (bulkQueue.length === 0) {
      isProcessingBulk = false;
      showToast('Carga múltiple completada', 'success');
      activePageIndex = scannedPages.length - 1;
      renderPagesStrip();
      updatePageCounter();
      setState('result');
      return;
    }

    const file = bulkQueue.shift();
    const remaining = bulkQueue.length;
    showToast(`Procesando imagen... (${remaining} restantes)`, 'info');

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        autoScanImage(img);
        // Process next using setTimeout to not block UI completely
        setTimeout(processBulkQueue, 100);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function autoScanImage(img) {
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imgW;
    tempCanvas.height = imgH;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, imgW, imgH);

    const originalDataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);
    const mat = cv.imread(tempCanvas);

    let detectedPoints = null;
    try {
      // Downscale for faster detection
      const scale = Math.min(600 / imgW, 1);
      const displayW = Math.round(imgW * scale);
      const displayH = Math.round(imgH * scale);
      
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = displayW;
      smallCanvas.height = displayH;
      const smallCtx = smallCanvas.getContext('2d');
      smallCtx.drawImage(img, 0, 0, displayW, displayH);
      
      const detectMat = cv.imread(smallCanvas);
      const result = Scanner.detectEdges(detectMat);
      
      if (result && result.points) {
        detectedPoints = result.points.map(p => ({
          x: p.x * (imgW / displayW),
          y: p.y * (imgH / displayH)
        }));
      }
      detectMat.delete();
    } catch(e) {}

    // Fallback to full image corners if no detection
    if (!detectedPoints) {
      detectedPoints = [
        {x: 0, y: 0},
        {x: imgW, y: 0},
        {x: imgW, y: imgH},
        {x: 0, y: imgH}
      ];
    }

    const warped = Scanner.warpPerspective(mat, detectedPoints);
    const filtered = Scanner.applyFilter(warped, 'color');

    // Create a temporary canvas for output
    const outCanvas = document.createElement('canvas');
    Scanner.drawToCanvas(filtered, outCanvas);

    const warpCanvas = document.createElement('canvas');
    warpCanvas.width = warped.cols;
    warpCanvas.height = warped.rows;
    cv.imshow(warpCanvas, warped);

    scannedPages.push({
      originalDataUrl,
      corners: detectedPoints,
      warpedDataUrl: warpCanvas.toDataURL('image/png'),
      dataUrl: outCanvas.toDataURL('image/png'),
      width: outCanvas.width,
      height: outCanvas.height,
      filter: 'color'
    });

    mat.delete();
    warped.delete();
    filtered.delete();
  }

  // ======== State Management ========

  function setState(state) {
    currentState = state;

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
    scannedPages = [];
    activePageIndex = -1;
    resetFilterUI();
    renderPagesStrip();
    setState('upload');
  }

  function handleCancel() {
    isReAdjusting = false;
    if (scannedPages.length > 0) {
      cleanupMats();
      Corners.destroy();
      originalImage = null;
      showActivePage();
      setState('result');
    } else {
      goToUpload();
    }
  }

  function goToEditor(predefinedCorners = null) {
    if (warpedMat) {
      warpedMat.delete();
      warpedMat = null;
    }

    setState('editor');
    setupEditor(predefinedCorners);
  }

  // ======== Editor ========

  function setupEditor(predefinedCorners = null) {
    if (!originalImage) return;

    const img = originalImage;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;

    const wrapper = dom.canvasWrapper;
    const maxDisplayWidth = wrapper.clientWidth;
    const scale = Math.min(maxDisplayWidth / imgW, 1);
    const displayW = Math.round(imgW * scale);
    const displayH = Math.round(imgH * scale);

    dom.canvasInput.width = displayW;
    dom.canvasInput.height = displayH;
    const ctxInput = dom.canvasInput.getContext('2d');
    ctxInput.drawImage(img, 0, 0, displayW, displayH);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imgW;
    tempCanvas.height = imgH;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0, imgW, imgH);

    if (originalMat) originalMat.delete();
    originalMat = cv.imread(tempCanvas);

    let detectedPoints = predefinedCorners;

    // Only run detection if we don't have predefined corners
    if (!detectedPoints) {
      try {
        const detectMat = cv.imread(dom.canvasInput);
        const result = Scanner.detectEdges(detectMat);
        if (result && result.points) {
          detectedPoints = result.points.map(p => ({
            x: p.x * (imgW / displayW),
            y: p.y * (imgH / displayH)
          }));
          showToast('Documento detectado automáticamente', 'success');
        } else {
          showToast('No se detectó documento. Ajusta las esquinas.', 'info');
        }
        detectMat.delete();
      } catch (err) {
        showToast('Ajusta las esquinas manualmente', 'info');
      }
    }

    Corners.init(
      dom.canvasOverlay,
      detectedPoints,
      displayW,
      displayH,
      imgW,
      imgH
    );
  }

  // ======== Re-adjust ========

  function startReAdjust() {
    if (activePageIndex < 0 || activePageIndex >= scannedPages.length) return;
    
    const page = scannedPages[activePageIndex];
    if (!page.originalDataUrl) {
      showToast('No se puede re-ajustar, falta imagen original', 'error');
      return;
    }

    isReAdjusting = true;

    const img = new Image();
    img.onload = () => {
      originalImage = img;
      goToEditor(page.corners);
    };
    img.src = page.originalDataUrl;
  }

  // ======== Scanning ========

  function performScan() {
    if (!originalMat) {
      showToast('No hay imagen cargada', 'error');
      return;
    }

    try {
      const cornerPoints = Corners.getPoints();

      if (warpedMat) warpedMat.delete();
      warpedMat = Scanner.warpPerspective(originalMat, cornerPoints);

      const targetFilter = isReAdjusting ? scannedPages[activePageIndex].filter : 'color';
      
      const filtered = Scanner.applyFilter(warpedMat, targetFilter);
      Scanner.drawToCanvas(filtered, dom.canvasOutput);

      const warpCanvas = document.createElement('canvas');
      warpCanvas.width = warpedMat.cols;
      warpCanvas.height = warpedMat.rows;
      cv.imshow(warpCanvas, warpedMat);

      const pageData = {
        originalDataUrl: originalImage.src,
        corners: cornerPoints,
        warpedDataUrl: warpCanvas.toDataURL('image/png'),
        dataUrl: dom.canvasOutput.toDataURL('image/png'),
        width: dom.canvasOutput.width,
        height: dom.canvasOutput.height,
        filter: targetFilter
      };

      if (isReAdjusting) {
        scannedPages[activePageIndex] = pageData;
        showToast('Ajuste guardado', 'success');
      } else {
        scannedPages.push(pageData);
        activePageIndex = scannedPages.length - 1;
        showToast(`¡Página escaneada!`, 'success');
      }

      isReAdjusting = false;
      filtered.delete();
      Corners.destroy();
      cleanupMats();
      originalImage = null;

      renderPagesStrip();
      showActivePage(); // Also updates counter and filter UI
      setState('result');

    } catch (err) {
      console.error('[App] Scan error:', err);
      showToast('Error al escanear. Intenta ajustar las esquinas.', 'error');
    }
  }

  // ======== Re-apply filter to active page ========

  function reapplyFilterToActivePage() {
    if (activePageIndex < 0 || activePageIndex >= scannedPages.length) return;

    const page = scannedPages[activePageIndex];

    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.naturalWidth;
      tempCanvas.height = img.naturalHeight;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const mat = cv.imread(tempCanvas);
      try {
        const filtered = Scanner.applyFilter(mat, currentFilter);
        Scanner.drawToCanvas(filtered, dom.canvasOutput);

        page.dataUrl = dom.canvasOutput.toDataURL('image/png');
        page.width = dom.canvasOutput.width;
        page.height = dom.canvasOutput.height;
        page.filter = currentFilter;

        filtered.delete();
        renderPagesStrip();
      } catch (err) {
        console.error('[App] Re-filter error:', err);
        showToast('Error al aplicar filtro', 'error');
      }
      mat.delete();
    };
    img.src = page.warpedDataUrl;
  }

  // ======== Multi-page Navigation ========

  function addAnotherPage() {
    isReAdjusting = false;
    dom.fileInput.click();
  }

  function deleteActivePage() {
    if (activePageIndex < 0 || scannedPages.length === 0) return;

    scannedPages.splice(activePageIndex, 1);

    if (scannedPages.length === 0) {
      goToUpload();
      showToast('Todas las páginas eliminadas', 'info');
      return;
    }

    if (activePageIndex >= scannedPages.length) {
      activePageIndex = scannedPages.length - 1;
    }

    showActivePage();
    renderPagesStrip();
    showToast('Página eliminada', 'info');
  }

  function showActivePage() {
    if (activePageIndex < 0 || activePageIndex >= scannedPages.length) return;

    const page = scannedPages[activePageIndex];

    const img = new Image();
    img.onload = () => {
      dom.canvasOutput.width = img.naturalWidth;
      dom.canvasOutput.height = img.naturalHeight;
      const ctx = dom.canvasOutput.getContext('2d');
      ctx.drawImage(img, 0, 0);

      currentFilter = page.filter;
      dom.filterBtns.forEach(b => b.classList.remove('active'));
      const activeBtn = document.querySelector(`[data-filter="${page.filter}"]`);
      if (activeBtn) activeBtn.classList.add('active');
    };
    img.src = page.dataUrl;

    updatePageCounter();
    highlightActiveThumb();
  }

  function selectPage(index) {
    if (index < 0 || index >= scannedPages.length) return;
    activePageIndex = index;
    showActivePage();
  }

  // ======== Drag & Drop Reordering (Pages Strip) ========

  let draggedItemIndex = null;

  function renderPagesStrip() {
    if (!dom.pagesStripList) return;

    dom.pagesStripList.innerHTML = '';

    if (scannedPages.length === 0) {
      dom.pagesStrip.classList.add('hidden');
      return;
    }

    dom.pagesStrip.classList.remove('hidden');

    scannedPages.forEach((page, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb' + (i === activePageIndex ? ' active' : '');
      thumb.title = `Página ${i + 1}`;
      thumb.setAttribute('draggable', 'true');
      thumb.dataset.index = i;

      const img = document.createElement('img');
      img.src = page.dataUrl;
      img.alt = `Página ${i + 1}`;
      img.draggable = false;

      const label = document.createElement('span');
      label.className = 'page-thumb__label';
      label.textContent = i + 1;

      thumb.appendChild(img);
      thumb.appendChild(label);

      // Select page on click
      thumb.addEventListener('click', () => selectPage(i));

      // Drag and Drop events
      thumb.addEventListener('dragstart', handleDragStart);
      thumb.addEventListener('dragover', handleDragOver);
      thumb.addEventListener('dragleave', handleDragLeave);
      thumb.addEventListener('drop', handleDrop);
      thumb.addEventListener('dragend', handleDragEnd);

      dom.pagesStripList.appendChild(thumb);
    });

    highlightActiveThumb();
  }

  function handleDragStart(e) {
    draggedItemIndex = parseInt(this.dataset.index);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedItemIndex); // Firefox requires data to be set
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this.dataset.index != draggedItemIndex) {
      this.classList.add('drag-over');
    }
    return false;
  }

  function handleDragLeave(e) {
    this.classList.remove('drag-over');
  }

  function handleDrop(e) {
    e.stopPropagation();
    this.classList.remove('drag-over');
    
    const targetIndex = parseInt(this.dataset.index);
    if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
      // Reorder array
      const itemToMove = scannedPages.splice(draggedItemIndex, 1)[0];
      scannedPages.splice(targetIndex, 0, itemToMove);
      
      // Update activePageIndex if needed
      if (activePageIndex === draggedItemIndex) {
        activePageIndex = targetIndex;
      } else if (activePageIndex > draggedItemIndex && activePageIndex <= targetIndex) {
        activePageIndex--;
      } else if (activePageIndex < draggedItemIndex && activePageIndex >= targetIndex) {
        activePageIndex++;
      }

      renderPagesStrip();
      updatePageCounter();
      showToast('Páginas reordenadas', 'success');
    }
    return false;
  }

  function handleDragEnd(e) {
    this.classList.remove('dragging');
    const thumbs = dom.pagesStripList.querySelectorAll('.page-thumb');
    thumbs.forEach(t => t.classList.remove('drag-over'));
  }

  function highlightActiveThumb() {
    if (!dom.pagesStripList) return;
    const thumbs = dom.pagesStripList.querySelectorAll('.page-thumb');
    thumbs.forEach((t, i) => {
      t.classList.toggle('active', i === activePageIndex);
    });
    const activeThumb = dom.pagesStripList.querySelector('.page-thumb.active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  function updatePageCounter() {
    if (dom.pageCounter) {
      if (scannedPages.length > 0) {
        dom.pageCounter.textContent = `${activePageIndex + 1} / ${scannedPages.length}`;
        dom.pageCounter.classList.remove('hidden');
      } else {
        dom.pageCounter.classList.add('hidden');
      }
    }
  }

  function resetFilterUI() {
    currentFilter = 'color';
    dom.filterBtns.forEach(b => b.classList.remove('active'));
    document.getElementById('filter-color').classList.add('active');
  }

  // ======== Download ========

  function downloadAllImages() {
    if (scannedPages.length === 0) {
      showToast('No hay páginas para descargar', 'warning');
      return;
    }

    try {
      if (scannedPages.length === 1) {
        const link = document.createElement('a');
        link.download = `pablito-leans-scan-${Date.now()}.png`;
        link.href = scannedPages[0].dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Imagen descargada', 'success');
      } else {
        scannedPages.forEach((page, i) => {
          setTimeout(() => {
            const link = document.createElement('a');
            link.download = `pablito-leans-pag${i + 1}-${Date.now()}.png`;
            link.href = page.dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }, i * 300);
        });
        showToast(`Descargando ${scannedPages.length} imágenes…`, 'success');
      }
    } catch (err) {
      showToast('Error al descargar', 'error');
    }
  }

  function downloadPdf() {
    if (scannedPages.length === 0) {
      showToast('No hay páginas para exportar', 'warning');
      return;
    }

    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
      showToast('Cargando librería PDF…', 'info');
      const script = document.createElement('script');
      // Changed CDN version to 2.5.1 since 2.5.2 was returning 404
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload = () => generatePdf();
      script.onerror = () => showToast('Error al cargar la librería PDF', 'error');
      document.head.appendChild(script);
      return;
    }

    generatePdf();
  }

  function generatePdf() {
    try {
      const { jsPDF } = window.jspdf;
      const firstPage = scannedPages[0];
      const isLandscape = firstPage.width > firstPage.height;

      const pdf = new jsPDF({
        orientation: isLandscape ? 'landscape' : 'portrait',
        unit: 'px',
        format: [firstPage.width, firstPage.height],
        hotfixes: ['px_scaling']
      });

      scannedPages.forEach((page, i) => {
        if (i > 0) {
          const pageLandscape = page.width > page.height;
          pdf.addPage([page.width, page.height], pageLandscape ? 'landscape' : 'portrait');
        }

        pdf.addImage(
          page.dataUrl,
          'PNG',
          0, 0,
          page.width,
          page.height
        );
      });

      pdf.save(`pablito-leans-${scannedPages.length}pag-${Date.now()}.pdf`);
      showToast(`PDF con ${scannedPages.length} página(s) descargado`, 'success');
    } catch (err) {
      console.error('[App] PDF generation error:', err);
      showToast('Error al generar PDF', 'error');
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

// Boot
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

window.App = App;
