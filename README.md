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
- 🗃️ **Visor de páginas** con miniaturas, zoom, navegación y vista continua
- ✂️ **Recorte con ocho tiradores**: cuatro esquinas de perspectiva y cuatro
  bordes para cortar vertical u horizontalmente, con modo rectangular
- 🎛️ **Ajustes por página** de luz, contraste, fondo, saturación, balance de
  blancos, temperatura y nitidez; se conservan al recortar y pueden aplicarse a todas
- ✨ **Mejorar documento** con gamma adaptativa y contraste local CLAHE sobre
  luminosidad, intensidad regulable y reducción de ruido bilateral independiente
- 📚 **Flujo por etapas** optimizado para móvil y vista de dos columnas en PC
- 📥 **Exportación** a PDF, JPG y ZIP con selección de páginas
  mediante el administrador de descargas del navegador
- 📐 **Composición de impresión** con DNI, escala 195%, medidas personalizadas,
  recomendación A0–A5, vista previa de cada hoja y cuadrículas de varias copias
- 🗂️ **Rellenado por página o por archivo**: repite cada original en su propia hoja
  o reúne originales distintos en las hojas necesarias, conservando sus medidas
- 🪪 **DNI con dos caras**: anverso arriba y reverso debajo en la misma hoja,
  a tamaño normal o ampliado, con opción de intercambiar las caras
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

## Preparar hojas para imprimir

Abre **PDF → Tipo de salida PDF → Impresión**. Selecciona las páginas del
documento y elige una distribución:

- **Una por hoja**: un original centrado en cada hoja.
- **Rellenar una hoja por cada página**: repite cada original hasta llenar su
  propia hoja. Con `Copias por página = 0` se llena una hoja; con un número
  concreto se generan esas copias, continuando en otra hoja cuando sea necesario.
- **Todo el archivo en las hojas necesarias**: coloca cada original una sola vez,
  en orden, sin reducir las medidas. Por ejemplo, a 5 × 5 cm en A4 con margen
  de 10 mm y separación de 3 mm caben 15 piezas: 10 páginas ocupan una hoja
  y 20 ocupan dos.
- **DNI**: selecciona anverso y reverso como dos páginas consecutivas. Cada par
  ocupa una misma hoja, una cara debajo de la otra. Puedes usar 100%, 195% o una
  escala personalizada. La aplicación avisa si falta una cara o el par no cabe.

La vista previa permite recorrer las hojas y muestra el total real del archivo
exportado. Sus números y guías no se imprimen. Elige **tamaño real / 100%** en el
diálogo de impresión para conservar las medidas. La composición se exporta en
PDF; la descarga de imágenes conserva su funcionamiento habitual.

## Editar y descargar

Las miniaturas de la izquierda permiten seleccionar y ordenar las páginas.
El selector **Todas las páginas** muestra el documento completo; **Una página**
permite revisar el detalle con zoom. Los ajustes de **Luz y limpieza** y
**Color y nitidez** afectan a la página seleccionada, conservan el original y se
mantienen al volver a recortar. **Restablecer** elimina los ajustes adicionales;
**Original** también quita el filtro. Puedes copiar el acabado a todo el documento.

**Mejorar documento** activa una mejora automática moderada. Regula su intensidad
o usa **Quitar mejora automática** para desactivarla. **Reducir ruido** es
independiente: déjalo en 0% para conservar toda la textura y los trazos finos.
Ambos controles se guardan por página, se mantienen al recortar y se incluyen
al aplicar el acabado a todas. Las páginas nuevas empiezan sin estos efectos.

El procesamiento usa gamma estimada a partir de la luminosidad del papel,
CLAHE limitado y protección de blancos y tinta negra. Funciona localmente
con OpenCV.js. Las técnicas toman como referencia los ejercicios de
[Image-Processing-OpenCV](https://github.com/GeorgeSeif/Image-Processing-OpenCV)
y la documentación de OpenCV sobre
[CLAHE](https://docs.opencv.org/4.x/d2/d74/tutorial_js_histogram_equalization.html)
y [filtrado bilateral](https://docs.opencv.org/4.x/dd/d6a/tutorial_js_filtering.html).

En **Recortar**, arrastra las esquinas para corregir perspectiva o los tiradores
del centro de cada borde para cortar desde arriba, abajo, izquierda o derecha.
**Rectangular** mantiene los lados alineados. En el lienzo, las teclas 1–4
seleccionan esquinas y 5–8 seleccionan bordes; usa flechas o Mayús + flecha.

PDF, JPG y ZIP se envían a las **descargas del navegador**. La ubicación y la
visualización de la barra de descargas siguen las preferencias del navegador;
la aplicación ya no guarda los archivos directamente con el selector del sistema.

## 📜 Licencia

MIT
