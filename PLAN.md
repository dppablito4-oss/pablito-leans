# Plan de evolución — Pablito Leans

## 1. Objetivo

Construir un escáner de documentos **rápido, privado, confiable y cómodo en
móvil**, sin perder la buena experiencia de escritorio.

Pablito Leans no necesita copiar todas las funciones de Microsoft Lens. Debe
hacer excepcionalmente bien este recorrido:

```text
Capturar o importar → Ajustar → Limpiar → Organizar → Exportar
```

## 2. Lo que realmente importa

1. Abrir la aplicación y empezar sin esperas ni loaders infinitos.
2. Capturar o importar una página fácilmente desde el celular.
3. Detectar y ajustar los bordes con precisión.
4. Obtener texto limpio, fondo uniforme y colores naturales.
5. Organizar varias páginas sin perder trabajo.
6. Crear rápidamente un PDF o imágenes con buena calidad.
7. Mantener todo dentro del dispositivo y funcionar sin conexión.

## 3. Fuera de alcance

Estas funciones no forman parte del producto actual ni del roadmap principal:

- OCR y PDF con texto reconocible.
- Captura o disparo automático.
- Extracción de tablas.
- Tarjetas de contacto y archivos VCF.
- Lectura en voz alta.
- Escáner QR o códigos de barras.
- Exportación a Word o PowerPoint.
- Funciones generativas o de “IA” añadidas sólo por marketing.
- Integraciones obligatorias con cuentas o servicios en la nube.

Sólo se reconsiderarán si algún día resuelven una necesidad real de los
usuarios sin perjudicar velocidad, privacidad o simplicidad.

## 4. Principios

1. **Calidad del escaneo antes que cantidad de funciones.**
2. **Móvil primero, escritorio intacto.**
3. **Procesamiento local y privacidad por defecto.**
4. **Una acción principal clara por pantalla.**
5. **Configuración avanzada sólo cuando se necesita.**
6. **Nunca perder una página escaneada.**
7. **Cada mejora debe poder probarse con documentos reales.**

## 5. Estado actual

La aplicación ya tiene:

- Importación de imágenes y PDFs.
- Detección de bordes con OpenCV.js.
- Ajuste manual de cuatro esquinas.
- Corrección de perspectiva y rotación.
- Documentos de varias páginas.
- Reordenamiento, eliminación y adición de páginas.
- Hasta tres documentos abiertos.
- Varios filtros y ajustes manuales.
- Exportación a PDF, JPG y ZIP.
- Tamaños, orientación y rangos de exportación.
- PWA, funcionamiento offline y procesamiento local.
- Navegación básica mediante teclado.

## 6. Roadmap

### Fase 0 — Estabilidad

**Objetivo:** que la aplicación actual nunca se quede bloqueada ni pierda datos.

- [ ] Probar Android, iPhone, tablet y PC.
- [ ] Probar JPG, PNG, WebP, fotografías grandes y PDFs extensos.
- [ ] Verificar instalación, actualización PWA y funcionamiento offline.
- [ ] Garantizar que OpenCV siempre termine en estado listo o error recuperable.
- [ ] Verificar que una carga inválida no detenga las demás páginas.
- [ ] Probar cambios rápidos entre páginas y documentos.
- [ ] Preparar un conjunto fijo de imágenes para comparar resultados.

**Terminado cuando:**

- No existen loaders infinitos.
- Ninguna página termina en el documento equivocado.
- Los errores muestran una explicación y una acción para recuperarse.
- Todas las pruebas automáticas y manuales pasan.

---

### Fase 1 — Interfaz mobile-first

**Objetivo:** que la app se sienta diseñada para teléfono y no como la versión de
PC reducida.

- [x] Usar una vista por paso: Capturar, Ajustar, Limpiar, Organizar y Exportar.
- [x] Crear una barra inferior fija para las acciones principales.
- [x] Utilizar botones grandes, legibles y alcanzables con una mano.
- [x] Respetar las áreas seguras de iPhone y las barras del sistema.
- [ ] Mostrar filtros en un carrusel horizontal con vista previa.
- [x] Mover ajustes secundarios a un panel desplegable.
- [ ] Permitir ampliar y desplazar la página con gestos.
- [ ] Reducir texto, controles y opciones visibles al mismo tiempo.
- [x] Mantener una vista de dos columnas para PC desde 1024 px.
- [ ] Diseñar estados de vacío, carga, proceso, error y sin conexión.

**Terminado cuando:**

- El recorrido principal puede completarse con una mano.
- No hay desplazamiento horizontal accidental.
- Todos los objetivos táctiles miden al menos 44 × 44 px.
- La experiencia de PC conserva su espacio y potencia actuales.

---

### Fase 2 — Cámara manual confiable

**Objetivo:** capturar una página sin depender exclusivamente del selector de
archivos, pero sin añadir automatismos innecesarios.

- [x] Abrir la cámara con `navigator.mediaDevices.getUserMedia()`.
- [x] Preferir la cámara trasera.
- [x] Añadir un disparador grande y accesible.
- [x] Permitir cambiar de cámara.
- [x] Activar linterna cuando el navegador y el dispositivo lo permitan.
- [x] Mostrar una guía visual para colocar el documento.
- [ ] Permitir repetir o aceptar inmediatamente la fotografía.
- [ ] Añadir captura manual continua para documentos de varias páginas.
- [x] Mantener “Elegir archivo” y “Importar PDF” como alternativas.
- [x] Cerrar siempre la cámara al abandonar la pantalla.

**No se implementará disparo automático.** El usuario decide cuándo capturar.

**Terminado cuando:**

- La cámara se abre rápidamente en Android y iPhone compatibles.
- La fotografía conserva suficiente resolución para texto pequeño.
- Cancelar, repetir y aceptar nunca dejan la cámara activa en segundo plano.

---

### Fase 3 — Bordes y filtros de calidad

**Objetivo:** que ésta sea la principal ventaja del producto.

#### Bordes y perspectiva

- [ ] Corregir la orientación EXIF antes de procesar.
- [ ] Mejorar detección en fondos claros, oscuros y con poco contraste.
- [ ] Validar que el contorno sea un cuadrilátero razonable.
- [ ] Evitar esquinas cruzadas o áreas demasiado pequeñas.
- [ ] Separar resolución de vista previa y resolución final.
- [ ] Hacer más grandes y precisos los controles de esquinas en móvil.

#### Cuatro filtros principales

- [x] **Auto:** aplicar un tratamiento conservador de iluminación y color.
- [ ] **Documento:** fondo uniforme y texto nítido sin destruir letras finas.
- [ ] **Pizarra:** limpiar el fondo conservando marcadores de colores.
- [ ] **Color:** corregir iluminación sin saturar ni cambiar tonos naturales.

#### Mejoras técnicas

- [ ] Corregir balance de blancos.
- [ ] Reducir sombras e iluminación desigual.
- [ ] Limpiar ruido antes de aumentar nitidez.
- [ ] Recuperar texto gris, tenue o de papel térmico.
- [ ] Evitar halos, manchas y áreas completamente quemadas.
- [ ] Añadir un único control de intensidad por filtro.
- [x] Mostrar comparación antes/después al mantener pulsada la página.
- [x] Aplicar el mismo filtro a todas las páginas.

Los filtros Sepia, Boceto y similares pueden permanecer como secundarios, pero
no deben consumir tiempo antes de perfeccionar los cuatro modos principales.

**Terminado cuando:**

- Documento conserva texto pequeño y líneas finas.
- Las sombras suaves disminuyen sin borrar contenido.
- Pizarra conserva rojo, azul, verde y negro.
- Color se parece a la escena original, pero más limpia.
- La previsualización coincide con el archivo exportado.

---

### Fase 4 — Documentos sin pérdida de trabajo

**Objetivo:** manejar documentos grandes con menos RAM y poder continuar después.

- [ ] Sustituir Data URL por `Blob` para imágenes completas.
- [ ] Guardar documentos y páginas en IndexedDB.
- [ ] Restaurar la sesión después de recargar o cerrar la PWA.
- [ ] Crear miniaturas pequeñas separadas de las imágenes originales.
- [ ] Permitir renombrar, duplicar y eliminar documentos.
- [ ] Permitir mover páginas entre documentos.
- [ ] Mostrar espacio utilizado y una opción para borrar datos locales.
- [ ] Añadir deshacer para eliminación y reordenamiento.

**Terminado cuando:**

- Recargar no elimina el trabajo actual.
- Cincuenta páginas no mantienen varias copias base64 completas en memoria.
- El usuario puede borrar permanentemente todos sus documentos locales.

---

### Fase 5 — Exportación excelente

**Objetivo:** obtener el archivo correcto con la menor cantidad de decisiones.

- [ ] Crear presets: Documento, Impresión, Archivo ligero y Tamaño original.
- [ ] Estimar el peso antes de exportar.
- [ ] Mejorar compresión de PDF sin destruir texto fino.
- [ ] Recordar las últimas preferencias utilizadas.
- [ ] Compartir con Web Share API desde móvil.
- [ ] Guardar directamente cuando File System Access API esté disponible.
- [ ] Dividir ZIP grandes para evitar picos de memoria.
- [ ] Permitir exportar una página, un rango o todo el documento.
- [ ] Mantener PDF y JPG como formatos principales.

**Terminado cuando:**

- Exportar un documento normal requiere como máximo dos decisiones.
- Un documento de 50 páginas se exporta sin bloquear la interfaz.
- El archivo resultante mantiene el orden y la orientación correctos.

---

### Fase 6 — Herramientas útiles, no decorativas

Sólo después de completar las fases anteriores:

- [ ] Firma local.
- [ ] Censura irreversible de información.
- [ ] Rotación y filtros por lote.
- [ ] Marcas de agua.
- [ ] Numeración de páginas.
- [ ] Combinar documentos.

Cada herramienta debe justificar su presencia resolviendo una tarea frecuente.

## 7. Arquitectura objetivo

Separar gradualmente responsabilidades para que `app.js` no siga creciendo:

```text
js/
├── app.js                 # Arranque y coordinación
├── state/
│   ├── document-store.js  # Documentos, páginas y acciones
│   └── persistence.js     # IndexedDB y migraciones
├── camera/
│   └── camera.js          # Cámara manual y capacidades
├── vision/
│   ├── detector.js        # Bordes
│   ├── perspective.js     # Transformación
│   └── filters.js         # Auto, Documento, Pizarra y Color
├── export/
│   ├── pdf.js
│   ├── images.js
│   └── share.js
└── ui/
    ├── navigation.js
    ├── dialogs.js
    └── toasts.js
```

Las imágenes completas deben almacenarse como `Blob`. El estado sólo debe
contener IDs, metadatos, esquinas, configuración de filtro y referencias.

## 8. Prioridad definitiva

### Ahora

1. Estabilidad y pruebas en dispositivos reales.
2. Interfaz mobile-first.
3. Cámara manual.
4. Bordes y cuatro filtros realmente buenos.

### Después

5. Persistencia local con IndexedDB.
6. Exportación y compartir.
7. Firma, censura y acciones por lote.

### No planificado

OCR, captura automática, tablas, contactos, QR, Word, PowerPoint e IA.

## 9. Métricas

- Menos de 3 segundos desde abrir hasta poder capturar.
- Máximo 2 toques para tomar una fotografía desde el inicio.
- Procesamiento de una fotografía de 12 MP en menos de 3 segundos en móvil medio.
- Cero pérdida de páginas al recargar o quedarse sin conexión.
- Exportación exitosa de documentos de 50 páginas.
- Lighthouse Performance ≥ 85 y Accessibility ≥ 95.
- Cero loaders o procesos infinitos.

## 10. Primera entrega

La primera entrega del rediseño incluirá únicamente:

1. Nueva navegación móvil inferior.
2. Pantalla de cámara manual a tamaño completo.
3. Importar archivo y PDF como alternativas visibles.
4. Ajuste de esquinas simplificado.
5. Carrusel de cuatro filtros: Auto, Documento, Pizarra y Color.
6. Pantalla simple para organizar páginas.
7. Exportación rápida a PDF o JPG.
8. Vista de escritorio conservada mediante breakpoint.

El objetivo de esta entrega es que **abrir, capturar, limpiar y exportar** resulte
rápido y agradable. Todo lo que no mejore directamente ese recorrido espera.

## 11. Definición de terminado

Una fase se considera completa cuando:

- [ ] Funciona en Android, iPhone y PC.
- [ ] Incluye carga, error, cancelación y recuperación.
- [ ] Tiene pruebas para su lógica crítica.
- [ ] Se probó con documentos, recibos y pizarras reales.
- [ ] No envía contenido del usuario a servicios externos.
- [ ] No empeora memoria, velocidad ni experiencia de escritorio.
- [ ] Actualiza README, service worker y documentación relacionada.
