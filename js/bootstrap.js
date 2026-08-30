/**
 * Loads third-party runtimes and registers the offline worker without mixing
 * bootstrap concerns into the HTML document.
 */
(function bootstrap() {
  'use strict';

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  let openCvNotified = false;

  function notifyOpenCvReady() {
    if (openCvNotified) return;
    openCvNotified = true;
    if (window.App?.onOpenCvReady) {
      window.App.onOpenCvReady();
    } else {
      window._opencvReady = true;
    }
  }

  window.onOpenCvReady = async function onOpenCvReady() {
    try {
      if (window.cv && typeof window.cv.then === 'function') {
        window.cv = await window.cv;
      }
      if (window.cv?.Mat) {
        notifyOpenCvReady();
      } else if (window.cv) {
        window.cv.onRuntimeInitialized = notifyOpenCvReady;
      } else {
        throw new Error('OpenCV no expuso su API');
      }
    } catch (error) {
      console.error('[Pablito Leans] OpenCV initialization failed:', error);
      window.onOpenCvError();
    }
  };

  window.onOpenCvError = function onOpenCvError() {
    window._opencvFailed = true;
    const loader = document.getElementById('opencv-loader');
    if (!loader) return;

    loader.replaceChildren();
    const content = document.createElement('div');
    content.className = 'loader-error';
    const title = document.createElement('h2');
    title.textContent = 'No se pudo cargar el motor de visión';
    const description = document.createElement('p');
    description.textContent = 'OpenCV.js no respondió. Revisa tu conexión e inténtalo nuevamente.';
    const retry = document.createElement('button');
    retry.className = 'btn btn-primary';
    retry.type = 'button';
    retry.textContent = 'Reintentar';
    retry.addEventListener('click', () => window.location.reload());
    content.append(title, description, retry);
    loader.appendChild(content);
  };

  const openCvScript = document.createElement('script');
  openCvScript.src = 'https://cdn.jsdelivr.net/npm/@seadong/opencv-js@4.10.0/dist/opencv.js';
  openCvScript.async = true;
  openCvScript.crossOrigin = 'anonymous';
  openCvScript.integrity = 'sha384-2gLneYBuHvgzelAqVcEKadCR35Egc4Vn4QoJHBcSwXmVM2zijxno6huJeyW4YSrZ';
  openCvScript.addEventListener('load', window.onOpenCvReady);
  openCvScript.addEventListener('error', window.onOpenCvError);
  document.head.appendChild(openCvScript);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(error => {
        console.error('[Pablito Leans] Service worker registration failed:', error);
      });
    });
  }
})();
