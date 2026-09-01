# 📸 Pablito Leans — Escáner Web de Documentos

Herramienta web estática que permite escanear documentos directamente desde el navegador. Detecta bordes automáticamente, permite ajustar las esquinas manualmente y exporta imágenes limpias y planas listas para imprimir o guardar.

**🌐 [leans.sypablitodp.site](https://leans.sypablitodp.site)**

---

## ✨ Características

- 📄 **Detección automática de bordes** con OpenCV.js (Canny + contornos)
- 📷 **Cámara manual integrada** con cámara trasera, cambio de lente y linterna compatible
- 🎯 **Ajuste manual de esquinas** con nodos arrastrables (mouse y touch)
- 🔄 **Transformación de perspectiva** para aplanar documentos
- 🎨 **Original sin corrección** y filtros opcionales Auto, Documento, Pizarra y Color
- 👁️ **Comparación antes/después** manteniendo pulsada la vista previa
- 📚 **Flujo por etapas** optimizado para móvil y vista de dos columnas en PC
- 📥 **Exportación** a PDF, JPG y ZIP con selección de páginas
- 📐 **Composición de impresión** con DNI, escala 195%, medidas personalizadas,
  recomendación A0–A5 y cuadrículas de varias copias
- 📱 **Responsive** y compatible con cámaras de celular
- 🔒 **Procesamiento local** — los documentos no se suben a un servidor
- ⌨️ **Accesible por teclado** — pestañas, diálogos y ajuste fino de esquinas
- 📴 **PWA offline** — recursos críticos cacheados tras la primera instalación

> La aplicación descarga OpenCV.js, PDF.js y JSZip desde CDNs con versiones
> fijas. Esas solicitudes exponen al proveedor los metadatos normales de red,
> pero el contenido de tus documentos permanece dentro del navegador.

## 🛠️ Stack

- HTML5 / CSS3 / JavaScript (Vanilla)
- [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html) vía WebAssembly
- HTML5 Canvas
- GitHub Pages

Para proteger la memoria en móviles, cada archivo está limitado a 50 MB, cada
imagen se normaliza a un máximo de 4096 px/16 MP y cada documento tiene límites
de 100 páginas y aproximadamente 200 MB de datos en memoria.
El conjunto de documentos abiertos se limita además a unos 350 MB estimados.

## 🚀 Uso Local

```bash
# Clonar el repositorio
git clone https://github.com/dppablito4-oss/pablito-leans.git
cd pablito-leans

# Servir localmente (cualquier servidor estático)
npx serve .
```

## 📁 Estructura

```
├── index.html          # Página principal (SPA)
├── css/style.css       # Sistema de diseño
├── js/
│   ├── app.js          # Orquestador principal
│   ├── bootstrap.js    # Dependencias externas y service worker
│   ├── scanner.js      # Motor de visión (OpenCV.js)
│   ├── corners.js      # Esquinas interactivas
│   └── utils.js        # Utilidades puras y comprobables
├── test/               # Pruebas con node:test
├── assets/             # Favicon e iconos PWA
├── CNAME               # Dominio custom
└── LICENSE             # Licencia MIT
```

## ✅ Verificación

```bash
npm run check
npm test
```

## 📜 Licencia

MIT
