/**
 * app.js — Main Application Orchestrator
 * Manages UI states, multi-page scanning, bulk upload, re-adjusting, D&D reordering,
 * and document tabs (max 3 simultaneous documents).
 */

import { Scanner } from './scanner.js';
import { Corners } from './corners.js';

const App = (() => {
  'use strict';

  // ======== Constants ========
  const MAX_TABS = 3;
  let tabIdCounter = 0;

  // ======== State ========
  let opencvReady = false;

  // Tab-based state: each tab is an independent document workspace
  let tabs = [];
  let activeTabIndex = 0;

  // Transient state (not saved per tab, only used during active editing)
  let originalImage = null;
  let originalMat = null;
  let warpedMat = null;

  // Bulk processing state
  let bulkQueue = [];
  let isProcessingBulk = false;

  function createTabData(name) {
    return {
      id: ++tabIdCounter,
      name: name || `Documento ${tabIdCounter}`,
      state: 'upload',
      scannedPages: [],
      activePageIndex: -1,
      currentFilter: 'color',
      originalImageDataUrl: null,
      isReAdjusting: false,
      corners: null
    };
  }

  function currentTab() {
    return tabs[activeTabIndex];
  }

  // ======== DOM Elements ========
  const dom = {};

  function cacheDom() {
    dom.uploadZone = document.getElementById('upload-zone');
    dom.editorZone = document.getElementById('editor-zone');
    dom.resultZone = document.getElementById('result-zone');
    dom.editorControls = document.getElementById('editor-controls');
    dom.resultControls = document.getElementById('result-controls');
    dom.fileInput = document.getElementById('file-input');
    dom.btnSelectFile = document.getElementById('btn-select-file');
    dom.btnCancel = document.getElementById('btn-cancel');
    dom.btnScan = document.getElementById('btn-scan');
    dom.btnRotate = document.getElementById('btn-rotate');
    dom.btnEditorPrev = document.getElementById('btn-editor-prev');
    dom.btnEditorNext = document.getElementById('btn-editor-next');
    dom.editorPageCounter = document.getElementById('editor-page-counter');
    dom.btnReadjust = document.getElementById('btn-readjust');
    dom.btnApplyAll = document.getElementById('btn-apply-all');
    dom.btnDownload = document.getElementById('btn-download');
    dom.btnDownloadPdf = document.getElementById('btn-download-pdf');
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
    // Tabs
    dom.tabsBar = document.getElementById('tabs-bar');
    dom.tabsList = document.getElementById('tabs-list');
    dom.btnAddTab = document.getElementById('btn-add-tab');
    
    // PDF Modal
    dom.pdfModal = document.getElementById('pdf-modal-overlay');
    dom.btnPdfClose = document.getElementById('pdf-modal-close');
    dom.btnPdfCancel = document.getElementById('pdf-modal-cancel');
    dom.btnPdfConfirm = document.getElementById('pdf-modal-confirm');
    dom.pdfPageRange = document.getElementById('pdf-page-range');
    dom.pdfPageSize = document.getElementById('pdf-page-size');
    dom.pdfFitOptions = document.querySelectorAll('input[name="pdf-fit"]');
    dom.pdfOrientationOptions = document.querySelectorAll('input[name="pdf-orientation"]');

    // Manual Adjustments
    dom.manualAdjustments = document.getElementById('manual-adjustments');
    dom.adjBgClean = document.getElementById('adj-bg-clean');
    dom.adjSaturation = document.getElementById('adj-saturation');
  }

  // ======== Initialization ========

  function init() {
    cacheDom();
    bindEvents();

    window.addEventListener('beforeunload', (e) => {
      const hasPages = tabs.some(tab => tab.scannedPages.length > 0);
      if (hasPages) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Create the first tab
    tabs.push(createTabData());
    activeTabIndex = 0;
    renderTabsBar();

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
    dom.btnScan.addEventListener('click', () => performScan('result'));
    dom.btnRotate.addEventListener('click', rotateEditorImage);
    dom.btnEditorPrev.addEventListener('click', () => navigateEditor(-1));
    dom.btnEditorNext.addEventListener('click', () => navigateEditor(1));
    dom.btnReadjust.addEventListener('click', startReAdjust);
    dom.btnApplyAll.addEventListener('click', applyFilterToAllPages);
    dom.btnDownload.addEventListener('click', downloadAllImages);
    dom.btnDownloadPdf.addEventListener('click', downloadPdf);
    dom.btnAddPage.addEventListener('click', addAnotherPage);
    dom.btnDeletePage.addEventListener('click', deleteActivePage);

    // PDF Modal
    if (dom.btnPdfClose) dom.btnPdfClose.addEventListener('click', closePdfModal);
    if (dom.btnPdfCancel) dom.btnPdfCancel.addEventListener('click', closePdfModal);
    if (dom.btnPdfConfirm) dom.btnPdfConfirm.addEventListener('click', confirmPdfExport);

    // Tab controls
    dom.btnAddTab.addEventListener('click', addNewTab);

    // Filter buttons
    dom.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = currentTab();
        const filter = btn.dataset.filter;
        if (filter === tab.currentFilter) return;
        tab.currentFilter = filter;
        dom.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        reapplyFilterToActivePage();
      });
    });

    // Sliders
    if (dom.adjBgClean) {
      dom.adjBgClean.addEventListener('change', reapplyFilterToActivePage);
    }
    if (dom.adjSaturation) {
      dom.adjSaturation.addEventListener('change', reapplyFilterToActivePage);
    }
  }

  // ======== Tab Management ========

  function addNewTab() {
    if (tabs.length >= MAX_TABS) {
      showToast(`Máximo ${MAX_TABS} documentos simultáneos`, 'warning');
      return;
    }

    // Save current transient state before switching
    saveTransientState();

    const newTab = createTabData();
    tabs.push(newTab);
    activeTabIndex = tabs.length - 1;

    // Clean up transient state for the new tab
    cleanupMats();
    originalImage = null;
    Corners.destroy();

    renderTabsBar();
    restoreTabView();
    showToast(`${newTab.name} creado`, 'success');
  }

  function switchTab(index) {
    if (index === activeTabIndex) return;
    if (index < 0 || index >= tabs.length) return;

    // Save current state
    saveTransientState();
    cleanupMats();
    originalImage = null;
    Corners.destroy();

    activeTabIndex = index;
    renderTabsBar();
    restoreTabView();
  }

  function closeTab(index) {
    if (index < 0 || index >= tabs.length) return;

    const tab = tabs[index];

    // If the tab has scanned pages, ask for confirmation
    if (tab.scannedPages.length > 0) {
      showCloseConfirmation(index);
      return;
    }

    // Otherwise close directly
    doCloseTab(index);
  }

  function doCloseTab(index) {
    const closingName = tabs[index].name;
    tabs.splice(index, 1);

    // Always keep at least 1 tab
    if (tabs.length === 0) {
      tabs.push(createTabData());
      activeTabIndex = 0;
    } else if (activeTabIndex >= tabs.length) {
      activeTabIndex = tabs.length - 1;
    } else if (index < activeTabIndex) {
      activeTabIndex--;
    } else if (index === activeTabIndex) {
      // We closed the active tab, switch to clamped index
      activeTabIndex = Math.min(activeTabIndex, tabs.length - 1);
    }

    cleanupMats();
    originalImage = null;
    Corners.destroy();

    renderTabsBar();
    restoreTabView();
    showToast(`${closingName} cerrado`, 'info');
  }

  function showCloseConfirmation(tabIndex) {
    const tab = tabs[tabIndex];
    const overlay = document.createElement('div');
    overlay.className = 'tab-confirm-overlay';
    overlay.innerHTML = `
      <div class="tab-confirm-dialog">
        <h3>¿Cerrar "${tab.name}"?</h3>
        <p>Se perderán ${tab.scannedPages.length} página(s) escaneada(s).</p>
        <div class="tab-confirm-actions">
          <button class="btn btn-secondary" id="tab-confirm-cancel">Cancelar</button>
          <button class="btn btn-danger" id="tab-confirm-close">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#tab-confirm-cancel').addEventListener('click', () => {
      overlay.remove();
    });
    overlay.querySelector('#tab-confirm-close').addEventListener('click', () => {
      overlay.remove();
      doCloseTab(tabIndex);
    });
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  function saveTransientState() {
    // Save the current tab's visual state. No cv.Mat objects are saved.
    const tab = currentTab();
    if (!tab) return;
    // State (upload/editor/result) is already tracked in tab.state via setState
    // scannedPages, activePageIndex, currentFilter are already on the tab
    // originalImageDataUrl is saved when entering editor
  }

  function restoreTabView() {
    const tab = currentTab();
    if (!tab) return;

    // Restore UI state for this tab
    setState(tab.state);

    if (tab.state === 'result' && tab.scannedPages.length > 0) {
      if (tab.activePageIndex < 0) tab.activePageIndex = 0;
      showActivePage();
      renderPagesStrip();
    } else if (tab.state === 'editor' && tab.originalImageDataUrl) {
      // Reload the image into the editor
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        setupEditor(tab.corners);
      };
      img.src = tab.originalImageDataUrl;
    } else {
      // Upload state — reset visual
      resetFilterUI();
      renderPagesStrip();
    }
  }

  function renderTabsBar() {
    dom.tabsList.innerHTML = '';

    tabs.forEach((tab, i) => {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab' + (i === activeTabIndex ? ' active' : '');
      tabEl.dataset.index = i;

      const hasPages = tab.scannedPages.length > 0;

      tabEl.innerHTML = `
        <span class="tab__status ${hasPages ? 'tab__status--has-pages' : 'tab__status--empty'}"></span>
        <span class="tab__name">${tab.name}</span>
        <span class="tab__close" title="Cerrar">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </span>
      `;

      // Click on tab to switch
      tabEl.addEventListener('click', (e) => {
        if (e.target.closest('.tab__close')) return;
        switchTab(i);
      });

      // Click on close button
      const closeBtn = tabEl.querySelector('.tab__close');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(i);
      });

      dom.tabsList.appendChild(tabEl);
    });

    // Show/hide add button based on max tabs
    dom.btnAddTab.style.display = tabs.length >= MAX_TABS ? 'none' : 'flex';
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

    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    
    if (validFiles.length === 0) {
      showToast('No se encontraron imágenes o PDFs válidos', 'error');
      return;
    }

    if (validFiles.length === 1 && validFiles[0].type === 'application/pdf') {
      currentTab().isReAdjusting = false;
      processPdf(validFiles[0]);
    } else if (validFiles.length === 1) {
      currentTab().isReAdjusting = false;
      loadSingleImageToEditor(validFiles[0]);
    } else {
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
        currentTab().originalImageDataUrl = img.src;
        goToEditor();
      };
      img.onerror = () => showToast('Error al cargar la imagen', 'error');
      img.src = e.target.result;
    };
    reader.onerror = () => showToast('Error al leer el archivo', 'error');
    reader.readAsDataURL(file);
  }

  async function processPdf(file, isBulk = false) {
    const tab = currentTab();
    showToast('Procesando PDF...', 'info');

    try {
      if (typeof pdfjsLib === 'undefined') {
        showToast('La librería PDF.js no está cargada aún', 'error');
        return;
      }
      const fileUrl = URL.createObjectURL(file);
      const loadingTask = pdfjsLib.getDocument(fileUrl);
      const pdf = await loadingTask.promise;
      
      for (let i = 1; i <= pdf.numPages; i++) {
        showToast(`Procesando página ${i}/${pdf.numPages} del PDF...`, 'info');
        const page = await pdf.getPage(i);
        
        const initialViewport = page.getViewport({ scale: 1.0 });
        const maxDim = Math.max(initialViewport.width, initialViewport.height);
        let scale = 1.0;
        if (maxDim > 2500) {
          scale = 2500 / maxDim;
        } else if (maxDim < 1000) {
          scale = 2.0;
        }
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
        
        let mat = null;
        let filtered = null;
        try {
          mat = cv.imread(canvas);
          filtered = Scanner.applyFilter(mat, 'color');
          
          const outCanvas = document.createElement('canvas');
          Scanner.drawToCanvas(filtered, outCanvas);
          
          const corners = [
            {x: 0, y: 0},
            {x: canvas.width, y: 0},
            {x: canvas.width, y: canvas.height},
            {x: 0, y: canvas.height}
          ];
          
          tab.scannedPages.push({
            originalDataUrl: canvas.toDataURL('image/jpeg', 0.9),
            corners: corners,
            warpedDataUrl: canvas.toDataURL('image/jpeg', 0.9),
            dataUrl: outCanvas.toDataURL('image/jpeg', 0.9),
            width: outCanvas.width,
            height: outCanvas.height,
            filter: 'color',
            isPdf: true
          });
        } finally {
          if (mat) mat.delete();
          if (filtered) filtered.delete();
        }
      }
      URL.revokeObjectURL(fileUrl);
      
      if (!isBulk) {
        showToast('PDF procesado exitosamente', 'success');
        tab.activePageIndex = tab.scannedPages.length - 1;
        renderPagesStrip();
        updatePageCounter();
        renderTabsBar();
        setState('result');
      }
    } catch (error) {
      console.error('[App] Error processing PDF:', error);
      showToast('Error al procesar el archivo PDF', 'error');
    }
  }

  // ======== Bulk Processing ========

  async function processBulkQueue() {
    const tab = currentTab();
    if (bulkQueue.length === 0) {
      isProcessingBulk = false;
      showToast('Carga múltiple completada', 'success');
      tab.activePageIndex = tab.scannedPages.length - 1;
      renderPagesStrip();
      updatePageCounter();
      renderTabsBar();
      setState('result');
      return;
    }

    const file = bulkQueue.shift();
    const remaining = bulkQueue.length;
    showToast(`Procesando archivo... (${remaining} restantes)`, 'info');

    if (file.type === 'application/pdf') {
      await processPdf(file, true);
      setTimeout(processBulkQueue, 100);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          autoScanImage(img);
          setTimeout(processBulkQueue, 100);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  function autoScanImage(img) {
    const tab = currentTab();
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
    let detectMat = null;
    try {
      const scale = Math.min(600 / imgW, 1);
      const displayW = Math.round(imgW * scale);
      const displayH = Math.round(imgH * scale);
      
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = displayW;
      smallCanvas.height = displayH;
      const smallCtx = smallCanvas.getContext('2d');
      smallCtx.drawImage(img, 0, 0, displayW, displayH);
      
      detectMat = cv.imread(smallCanvas);
      const result = Scanner.detectEdges(detectMat);
      
      if (result && result.points) {
        detectedPoints = result.points.map(p => ({
          x: p.x * (imgW / displayW),
          y: p.y * (imgH / displayH)
        }));
      }
    } catch(e) {
      console.error('[App] Auto-scan error:', e);
    } finally {
      if (detectMat) detectMat.delete();
    }

    if (!detectedPoints) {
      detectedPoints = [
        {x: 0, y: 0},
        {x: imgW, y: 0},
        {x: imgW, y: imgH},
        {x: 0, y: imgH}
      ];
    }

    let warped = null;
    let filtered = null;
    try {
      warped = Scanner.warpPerspective(mat, detectedPoints);
      filtered = Scanner.applyFilter(warped, 'color');

      const outCanvas = document.createElement('canvas');
      Scanner.drawToCanvas(filtered, outCanvas);

      const warpCanvas = document.createElement('canvas');
      warpCanvas.width = warped.cols;
      warpCanvas.height = warped.rows;
      cv.imshow(warpCanvas, warped);

      tab.scannedPages.push({
        originalDataUrl,
        corners: detectedPoints,
        warpedDataUrl: warpCanvas.toDataURL('image/jpeg', 0.9),
        dataUrl: outCanvas.toDataURL('image/jpeg', 0.9),
        width: outCanvas.width,
        height: outCanvas.height,
        filter: 'color'
      });
    } finally {
      if (mat) mat.delete();
      if (warped) warped.delete();
      if (filtered) filtered.delete();
    }
  }

  // ======== State Management ========

  function setState(state) {
    currentTab().state = state;

    dom.uploadZone.classList.add('hidden');
    dom.editorZone.classList.add('hidden');
    dom.resultZone.classList.add('hidden');

    switch (state) {
      case 'upload':
        dom.uploadZone.classList.remove('hidden');
        break;

      case 'editor':
        dom.editorZone.classList.remove('hidden');
        break;

      case 'result':
        dom.resultZone.classList.remove('hidden');
        break;
    }
  }

  function goToUpload() {
    cleanupMats();
    Corners.destroy();
    originalImage = null;
    const tab = currentTab();
    tab.scannedPages = [];
    tab.activePageIndex = -1;
    tab.originalImageDataUrl = null;
    tab.isReAdjusting = false;
    tab.corners = null;
    resetFilterUI();
    renderPagesStrip();
    renderTabsBar();
    setState('upload');
  }

  function handleCancel() {
    const tab = currentTab();
    tab.isReAdjusting = false;
    if (tab.scannedPages.length > 0) {
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

    if (!detectedPoints) {
      let detectMat = null;
      try {
        detectMat = cv.imread(dom.canvasInput);
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
      } catch (err) {
        showToast('Ajusta las esquinas manualmente', 'info');
      } finally {
        if (detectMat) detectMat.delete();
      }
    }

    // Save corners to tab for potential restore
    currentTab().corners = detectedPoints;

    Corners.init(
      dom.canvasOverlay,
      detectedPoints,
      displayW,
      displayH,
      imgW,
      imgH
    );

    const tab = currentTab();
    if (tab.isReAdjusting && tab.scannedPages.length > 1) {
      dom.editorPageCounter.textContent = `${tab.activePageIndex + 1} / ${tab.scannedPages.length}`;
      dom.editorPageCounter.classList.remove('hidden');
      dom.btnEditorPrev.classList.toggle('hidden', tab.activePageIndex === 0);
      dom.btnEditorNext.classList.toggle('hidden', tab.activePageIndex >= tab.scannedPages.length - 1);
      
      const scanText = dom.btnScan.querySelector('.btn-text');
      if (scanText) {
        scanText.textContent = (tab.activePageIndex === tab.scannedPages.length - 1) ? 'Finalizar' : 'Escanear';
      }
    } else {
      dom.editorPageCounter.classList.add('hidden');
      dom.btnEditorPrev.classList.add('hidden');
      dom.btnEditorNext.classList.add('hidden');
      const scanText = dom.btnScan.querySelector('.btn-text');
      if (scanText) scanText.textContent = 'Escanear';
    }
  }

  function rotateEditorImage() {
    if (!originalMat) return;
    
    const dst = new cv.Mat();
    cv.rotate(originalMat, dst, cv.ROTATE_90_CLOCKWISE);
    
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = dst.cols;
    rotatedCanvas.height = dst.rows;
    cv.imshow(rotatedCanvas, dst);
    
    const newSrc = rotatedCanvas.toDataURL('image/jpeg', 0.95);
    
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      const tab = currentTab();
      tab.originalImageDataUrl = img.src;
      // We do not pass predefinedCorners because the image rotated and old points are invalid
      goToEditor(null);
    };
    img.src = newSrc;
    
    dst.delete();
  }

  function navigateEditor(direction) {
    performScan(direction === 1 ? 'next' : 'prev');
  }

  // ======== Re-adjust ========

  function startReAdjust() {
    const tab = currentTab();
    if (tab.activePageIndex < 0 || tab.activePageIndex >= tab.scannedPages.length) return;
    
    const page = tab.scannedPages[tab.activePageIndex];
    if (!page.originalDataUrl) {
      showToast('No se puede re-ajustar, falta imagen original', 'error');
      return;
    }

    tab.isReAdjusting = true;

    const img = new Image();
    img.onload = () => {
      originalImage = img;
      tab.originalImageDataUrl = img.src;
      goToEditor(page.corners);
    };
    img.src = page.originalDataUrl;
  }

  // ======== Scanning ========

  function performScan(nextAction = 'result') {
    if (!originalMat) {
      showToast('No hay imagen cargada', 'error');
      return;
    }

    const tab = currentTab();

    try {
      const cornerPoints = Corners.getPoints();

      if (warpedMat) warpedMat.delete();
      warpedMat = Scanner.warpPerspective(originalMat, cornerPoints);

      const targetFilter = tab.isReAdjusting ? tab.scannedPages[tab.activePageIndex].filter : 'color';
      
      const filtered = Scanner.applyFilter(warpedMat, targetFilter);
      Scanner.drawToCanvas(filtered, dom.canvasOutput);

      const warpCanvas = document.createElement('canvas');
      warpCanvas.width = warpedMat.cols;
      warpCanvas.height = warpedMat.rows;
      cv.imshow(warpCanvas, warpedMat);

      const pageData = {
        originalDataUrl: originalImage.src,
        corners: cornerPoints,
        warpedDataUrl: warpCanvas.toDataURL('image/jpeg', 0.92),
        dataUrl: dom.canvasOutput.toDataURL('image/jpeg', 0.92),
        width: dom.canvasOutput.width,
        height: dom.canvasOutput.height,
        filter: targetFilter
      };

      if (tab.isReAdjusting) {
        tab.scannedPages[tab.activePageIndex] = pageData;
        showToast('Ajuste guardado', 'success');
      } else {
        tab.scannedPages.push(pageData);
        tab.activePageIndex = tab.scannedPages.length - 1;
        showToast(`¡Página escaneada!`, 'success');
      }

      tab.isReAdjusting = false;
      tab.corners = null;
      tab.originalImageDataUrl = null;
      filtered.delete();
      Corners.destroy();
      cleanupMats();
      originalImage = null;

      if (nextAction === 'next' || nextAction === 'prev') {
        let newIndex = tab.activePageIndex;
        if (nextAction === 'next') newIndex++;
        if (nextAction === 'prev') newIndex--;
        
        if (newIndex >= 0 && newIndex < tab.scannedPages.length) {
          tab.activePageIndex = newIndex;
          const nextPage = tab.scannedPages[tab.activePageIndex];
          if (nextPage.originalDataUrl) {
            tab.isReAdjusting = true;
            const img = new Image();
            img.onload = () => {
              originalImage = img;
              tab.originalImageDataUrl = img.src;
              goToEditor(nextPage.corners);
            };
            img.src = nextPage.originalDataUrl;
            return;
          }
        }
      }

      renderPagesStrip();
      renderTabsBar();
      showActivePage();
      setState('result');

    } catch (err) {
      console.error('[App] Scan error:', err);
      showToast('Error al escanear. Intenta ajustar las esquinas.', 'error');
    }
  }

  // ======== Re-apply filter to active page ========

  function reapplyFilterToActivePage() {
    const tab = currentTab();
    if (tab.activePageIndex < 0 || tab.activePageIndex >= tab.scannedPages.length) return;

    const page = tab.scannedPages[tab.activePageIndex];

    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.naturalWidth;
      tempCanvas.height = img.naturalHeight;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const mat = cv.imread(tempCanvas);
      try {
        let options = {};
        if (tab.currentFilter === 'manual') {
          options = {
            bgClean: dom.adjBgClean ? parseInt(dom.adjBgClean.value) : 50,
            saturation: dom.adjSaturation ? parseInt(dom.adjSaturation.value) : 100
          };
          page.manualOptions = options;
        }

        const filtered = Scanner.applyFilter(mat, tab.currentFilter, options);
        Scanner.drawToCanvas(filtered, dom.canvasOutput);

        page.dataUrl = dom.canvasOutput.toDataURL('image/jpeg', 0.92);
        page.width = dom.canvasOutput.width;
        page.height = dom.canvasOutput.height;
        page.filter = tab.currentFilter;

        filtered.delete();
        renderPagesStrip();
      } catch (err) {
        console.error('[App] Re-filter error:', err);
        showToast('Error al aplicar filtro', 'error');
      }
      mat.delete();
    };
    img.src = page.warpedDataUrl;
    
    if (dom.manualAdjustments) {
      if (tab.currentFilter === 'manual') {
        dom.manualAdjustments.classList.remove('hidden');
      } else {
        dom.manualAdjustments.classList.add('hidden');
      }
    }
  }

  async function applyFilterToAllPages() {
    const tab = currentTab();
    if (tab.scannedPages.length <= 1) {
      showToast('No hay suficientes páginas adicionales', 'info');
      return;
    }

    const currentFilter = tab.currentFilter;
    showToast(`Aplicando filtro a todas las páginas...`, 'info');

    for (let i = 0; i < tab.scannedPages.length; i++) {
      const page = tab.scannedPages[i];
      if (page.filter === currentFilter) continue;

      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = img.naturalWidth;
          tempCanvas.height = img.naturalHeight;
          const tempCtx = tempCanvas.getContext('2d');
          tempCtx.drawImage(img, 0, 0);

          const mat = cv.imread(tempCanvas);
          
          let options = {};
          if (currentFilter === 'manual') {
             // Use the active page's manual settings for all pages if available
             const activePage = tab.scannedPages[tab.activePageIndex];
             options = activePage.manualOptions || { bgClean: 50, saturation: 100 };
             page.manualOptions = { ...options };
          }
          
          const filtered = Scanner.applyFilter(mat, currentFilter, options);
          
          const outCanvas = document.createElement('canvas');
          Scanner.drawToCanvas(filtered, outCanvas);
          
          page.dataUrl = outCanvas.toDataURL('image/jpeg', 0.9);
          page.filter = tab.currentFilter;
          
          mat.delete();
          filtered.delete();
          resolve();
        };
        img.src = page.warpedDataUrl;
      });
    }

    showActivePage();
    renderPagesStrip();
    showToast('Filtro aplicado a todas las páginas', 'success');
  }

  // ======== Page Actions ========

  function addAnotherPage() {
    currentTab().isReAdjusting = false;
    dom.fileInput.click();
  }

  function deleteActivePage() {
    const tab = currentTab();
    if (tab.activePageIndex < 0 || tab.scannedPages.length === 0) return;

    tab.scannedPages.splice(tab.activePageIndex, 1);

    if (tab.scannedPages.length === 0) {
      goToUpload();
      showToast('Todas las páginas eliminadas', 'info');
      return;
    }

    if (tab.activePageIndex >= tab.scannedPages.length) {
      tab.activePageIndex = tab.scannedPages.length - 1;
    }

    showActivePage();
    renderPagesStrip();
    renderTabsBar();
    showToast('Página eliminada', 'info');
  }

  function showActivePage() {
    const tab = currentTab();
    if (tab.activePageIndex < 0 || tab.activePageIndex >= tab.scannedPages.length) return;

    const page = tab.scannedPages[tab.activePageIndex];

    const img = new Image();
    img.onload = () => {
      dom.canvasOutput.width = img.naturalWidth;
      dom.canvasOutput.height = img.naturalHeight;
      const ctx = dom.canvasOutput.getContext('2d');
      ctx.drawImage(img, 0, 0);

      tab.currentFilter = page.filter;
      dom.filterBtns.forEach(b => b.classList.remove('active'));
      const activeBtn = document.querySelector(`[data-filter="${page.filter}"]`);
      if (activeBtn) activeBtn.classList.add('active');
    };
    img.src = page.dataUrl;

    updatePageCounter();

    if (dom.btnReadjust) {
      dom.btnReadjust.style.display = 'inline-flex';
    }

    if (dom.manualAdjustments) {
      if (tab.currentFilter === 'manual') {
        dom.manualAdjustments.classList.remove('hidden');
        if (page.manualOptions) {
          if (dom.adjBgClean) dom.adjBgClean.value = page.manualOptions.bgClean;
          if (dom.adjSaturation) dom.adjSaturation.value = page.manualOptions.saturation;
        }
      } else {
        dom.manualAdjustments.classList.add('hidden');
      }
    }

    highlightActiveThumb();
  }

  function selectPage(index) {
    const tab = currentTab();
    if (index < 0 || index >= tab.scannedPages.length) return;
    tab.activePageIndex = index;
    showActivePage();
  }

  // ======== Drag & Drop Reordering (Pages Strip) ========

  let draggedItemIndex = null;

  function renderPagesStrip() {
    if (!dom.pagesStripList) return;

    const tab = currentTab();
    dom.pagesStripList.innerHTML = '';

    if (tab.scannedPages.length === 0) {
      dom.pagesStrip.classList.add('hidden');
      return;
    }

    dom.pagesStrip.classList.remove('hidden');

    tab.scannedPages.forEach((page, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb' + (i === tab.activePageIndex ? ' active' : '');
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

      thumb.addEventListener('click', () => selectPage(i));

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
    e.dataTransfer.setData('text/plain', draggedItemIndex);
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
    
    const tab = currentTab();
    const targetIndex = parseInt(this.dataset.index);
    if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
      const itemToMove = tab.scannedPages.splice(draggedItemIndex, 1)[0];
      tab.scannedPages.splice(targetIndex, 0, itemToMove);
      
      if (tab.activePageIndex === draggedItemIndex) {
        tab.activePageIndex = targetIndex;
      } else if (tab.activePageIndex > draggedItemIndex && tab.activePageIndex <= targetIndex) {
        tab.activePageIndex--;
      } else if (tab.activePageIndex < draggedItemIndex && tab.activePageIndex >= targetIndex) {
        tab.activePageIndex++;
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
    const tab = currentTab();
    const thumbs = dom.pagesStripList.querySelectorAll('.page-thumb');
    thumbs.forEach((t, i) => {
      t.classList.toggle('active', i === tab.activePageIndex);
    });
    const activeThumb = dom.pagesStripList.querySelector('.page-thumb.active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  function updatePageCounter() {
    const tab = currentTab();
    if (dom.pageCounter) {
      if (tab.scannedPages.length > 0) {
        dom.pageCounter.textContent = `${tab.activePageIndex + 1} / ${tab.scannedPages.length}`;
        dom.pageCounter.classList.remove('hidden');
      } else {
        dom.pageCounter.classList.add('hidden');
      }
    }
  }

  function resetFilterUI() {
    const tab = currentTab();
    if (tab) tab.currentFilter = 'color';
    dom.filterBtns.forEach(b => b.classList.remove('active'));
    document.getElementById('filter-color').classList.add('active');
  }

  // ======== Download ========

  function parsePageRange(rangeStr, maxPages) {
    if (!rangeStr || rangeStr.trim() === '') {
      return Array.from({ length: maxPages }, (_, i) => i);
    }
    const pages = new Set();
    const parts = rangeStr.split(',');
    for (let part of parts) {
      part = part.trim();
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(n => parseInt(n, 10));
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            if (i >= 1 && i <= maxPages) pages.add(i - 1);
          }
        }
      } else {
        const page = parseInt(part, 10);
        if (!isNaN(page) && page >= 1 && page <= maxPages) {
          pages.add(page - 1);
        }
      }
    }
    return Array.from(pages).sort((a, b) => a - b);
  }

  async function downloadAllImages() {
    const tab = currentTab();
    if (tab.scannedPages.length === 0) {
      showToast('No hay páginas para descargar', 'warning');
      return;
    }

    let pagesToExport = tab.scannedPages;
    if (tab.scannedPages.length > 1) {
      const rangeStr = window.prompt(`¿Qué páginas deseas descargar?\nIngresa el rango (1 a ${tab.scannedPages.length}) o deja en blanco para TODAS.\nEjemplo: 1-3, 5`, "");
      if (rangeStr === null) return; // Cancelado
      const indices = parsePageRange(rangeStr, tab.scannedPages.length);
      if (indices.length === 0) {
        showToast('Rango de páginas no válido', 'error');
        return;
      }
      pagesToExport = indices.map(i => tab.scannedPages[i]);
    }

    try {
      if (pagesToExport.length === 1) {
        const page = pagesToExport[0];
        const res = await fetch(page.dataUrl);
        const blob = await res.blob();
        if (window.showSaveFilePicker) {
          try {
            const handle = await window.showSaveFilePicker({
              suggestedName: `pablito-leans-pag-${Date.now()}.jpg`,
              types: [{ description: 'Imagen JPEG', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            showToast('Imagen guardada con éxito', 'success');
          } catch(e) { 
            if(e.name !== 'AbortError') showToast('Error al guardar', 'error'); 
          }
        } else {
          const link = document.createElement('a');
          link.download = `pablito-leans-pag-${Date.now()}.jpg`;
          link.href = page.dataUrl;
          link.click();
          showToast('Imagen descargada', 'success');
        }
      } else {
        if (typeof JSZip === 'undefined') {
          showToast('Error: Librería JSZip no cargada', 'error');
          return;
        }
        showToast('Comprimiendo imágenes en ZIP...', 'info');
        
        // Pequeña pausa para permitir que el UI se actualice
        await new Promise(r => setTimeout(r, 100));

        const zip = new JSZip();
        for (let i = 0; i < pagesToExport.length; i++) {
          const page = pagesToExport[i];
          const base64Data = page.dataUrl.split(',')[1];
          zip.file(`pagina_${i + 1}.jpg`, base64Data, { base64: true });
        }
        
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        if (window.showSaveFilePicker) {
          try {
            const handle = await window.showSaveFilePicker({
              suggestedName: `pablito-leans-${pagesToExport.length}imagenes-${Date.now()}.zip`,
              types: [{ description: 'Archivo ZIP', accept: { 'application/zip': ['.zip'] } }]
            });
            const writable = await handle.createWritable();
            await writable.write(zipBlob);
            await writable.close();
            showToast(`ZIP guardado con éxito`, 'success');
          } catch(e) { 
            if(e.name !== 'AbortError') {
              const link = document.createElement('a');
              link.download = `pablito-leans-${pagesToExport.length}imagenes-${Date.now()}.zip`;
              link.href = URL.createObjectURL(zipBlob);
              link.click();
              showToast(`ZIP descargado`, 'success');
            }
          }
        } else {
          const link = document.createElement('a');
          link.download = `pablito-leans-${pagesToExport.length}imagenes-${Date.now()}.zip`;
          link.href = URL.createObjectURL(zipBlob);
          link.click();
          showToast(`ZIP descargado`, 'success');
        }
      }
    } catch (err) {
      console.error(err);
      showToast('Error al descargar imágenes', 'error');
    }
  }

  function downloadPdf() {
    const tab = currentTab();
    if (tab.scannedPages.length === 0) {
      showToast('No hay páginas para exportar', 'warning');
      return;
    }

    if (dom.pdfPageRange) dom.pdfPageRange.value = '';
    if (dom.pdfModal) dom.pdfModal.classList.remove('hidden');
  }

  function closePdfModal() {
    if (dom.pdfModal) dom.pdfModal.classList.add('hidden');
  }

  let isJsPdfLoading = false;

  async function confirmPdfExport() {
    closePdfModal();
    const tab = currentTab();
    if (tab.scannedPages.length === 0) return;

    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
      if (isJsPdfLoading) {
        showToast('Cargando librería PDF, por favor espera...', 'info');
        return;
      }
      isJsPdfLoading = true;
      showToast('Cargando librería PDF…', 'info');
      
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      } catch (err) {
        isJsPdfLoading = false;
        showToast('Error al cargar la librería PDF', 'error');
        return;
      }
      isJsPdfLoading = false;
    }

    generatePdf();
  }

  async function generatePdf() {
    const tab = currentTab();
    try {
      const rangeStr = dom.pdfPageRange ? dom.pdfPageRange.value : '';
      const sizeSelection = dom.pdfPageSize ? dom.pdfPageSize.value : 'A4';
      let fitMode = 'contain';
      if (dom.pdfFitOptions) {
        dom.pdfFitOptions.forEach(opt => { if (opt.checked) fitMode = opt.value; });
      }

      let orientationMode = 'auto';
      if (dom.pdfOrientationOptions) {
        dom.pdfOrientationOptions.forEach(opt => { if (opt.checked) orientationMode = opt.value; });
      }

      let pagesToExport = tab.scannedPages;
      if (rangeStr.trim() !== '') {
        const indices = parsePageRange(rangeStr, tab.scannedPages.length);
        if (indices.length === 0) {
          showToast('Rango de páginas no válido', 'error');
          return;
        }
        pagesToExport = indices.map(i => tab.scannedPages[i]);
      }

      showToast('Generando PDF, por favor espera...', 'info');

      const { jsPDF } = window.jspdf;
      
      const sizesMm = {
        'A0': [841, 1189],
        'A1': [594, 841],
        'A2': [420, 594],
        'A3': [297, 420],
        'A4': [210, 297],
        'A5': [148, 210]
      };
      
      const formatMm = sizesMm[sizeSelection] || sizesMm['A4'];

      let firstPageLandscape = false;
      if (pagesToExport.length > 0) {
         if (orientationMode === 'auto') {
             firstPageLandscape = pagesToExport[0].width > pagesToExport[0].height;
         } else if (orientationMode === 'landscape') {
             firstPageLandscape = true;
         } else if (orientationMode === 'portrait') {
             firstPageLandscape = false;
         }
      }

      const pdf = new jsPDF({
        orientation: firstPageLandscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: formatMm,
        compress: true
      });

      for (let i = 0; i < pagesToExport.length; i++) {
        const page = pagesToExport[i];
        
        let pageLandscape = false;
        if (orientationMode === 'auto') {
           pageLandscape = page.width > page.height;
        } else if (orientationMode === 'landscape') {
           pageLandscape = true;
        } else if (orientationMode === 'portrait') {
           pageLandscape = false;
        }
        
        let pdfWidth = formatMm[0];
        let pdfHeight = formatMm[1];
        
        if (pageLandscape) {
           pdfWidth = formatMm[1];
           pdfHeight = formatMm[0];
        }

        if (i > 0) {
          pdf.addPage([formatMm[0], formatMm[1]], pageLandscape ? 'landscape' : 'portrait');
        }

        if (fitMode === 'cover') {
           pdf.addImage(page.dataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
        } else {
           const imgRatio = page.width / page.height;
           const pdfRatio = pdfWidth / pdfHeight;
           
           let finalW = pdfWidth;
           let finalH = pdfHeight;
           let x = 0;
           let y = 0;

           if (imgRatio > pdfRatio) {
             finalW = pdfWidth;
             finalH = pdfWidth / imgRatio;
             y = (pdfHeight - finalH) / 2;
           } else {
             finalH = pdfHeight;
             finalW = pdfHeight * imgRatio;
             x = (pdfWidth - finalW) / 2;
           }
           
           pdf.addImage(page.dataUrl, 'JPEG', x, y, finalW, finalH, undefined, 'FAST');
        }
      }

      if (window.showSaveFilePicker) {
        try {
          const pdfBlob = pdf.output('blob');
          const handle = await window.showSaveFilePicker({
            suggestedName: `pablito-leans-${pagesToExport.length}pag-${Date.now()}.pdf`,
            types: [{ description: 'Documento PDF', accept: { 'application/pdf': ['.pdf'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(pdfBlob);
          await writable.close();
          showToast(`PDF guardado con éxito`, 'success');
        } catch (err) {
          if (err.name !== 'AbortError') {
            pdf.save(`pablito-leans-${pagesToExport.length}pag-${Date.now()}.pdf`);
            showToast(`PDF descargado`, 'success');
          }
        }
      } else {
        pdf.save(`pablito-leans-${pagesToExport.length}pag-${Date.now()}.pdf`);
        showToast(`PDF descargado`, 'success');
      }
    } catch (err) {
      console.error('[App] PDF generation error:', err);
      showToast('Error al generar PDF.', 'error');
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
