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
- 🗃️ **Visor de páginas** con miniaturas, navegación y vista continua. Lienzos
  libres en el editor y la vista de impresión: arrastre, zoom de 10% a 800% con
  rueda o pellizco y encuadre con doble clic o el botón del porcentaje. En la vista
  continua, la rueda desplaza y Ctrl + rueda amplía. La hoja se encuadra al cambiar
  de tamaño u orientación, sin modificar las medidas de impresión.
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
- 📏 **Lienzo libre hasta 5 × 5 m**, con PDF de medidas reales (por ejemplo,
  80 × 200 cm), ARCH E y montaje en tramos de plóter de hasta 90 cm o mosaico A4/A3
- 🗂️ **Rellenado por página o por archivo**: repite cada original en su propia hoja
  o reúne originales distintos en las hojas necesarias, conservando sus medidas
- 🪪 **DNI con dos caras**: anverso arriba y reverso debajo en la misma hoja,
  a tamaño normal o ampliado, con opción de intercambiar las caras
- 📱 **Responsive** y compatible con cámaras de celular
- 🌓 **Temas claro y oscuro AMOLED** con acento esmeralda y selector en la
  cabecera. La elección se recuerda en próximas visitas y se sincroniza entre pestañas.
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

Abre **Exportar**. En **Formato**, elige **PDF** y en **Diseño**, selecciona
**Composición para imprimir**. Selecciona las páginas y una distribución:

- **Una por hoja**: un original centrado en cada hoja.
- **Repetir cada página**: repite cada original hasta llenar su
  propia hoja. Con `Copias por página = 0` se llena una hoja; con un número
  concreto se generan esas copias, continuando en otra hoja cuando sea necesario.
- **Varias imágenes por hoja**: coloca cada original una sola vez,
  en orden, sin reducir las medidas. Por ejemplo, a 5 × 5 cm en A4 con margen
  de 10 mm y separación de 3 mm caben 15 piezas: 10 páginas ocupan una hoja
  y 20 ocupan dos.
- **DNI**: selecciona anverso y reverso como dos páginas consecutivas. Cada par
  ocupa una misma hoja, una cara debajo de la otra. Puedes usar 100%, 195% o una
  escala personalizada. La aplicación avisa si falta una cara o el par no cabe.

El lienzo muestra la vista previa de la salida y las medidas de cada hoja.
Activa **Contorno en cada imagen** para añadir un borde fino a la composición.
Elige **tamaño real / 100%** al imprimir para conservar las medidas.

En **Tamaño de hoja → Personalizado** escribe cualquier ancho y alto en
mm, cm, metros o pulgadas, hasta 5 metros por lado. Estas medidas definen la
página real del PDF y conservan el orden ancho × alto. En modo Documento, cada
imagen se ajusta directamente al lienzo. En una composición, **Usar la hoja
completa** iguala el tamaño de la pieza al lienzo y pone el margen en 0.
También puedes definir la pieza primero y pulsar **Usar esta medida para la hoja**.
La escala de las piezas también se valida contra el límite de 5 metros.

**Salida de impresión** permite descargar el lienzo completo, dividirlo en
tramos de hasta **90 cm de ancho** para el plóter o montarlo con hojas A4, A3 o
ARCH E. ARCH E mide 914.4 × 1219.2 mm: su ancho supera los 90 cm de este equipo.
El solape es ajustable y los mosaicos incluyen un margen blanco por hoja. Las
hojas se recorren de izquierda a derecha y de arriba abajo; la vista previa indica
fila y columna. Imprime siempre a **tamaño real / 100%** y verifica que el equipo
admita el largo elegido. El montaje conserva las dimensiones, sin reducirlas.

El lienzo grande no crea una imagen gigante en memoria: la vista previa tiene
como máximo 1000 píxeles por lado y el PDF reutiliza las imágenes originales.
La salida se limita a 500 hojas o 10 000 colocaciones de piezas. Al ajustar un
JPG al papel puedes elegir 300 ppp (predeterminado) o 150 ppp. La vista previa
muestra los píxeles y la resolución resultantes con el límite de 4096 px / 16 MP.

## Editar y descargar

Las miniaturas de la izquierda permiten seleccionar y ordenar las páginas.
El selector **Todas las páginas** muestra el documento completo; **Una página**
permite revisar el detalle con zoom. Los ajustes de **Luz y limpieza** y
**Color y nitidez** afectan a la página seleccionada, conservan el original y se
mantienen al volver a recortar. **Restablecer** elimina los ajustes adicionales;
**Original** también quita el filtro. Puedes copiar el acabado a todo el documento.

El botón de sol/luna en la cabecera alterna entre **Claro** y **Oscuro AMOLED**.
El tema oscuro usa negro puro como fondo, paneles con elevación y acento verde
esmeralda. El claro mantiene la misma distribución con superficies blancas y
texto oscuro. El cambio de tema afecta a la interfaz; conserva los colores de
los documentos, los ajustes de recorte y los archivos exportados.

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
