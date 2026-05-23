# Plan de Interfaz (UI/UX) - Pablito Leans

## 🎨 1. Sistema de Diseño (Design System)
La aplicación utiliza un diseño oscuro y moderno, optimizado para reducir la fatiga visual y hacer resaltar el documento escaneado.

* **Paleta de Colores:** Fondo oscuro (`#07070d` y `#0e0e18`) con detalles interactivos en degradado cian/púrpura y acentos en cian neón (`#00D4FF`).
* **Tipografía:** `Inter`, asegurando legibilidad en interfaces densas.
* **Efectos visuales:** Uso de *Glassmorphism* (fondos translúcidos con desenfoque) para el encabezado (`.app-header`) y el panel de controles flotante en móviles (`.controls-panel`).

---

## 🏗️ 2. Estructura de Archivos
El proyecto sigue una arquitectura limpia de Vanilla JS separada por responsabilidades:

* `index.html`: Estructura principal y contenedores de los 3 estados de la app.
* `css/style.css`: Tokens de diseño y diseño responsivo.
* `js/app.js`: Orquestador de estados, manejo de múltiples páginas y eventos del DOM.
* `js/scanner.js`: Lógica matemática de OpenCV (detección, recorte y filtros).
* `js/corners.js`: Motor interactivo para arrastrar las esquinas en el `<canvas>`.

---

## 🔄 3. Flujo de Estados de la Interfaz (App Flow)
La aplicación es una SPA (Single Page Application) que transiciona entre tres zonas principales ocultando y mostrando contenedores (`.hidden`).

### Estado 1: Zona de Carga (`#upload-zone`)
* **Objetivo:** Capturar la imagen de entrada.
* **UX:** Un área grande con borde punteado que soporta *Drag & Drop* en PC.
* **Móvil:** El botón de carga acciona directamente la cámara del dispositivo mediante el atributo `capture="environment"`.

### Estado 2: Zona de Edición (`#editor-zone`)
* **Objetivo:** Ajustar los bordes del documento.
* **UX:** Muestra la imagen original escalada en un `canvasInput` con un `canvasOverlay` transparente encima.
* **Interactividad:** 4 nodos (círculos) con efecto de resplandor (`box-shadow` simulado en canvas) que el usuario puede arrastrar. El área fuera del polígono seleccionado se oscurece (`rgba(0, 0, 0, 0.35)`) para enfocar el recorte.
* **Controles:** Botones de "Cancelar" y "Escanear" fijados en la parte inferior de la pantalla en móviles para fácil alcance con los pulgares.

### Estado 3: Zona de Resultados (`#result-zone`)
* **Objetivo:** Visualizar, filtrar y exportar.
* **Visualización:** El documento ya aplanado (`canvasOutput`) se muestra en el centro.
* **Filtros:** Una tira desplazable horizontalmente (`.filter-selector`) permite cambiar entre Documento, Color, Pizarra, Alto Contraste, etc., usando OpenCV para re-procesar la imagen al instante.
* **Paginación:** Un carrusel (`.pages-strip`) muestra miniaturas de todas las páginas escaneadas. Soporta arrastrar y soltar (Drag & Drop) para reordenar las páginas antes de exportar.
* **Exportación:** Panel fijo con opciones para añadir más páginas (+ Página), descargar imágenes individuales (IMG) o fusionar todo en un solo archivo PDF (PDF) usando `jsPDF`.

---

## 📱 4. Adaptabilidad (Responsive y Móvil)
El CSS está diseñado con una mentalidad *Mobile-First*.

* **Controles Flotantes:** En pantallas pequeñas, el `.controls-panel` se fija en la parte inferior (`position: fixed; bottom: 0;`) creando una experiencia similar a una app nativa instalada.
* **Padding Inferior:** El `body` tiene un `padding-bottom: 80px;` para evitar que el contenido principal quede oculto detrás de la barra de controles fija en móviles.
* **Gestos:** La tira de miniaturas de páginas y la selección de filtros utilizan `scroll-snap-type: x mandatory` para un desplazamiento táctil suave y preciso en celulares.