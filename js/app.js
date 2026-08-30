/**
 * app.js — Main Application Orchestrator
 * Manages UI states, multi-page scanning, bulk upload, re-adjusting, D&D reordering,
 * and document tabs (max 3 simultaneous documents).
 */

import { Scanner } from './scanner.js';
import { Corners } from './corners.js';
import { fitImageDimensions, parsePageRange } from './utils.js';

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
  let modalTrigger = null;
  let cameraStream = null;
  let cameraFacingMode = 'environment';
  let cameraTorchEnabled = false;
  let manualFilterTimer = null;

  function createTabData(name) {
    return {
      id: ++tabIdCounter,
      name: name || `Documento ${tabIdCounter}`,
      state: 'upload',
      scannedPages: [],
      activePageIndex: -1,
      currentFilter: 'auto',
      originalImageDataUrl: null,
      isReAdjusting: false,
      corners: null,
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

  function appendPage(tab, page) {
    if (tab.scannedPages.length >= MAX_PAGES_PER_TAB || !canStorePage(tab, page)) return false;
    tab.scannedPages.push(page);
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
    dom.btnDownload = document.getElementById('btn-download');
    dom.btnDownloadPdf = document.getElementById('btn-download-pdf');
    dom.btnAddPage = document.getElementById('btn-add-page');
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
    dom.pageCounter = document.getElementById('page-counter');
    dom.flowSteps = document.querySelectorAll('.flow-step');
    // Tabs
    dom.tabsBar = document.getElementById('tabs-bar');
    dom.tabsList = document.getElementById('tabs-list');
    dom.btnAddTab = document.getElementById('btn-add-tab');
    
    // Export Modal
    dom.exportModal = document.getElementById('export-modal-overlay');
    dom.exportDialog = dom.exportModal?.querySelector('.modal-dialog');
    dom.btnExportClose = document.getElementById('export-modal-close');
    dom.btnExportCancel = document.getElementById('export-modal-cancel');
    dom.btnExportConfirm = document.getElementById('export-modal-confirm');
    dom.exportPageRange = document.getElementById('export-page-range');
    dom.exportPageSize = document.getElementById('export-page-size');
    dom.exportFitOptions = document.querySelectorAll('input[name="export-fit"]');
    dom.exportOrientationOptions = document.querySelectorAll('input[name="export-orientation"]');
    dom.exportFormatOptions = document.querySelectorAll('input[name="export-format"]');
    dom.exportImageMethodOptions = document.querySelectorAll('input[name="export-image-method"]');
    dom.groupPageSize = document.getElementById('group-page-size');
    dom.groupImageFit = document.getElementById('group-image-fit');
    dom.groupOrientation = document.getElementById('group-orientation');
    dom.groupImageMethod = document.getElementById('group-image-method');

    // Manual Adjustments
    dom.manualAdjustments = document.getElementById('manual-adjustments');
    dom.adjBgClean = document.getElementById('adj-bg-clean');
    dom.adjSaturation = document.getElementById('adj-saturation');
    dom.adjBgCleanValue = document.getElementById('adj-bg-clean-value');
    dom.adjSaturationValue = document.getElementById('adj-saturation-value');
  }

  // ======== Initialization ========

  function init() {
    cacheDom();
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
    dom.btnDownload.addEventListener('click', () => openExportModal('images'));
    dom.btnDownloadPdf.addEventListener('click', () => openExportModal('pdf'));
    dom.btnAddPage.addEventListener('click', addAnotherPage);
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
    if (dom.btnExportClose) dom.btnExportClose.addEventListener('click', closeExportModal);
    if (dom.btnExportCancel) dom.btnExportCancel.addEventListener('click', closeExportModal);
    if (dom.btnExportConfirm) dom.btnExportConfirm.addEventListener('click', confirmExport);
    dom.exportModal?.addEventListener('click', (event) => {
      if (event.target === dom.exportModal) closeExportModal();
    });
    document.addEventListener('keydown', handleDialogKeydown);

    dom.exportFormatOptions.forEach(opt => {
      opt.addEventListener('change', updateExportModalUi);
    });
    if (dom.exportPageSize) {
      dom.exportPageSize.addEventListener('change', updateExportModalUi);
    }

    // Tab controls
    dom.btnAddTab.addEventListener('click', addNewTab);

    // Filter buttons
    dom.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = currentTab();
        const filter = btn.dataset.filter;
        if (filter === tab.currentFilter) return;
        if (filter === 'manual') {
          const page = tab.scannedPages[tab.activePageIndex];
          setManualControlValues(page?.manualOptions || { bgClean: 0, saturation: 50 });
        }
        tab.currentFilter = filter;
        dom.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        reapplyFilterToActivePage();
      });
    });

    // Sliders
    if (dom.adjBgClean) {
      dom.adjBgClean.addEventListener('input', scheduleManualFilter);
    }
    if (dom.adjSaturation) {
      dom.adjSaturation.addEventListener('input', scheduleManualFilter);
    }
    updateManualControlLabels();
  }

  function setManualControlValues(options) {
    if (dom.adjBgClean) dom.adjBgClean.value = options.bgClean ?? 0;
    if (dom.adjSaturation) dom.adjSaturation.value = options.saturation ?? 50;
    updateManualControlLabels();
  }

  function updateManualControlLabels() {
    const background = Number.parseInt(dom.adjBgClean?.value || '0', 10);
    const saturation = Number.parseInt(dom.adjSaturation?.value || '50', 10);
    if (dom.adjBgCleanValue) dom.adjBgCleanValue.textContent = `${background}%`;
    if (dom.adjSaturationValue) {
      const delta = Math.round((saturation - 50) / 2);
      dom.adjSaturationValue.textContent = delta === 0 ? 'Natural' : `${delta > 0 ? '+' : ''}${delta}%`;
    }
  }

  function scheduleManualFilter() {
    updateManualControlLabels();
    clearTimeout(manualFilterTimer);
    const tab = currentTab();
    const tabId = tab.id;
    const pageIndex = tab.activePageIndex;
    manualFilterTimer = setTimeout(() => {
      if (currentTab().id === tabId && currentTab().activePageIndex === pageIndex &&
          currentTab().currentFilter === 'manual') {
        reapplyFilterToActivePage();
      }
    }, 100);
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
      setState('result');
      showActivePage();
      document.querySelector('.filter-heading')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (step === 'organize' && tab.scannedPages.length) {
      markFlowStep('organize');
      dom.pagesStrip.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (step === 'export' && tab.scannedPages.length) {
      markFlowStep('export');
      openExportModal('pdf');
    }
  }

  function markFlowStep(activeStep) {
    dom.flowSteps.forEach(step => step.classList.toggle('active', step.dataset.flowStep === activeStep));
  }

  function updateFlowNavigation(state) {
    const hasPages = currentTab().scannedPages.length > 0;
    dom.flowSteps.forEach(step => {
      const name = step.dataset.flowStep;
      step.disabled = name !== 'capture' && !hasPages && !(name === 'adjust' && state === 'editor');
    });
    markFlowStep(state === 'editor' ? 'adjust' : state === 'result' ? 'improve' : 'capture');
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
    showToast('Procesando PDF...', 'info');
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
            filtered = Scanner.applyFilter(mat, 'auto');
            
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
              filter: 'auto',
              isPdf: true
            };
            if (!appendPage(tab, pageData)) {
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
      filtered = Scanner.applyFilter(warped, 'auto');

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
        filter: 'auto'
      };
      return appendPage(tab, pageData);
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
    currentTab().state = state === 'camera' ? 'upload' : state;
    document.body.classList.toggle('camera-open', state === 'camera');

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

      const targetFilter = tab.isReAdjusting ? tab.scannedPages[tab.activePageIndex].filter : 'auto';
      
      filtered = Scanner.applyFilter(warpedMat, targetFilter);
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
        if (!canStorePage(tab, pageData, tab.activePageIndex)) {
          showToast('El ajuste excede el límite de memoria del documento', 'warning');
          return;
        }
        tab.scannedPages[tab.activePageIndex] = pageData;
        showToast('Ajuste guardado', 'success');
      } else {
        if (!appendPage(tab, pageData)) {
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

  function reapplyFilterToActivePage() {
    const tab = currentTab();
    if (tab.activePageIndex < 0 || tab.activePageIndex >= tab.scannedPages.length) return;

    const page = tab.scannedPages[tab.activePageIndex];
    const pageIndex = tab.activePageIndex;
    const filter = tab.currentFilter;
    const revision = ++tab.filterRevision;
    const options = filter === 'manual' ? {
      bgClean: dom.adjBgClean ? Number.parseInt(dom.adjBgClean.value, 10) : 0,
      saturation: dom.adjSaturation ? Number.parseInt(dom.adjSaturation.value, 10) : 50
    } : {};

    const img = new Image();
    img.onload = () => {
      if (!isActiveTab(tab) || revision !== tab.filterRevision ||
          tab.activePageIndex !== pageIndex || tab.scannedPages[pageIndex] !== page) return;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.naturalWidth;
      tempCanvas.height = img.naturalHeight;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const mat = cv.imread(tempCanvas);
      let filtered = null;
      try {
        if (filter === 'manual') {
          page.manualOptions = options;
        }

        filtered = Scanner.applyFilter(mat, filter, options);
        if (!isActiveTab(tab) || revision !== tab.filterRevision) return;
        Scanner.drawToCanvas(filtered, dom.canvasOutput);

        const updatedPage = {
          ...page,
          dataUrl: dom.canvasOutput.toDataURL('image/jpeg', 0.92),
          width: dom.canvasOutput.width,
          height: dom.canvasOutput.height,
          filter
        };
        if (!canStorePage(tab, updatedPage, pageIndex)) {
          showToast('El filtro excede el límite de memoria del documento', 'warning');
          tab.currentFilter = page.filter;
          showActivePage();
          return;
        }
        Object.assign(page, updatedPage);
        renderPagesStrip();
      } catch (err) {
        console.error('[App] Re-filter error:', err);
        showToast('Error al aplicar filtro', 'error');
      } finally {
        if (filtered) filtered.delete();
        mat.delete();
        tempCanvas.width = 0;
        tempCanvas.height = 0;
      }
    };
    img.onerror = () => {
      if (isActiveTab(tab) && revision === tab.filterRevision) {
        showToast('No se pudo cargar la página para aplicar el filtro', 'error');
      }
    };
    img.src = page.warpedDataUrl;
    
    if (dom.manualAdjustments) {
      if (filter === 'manual') {
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
    const revision = ++tab.filterRevision;
    let completed = true;
    showToast(`Aplicando filtro a todas las páginas...`, 'info');

    for (let i = 0; i < tab.scannedPages.length; i++) {
      if (revision !== tab.filterRevision) {
        completed = false;
        break;
      }
      const page = tab.scannedPages[i];
      if (page.filter === currentFilter && currentFilter !== 'manual') continue;

      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          if (revision !== tab.filterRevision) {
            resolve();
            return;
          }
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = img.naturalWidth;
          tempCanvas.height = img.naturalHeight;
          const tempCtx = tempCanvas.getContext('2d');
          tempCtx.drawImage(img, 0, 0);

          let mat = null;
          let filtered = null;
          const outCanvas = document.createElement('canvas');
          try {
            mat = cv.imread(tempCanvas);
            let options = {};
            if (currentFilter === 'manual') {
              const activePage = tab.scannedPages[tab.activePageIndex];
              options = activePage.manualOptions || { bgClean: 0, saturation: 50 };
              page.manualOptions = { ...options };
            }

            filtered = Scanner.applyFilter(mat, currentFilter, options);
            if (revision !== tab.filterRevision) return;
            Scanner.drawToCanvas(filtered, outCanvas);
            const updatedPage = {
              ...page,
              dataUrl: outCanvas.toDataURL('image/jpeg', 0.9),
              width: outCanvas.width,
              height: outCanvas.height,
              filter: currentFilter
            };
            if (!canStorePage(tab, updatedPage, i)) {
              completed = false;
              return;
            }
            Object.assign(page, updatedPage);
          } catch (error) {
            console.error(`[App] Error filtering page ${i + 1}:`, error);
          } finally {
            if (mat) mat.delete();
            if (filtered) filtered.delete();
            tempCanvas.width = 0;
            tempCanvas.height = 0;
            outCanvas.width = 0;
            outCanvas.height = 0;
            resolve();
          }
        };
        img.onerror = () => {
          console.error(`[App] Could not load page ${i + 1} for bulk filtering`);
          resolve();
        };
        img.src = page.warpedDataUrl;
      });
    }

    if (isActiveTab(tab)) {
      showActivePage();
      renderPagesStrip();
    }
    showToast(completed ? 'Filtro aplicado a todas las páginas' : 'Aplicación de filtro cancelada', completed ? 'success' : 'info');
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
    const pageIndex = tab.activePageIndex;
    const revision = ++tab.viewRevision;

    tab.currentFilter = page.filter;
    dom.filterBtns.forEach(button => button.classList.remove('active'));
    const activeBtn = document.querySelector(`[data-filter="${page.filter}"]`);
    if (activeBtn) activeBtn.classList.add('active');
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

    if (dom.manualAdjustments) {
      if (tab.currentFilter === 'manual') {
        dom.manualAdjustments.classList.remove('hidden');
        setManualControlValues(page.manualOptions || { bgClean: 0, saturation: 50 });
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
    if (tab) tab.currentFilter = 'auto';
    dom.filterBtns.forEach(b => b.classList.remove('active'));
    document.getElementById('filter-auto').classList.add('active');
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

  function openExportModal(defaultFormat) {
    const tab = currentTab();
    if (tab.scannedPages.length === 0) {
      showToast('No hay páginas para exportar', 'warning');
      return;
    }
    
    // Set format radio button
    dom.exportFormatOptions.forEach(opt => {
      opt.checked = (opt.value === defaultFormat);
    });

    if (dom.exportPageRange) dom.exportPageRange.value = '';
    
    modalTrigger = document.activeElement;
    dom.exportModal.classList.remove('hidden');
    dom.exportModal.setAttribute('aria-hidden', 'false');
    updateExportModalUi();
    requestAnimationFrame(() => dom.btnExportClose?.focus());
  }

  function closeExportModal() {
    if (dom.exportModal.classList.contains('hidden')) return;
    dom.exportModal.classList.add('hidden');
    dom.exportModal.setAttribute('aria-hidden', 'true');
    if (modalTrigger instanceof HTMLElement) modalTrigger.focus();
    modalTrigger = null;
  }

  function handleDialogKeydown(event) {
    if (!dom.exportModal || dom.exportModal.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeExportModal();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(dom.exportDialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.closest('.hidden'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function updateExportModalUi() {
    let format = 'pdf';
    dom.exportFormatOptions.forEach(opt => { if (opt.checked) format = opt.value; });

    const pageSize = dom.exportPageSize ? dom.exportPageSize.value : 'A4';
    const isOriginal = pageSize === 'original';

    // Show/hide groups
    if (format === 'pdf') {
      dom.groupImageMethod.classList.add('hidden');
    } else {
      dom.groupImageMethod.classList.remove('hidden');
    }

    if (isOriginal) {
      dom.groupImageFit.classList.add('hidden');
      dom.groupOrientation.classList.add('hidden');
    } else {
      dom.groupImageFit.classList.remove('hidden');
      dom.groupOrientation.classList.remove('hidden');
    }

    const confirmText = document.getElementById('export-confirm-text');
    if (confirmText) {
      confirmText.textContent = format === 'pdf' ? 'Generar PDF' : 'Descargar';
    }
  }

  async function confirmExport() {
    const tab = currentTab();
    if (tab.scannedPages.length === 0) return;

    let format = 'pdf';
    dom.exportFormatOptions.forEach(opt => { if (opt.checked) format = opt.value; });

    closeExportModal();

    if (format === 'pdf') {
      if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
        showToast('Cargando librería PDF, por favor espera un momento y vuelve a exportar...', 'warning');
        loadJsPdfLib();
        return;
      }
      generatePdf();
    } else {
      generateImages();
    }
  }

  async function generatePdf() {
    const tab = currentTab();
    try {
      const rangeStr = dom.exportPageRange ? dom.exportPageRange.value : '';
      const sizeSelection = dom.exportPageSize ? dom.exportPageSize.value : 'A4';
      
      let fitMode = 'contain';
      dom.exportFitOptions.forEach(opt => { if (opt.checked) fitMode = opt.value; });

      let orientationMode = 'auto';
      dom.exportOrientationOptions.forEach(opt => { if (opt.checked) orientationMode = opt.value; });

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
      
      let firstPageWidthMm;
      let firstPageHeightMm;
      let firstPageLandscape = false;
      
      if (sizeSelection === 'original') {
        firstPageWidthMm = pagesToExport[0].width * 25.4 / 150;
        firstPageHeightMm = pagesToExport[0].height * 25.4 / 150;
        firstPageLandscape = firstPageWidthMm > firstPageHeightMm;
      } else {
        const formatMm = sizesMm[sizeSelection] || sizesMm['A4'];
        firstPageWidthMm = formatMm[0];
        firstPageHeightMm = formatMm[1];
        if (orientationMode === 'auto') {
          firstPageLandscape = pagesToExport[0].width > pagesToExport[0].height;
        } else if (orientationMode === 'landscape') {
          firstPageLandscape = true;
        } else if (orientationMode === 'portrait') {
          firstPageLandscape = false;
        }
        if (firstPageLandscape) {
          firstPageWidthMm = formatMm[1];
          firstPageHeightMm = formatMm[0];
        }
      }

      const pdf = new jsPDF({
        orientation: firstPageLandscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: sizeSelection === 'original' ? [firstPageWidthMm, firstPageHeightMm] : (sizesMm[sizeSelection] || sizesMm['A4']),
        compress: true
      });

      for (let i = 0; i < pagesToExport.length; i++) {
        const page = pagesToExport[i];
        
        let pdfWidth;
        let pdfHeight;
        let pageLandscape = false;

        if (sizeSelection === 'original') {
          pdfWidth = page.width * 25.4 / 150;
          pdfHeight = page.height * 25.4 / 150;
          pageLandscape = pdfWidth > pdfHeight;
          if (i > 0) {
            pdf.addPage([pdfWidth, pdfHeight], pageLandscape ? 'landscape' : 'portrait');
          }
          pdf.addImage(page.dataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
        } else {
          const formatMm = sizesMm[sizeSelection] || sizesMm['A4'];
          if (orientationMode === 'auto') {
             pageLandscape = page.width > page.height;
          } else if (orientationMode === 'landscape') {
             pageLandscape = true;
          } else if (orientationMode === 'portrait') {
             pageLandscape = false;
          }
          
          pdfWidth = formatMm[0];
          pdfHeight = formatMm[1];
          
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

  async function generateImages() {
    const tab = currentTab();
    try {
      const rangeStr = dom.exportPageRange ? dom.exportPageRange.value : '';
      const sizeSelection = dom.exportPageSize ? dom.exportPageSize.value : 'A4';
      
      let fitMode = 'contain';
      dom.exportFitOptions.forEach(opt => { if (opt.checked) fitMode = opt.value; });

      let orientationMode = 'auto';
      dom.exportOrientationOptions.forEach(opt => { if (opt.checked) orientationMode = opt.value; });

      let imageMethod = 'zip';
      dom.exportImageMethodOptions.forEach(opt => { if (opt.checked) imageMethod = opt.value; });

      let pagesToExport = tab.scannedPages;
      if (rangeStr.trim() !== '') {
        const indices = parsePageRange(rangeStr, tab.scannedPages.length);
        if (indices.length === 0) {
          showToast('Rango de páginas no válido', 'error');
          return;
        }
        pagesToExport = indices.map(i => tab.scannedPages[i]);
      }

      showToast('Generando imágenes, por favor espera...', 'info');

      // Helper to draw a single page to canvas and get dataUrl
      const processPageImage = async (page) => {
        if (sizeSelection === 'original') {
          return page.dataUrl; // Return original data url
        }

        const sizesPx = {
          'A0': [4960, 7016],
          'A1': [3508, 4960],
          'A2': [2480, 3508],
          'A3': [1754, 2480],
          'A4': [1240, 1754],
          'A5': [874, 1240]
        };
        const formatPx = sizesPx[sizeSelection] || sizesPx['A4'];
        
        let pageLandscape = false;
        if (orientationMode === 'auto') {
          pageLandscape = page.width > page.height;
        } else if (orientationMode === 'landscape') {
          pageLandscape = true;
        } else if (orientationMode === 'portrait') {
          pageLandscape = false;
        }

        let targetWidth = formatPx[0];
        let targetHeight = formatPx[1];
        if (pageLandscape) {
          targetWidth = formatPx[1];
          targetHeight = formatPx[0];
        }

        const safeTarget = fitImageDimensions(
          targetWidth,
          targetHeight,
          MAX_IMAGE_DIMENSION,
          MAX_IMAGE_PIXELS
        );
        targetWidth = safeTarget.width;
        targetHeight = safeTarget.height;

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');

        // White background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            if (fitMode === 'cover') {
              ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
            } else {
              const imgRatio = page.width / page.height;
              const targetRatio = targetWidth / targetHeight;
              
              let finalW = targetWidth;
              let finalH = targetHeight;
              let x = 0;
              let y = 0;

              if (imgRatio > targetRatio) {
                finalW = targetWidth;
                finalH = targetWidth / imgRatio;
                y = (targetHeight - finalH) / 2;
              } else {
                finalH = targetHeight;
                finalW = targetHeight * imgRatio;
                x = (targetWidth - finalW) / 2;
              }
              ctx.drawImage(img, x, y, finalW, finalH);
            }
            const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            // Clear canvas memory
            canvas.width = 0;
            canvas.height = 0;
            resolve(dataUrl);
          };
          img.onerror = () => reject(new Error('No se pudo cargar una página para exportarla'));
          img.src = page.dataUrl;
        });
      };

      const downloadBlob = (blob, filename) => {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = filename;
        link.href = objectUrl;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      };

      if (imageMethod === 'individual') {
        // Individual downloads
        for (let i = 0; i < pagesToExport.length; i++) {
          const page = pagesToExport[i];
          const dataUrl = await processPageImage(page);
          const res = await fetch(dataUrl);
          const blob = await res.blob();

          if (window.showSaveFilePicker) {
            try {
              const handle = await window.showSaveFilePicker({
                suggestedName: `pablito-leans-pag-${i + 1}-${Date.now()}.jpg`,
                types: [{ description: 'Imagen JPEG', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }]
              });
              const writable = await handle.createWritable();
              await writable.write(blob);
              await writable.close();
            } catch(e) { 
              if(e.name !== 'AbortError') {
                // Fallback to standard link download
                const link = document.createElement('a');
                link.download = `pablito-leans-pag-${i + 1}-${Date.now()}.jpg`;
                link.href = dataUrl;
                link.click();
              } 
            }
          } else {
            const link = document.createElement('a');
            link.download = `pablito-leans-pag-${i + 1}-${Date.now()}.jpg`;
            link.href = dataUrl;
            link.click();
          }
          // Slight delay to avoid browser blocking multiple downloads
          if (pagesToExport.length > 1) {
            await new Promise(r => setTimeout(r, 600));
          }
        }
        showToast('Descarga completada', 'success');
      } else {
        // ZIP download
        if (typeof JSZip === 'undefined') {
          showToast('Error: Librería JSZip no cargada', 'error');
          return;
        }
        showToast('Comprimiendo imágenes en ZIP...', 'info');
        await new Promise(r => setTimeout(r, 100));

        const zip = new JSZip();
        for (let i = 0; i < pagesToExport.length; i++) {
          const page = pagesToExport[i];
          const dataUrl = await processPageImage(page);
          const base64Data = dataUrl.split(',')[1];
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
              downloadBlob(zipBlob, `pablito-leans-${pagesToExport.length}imagenes-${Date.now()}.zip`);
              showToast(`ZIP descargado`, 'success');
            }
          }
        } else {
          downloadBlob(zipBlob, `pablito-leans-${pagesToExport.length}imagenes-${Date.now()}.zip`);
          showToast(`ZIP descargado`, 'success');
        }
      }
    } catch (err) {
      console.error('[App] Image generation error:', err);
      showToast('Error al generar imágenes.', 'error');
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

    const safeType = Object.hasOwn(icons, type) ? type : 'info';
    const toast = document.createElement('div');
    toast.className = `toast toast--${safeType}`;
    const icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = icons[safeType];
    const messageElement = document.createElement('span');
    messageElement.textContent = String(message);
    toast.append(icon, messageElement);

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
