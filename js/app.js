/**
 * app.js — Main Application Orchestrator
 * Manages UI states, multi-page scanning, bulk upload, re-adjusting, D&D reordering,
 * and document tabs (max 3 simultaneous documents).
 */

import { Scanner } from './scanner.js';
import { Corners } from './corners.js';
import { fitImageDimensions, parsePageRange } from './utils.js';
import { resolvePrintSize, getCustomPaper, getPaperSize } from './export/print-sizes.js';
import { createPrintPlan, createOutputPlan, fitImageToBox } from './export/layout-calculator.js';
import { downloadBlob } from './export/download.js';
import { NEUTRAL_ADJUSTMENTS, normalizeAdjustments } from './image-adjustments.js';
import { createPanZoomViewport } from './pan-zoom.js';

const App = (() => {
  'use strict';

  // ======== Constants ========
  const MAX_TABS = 3;
  const MAX_PAGES_PER_TAB = 100;
  const MAX_IMAGE_DIMENSION = 4096;
  const MAX_IMAGE_PIXELS = 16_000_000;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_ESTIMATED_TAB_BYTES = 200 * 1024 * 1024;
  const MAX_ESTIMATED_TOTAL_BYTES = 350 * 1024 * 1024;
  const EXPORT_DPI = 150;
  const EXPORT_SIZES_PX = {
    A0: [4960, 7016], A1: [3508, 4960], A2: [2480, 3508],
    A3: [1754, 2480], A4: [1240, 1754], A5: [874, 1240]
  };
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
  let isImporting = false;
  let bulkTargetTabId = null;
  let bulkJobId = 0;
  let exportSession = null;
  let cameraStream = null;
  let cameraFacingMode = 'environment';
  let cameraTorchEnabled = false;
  let manualFilterTimer = null;
  let previewPlan = null;
  let isExporting = false;
  let previewSheetIndex = 0;
  let previewRevision = 0;
  let dniSwapped = false;
  const previewImages = new Map();
  const pendingFilters = new Set();
  let viewerZoom = 100;
  let previewZoom = 100;
  let documentViewport = null;
  let printViewport = null;
  let viewerIdentity = null;
  let previewPaperKey = null;

  function createTabData(name) {
    return {
      id: ++tabIdCounter,
      name: name || `Documento ${tabIdCounter}`,
      state: 'upload',
      scannedPages: [],
      activePageIndex: -1,
      currentFilter: 'original',
      originalImageDataUrl: null,
      isReAdjusting: false,
      corners: null,
      editorCropMode: 'perspective',
      viewRevision: 0,
      filterRevision: 0,
      importRevision: 0
    };
  }

  function currentTab() {
    return tabs[activeTabIndex];
  }

  function findTabById(tabId) {
    return tabs.find(tab => tab.id === tabId) || null;
  }

  function isActiveTab(tab) {
    return Boolean(tab && currentTab() && currentTab().id === tab.id);
  }

  function blockTabMutationWhileImporting() {
    if (!isImporting) return false;
    showToast('Espera a que termine la importación', 'warning');
    return true;
  }

  function estimatePageBytes(page) {
    return ['originalDataUrl', 'warpedDataUrl', 'dataUrl']
      .reduce((total, key) => total + (page[key]?.length || 0) * 2, 0);
  }

  function canStorePage(tab, page, replacingIndex = -1) {
    const currentBytes = tab.scannedPages.reduce((total, existingPage, index) =>
      total + (index === replacingIndex ? 0 : estimatePageBytes(existingPage)), 0);
    const otherTabsBytes = tabs
      .filter(existingTab => existingTab.id !== tab.id)
      .flatMap(existingTab => existingTab.scannedPages)
      .reduce((total, existingPage) => total + estimatePageBytes(existingPage), 0);
    const nextPageBytes = estimatePageBytes(page);
    return currentBytes + nextPageBytes <= MAX_ESTIMATED_TAB_BYTES &&
      otherTabsBytes + currentBytes + nextPageBytes <= MAX_ESTIMATED_TOTAL_BYTES;
  }

  function insertPage(tab, page, index = tab.scannedPages.length) {
    if (tab.scannedPages.length >= MAX_PAGES_PER_TAB || !canStorePage(tab, page)) return false;
    tab.scannedPages.splice(index, 0, page);
    return true;
  }

  // ======== DOM Elements ========
  const dom = {};

  function cacheDom() {
    dom.uploadZone = document.getElementById('upload-zone');
    dom.cameraZone = document.getElementById('camera-zone');
    dom.cameraVideo = document.getElementById('camera-video');
    dom.cameraStatus = document.getElementById('camera-status');
    dom.btnOpenCamera = document.getElementById('btn-open-camera');
    dom.btnCameraClose = document.getElementById('btn-camera-close');
    dom.btnCameraCapture = document.getElementById('btn-camera-capture');
    dom.btnCameraSwitch = document.getElementById('btn-camera-switch');
    dom.btnCameraTorch = document.getElementById('btn-camera-torch');
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
    dom.btnExport = document.getElementById('btn-export');
    dom.resultControls = document.getElementById('result-controls');
    dom.editSettings = document.getElementById('edit-settings');
    dom.documentView = document.getElementById('document-view');
    dom.btnAddPage = document.getElementById('btn-add-page');
    dom.btnAddPageRail = document.getElementById('btn-add-page-rail');
    dom.btnDuplicatePage = document.getElementById('btn-duplicate-page');
    dom.btnDeletePage = document.getElementById('btn-delete-page');
    dom.canvasInput = document.getElementById('canvasInput');
    dom.canvasOverlay = document.getElementById('canvasOverlay');
    dom.canvasOutput = document.getElementById('canvasOutput');
    dom.btnCompare = document.getElementById('btn-compare');
    dom.canvasWrapper = document.getElementById('canvas-wrapper');
    dom.opencvLoader = document.getElementById('opencv-loader');
    dom.toastContainer = document.getElementById('toast-container');
    dom.filterSelector = document.getElementById('filter-selector');
    dom.filterBtns = document.querySelectorAll('.filter-option');
    dom.advancedFilters = document.querySelector('.advanced-filters');
    dom.pagesStrip = document.getElementById('pages-strip');
    dom.pagesStripList = document.getElementById('pages-strip-list');
    dom.btnPageLeft = document.getElementById('btn-page-left');
    dom.btnPageRight = document.getElementById('btn-page-right');
    dom.flowSteps = document.querySelectorAll('.flow-step');
    // Tabs
    dom.tabsBar = document.getElementById('tabs-bar');
    dom.tabsList = document.getElementById('tabs-list');
    dom.btnAddTab = document.getElementById('btn-add-tab');
    
    // Export workspace
    dom.exportPanel = document.getElementById('export-panel');
    dom.exportPanelTitle = document.getElementById('export-panel-title');
    dom.exportSettings = document.getElementById('export-settings');
    dom.btnExportBack = document.getElementById('btn-export-back');
    dom.btnExportConfirm = document.getElementById('btn-export-confirm');
    dom.exportConfirmText = document.getElementById('export-confirm-text');
    dom.exportFormat = document.getElementById('export-format');
    dom.exportFit = document.getElementById('export-fit');
    dom.exportOrientation = document.getElementById('export-orientation');
    dom.exportImageMethod = document.getElementById('export-image-method');
    dom.exportPageRange = document.getElementById('export-page-range');
    dom.exportPageSize = document.getElementById('export-page-size');
    for (const [key, id] of Object.entries({
      groupCustomPaper: 'group-custom-paper', exportPaperWidth: 'export-paper-width',
      exportPaperHeight: 'export-paper-height', exportPaperUnit: 'export-paper-unit',
      btnCanvasFromPiece: 'btn-canvas-from-piece', btnPieceFromCanvas: 'btn-piece-from-canvas',
      groupPrintOutput: 'group-print-output', exportPrintOutput: 'export-print-output',
      groupTileOptions: 'group-tile-options', exportTileOverlap: 'export-tile-overlap',
      exportTileMargin: 'export-tile-margin', groupTileMargin: 'group-tile-margin'
    })) dom[key] = document.getElementById(id);
    dom.exportPurpose = document.getElementById('export-purpose');
    dom.groupExportPurpose = document.getElementById('group-export-purpose');
    dom.groupPrintLayout = document.getElementById('group-print-layout');
    dom.exportLayoutMode = document.getElementById('export-layout-mode');
    dom.groupPrintImageOutlines = document.getElementById('group-print-image-outlines');
    dom.exportPrintImageOutlines = document.getElementById('export-print-image-outlines');
    dom.exportPrintPreset = document.getElementById('export-print-preset');
    dom.groupCustomPrintSize = document.getElementById('group-custom-print-size');
    dom.exportPrintWidth = document.getElementById('export-print-width');
    dom.exportPrintHeight = document.getElementById('export-print-height');
    dom.exportPrintUnit = document.getElementById('export-print-unit');
    dom.exportPrintScale = document.getElementById('export-print-scale');
    dom.exportPrintMargin = document.getElementById('export-print-margin');
    dom.exportPrintGap = document.getElementById('export-print-gap');
    dom.exportPrintCopies = document.getElementById('export-print-copies');
    dom.groupPrintGap = document.getElementById('group-print-gap');
    dom.groupPrintCopies = document.getElementById('group-print-copies');
    dom.exportPageSizeAuto = document.getElementById('export-page-size-auto');
    dom.dniGuide = document.getElementById('group-dni-guide');
    dom.btnDniSwap = document.getElementById('btn-dni-swap');
    dom.scaleShortcuts = document.querySelectorAll('[data-print-scale]');
    dom.exportPreview = document.getElementById('export-preview');
    dom.previewCanvas = document.getElementById('print-preview-canvas');
    dom.previewStage = document.getElementById('print-preview-stage');
    dom.previewZoomIn = document.getElementById('btn-preview-zoom-in');
    dom.previewZoomOut = document.getElementById('btn-preview-zoom-out');
    dom.previewZoomReset = document.getElementById('btn-preview-zoom-reset');
    dom.previewEmpty = document.getElementById('preview-empty');
    dom.previewPaperLabel = document.getElementById('preview-paper-label');
    dom.previewCounter = document.getElementById('preview-sheet-counter');
    dom.previewPrev = document.getElementById('preview-prev');
    dom.previewNext = document.getElementById('preview-next');
    dom.exportFeedback = document.getElementById('export-feedback');
    dom.exportFieldRow = document.getElementById('export-field-row');
    dom.groupOrientation = document.getElementById('group-orientation');
    dom.groupImageMethod = document.getElementById('group-image-method');

    // Manual Adjustments
    dom.manualAdjustments = document.getElementById('manual-adjustments');
    dom.adjBgClean = document.getElementById('adj-bg-clean');
    dom.adjSaturation = document.getElementById('adj-saturation');
    dom.adjBgCleanValue = document.getElementById('adj-bg-clean-value');
    dom.adjSaturationValue = document.getElementById('adj-saturation-value');
    dom.appMain = document.getElementById('app-main');
    dom.railPageCount = document.getElementById('rail-page-count');
    dom.viewerPrev = document.getElementById('btn-viewer-prev');
    dom.viewerNext = document.getElementById('btn-viewer-next');
    dom.viewerPageNumber = document.getElementById('viewer-page-number');
    dom.viewerPageTotal = document.getElementById('viewer-page-total');
    dom.viewerViewMode = document.getElementById('document-view-mode');
    dom.viewerScroll = document.getElementById('result-viewer-scroll');
    dom.singlePageView = document.getElementById('single-page-view');
    dom.documentPages = document.getElementById('document-pages');
    dom.resultPaper = document.getElementById('result-paper');
    dom.zoomIn = document.getElementById('btn-zoom-in');
    dom.zoomOut = document.getElementById('btn-zoom-out');
    dom.zoomReset = document.getElementById('btn-zoom-reset');
    dom.cropModes = document.querySelectorAll('[data-crop-mode]');
    dom.cropReset = document.getElementById('btn-crop-reset');
    dom.resetAdjustments = document.getElementById('btn-reset-adjustments');
    dom.filterStatus = document.getElementById('filter-status');
    dom.btnEnhanceDocument = document.getElementById('btn-enhance-document');
    dom.enhanceButtonLabel = document.getElementById('enhance-button-label');
    const adjustmentIds = { bgClean: 'bg-clean', saturation: 'saturation', brightness: 'brightness',
      contrast: 'contrast', warmth: 'warmth', whiteBalance: 'white-balance', sharpness: 'sharpness',
      documentEnhance: 'document-enhance', denoise: 'denoise' };
    dom.adjustmentControls = Object.fromEntries(Object.entries(adjustmentIds).map(([key, id]) =>
      [key, { input: document.getElementById(`adj-${id}`), output: document.getElementById(`adj-${id}-value`) }]));
  }

  // ======== Initialization ========

  function init() {
    cacheDom();
    initViewports();
    bindEvents();

    window.addEventListener('beforeunload', (e) => {
      stopCamera();
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

    // Preload PDF library
    loadJsPdfLib();

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
    window.addEventListener('themechange', () => {
      Corners.draw();
    });
    // File selection
    dom.btnSelectFile.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.fileInput.click();
    });

    dom.btnOpenCamera.addEventListener('click', (e) => {
      e.stopPropagation();
      startCamera();
    });

    dom.uploadZone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
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
    dom.btnExport.addEventListener('click', openExportView);
    dom.btnAddPage.addEventListener('click', addAnotherPage);
    dom.btnAddPageRail.addEventListener('click', addAnotherPage);
    dom.btnDuplicatePage.addEventListener('click', duplicateActivePage);
    dom.btnDeletePage.addEventListener('click', deleteActivePage);
    dom.btnPageLeft.addEventListener('click', () => movePage(currentTab().activePageIndex, currentTab().activePageIndex - 1));
    dom.btnPageRight.addEventListener('click', () => movePage(currentTab().activePageIndex, currentTab().activePageIndex + 1));
    dom.btnCameraClose.addEventListener('click', closeCamera);
    dom.btnCameraCapture.addEventListener('click', captureCameraFrame);
    dom.btnCameraSwitch.addEventListener('click', switchCamera);
    dom.btnCameraTorch.addEventListener('click', toggleCameraTorch);

    const beginComparison = (event) => {
      event.preventDefault();
      dom.btnCompare.setPointerCapture?.(event.pointerId);
      showUnfilteredPage();
    };
    const endComparison = (event) => {
      event.preventDefault();
      stopComparing();
    };
    dom.btnCompare.addEventListener('pointerdown', beginComparison);
    dom.btnCompare.addEventListener('pointerup', endComparison);
    dom.btnCompare.addEventListener('pointercancel', endComparison);
    dom.btnCompare.addEventListener('lostpointercapture', stopComparing);

    dom.flowSteps.forEach(step => {
      step.addEventListener('click', () => handleFlowStep(step.dataset.flowStep));
    });

    // Export Modal
    dom.btnExportBack.addEventListener('click', () => closeExportView(true));
    dom.btnExportConfirm.addEventListener('click', confirmExport);
    dom.resultZone.addEventListener('keydown', event => {
      if (exportSession && event.key === 'Escape') {
        event.preventDefault();
        closeExportView(true);
      }
    });
    dom.exportLayoutMode.addEventListener('change', () => {
      if (dom.exportLayoutMode.value === 'dni') dom.exportPrintPreset.value = 'dni';
      else if (dom.exportPrintPreset.value === 'dni') dom.exportPrintPreset.value = 'square5';
      dniSwapped = false;
    });
    dom.exportPrintPreset.addEventListener('change', () => {
      if (dom.exportPrintPreset.value === 'dni') dom.exportLayoutMode.value = 'dni';
      else if (dom.exportLayoutMode.value === 'dni') dom.exportLayoutMode.value = 'pack';
      dniSwapped = false;
    });
    dom.scaleShortcuts.forEach(button => button.addEventListener('click', () => {
      dom.exportPrintScale.value = button.dataset.printScale;
      updateExportView();
    }));
    dom.btnDniSwap.addEventListener('click', () => {
      dniSwapped = !dniSwapped;
      updateExportView();
    });
    dom.btnCanvasFromPiece.addEventListener('click', () => {
      try {
        const item = readPrintItem();
        dom.exportPageSize.value = 'custom';
        dom.exportPaperUnit.value = 'mm';
        dom.exportPaperWidth.value = item.width;
        dom.exportPaperHeight.value = item.height;
        dom.exportPrintMargin.value = '0';
        updateExportView();
      } catch (error) { showToast(error.message, 'warning'); }
    });
    dom.btnPieceFromCanvas.addEventListener('click', () => {
      try {
        const paper = readCustomPaper();
        dom.exportPrintPreset.value = 'custom';
        dom.exportPrintUnit.value = 'mm';
        dom.exportPrintWidth.value = paper.width;
        dom.exportPrintHeight.value = paper.height;
        dom.exportPrintScale.value = '100';
        dom.exportPrintMargin.value = '0';
        dom.exportLayoutMode.value = 'single';
        updateExportView();
      } catch (error) { showToast(error.message, 'warning'); }
    });
    dom.previewPrev.addEventListener('click', () => { previewSheetIndex--; renderExportPreview(); });
    dom.previewNext.addEventListener('click', () => { previewSheetIndex++; renderExportPreview(); });
    dom.exportSettings.addEventListener('input', event => {
      if (!event.target.matches('input[type="number"], input[type="text"]')) return;
      if (event.target === dom.exportPageRange) previewSheetIndex = 0;
      updateExportView();
    });
    dom.exportSettings.addEventListener('change', event => {
      if (!event.target.matches('select, input[type="checkbox"]')) return;
      if (event.target === dom.exportFormat || event.target === dom.exportPurpose ||
          event.target === dom.exportLayoutMode || event.target === dom.exportPrintOutput) previewSheetIndex = 0;
      updateExportView();
    });

    // Tab controls
    dom.btnAddTab.addEventListener('click', addNewTab);
    dom.viewerPrev.addEventListener('click', () => selectPage(currentTab().activePageIndex - 1));
    dom.viewerNext.addEventListener('click', () => selectPage(currentTab().activePageIndex + 1));
    dom.viewerPageNumber.addEventListener('change', () => {
      const index = Number(dom.viewerPageNumber.value) - 1;
      if (Number.isInteger(index)) selectPage(index);
      updatePageCounter();
    });
    dom.viewerViewMode.addEventListener('change', updateDocumentView);
    dom.zoomIn.addEventListener('click', () => setViewerZoom(viewerZoom + 25));
    dom.zoomOut.addEventListener('click', () => setViewerZoom(viewerZoom - 25));
    dom.zoomReset.addEventListener('click', () => documentViewport.fit());
    dom.previewZoomIn.addEventListener('click', () => printViewport.setZoom((previewZoom + 25) / 100));
    dom.previewZoomOut.addEventListener('click', () => printViewport.setZoom((previewZoom - 25) / 100));
    dom.previewZoomReset.addEventListener('click', () => printViewport.fit());
    dom.cropModes.forEach(button => button.addEventListener('click', () => {
      Corners.setMode(button.dataset.cropMode);
      updateCropModeButtons();
    }));
    dom.cropReset.addEventListener('click', () => Corners.reset());
    dom.resetAdjustments.addEventListener('click', () => {
      setManualControlValues(NEUTRAL_ADJUSTMENTS);
      scheduleManualFilter();
    });
    dom.btnEnhanceDocument.addEventListener('click', () => {
      const settings = readAdjustmentValues();
      const active = settings.documentEnhance > 0 || settings.denoise > 0;
      settings.documentEnhance = active ? 0 : 65;
      settings.denoise = active ? 0 : 50;
      setManualControlValues(settings);
      scheduleManualFilter();
    });

    // Filter buttons
    dom.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = currentTab();
        const filter = btn.dataset.filter;
        clearTimeout(manualFilterTimer);
        manualFilterTimer = null;
        setManualControlValues(NEUTRAL_ADJUSTMENTS);
        tab.currentFilter = filter;
        const page = tab.scannedPages[tab.activePageIndex];
        if (!page) return;
        page.filter = filter;
        page.manualOptions = readAdjustmentValues();
        page.needsFilter = true;
        updateFilterButtons(filter);
        tab.filterRevision++;
        reapplyFilterToActivePage();
      });
    });

    // Sliders
    Object.values(dom.adjustmentControls).forEach(({ input }) => input.addEventListener('input', scheduleManualFilter));
    updateManualControlLabels();
  }

  function setManualControlValues(options) {
    const settings = normalizeAdjustments(options);
    Object.entries(dom.adjustmentControls).forEach(([key, control]) => { control.input.value = settings[key]; });
    updateManualControlLabels();
  }

  function updateManualControlLabels() {
    Object.entries(dom.adjustmentControls).forEach(([key, { input, output }]) => {
      const value = Number(input.value);
      if (key === 'saturation') {
        const delta = Math.round((value - 50) / 2);
        output.textContent = delta ? `${delta > 0 ? '+' : ''}${delta}%` : 'Natural';
      } else if (key === 'warmth') output.textContent = value ? `${value > 0 ? '+' : ''}${value}` : 'Neutra';
      else output.textContent = ['brightness', 'contrast'].includes(key) ? `${value > 0 ? '+' : ''}${value}` : `${value}%`;
    });
    const active = Number(dom.adjustmentControls.documentEnhance.input.value) > 0 || Number(dom.adjustmentControls.denoise.input.value) > 0;
    dom.btnEnhanceDocument.setAttribute('aria-pressed', String(active));
    dom.enhanceButtonLabel.textContent = active ? 'Quitar mejora automática' : 'Mejorar documento';
  }

  function readAdjustmentValues() {
    return normalizeAdjustments(Object.fromEntries(Object.entries(dom.adjustmentControls).map(([key, { input }]) => [key, input.value])));
  }

  function scheduleManualFilter() {
    updateManualControlLabels();
    clearTimeout(manualFilterTimer);
    const tab = currentTab();
    const page = tab.scannedPages[tab.activePageIndex];
    if (!page) return;
    page.manualOptions = readAdjustmentValues();
    page.needsFilter = true;
    page.renderRevision = (page.renderRevision || 0) + 1;
    tab.filterRevision++;
    updateFilterStatus('Actualizando vista previa…');
    manualFilterTimer = setTimeout(() => {
      manualFilterTimer = null;
      applyPageFilter(tab, page);
    }, 130);
  }

  // ======== Manual Camera ========

  async function startCamera() {
    if (!opencvReady) {
      showToast('Espera a que se cargue el motor de visión', 'warning');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast('Este navegador no permite usar la cámara. Elige una imagen.', 'warning');
      dom.fileInput.click();
      return;
    }

    stopCamera();
    dom.btnCameraCapture.disabled = true;
    dom.cameraStatus.textContent = 'Iniciando cámara…';
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: cameraFacingMode },
          width: { ideal: 2560 },
          height: { ideal: 1440 }
        }
      });
      dom.cameraVideo.srcObject = cameraStream;
      await dom.cameraVideo.play();
      setState('camera');
      dom.btnCameraCapture.disabled = false;
      dom.cameraStatus.textContent = 'Encuadra el documento y captura';

      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');
      dom.btnCameraSwitch.disabled = cameras.length < 2;

      const track = cameraStream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() || {};
      dom.btnCameraTorch.classList.toggle('hidden', !capabilities.torch);
    } catch (error) {
      console.error('[App] Camera error:', error);
      stopCamera();
      setState(currentTab().scannedPages.length ? 'result' : 'upload');
      showToast('No se pudo abrir la cámara. Revisa el permiso o elige una imagen.', 'error');
    }
  }

  function stopCamera() {
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;
    cameraTorchEnabled = false;
    if (dom.cameraVideo) dom.cameraVideo.srcObject = null;
    if (dom.btnCameraTorch) {
      dom.btnCameraTorch.classList.add('hidden');
      dom.btnCameraTorch.setAttribute('aria-pressed', 'false');
    }
  }

  function closeCamera() {
    stopCamera();
    setState(currentTab().scannedPages.length ? 'result' : 'upload');
    if (currentTab().scannedPages.length) showActivePage();
  }

  async function switchCamera() {
    cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    await startCamera();
  }

  async function toggleCameraTorch() {
    const track = cameraStream?.getVideoTracks()[0];
    if (!track) return;
    cameraTorchEnabled = !cameraTorchEnabled;
    try {
      await track.applyConstraints({ advanced: [{ torch: cameraTorchEnabled }] });
      dom.btnCameraTorch.setAttribute('aria-pressed', String(cameraTorchEnabled));
    } catch (error) {
      cameraTorchEnabled = false;
      dom.btnCameraTorch.setAttribute('aria-pressed', 'false');
      showToast('La linterna no está disponible en este modo', 'info');
    }
  }

  async function captureCameraFrame() {
    const video = dom.cameraVideo;
    if (!cameraStream || !video.videoWidth || !video.videoHeight) return;

    dom.btnCameraCapture.disabled = true;
    dom.cameraStatus.textContent = 'Preparando captura…';
    const tab = currentTab();
    const revision = ++tab.importRevision;
    const safeSize = fitImageDimensions(
      video.videoWidth,
      video.videoHeight,
      MAX_IMAGE_DIMENSION,
      MAX_IMAGE_PIXELS
    );
    const canvas = document.createElement('canvas');
    canvas.width = safeSize.width;
    canvas.height = safeSize.height;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, safeSize.width, safeSize.height);

    try {
      const img = await loadImage(canvas.toDataURL('image/jpeg', 0.95));
      if (!isActiveTab(tab) || revision !== tab.importRevision) return;
      originalImage = img;
      tab.originalImageDataUrl = img.src;
      tab.isReAdjusting = false;
      stopCamera();
      goToEditor();
      showToast('Captura lista. Ajusta las esquinas.', 'success');
    } catch (error) {
      console.error('[App] Capture error:', error);
      showToast('No se pudo preparar la captura', 'error');
      dom.btnCameraCapture.disabled = false;
      dom.cameraStatus.textContent = 'Intenta capturar de nuevo';
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  function handleFlowStep(step) {
    const tab = currentTab();
    if (step === 'capture') {
      if (tab.state === 'editor') {
        showToast('Termina o cancela el ajuste antes de capturar otra página', 'info');
        return;
      }
      startCamera();
    } else if (step === 'adjust' && tab.scannedPages.length) {
      startReAdjust();
    } else if (step === 'improve' && tab.scannedPages.length) {
      closeExportView();
      setState('result');
      showActivePage();
      dom.resultZone.scrollIntoView({ block: 'start' });
    } else if (step === 'organize' && tab.scannedPages.length) {
      closeExportView();
      markFlowStep('organize');
      dom.pagesStrip.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (step === 'export' && tab.scannedPages.length) {
      openExportView();
    }
  }

  function markFlowStep(activeStep) {
    dom.flowSteps.forEach(step => {
      const active = step.dataset.flowStep === activeStep;
      step.classList.toggle('active', active);
      step.setAttribute('aria-current', active ? 'step' : 'false');
    });
  }

  function updateFlowNavigation(state) {
    const hasPages = currentTab().scannedPages.length > 0;
    dom.flowSteps.forEach(step => {
      const name = step.dataset.flowStep;
      step.disabled = name !== 'capture' && !hasPages && !(name === 'adjust' && state === 'editor');
    });
    markFlowStep(state === 'editor' ? 'adjust' : state === 'result' ? (exportSession ? 'export' : 'improve') : 'capture');
  }

  function showUnfilteredPage() {
    const tab = currentTab();
    const page = tab.scannedPages[tab.activePageIndex];
    if (!page?.warpedDataUrl) return;
    const pageIndex = tab.activePageIndex;
    const revision = ++tab.viewRevision;
    dom.btnCompare.classList.add('is-comparing');
    const img = new Image();
    img.onload = () => {
      if (!isActiveTab(tab) || revision !== tab.viewRevision || tab.activePageIndex !== pageIndex) return;
      dom.canvasOutput.width = img.naturalWidth;
      dom.canvasOutput.height = img.naturalHeight;
      dom.canvasOutput.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = page.warpedDataUrl;
  }

  function stopComparing() {
    if (!dom.btnCompare.classList.contains('is-comparing')) return;
    dom.btnCompare.classList.remove('is-comparing');
    showActivePage();
  }

  // ======== Tab Management ========

  function addNewTab() {
    if (blockTabMutationWhileImporting()) return;
    if (tabs.length >= MAX_TABS) {
      showToast(`Máximo ${MAX_TABS} documentos simultáneos`, 'warning');
      return;
    }

    stopCamera();
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
    if (blockTabMutationWhileImporting()) return;
    if (index < 0 || index >= tabs.length) return;

    stopCamera();
    // Save current state and invalidate pending image callbacks.
    currentTab().importRevision++;
    saveTransientState();
    cleanupMats();
    originalImage = null;
    Corners.destroy();

    activeTabIndex = index;
    renderTabsBar();
    restoreTabView();
  }

  function closeTab(index) {
    if (blockTabMutationWhileImporting()) return;
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
    stopCamera();
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
      <div class="tab-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tab-confirm-title" aria-describedby="tab-confirm-description">
        <h3 id="tab-confirm-title">¿Cerrar "${tab.name}"?</h3>
        <p id="tab-confirm-description">Se perderán ${tab.scannedPages.length} página(s) escaneada(s).</p>
        <div class="tab-confirm-actions">
          <button class="btn btn-secondary" id="tab-confirm-cancel">Cancelar</button>
          <button class="btn btn-danger" id="tab-confirm-close">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const cancelButton = overlay.querySelector('#tab-confirm-cancel');
    const closeButton = overlay.querySelector('#tab-confirm-close');
    const dismiss = () => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      } else if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === cancelButton) {
          event.preventDefault();
          closeButton.focus();
        } else if (!event.shiftKey && document.activeElement === closeButton) {
          event.preventDefault();
          cancelButton.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeydown);
    cancelButton.focus();

    cancelButton.addEventListener('click', dismiss);
    closeButton.addEventListener('click', () => {
      dismiss();
      doCloseTab(tabIndex);
    });
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss();
    });
  }

  function saveTransientState() {
    // Save the current tab's visual state. No cv.Mat objects are saved.
    const tab = currentTab();
    if (!tab) return;
    flushActiveAdjustment();
    if (tab.state === 'editor') {
      tab.corners = Corners.getPoints();
      tab.editorCropMode = Corners.getMode();
    }
    // State (upload/editor/result) is already tracked in tab.state via setState
    // scannedPages, activePageIndex, currentFilter are already on the tab
    // originalImageDataUrl is saved when entering editor
  }

  function restoreTabView() {
    const tab = currentTab();
    if (!tab) return;
    const revision = ++tab.viewRevision;

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
        if (!isActiveTab(tab) || revision !== tab.viewRevision) return;
        originalImage = img;
        setupEditor(tab.corners);
      };
      img.onerror = () => {
        if (isActiveTab(tab)) showToast('No se pudo restaurar la imagen del editor', 'error');
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
      tabEl.setAttribute('role', 'presentation');

      const hasPages = tab.scannedPages.length > 0;

      tabEl.innerHTML = `
        <button class="tab__select" type="button" role="tab" aria-selected="${i === activeTabIndex}" tabindex="${i === activeTabIndex ? '0' : '-1'}">
          <span class="tab__status ${hasPages ? 'tab__status--has-pages' : 'tab__status--empty'}" aria-hidden="true"></span>
          <span class="tab__name">${tab.name}</span>
        </button>
        <button class="tab__close" type="button" title="Cerrar ${tab.name}" aria-label="Cerrar ${tab.name}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;

      const selectBtn = tabEl.querySelector('.tab__select');
      selectBtn.addEventListener('click', () => switchTab(i));
      selectBtn.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let targetIndex = i;
        if (event.key === 'ArrowLeft') targetIndex = (i - 1 + tabs.length) % tabs.length;
        if (event.key === 'ArrowRight') targetIndex = (i + 1) % tabs.length;
        if (event.key === 'Home') targetIndex = 0;
        if (event.key === 'End') targetIndex = tabs.length - 1;
        switchTab(targetIndex);
        requestAnimationFrame(() => dom.tabsList.querySelector('.tab.active .tab__select')?.focus());
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
    dom.btnAddTab.disabled = isImporting;
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

    if (isImporting) {
      showToast('Ya hay una importación en curso', 'warning');
      return;
    }

    const supportedFiles = Array.from(files).filter(isSupportedFile);
    const validFiles = supportedFiles.filter(file => file.size <= MAX_FILE_BYTES);

    if (supportedFiles.length > validFiles.length) {
      showToast('Se omitieron archivos de más de 50 MB', 'warning');
    }
    
    if (validFiles.length === 0) {
      showToast('No se encontraron imágenes o PDFs válidos', 'error');
      return;
    }

    if (validFiles.length === 1 && isPdfFile(validFiles[0])) {
      currentTab().isReAdjusting = false;
      processSinglePdf(validFiles[0], currentTab());
    } else if (validFiles.length === 1) {
      currentTab().isReAdjusting = false;
      loadSingleImageToEditor(validFiles[0]);
    } else {
      const availableSlots = MAX_PAGES_PER_TAB - currentTab().scannedPages.length;
      if (availableSlots <= 0) {
        showToast(`Este documento ya alcanzó el límite de ${MAX_PAGES_PER_TAB} páginas`, 'warning');
        return;
      }
      bulkQueue = validFiles.slice(0, availableSlots);
      if (validFiles.length > bulkQueue.length) {
        showToast(`Solo se procesarán ${bulkQueue.length} archivos por el límite de páginas`, 'warning');
      }
      isImporting = true;
      bulkTargetTabId = currentTab().id;
      const jobId = ++bulkJobId;
      renderTabsBar();
      processBulkQueue(jobId, bulkTargetTabId);
    }
  }

  function isSupportedFile(file) {
    const name = file.name.toLowerCase();
    return file.type.startsWith('image/') || file.type === 'application/pdf' ||
      /\.(png|jpe?g|webp|gif|bmp|pdf)$/.test(name);
  }

  function isPdfFile(file) {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
      img.src = src;
    });
  }

  async function loadImageFile(file) {
    const objectUrl = URL.createObjectURL(file);
    try {
      return await loadImage(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function normalizeImage(img, quality = 0.92) {
    const safeSize = fitImageDimensions(
      img.naturalWidth,
      img.naturalHeight,
      MAX_IMAGE_DIMENSION,
      MAX_IMAGE_PIXELS
    );
    const canvas = document.createElement('canvas');
    canvas.width = safeSize.width;
    canvas.height = safeSize.height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, safeSize.width, safeSize.height);
    context.drawImage(img, 0, 0, safeSize.width, safeSize.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    canvas.width = 0;
    canvas.height = 0;
    return loadImage(dataUrl);
  }

  async function loadSingleImageToEditor(file) {
    const tab = currentTab();
    const revision = ++tab.importRevision;
    try {
      const loadedImage = await loadImageFile(file);
      if (!isActiveTab(tab) || revision !== tab.importRevision) return;
      const img = await normalizeImage(loadedImage, 0.95);
      if (!isActiveTab(tab) || revision !== tab.importRevision) return;
      originalImage = img;
      tab.originalImageDataUrl = img.src;
      goToEditor();
    } catch (error) {
      console.error('[App] Image load error:', error);
      showToast('Error al cargar la imagen', 'error');
    }
  }

  async function processSinglePdf(file, tab) {
    isImporting = true;
    bulkTargetTabId = tab.id;
    const jobId = ++bulkJobId;
    renderTabsBar();
    try {
      await processPdf(file, false, tab);
    } finally {
      if (jobId === bulkJobId) {
        isImporting = false;
        bulkTargetTabId = null;
        renderTabsBar();
      }
    }
  }

  async function processPdf(file, isBulk = false, targetTab = currentTab()) {
    const tab = targetTab;
    showToast('Procesando PDF...', 'info', 'pdf-progress');
    let loadingTask = null;
    let pdf = null;
    const initialPageCount = tab.scannedPages.length;

    try {
      if (typeof pdfjsLib === 'undefined') {
        showToast('La librería PDF.js no está cargada aún', 'error');
        return;
      }
      // Passing a blob: URL makes the PDF worker perform another fetch. Some
      // browsers and service-worker combinations report status 0 for that
      // request, even though the user already selected a valid local file.
      // Supplying bytes directly avoids the extra fetch entirely.
      const pdfBytes = new Uint8Array(await file.arrayBuffer());
      loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
      pdf = await loadingTask.promise;

      const availableSlots = Math.max(0, MAX_PAGES_PER_TAB - tab.scannedPages.length);
      const pagesToProcess = Math.min(pdf.numPages, availableSlots);
      if (pagesToProcess === 0) {
        showToast(`Este documento ya alcanzó el límite de ${MAX_PAGES_PER_TAB} páginas`, 'warning');
        return;
      }
      if (pagesToProcess < pdf.numPages) {
        showToast(`Se procesarán ${pagesToProcess} de ${pdf.numPages} páginas por el límite de memoria`, 'warning');
      }

      for (let i = 1; i <= pagesToProcess; i++) {
        const canvas = document.createElement('canvas');
        const outCanvas = document.createElement('canvas');
        try {
          showToast(`Procesando página ${i}/${pdf.numPages} del PDF...`, 'info', 'pdf-progress');
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
          const context = canvas.getContext('2d');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          context.fillStyle = '#FFFFFF';
          context.fillRect(0, 0, canvas.width, canvas.height);
          
          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise;
          
          let mat = null;
          let filtered = null;
          try {
            mat = cv.imread(canvas);
            filtered = Scanner.applyFilter(mat, 'original');
            
            Scanner.drawToCanvas(filtered, outCanvas);
            
            const corners = [
              {x: 0, y: 0},
              {x: canvas.width - 1, y: 0},
              {x: canvas.width - 1, y: canvas.height - 1},
              {x: 0, y: canvas.height - 1}
            ];
            
            const sourceDataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const pageData = {
              originalDataUrl: sourceDataUrl,
              corners: corners,
              warpedDataUrl: sourceDataUrl,
              dataUrl: outCanvas.toDataURL('image/jpeg', 0.9),
              width: outCanvas.width,
              height: outCanvas.height,
              filter: 'original',
              isPdf: true
            };
            if (!insertPage(tab, pageData)) {
              showToast('Se detuvo el PDF para proteger la memoria disponible', 'warning');
              break;
            }
          } finally {
            if (mat) mat.delete();
            if (filtered) filtered.delete();
          }
        } catch (pageError) {
          console.error(`[App] Error processing PDF page ${i}:`, pageError);
          showToast(`Error en página ${i}: ${pageError.message || pageError}`, 'warning');
        } finally {
          // Release canvas memory immediately
          canvas.width = 0;
          canvas.height = 0;
          outCanvas.width = 0;
          outCanvas.height = 0;
        }
      }
      const importedPages = tab.scannedPages.length - initialPageCount;
      if (importedPages === 0) {
        showToast('El PDF no produjo ninguna página válida', 'error');
        return;
      }
      if (!isBulk && isActiveTab(tab)) {
        showToast(`${importedPages} página(s) importada(s) del PDF`, 'success');
        tab.activePageIndex = tab.scannedPages.length - 1;
        renderPagesStrip();
        updatePageCounter();
        renderTabsBar();
        showActivePage();
        setState('result');
      }
    } catch (error) {
      console.error('[App] Error processing PDF:', error);
      showToast(`Error al procesar el archivo PDF: ${error.message || error}`, 'error');
    } finally {
      try {
        if (pdf) await pdf.destroy();
        else if (loadingTask) await loadingTask.destroy();
      } catch (cleanupError) {
        console.warn('[App] PDF worker cleanup failed:', cleanupError);
      }
    }
  }

  // ======== Bulk Processing ========

  async function processBulkQueue(jobId, targetTabId) {
    if (jobId !== bulkJobId || targetTabId !== bulkTargetTabId) return;
    const tab = findTabById(targetTabId);
    if (!tab) {
      finishBulkImport(jobId, null, false);
      return;
    }

    if (bulkQueue.length === 0) {
      finishBulkImport(jobId, tab, true);
      return;
    }

    const file = bulkQueue.shift();
    const remaining = bulkQueue.length;
    showToast(`Procesando archivo... (${remaining} restantes)`, 'info');

    try {
      if (isPdfFile(file)) {
        await processPdf(file, true, tab);
      } else if (tab.scannedPages.length < MAX_PAGES_PER_TAB) {
        const loadedImage = await loadImageFile(file);
        const normalizedImage = await normalizeImage(loadedImage);
        if (!autoScanImage(normalizedImage, tab)) {
          bulkQueue = [];
          showToast('Se detuvo la carga para proteger la memoria disponible', 'warning');
        }
      }
    } catch (error) {
      console.error('[App] Bulk import error:', error);
      showToast(`Se omitió “${file.name}” porque no pudo procesarse`, 'warning');
    } finally {
      if (jobId === bulkJobId && isImporting) {
        setTimeout(() => processBulkQueue(jobId, targetTabId), 50);
      }
    }
  }

  function finishBulkImport(jobId, tab, succeeded) {
    if (jobId !== bulkJobId) return;
    isImporting = false;
    bulkQueue = [];
    bulkTargetTabId = null;
    renderTabsBar();

    if (!tab || !isActiveTab(tab)) return;
    if (tab.scannedPages.length > 0) {
      tab.activePageIndex = tab.scannedPages.length - 1;
      renderPagesStrip();
      updatePageCounter();
      showActivePage();
      setState('result');
    }
    showToast(succeeded ? 'Carga múltiple completada' : 'Carga múltiple cancelada', succeeded ? 'success' : 'warning');
  }

  function autoScanImage(img, tab) {
    if (!tab || tab.scannedPages.length >= MAX_PAGES_PER_TAB) return false;
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
        {x: imgW - 1, y: 0},
        {x: imgW - 1, y: imgH - 1},
        {x: 0, y: imgH - 1}
      ];
    }

    let warped = null;
    let filtered = null;
    try {
      warped = Scanner.warpPerspective(mat, detectedPoints);
      filtered = Scanner.applyFilter(warped, 'original');

      const outCanvas = document.createElement('canvas');
      Scanner.drawToCanvas(filtered, outCanvas);

      const warpCanvas = document.createElement('canvas');
      warpCanvas.width = warped.cols;
      warpCanvas.height = warped.rows;
      cv.imshow(warpCanvas, warped);

      const pageData = {
        originalDataUrl,
        corners: detectedPoints,
        warpedDataUrl: warpCanvas.toDataURL('image/jpeg', 0.9),
        dataUrl: outCanvas.toDataURL('image/jpeg', 0.9),
        width: outCanvas.width,
        height: outCanvas.height,
        filter: 'original'
      };
      return insertPage(tab, pageData);
    } finally {
      if (mat) mat.delete();
      if (warped) warped.delete();
      if (filtered) filtered.delete();
      tempCanvas.width = 0;
      tempCanvas.height = 0;
    }
  }

  // ======== State Management ========

  function setState(state) {
    if (exportSession && (state !== 'result' || exportSession.tab !== currentTab())) closeExportView();
    currentTab().state = state === 'camera' ? 'upload' : state;
    dom.btnAddPageRail.classList.toggle('hidden', state !== 'result');
    document.body.classList.toggle('camera-open', state === 'camera');
    document.body.dataset.workspace = state;
    dom.appMain.classList.toggle('has-document', ['result', 'editor'].includes(state) && currentTab().scannedPages.length > 0);

    dom.uploadZone.classList.add('hidden');
    dom.cameraZone.classList.add('hidden');
    dom.editorZone.classList.add('hidden');
    dom.resultZone.classList.add('hidden');

    switch (state) {
      case 'camera':
        dom.cameraZone.classList.remove('hidden');
        break;

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
    updateFlowNavigation(state);
    if (state === 'result') requestAnimationFrame(updateDocumentView);
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

    const stage = dom.canvasWrapper.parentElement;
    const maxDisplayWidth = Math.max(100, stage.clientWidth - 48);
    const maxDisplayHeight = Math.max(160, stage.clientHeight - 48);
    const scale = Math.min(maxDisplayWidth / imgW, maxDisplayHeight / imgH, 1);
    const displayW = Math.round(imgW * scale);
    const displayH = Math.round(imgH * scale);
    dom.canvasWrapper.style.width = `${displayW}px`;

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
    tempCanvas.width = 0;
    tempCanvas.height = 0;

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
      imgH,
      currentTab().editorCropMode
    );
    updateCropModeButtons();

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
    const tab = currentTab();
    
    const dst = new cv.Mat();
    cv.rotate(originalMat, dst, cv.ROTATE_90_CLOCKWISE);
    
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = dst.cols;
    rotatedCanvas.height = dst.rows;
    cv.imshow(rotatedCanvas, dst);
    
    const newSrc = rotatedCanvas.toDataURL('image/jpeg', 0.95);
    
    const img = new Image();
    img.onload = () => {
      if (!isActiveTab(tab)) return;
      originalImage = img;
      tab.originalImageDataUrl = img.src;
      // We do not pass predefinedCorners because the image rotated and old points are invalid
      goToEditor(null);
    };
    img.onerror = () => {
      if (isActiveTab(tab)) showToast('No se pudo rotar la imagen', 'error');
    };
    img.src = newSrc;
    
    dst.delete();
  }

  function navigateEditor(direction) {
    performScan(direction === 1 ? 'next' : 'prev');
  }

  // ======== Re-adjust ========

  function startReAdjust() {
    flushActiveAdjustment();
    const tab = currentTab();
    if (tab.activePageIndex < 0 || tab.activePageIndex >= tab.scannedPages.length) return;
    
    const page = tab.scannedPages[tab.activePageIndex];
    if (!page.originalDataUrl) {
      showToast('No se puede re-ajustar, falta imagen original', 'error');
      return;
    }

    tab.isReAdjusting = true;
    tab.editorCropMode = page.cropMode || 'perspective';

    const img = new Image();
    img.onload = () => {
      if (!isActiveTab(tab) || tab.scannedPages[tab.activePageIndex] !== page) return;
      originalImage = img;
      tab.originalImageDataUrl = img.src;
      goToEditor(page.corners);
    };
    img.onerror = () => {
      if (isActiveTab(tab)) showToast('No se pudo cargar la imagen original', 'error');
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
    if (!tab.isReAdjusting && tab.scannedPages.length >= MAX_PAGES_PER_TAB) {
      showToast(`Este documento ya alcanzó el límite de ${MAX_PAGES_PER_TAB} páginas`, 'warning');
      return;
    }

    let filtered = null;
    try {
      const cornerPoints = Corners.getPoints();

      if (warpedMat) warpedMat.delete();
      warpedMat = Scanner.warpPerspective(originalMat, cornerPoints);

      const targetFilter = tab.isReAdjusting ? tab.scannedPages[tab.activePageIndex].filter : 'original';
      
      const previousPage = tab.isReAdjusting ? tab.scannedPages[tab.activePageIndex] : null;
      const options = normalizeAdjustments(previousPage?.manualOptions);
      filtered = Scanner.applyFilter(warpedMat, targetFilter, options);
      Scanner.drawToCanvas(filtered, dom.canvasOutput);

      const warpCanvas = document.createElement('canvas');
      warpCanvas.width = warpedMat.cols;
      warpCanvas.height = warpedMat.rows;
      cv.imshow(warpCanvas, warpedMat);

      const pageData = {
        ...(previousPage || {}),
        originalDataUrl: originalImage.src,
        corners: cornerPoints,
        warpedDataUrl: warpCanvas.toDataURL('image/jpeg', 0.92),
        dataUrl: dom.canvasOutput.toDataURL('image/jpeg', 0.92),
        width: dom.canvasOutput.width,
        height: dom.canvasOutput.height,
        filter: targetFilter,
        manualOptions: options,
        cropMode: Corners.getMode(),
        needsFilter: false,
        filterTask: null
      };

      if (tab.isReAdjusting) {
        if (!canStorePage(tab, pageData, tab.activePageIndex)) {
          showToast('El ajuste excede el límite de memoria del documento', 'warning');
          return;
        }
        tab.scannedPages[tab.activePageIndex] = pageData;
        showToast('Ajuste guardado', 'success');
      } else {
        if (!insertPage(tab, pageData)) {
          showToast('No se agregó la página para proteger la memoria disponible', 'warning');
          return;
        }
        tab.activePageIndex = tab.scannedPages.length - 1;
        showToast(`¡Página escaneada!`, 'success');
      }

      tab.isReAdjusting = false;
      tab.corners = null;
      tab.originalImageDataUrl = null;
      filtered.delete();
      filtered = null;
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
            tab.editorCropMode = nextPage.cropMode || 'perspective';
            const img = new Image();
            img.onload = () => {
              if (!isActiveTab(tab) || tab.scannedPages[tab.activePageIndex] !== nextPage) return;
              originalImage = img;
              tab.originalImageDataUrl = img.src;
              goToEditor(nextPage.corners);
            };
            img.onerror = () => {
              if (isActiveTab(tab)) showToast('No se pudo cargar la página original', 'error');
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
    } finally {
      if (filtered) filtered.delete();
    }
  }

  // ======== Re-apply filter to active page ========

  function updateFilterButtons(filter) {
    dom.filterBtns.forEach(button => {
      const active = button.dataset.filter === filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function updateFilterStatus(message) {
    const labels = { original: 'Original', auto: 'Automático', document: 'Texto B/N', whiteboard: 'Pizarra',
      color: 'Color natural', manual: 'Personalizado', gray: 'Grises', sepia: 'Sepia', sketch: 'Boceto', highcontrast: 'Alto contraste' };
    const page = currentTab().scannedPages[currentTab().activePageIndex];
    const adjusted = Object.entries(normalizeAdjustments(page?.manualOptions)).some(([key, value]) => value !== NEUTRAL_ADJUSTMENTS[key]);
    dom.filterStatus.textContent = message || (currentTab().currentFilter === 'original' && !adjusted
      ? 'Original · sin cambios de color'
      : `${labels[currentTab().currentFilter] || 'Original'} · cambios guardados en esta página`);
  }

  function reapplyFilterToActivePage() {
    const tab = currentTab();
    const page = tab.scannedPages[tab.activePageIndex];
    if (!page) return Promise.resolve(false);
    return applyPageFilter(tab, page);
  }

  function applyPageFilter(tab, page) {
    const revision = (page.renderRevision || 0) + 1;
    page.renderRevision = revision;
    const filter = page.filter;
    const options = normalizeAdjustments(page.manualOptions);
    const task = (async () => {
      const image = await loadImage(page.warpedDataUrl);
      if (revision !== page.renderRevision || !findTabById(tab.id) || !tab.scannedPages.includes(page)) return false;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      let mat = null, filtered = null;
      try {
        mat = cv.imread(canvas);
        filtered = Scanner.applyFilter(mat, filter, options);
        Scanner.drawToCanvas(filtered, canvas);
        const index = tab.scannedPages.indexOf(page);
        const updated = { ...page, dataUrl: canvas.toDataURL('image/jpeg', 0.92),
          width: canvas.width, height: canvas.height, filter, manualOptions: options };
        if (!canStorePage(tab, updated, index)) throw new Error('El ajuste supera la memoria disponible. Reduce las páginas del documento.');
        Object.assign(page, updated, { needsFilter: false });
        if (isActiveTab(tab)) {
          if (tab.scannedPages[tab.activePageIndex] === page) {
            tab.viewRevision++;
            dom.canvasOutput.width = canvas.width;
            dom.canvasOutput.height = canvas.height;
            dom.canvasOutput.getContext('2d').drawImage(canvas, 0, 0);
            updateViewerSize();
            updateFilterStatus();
          }
          renderPagesStrip();
          if (exportSession) updateExportView();
        }
        return true;
      } finally {
        mat?.delete();
        filtered?.delete();
        canvas.width = 0; canvas.height = 0;
      }
    })().catch(error => {
      console.error('[App] Filter error:', error);
      if (revision === page.renderRevision) {
        page.needsFilter = true;
        if (isActiveTab(tab)) {
          showToast(error.message || 'No se pudo aplicar el ajuste.', 'error');
          updateFilterStatus('No se pudo guardar el ajuste. Intenta nuevamente.');
        }
      }
      return false;
    });
    pendingFilters.add(task);
    page.filterTask = task;
    task.finally(() => {
      pendingFilters.delete(task);
      if (page.filterTask === task) page.filterTask = null;
    });
    return task;
  }

  function flushActiveAdjustment() {
    if (!manualFilterTimer) return;
    clearTimeout(manualFilterTimer);
    manualFilterTimer = null;
    reapplyFilterToActivePage();
  }

  async function settlePageFilters() {
    clearTimeout(manualFilterTimer);
    manualFilterTimer = null;
    const tab = currentTab();
    await Promise.all(tab.scannedPages.filter(page => page.needsFilter).map(page => applyPageFilter(tab, page)));
    await Promise.all([...pendingFilters]);
    if (tab.scannedPages.some(page => page.needsFilter)) throw new Error('Un ajuste no se pudo guardar. Revisa la página antes de descargar.');
  }

  async function applyFilterToAllPages() {
    const tab = currentTab();
    if (tab.scannedPages.length <= 1) {
      showToast('Agrega otra página para aplicar el acabado a todas.', 'info');
      return;
    }
    flushActiveAdjustment();
    const filter = tab.currentFilter;
    const options = readAdjustmentValues();
    const revision = ++tab.filterRevision;
    let completed = 0;
    dom.btnApplyAll.disabled = true;
    try {
      for (const page of [...tab.scannedPages]) {
        if (revision !== tab.filterRevision || !findTabById(tab.id)) break;
        page.filter = filter;
        page.manualOptions = { ...options };
        page.needsFilter = true;
        if (await applyPageFilter(tab, page)) completed++;
        else break;
        showToast(`Aplicando acabado: ${completed}/${tab.scannedPages.length}`, 'info', 'filter-progress');
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (isActiveTab(tab)) { showActivePage(); renderPagesStrip(); }
      showToast(completed === tab.scannedPages.length ? 'Acabado y ajustes aplicados a todas' : `Se actualizaron ${completed} páginas.`,
        completed === tab.scannedPages.length ? 'success' : 'warning');
    } finally { dom.btnApplyAll.disabled = false; }
  }

  // ======== Page Actions ========

  function updateCropModeButtons() {
    dom.cropModes.forEach(button => {
      const active = button.dataset.cropMode === Corners.getMode();
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function initViewports() {
    const updateZoomControls = (state, reset, minus, plus) => {
      reset.textContent = `${Math.round(state.zoom * 100)}%`;
      reset.disabled = !state.enabled;
      minus.disabled = !state.enabled || state.zoom <= state.minZoom;
      plus.disabled = !state.enabled || state.zoom >= state.maxZoom;
    };
    documentViewport = createPanZoomViewport(dom.viewerScroll, {
      onChange(state) {
        viewerZoom = state.zoom * 100;
        updateZoomControls(state, dom.zoomReset, dom.zoomOut, dom.zoomIn);
      }
    });
    printViewport = createPanZoomViewport(dom.previewStage, {
      padding: 18,
      onChange(state) {
        previewZoom = state.zoom * 100;
        updateZoomControls(state, dom.previewZoomReset, dom.previewZoomOut, dom.previewZoomIn);
      }
    });
    documentViewport.setEnabled(false);
    printViewport.setEnabled(false);
  }

  function setViewerZoom(value) {
    documentViewport.setZoom(value / 100);
  }

  function updateViewerSize() {
    if (exportSession || currentTab()?.state !== 'result' || !dom.canvasOutput.width) return;
    const tab = currentTab();
    const all = dom.viewerViewMode.value === 'all';
    const identity = all ? `all-${tab.id}` : tab.scannedPages[tab.activePageIndex];
    const content = all ? dom.documentPages : dom.singlePageView;
    let width = dom.canvasOutput.width;
    let height = dom.canvasOutput.height;
    if (all) {
      width = 800;
      content.style.width = `${width}px`;
      content.style.height = 'auto';
      height = Math.max(1, content.offsetHeight);
    }
    documentViewport.setContent(content, { width, height, mode: all ? 'width' : 'contain',
      wheel: all ? 'pan' : 'zoom', reset: identity !== viewerIdentity });
    viewerIdentity = identity;
  }

  function updateDocumentView() {
    if (exportSession || currentTab()?.state !== 'result') return;
    const all = dom.viewerViewMode.value === 'all';
    dom.singlePageView.classList.toggle('hidden', all);
    dom.documentPages.classList.toggle('hidden', !all);
    dom.btnCompare.classList.toggle('hidden', all);
    if (all) renderDocumentPages();
    updateViewerSize();
  }

  function renderDocumentPages() {
    const tab = currentTab();
    if (dom.documentPages.children.length !== tab.scannedPages.length || dom.documentPages.dataset.tabId !== String(tab.id)) {
      dom.documentPages.replaceChildren();
      dom.documentPages.dataset.tabId = tab.id;
      tab.scannedPages.forEach((page, index) => {
        const article = document.createElement('article');
        article.className = 'document-page';
        article.dataset.pageIndex = index;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'document-page__paper';
        button.setAttribute('aria-label', `Seleccionar página ${index + 1} para editar`);
        const image = document.createElement('img');
        image.alt = `Página ${index + 1}`;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.width = page.width;
        image.height = page.height;
        button.appendChild(image);
        button.addEventListener('click', () => selectPage(index));
        const caption = document.createElement('button');
        caption.className = 'document-page__caption';
        caption.type = 'button';
        caption.textContent = `Página ${index + 1} · Editar`;
        caption.addEventListener('click', () => {
          selectPage(index);
          dom.viewerViewMode.value = 'single';
          updateDocumentView();
        });
        article.append(button, caption);
        dom.documentPages.appendChild(article);
      });
    }
    Array.from(dom.documentPages.children).forEach((article, index) => {
      const page = tab.scannedPages[index];
      const image = article.querySelector('img');
      if (image.getAttribute('src') !== page.dataUrl) image.src = page.dataUrl;
      image.width = page.width; image.height = page.height;
      article.classList.toggle('active', index === tab.activePageIndex);
    });
    if (dom.viewerViewMode.value === 'all') updateViewerSize();
  }

  function addAnotherPage() {
    if (currentTab().state !== 'result' || blockTabMutationWhileImporting()) return;
    if (currentTab().scannedPages.length >= MAX_PAGES_PER_TAB) {
      showToast(`Este documento ya alcanzó el límite de ${MAX_PAGES_PER_TAB} páginas`, 'warning');
      return;
    }
    dom.fileInput.click();
  }

  function duplicateActivePage() {
    if (blockTabMutationWhileImporting()) return;
    const tab = currentTab();
    const page = tab.scannedPages[tab.activePageIndex];
    if (tab.state !== 'result' || !page) return;

    const copyIndex = tab.activePageIndex + 1;
    const copy = {
      ...page,
      corners: page.corners?.map(point => ({ ...point })),
      manualOptions: normalizeAdjustments(page.manualOptions),
      filterTask: null,
      renderRevision: 0
    };
    if (!insertPage(tab, copy, copyIndex)) {
      const message = tab.scannedPages.length >= MAX_PAGES_PER_TAB
        ? `Este documento ya alcanzó el límite de ${MAX_PAGES_PER_TAB} páginas`
        : 'No se pudo duplicar la página por el límite de memoria';
      showToast(message, 'warning');
      return;
    }

    renderPagesStrip();
    selectPage(copyIndex);
    showToast(`Página duplicada como página ${copyIndex + 1}`, 'success');
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
    const pageIndex = tab.activePageIndex;
    const revision = ++tab.viewRevision;

    tab.currentFilter = page.filter;
    updateFilterButtons(page.filter);
    if (dom.advancedFilters && ['gray', 'sepia', 'sketch', 'highcontrast', 'manual'].includes(page.filter)) {
      dom.advancedFilters.open = true;
    }

    const img = new Image();
    img.onload = () => {
      if (!isActiveTab(tab) || revision !== tab.viewRevision ||
          tab.activePageIndex !== pageIndex || tab.scannedPages[pageIndex] !== page) return;
      dom.canvasOutput.width = img.naturalWidth;
      dom.canvasOutput.height = img.naturalHeight;
      const ctx = dom.canvasOutput.getContext('2d');
      ctx.drawImage(img, 0, 0);
      updateViewerSize();
    };
    img.onerror = () => {
      if (isActiveTab(tab) && revision === tab.viewRevision) {
        showToast('No se pudo mostrar la página seleccionada', 'error');
      }
    };
    img.src = page.dataUrl;

    updatePageCounter();

    if (dom.btnReadjust) {
      dom.btnReadjust.style.display = 'inline-flex';
    }

    setManualControlValues(page.manualOptions || NEUTRAL_ADJUSTMENTS);
    dom.manualAdjustments.classList.remove('hidden');
    updateFilterStatus(page.needsFilter ? 'Actualizando vista previa…' : undefined);
    if (page.needsFilter && !page.filterTask) applyPageFilter(tab, page);

    highlightActiveThumb();
  }

  function selectPage(index) {
    const tab = currentTab();
    if (index < 0 || index >= tab.scannedPages.length) return;
    if (tab.state === 'editor') {
      if (index === tab.activePageIndex) return;
      if (tab.isReAdjusting) {
        performScan();
        if (tab.state === 'editor') return;
      } else return;
    }
    flushActiveAdjustment();
    tab.activePageIndex = index;
    showActivePage();
    if (dom.viewerViewMode.value === 'all') {
      const article = dom.documentPages.querySelector(`[data-page-index="${index}"]`);
      if (article) documentViewport.revealRect({ y: article.offsetTop, height: article.offsetHeight });
    }
  }

  // ======== Drag & Drop Reordering (Pages Strip) ========

  let draggedItemIndex = null;

  function renderPagesStrip() {
    if (!dom.pagesStripList) return;

    const tab = currentTab();
    dom.railPageCount.textContent = tab.scannedPages.length;
    dom.pagesStripList.innerHTML = '';

    if (tab.scannedPages.length === 0) {
      dom.pagesStrip.classList.add('hidden');
      dom.btnPageLeft.disabled = true;
      dom.btnPageRight.disabled = true;
      return;
    }

    dom.pagesStrip.classList.remove('hidden');
    dom.btnPageLeft.disabled = tab.activePageIndex <= 0;
    dom.btnPageRight.disabled = tab.activePageIndex >= tab.scannedPages.length - 1;

    tab.scannedPages.forEach((page, i) => {
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'page-thumb' + (i === tab.activePageIndex ? ' active' : '');
      thumb.title = `Página ${i + 1}`;
      thumb.setAttribute('aria-label', `Seleccionar página ${i + 1}. Alt más flecha izquierda o derecha para reordenar.`);
      thumb.setAttribute('draggable', 'true');
      thumb.dataset.index = i;

      const img = document.createElement('img');
      img.src = page.dataUrl;
      img.alt = `Página ${i + 1}`;
      img.draggable = false;
      img.loading = 'lazy';
      img.decoding = 'async';

      const label = document.createElement('span');
      label.className = 'page-thumb__label';
      label.textContent = i + 1;

      thumb.appendChild(img);
      thumb.appendChild(label);

      thumb.addEventListener('click', () => selectPage(i));
      thumb.addEventListener('keydown', (event) => {
        if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const targetIndex = event.key === 'ArrowLeft' ? i - 1 : i + 1;
        if (movePage(i, targetIndex)) {
          requestAnimationFrame(() => dom.pagesStripList.querySelector(`[data-index="${targetIndex}"]`)?.focus());
        }
      });

      thumb.addEventListener('dragstart', handleDragStart);
      thumb.addEventListener('dragover', handleDragOver);
      thumb.addEventListener('dragleave', handleDragLeave);
      thumb.addEventListener('drop', handleDrop);
      thumb.addEventListener('dragend', handleDragEnd);

      dom.pagesStripList.appendChild(thumb);
    });

    highlightActiveThumb();
    if (dom.viewerViewMode.value === 'all') renderDocumentPages();
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
    if (draggedItemIndex !== null) movePage(draggedItemIndex, targetIndex);
    return false;
  }

  function movePage(fromIndex, targetIndex) {
    const tab = currentTab();
    if (fromIndex === targetIndex || fromIndex < 0 || targetIndex < 0 ||
        fromIndex >= tab.scannedPages.length || targetIndex >= tab.scannedPages.length) return false;

    const itemToMove = tab.scannedPages.splice(fromIndex, 1)[0];
    tab.scannedPages.splice(targetIndex, 0, itemToMove);
    if (tab.activePageIndex === fromIndex) {
      tab.activePageIndex = targetIndex;
    } else if (tab.activePageIndex > fromIndex && tab.activePageIndex <= targetIndex) {
      tab.activePageIndex--;
    } else if (tab.activePageIndex < fromIndex && tab.activePageIndex >= targetIndex) {
      tab.activePageIndex++;
    }

    renderPagesStrip();
    updatePageCounter();
    showToast('Páginas reordenadas', 'success');
    return true;
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
      t.setAttribute('aria-current', i === tab.activePageIndex ? 'page' : 'false');
    });
    Array.from(dom.documentPages.children).forEach((article, index) => article.classList.toggle('active', index === tab.activePageIndex));
    const activeThumb = dom.pagesStripList.querySelector('.page-thumb.active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  function updatePageCounter() {
    const tab = currentTab();
    dom.viewerPageNumber.value = tab.activePageIndex + 1;
    dom.viewerPageNumber.max = tab.scannedPages.length;
    dom.viewerPageTotal.textContent = `/ ${tab.scannedPages.length}`;
    dom.viewerPrev.disabled = tab.activePageIndex <= 0;
    dom.viewerNext.disabled = tab.activePageIndex >= tab.scannedPages.length - 1;
    dom.btnPageLeft.disabled = tab.activePageIndex <= 0;
    dom.btnPageRight.disabled = tab.activePageIndex >= tab.scannedPages.length - 1;
  }

  function resetFilterUI() {
    const tab = currentTab();
    if (tab) tab.currentFilter = 'original';
    dom.filterBtns.forEach(b => b.classList.remove('active'));
    document.getElementById('filter-original').classList.add('active');
  }

    // ======== Export & Download ========

  let isJsPdfLoading = false;

  function loadJsPdfLib() {
    if (typeof jspdf !== 'undefined' || typeof window.jspdf !== 'undefined' || isJsPdfLoading) return;
    isJsPdfLoading = true;
    const existingScript = document.getElementById('jspdf-script-tag');
    if (existingScript) {
      existingScript.remove();
    }
    const script = document.createElement('script');
    script.id = 'jspdf-script-tag';
    script.src = './jspdf.js';
    script.onload = () => { isJsPdfLoading = false; };
    script.onerror = () => { 
      isJsPdfLoading = false; 
      script.remove();
      showToast('Error al cargar la librería PDF', 'error'); 
    };
    document.head.appendChild(script);
  }

  function openExportView() {
    const tab = currentTab();
    if (exportSession || !tab.scannedPages.length || blockTabMutationWhileImporting()) return;
    if (tab.state !== 'result') {
      showToast('Guarda la página antes de exportar.', 'info');
      return;
    }

    flushActiveAdjustment();
    dom.toastContainer.querySelectorAll('.toast--info, .toast--success').forEach(toast => {
      clearTimeout(toast.dismissTimer);
      toast.remove();
    });
    exportSession = { tab, trigger: document.activeElement };
    dom.exportPageRange.value = '';
    previewSheetIndex = 0;
    previewPaperKey = null;
    dniSwapped = false;
    dom.appMain.classList.add('export-workspace');
    dom.documentView.classList.add('hidden');
    dom.editSettings.classList.add('hidden');
    dom.resultControls.classList.add('hidden');
    dom.exportPreview.classList.remove('hidden');
    dom.exportPanel.classList.remove('hidden');
    markFlowStep('export');
    updateExportView();
    dom.exportPanelTitle.focus({ preventScroll: true });
    dom.resultZone.scrollIntoView({ block: 'start' });
  }

  function closeExportView(restoreFocus = false) {
    if (!exportSession) return;
    const { trigger } = exportSession;
    exportSession = null;
    previewRevision++;
    previewImages.clear();
    previewPlan = null;
    printViewport.setEnabled(false);
    dom.appMain.classList.remove('export-workspace');
    dom.exportPanel.classList.add('hidden');
    dom.exportPreview.classList.add('hidden');
    dom.documentView.classList.remove('hidden');
    dom.editSettings.classList.remove('hidden');
    dom.resultControls.classList.remove('hidden');
    markFlowStep('improve');
    updateDocumentView();
    if (restoreFocus && trigger instanceof HTMLElement) {
      trigger.focus({ preventScroll: true });
      dom.resultZone.scrollIntoView({ block: 'start' });
    }
  }

  function updateExportView() {
    if (!exportSession) return;
    const isPdf = dom.exportFormat.value === 'pdf';
    const isPrint = isPdf && dom.exportPurpose.value === 'print';
    if (isPrint && dom.exportPageSize.value === 'original') dom.exportPageSize.value = 'auto';
    if (!isPrint && dom.exportPageSize.value === 'auto') dom.exportPageSize.value = 'A4';

    const size = dom.exportPageSize.value;
    const output = dom.exportPrintOutput.value;
    const layout = dom.exportLayoutMode.value;
    dom.groupExportPurpose.classList.toggle('hidden', !isPdf);
    dom.groupImageMethod.classList.toggle('hidden', isPdf);
    dom.groupPrintLayout.classList.toggle('hidden', !isPrint);
    dom.groupPrintOutput.classList.toggle('hidden', !isPrint);
    dom.groupTileOptions.classList.toggle('hidden', output === 'full');
    dom.groupTileMargin.classList.toggle('hidden', output === 'plotter');
    dom.groupCustomPaper.classList.toggle('hidden', size !== 'custom');
    dom.btnPieceFromCanvas.classList.toggle('hidden', !isPrint);
    dom.exportFieldRow.classList.toggle('hidden', size === 'original');
    dom.groupOrientation.classList.toggle('hidden', size === 'original' || size === 'custom');
    dom.exportPageSizeAuto.hidden = dom.exportPageSizeAuto.disabled = !isPrint;
    const originalOption = dom.exportPageSize.querySelector('[value="original"]');
    originalOption.hidden = originalOption.disabled = isPrint;

    const customItem = dom.exportPrintPreset.value === 'custom';
    dom.groupCustomPrintSize.classList.toggle('hidden', !customItem);
    dom.btnCanvasFromPiece.classList.toggle('hidden', !customItem);
    dom.groupPrintImageOutlines.classList.toggle('hidden', layout === 'single');
    dom.groupPrintGap.classList.toggle('hidden', layout === 'single');
    dom.groupPrintCopies.classList.toggle('hidden', layout !== 'fill');
    dom.dniGuide.classList.toggle('hidden', layout !== 'dni');
    dom.btnDniSwap.setAttribute('aria-pressed', String(dniSwapped));
    dom.scaleShortcuts.forEach(button => {
      const active = Number(button.dataset.printScale) === Number(dom.exportPrintScale.value);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    dom.exportSettings.disabled = isExporting;
    dom.btnExportConfirm.disabled = isExporting;
    const extension = isPdf ? 'PDF' : dom.exportImageMethod.value === 'zip' ? 'ZIP' : 'JPG';
    dom.exportConfirmText.textContent = isExporting ? 'Preparando…' : 'Descargar ' + extension;
    setExportFeedback('');
    try {
      previewPlan = buildExportConfiguration();
      renderExportPreview();
    } catch (error) {
      showExportError(error);
    }
  }

  function readExportPageIndices() {
    const total = currentTab().scannedPages.length;
    const range = dom.exportPageRange.value.trim();
    if (range) {
      for (const part of range.split(',')) {
        const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        const start = Number(match?.[1]);
        const end = Number(match?.[2] || match?.[1]);
        if (!match || start < 1 || end > total || start > end) {
          dom.exportPageRange.setAttribute('aria-invalid', 'true');
          throw new RangeError(`Usa páginas entre 1 y ${total}. Por ejemplo: 1-3, 5.`);
        }
      }
    }
    const indices = parsePageRange(range, total);
    dom.exportPageRange.setAttribute('aria-invalid', String(!indices.length));
    if (!indices.length) throw new RangeError('No hay páginas seleccionadas.');
    return indices;
  }

  function readCustomPaper() {
    return getCustomPaper({ width: dom.exportPaperWidth.value, height: dom.exportPaperHeight.value, unit: dom.exportPaperUnit.value });
  }

  function readPrintItem() {
    return resolvePrintSize({
      preset: dom.exportPrintPreset.value,
      width: dom.exportPrintWidth.value,
      height: dom.exportPrintHeight.value,
      unit: dom.exportPrintUnit.value,
      scale: dom.exportPrintScale.value
    });
  }

  function buildPrintConfiguration(indices) {
    const item = readPrintItem();
    if (!dom.exportPrintMargin.value) throw new RangeError('Completa el margen. Puedes usar 0.');
    if (dom.exportLayoutMode.value !== 'single' && !dom.exportPrintGap.value) throw new RangeError('Completa la separación. Puedes usar 0.');
    if (dom.exportLayoutMode.value === 'fill' && !dom.exportPrintCopies.value) throw new RangeError('Completa las copias. Usa 0 para llenar una hoja.');
    if (dom.exportLayoutMode.value === 'dni' && dniSwapped) {
      for (let index = 0; index + 1 < indices.length; index += 2) {
        [indices[index], indices[index + 1]] = [indices[index + 1], indices[index]];
      }
    }
    const plan = createPrintPlan({
      pageIndices: indices, item, mode: dom.exportLayoutMode.value,
      paper: dom.exportPageSize.value === 'custom' ? readCustomPaper() : dom.exportPageSize.value,
      orientation: dom.exportOrientation.value,
      margin: dom.exportPrintMargin.value, gap: dom.exportPrintGap.value,
      copies: dom.exportPrintCopies.value
    });
    const outputPlan = createOutputPlan(plan, { output: dom.exportPrintOutput.value,
      overlap: dom.exportTileOverlap.value, tileMargin: dom.exportTileMargin.value });
    return { ...outputPlan, showImageOutlines: plan.mode !== 'single' && dom.exportPrintImageOutlines.checked };
  }

  function buildExportConfiguration() {
    const format = dom.exportFormat.value;
    const size = dom.exportPageSize.value;
    const fitMode = size === 'original' ? 'cover' : dom.exportFit.value;
    const indices = readExportPageIndices();
    if (format === 'pdf' && dom.exportPurpose.value === 'print') {
      return { ...buildPrintConfiguration(indices), format, size, fitMode };
    }

    const pages = currentTab().scannedPages;
    const orientation = dom.exportOrientation.value;
    const customPaper = size === 'custom' ? readCustomPaper() : null;
    const sheets = indices.map(pageIndex => {
      const page = pages[pageIndex];
      const landscape = orientation === 'auto' ? page.width > page.height : orientation === 'landscape';
      let paper;
      if (size === 'original') {
        const units = format === 'pdf' ? 25.4 / EXPORT_DPI : 1;
        paper = { width: page.width * units, height: page.height * units };
      } else if (format === 'pdf') {
        paper = customPaper || getPaperSize(size, landscape);
      } else {
        const physicalPaper = customPaper || getPaperSize(size, landscape);
        const pixelSize = EXPORT_SIZES_PX[size];
        const [width, height] = pixelSize
          ? (landscape ? [pixelSize[1], pixelSize[0]] : pixelSize)
          : [physicalPaper.width * EXPORT_DPI / 25.4, physicalPaper.height * EXPORT_DPI / 25.4];
        paper = fitImageDimensions(width, height, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS);
      }
      return { paper, items: [{ pageIndex, x: 0, y: 0, width: paper.width, height: paper.height }] };
    });

    return { format, size, fitMode, sheets, imageMethod: dom.exportImageMethod.value };
  }

  function setExportFeedback(message) {
    dom.exportFeedback.textContent = message;
    dom.exportFeedback.classList.toggle('hidden', !message);
  }

  function showExportError(error) {
    previewPlan = null;
    previewPaperKey = null;
    previewRevision++;
    printViewport.setEnabled(false);
    setExportFeedback(error.message || 'Revisa los ajustes de exportación.');
    dom.btnExportConfirm.disabled = true;
    dom.previewCanvas.classList.add('hidden');
    dom.previewEmpty.classList.remove('hidden');
    dom.previewCounter.textContent = '—';
    dom.previewPaperLabel.textContent = '';
    dom.previewPrev.disabled = dom.previewNext.disabled = true;
  }

  function loadPreviewImage(page) {
    if (!previewImages.has(page.dataUrl)) {
      const pending = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const thumbnail = document.createElement('canvas');
          const scale = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
          thumbnail.width = Math.max(1, Math.round(img.naturalWidth * scale));
          thumbnail.height = Math.max(1, Math.round(img.naturalHeight * scale));
          thumbnail.getContext('2d').drawImage(img, 0, 0, thumbnail.width, thumbnail.height);
          resolve(thumbnail);
        };
        img.onerror = () => reject(new Error('No se pudo cargar una imagen de la vista previa.'));
        img.src = page.dataUrl;
      });
      if (previewImages.size >= 24) previewImages.delete(previewImages.keys().next().value);
      previewImages.set(page.dataUrl, pending);
    }
    return previewImages.get(page.dataUrl);
  }

  async function renderExportPreview() {
    if (!previewPlan || !exportSession) return;
    const config = previewPlan;
    const revision = ++previewRevision;
    previewSheetIndex = Math.max(0, Math.min(config.sheets.length - 1, previewSheetIndex));
    const sheet = config.sheets[previewSheetIndex];
    const paper = sheet.paper || config.paper;
    const count = config.sheets.length;
    const pageLabel = config.format === 'pdf' ? 'Hoja' : 'Imagen';
    const units = config.format === 'pdf' ? 'mm' : 'px';
    const measure = new Intl.NumberFormat('es', { maximumFractionDigits: 2, useGrouping: false });
    dom.previewPrev.disabled = previewSheetIndex === 0;
    dom.previewNext.disabled = previewSheetIndex === count - 1;
    dom.previewCounter.textContent = pageLabel + ' ' + (previewSheetIndex + 1) + ' de ' + count +
      (sheet.clip ? ' · F' + (sheet.row + 1) + ' C' + (sheet.column + 1) : '');
    dom.previewPaperLabel.textContent = measure.format(paper.width) + ' × ' + measure.format(paper.height) + ' ' + units;
    dom.previewCanvas.classList.remove('hidden');
    dom.previewEmpty.classList.add('hidden');
    dom.previewCanvas.setAttribute('aria-label', dom.previewCounter.textContent + ' · ' + dom.previewPaperLabel.textContent);

    const factor = 1000 / Math.max(paper.width, paper.height);
    const canvas = dom.previewCanvas;
    canvas.width = Math.max(1, Math.round(paper.width * factor));
    canvas.height = Math.max(1, Math.round(paper.height * factor));
    const paperKey = paper.width + '×' + paper.height;
    printViewport.setContent(canvas, { width: canvas.width, height: canvas.height, reset: paperKey !== previewPaperKey });
    previewPaperKey = paperKey;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const pages = exportSession.tab.scannedPages;

    try {
      for (const box of sheet.items) {
        const thumbnail = await loadPreviewImage(pages[box.pageIndex]);
        if (revision !== previewRevision) return;
        ctx.save();
        if (sheet.clip) {
          const clip = sheet.clip;
          ctx.beginPath();
          ctx.rect(clip.x * factor, clip.y * factor, clip.width * factor, clip.height * factor);
          ctx.clip();
        }
        const fitted = fitImageToBox(pages[box.pageIndex], box, config.fitMode);
        ctx.drawImage(thumbnail, fitted.x * factor, fitted.y * factor, fitted.width * factor, fitted.height * factor);
        if (config.showImageOutlines) {
          const { x, y, width, height, lineWidth } = getPrintImageOutline(fitted);
          ctx.strokeStyle = '#000';
          ctx.lineWidth = Math.max(1.5, lineWidth * factor);
          ctx.strokeRect(x * factor, y * factor, width * factor, height * factor);
        }
        ctx.restore();
      }
    } catch (error) {
      if (revision === previewRevision) showExportError(error);
    }
  }

  async function confirmExport() {
    if (isExporting || !exportSession || !previewPlan) return;
    const session = exportSession;
    isExporting = true;
    updateExportView();
    let feedback = '';
    try {
      await settlePageFilters();
      if (exportSession !== session) return;
      const config = buildExportConfiguration();
      const sources = session.tab.scannedPages.map(({ dataUrl, width, height }) => ({ dataUrl, width, height }));
      if (config.format === 'pdf') {
        if (!window.jspdf) {
          loadJsPdfLib();
          feedback = 'Preparando PDF. Intenta descargar de nuevo.';
          return;
        }
        await generatePdf(sources, config);
      } else {
        await generateImages(sources, config);
      }
    } catch (error) {
      console.error('[App] Export error:', error);
      feedback = error.message || 'No se pudo exportar el documento.';
    } finally {
      isExporting = false;
      updateExportView();
      if (exportSession === session && feedback) setExportFeedback(feedback);
    }
  }

  function getPrintImageOutline({ x, y, width, height }) {
    const lineWidth = Math.min(0.25, width / 2, height / 2);
    const inset = lineWidth / 2;
    return { x: x + inset, y: y + inset, width: width - lineWidth, height: height - lineWidth, lineWidth };
  }

  function addImageToPrintBox(pdf, page, box, fitMode, showOutline) {
    const fitted = fitImageToBox(page, box, fitMode);
    const { x, y, width, height } = fitted;
    pdf.addImage(page.dataUrl, 'JPEG', x, y, width, height, `source-${box.pageIndex}`, 'FAST');
    if (showOutline) {
      const outline = getPrintImageOutline(fitted);
      pdf.setDrawColor(0);
      pdf.setLineWidth(outline.lineWidth);
      pdf.rect(outline.x, outline.y, outline.width, outline.height, 'S');
    }
  }

  async function generatePdf(sources, config) {
    const { jsPDF } = window.jspdf;
    let pdf = null;
    const addSheet = (paper) => {
      const orientation = paper.width > paper.height ? 'landscape' : 'portrait';
      if (!pdf) {
        pdf = new jsPDF({
          orientation,
          unit: 'mm',
          format: [paper.width, paper.height],
          compress: true
        });
      } else {
        pdf.addPage([paper.width, paper.height], orientation);
      }
    };

    for (const [index, sheet] of config.sheets.entries()) {
      addSheet(sheet.paper || config.paper);
      if (sheet.clip) {
        pdf.saveGraphicsState();
        pdf.rect(sheet.clip.x, sheet.clip.y, sheet.clip.width, sheet.clip.height, null);
        pdf.clip();
        pdf.discardPath();
      }
      sheet.items.forEach(box => addImageToPrintBox(pdf, sources[box.pageIndex], box, config.fitMode, config.showImageOutlines));
      if (sheet.clip) pdf.restoreGraphicsState();
      if (index % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (!pdf) throw new Error('No hay páginas para componer');
    const item = config.item || (config.size === 'custom' ? config.sheets[0].paper : null);
    const label = item ? `impresion-${item.width.toFixed(1)}x${item.height.toFixed(1)}mm` : `${config.sheets.length}pag`;
    downloadBlob(pdf.output('blob'), `pablito-leans-${label}-${Date.now()}.pdf`);
  }

  async function generateImages(sources, config) {
    const sheets = config.sheets;
    const individual = config.imageMethod === 'individual';
    if (!individual && typeof JSZip === 'undefined') throw new Error('No se pudo cargar la descarga ZIP.');
    const zip = individual ? null : new JSZip();

    for (const [index, sheet] of sheets.entries()) {
      const box = sheet.items[0];
      const page = sources[box.pageIndex];
      let dataUrl = page.dataUrl;
      if (config.size !== 'original') {
        const image = await loadImage(page.dataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = sheet.paper.width;
        canvas.height = sheet.paper.height;
        const context = canvas.getContext('2d');
        const { x, y, width, height } = fitImageToBox(page, box, config.fitMode);
        try {
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, x, y, width, height);
          dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      if (individual) {
        const response = await fetch(dataUrl);
        downloadBlob(await response.blob(), 'pablito-leans-pag-' + (index + 1) + '-' + Date.now() + '.jpg');
        if (index < sheets.length - 1) await new Promise(resolve => setTimeout(resolve, 600));
      } else {
        zip.file('pagina_' + (index + 1) + '.jpg', dataUrl.split(',')[1], { base64: true });
      }
    }

    if (zip) {
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, 'pablito-leans-' + sheets.length + 'imagenes-' + Date.now() + '.zip');
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

  function showToast(message, type = 'info', key = null) {
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    const safeType = Object.hasOwn(icons, type) ? type : 'info';
    if (key) {
      const previous = Array.from(dom.toastContainer.children).find(toast => toast.dataset.toastKey === key);
      if (previous) {
        clearTimeout(previous.dismissTimer);
        previous.remove();
      }
    }
    while (dom.toastContainer.children.length >= 3) {
      const oldest = dom.toastContainer.firstElementChild;
      clearTimeout(oldest.dismissTimer);
      oldest.remove();
    }
    const toast = document.createElement('div');
    toast.className = `toast toast--${safeType}`;
    if (key) toast.dataset.toastKey = key;
    const icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = icons[safeType];
    const messageElement = document.createElement('span');
    messageElement.textContent = String(message);
    toast.append(icon, messageElement);

    dom.toastContainer.appendChild(toast);

    toast.dismissTimer = setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
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
