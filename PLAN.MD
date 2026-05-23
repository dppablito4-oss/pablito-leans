# Plan de Desarrollo MVP: Escáner Web Documental

## 🎯 Objetivo del MVP
Crear una herramienta web estática (sin backend) que permita subir una foto, detectar los bordes de un documento, ajustar las esquinas manualmente si es necesario, y aplicar filtros para exportar una imagen limpia y plana, lista para imprimir o guardar.

## 🛠️ Stack Tecnológico
*   **Frontend:** HTML5, CSS3, JavaScript (Vanilla).
*   **Motor de Visión:** OpenCV.js (vía WebAssembly).
*   **Manipulación Gráfica:** HTML5 `<canvas>`.

---

## 🚀 Fases de Desarrollo

### Fase 1: Estructura Base e Interfaz (UI)
- [ ] Crear estructura de archivos (`index.html`, `style.css`, `app.js`).
- [ ] Implementar la carga asíncrona de OpenCV.js mediante CDN.
- [ ] Maquetar la UI básica (botones de subir/escanear/descargar).
- [ ] Configurar el `<input type="file" accept="image/*">` para admitir cámara de celulares o archivos locales.
- [ ] Dibujar la imagen cargada en el `canvasInput` respetando su relación de aspecto.

### Fase 2: Procesamiento Inicial (La Matemática)
- [ ] Convertir la imagen original a escala de grises (`cv.cvtColor`).
- [ ] Aplicar desenfoque gaussiano para eliminar ruido visual (`cv.GaussianBlur`).
- [ ] Aplicar detección de bordes mediante algoritmo Canny (`cv.Canny`).
- [ ] Buscar contornos en la imagen (`cv.findContours`) y filtrar el cuadrilátero más grande (que probablemente sea la hoja).

### Fase 3: Interactividad (El "Microsoft Lens")
- [ ] Dibujar 4 círculos (nodos) sobre el `<canvas>` en las coordenadas de las esquinas detectadas.
- [ ] Si la detección automática falla, colocar los 4 nodos en las esquinas del canvas por defecto.
- [ ] Programar eventos del mouse/táctiles (`pointerdown`, `pointermove`, `pointerup`) para permitir al usuario arrastrar los nodos y corregir la selección.
- [ ] Dibujar líneas que conecten los 4 nodos en tiempo real formando un polígono.

### Fase 4: Transformación y Resultado Final
- [ ] Mapear las coordenadas de los 4 nodos y ordenar los puntos (Arriba-Izquierda, Arriba-Derecha, Abajo-Derecha, Abajo-Izquierda).
- [ ] Aplicar la matriz de transformación de perspectiva (`cv.warpPerspective`) para aplanar la imagen.
- [ ] Aplicar umbralización adaptativa (`cv.adaptiveThreshold`) para blanquear el fondo y resaltar el texto en negro.
- [ ] Mostrar el resultado en `canvasOutput`.
- [ ] Habilitar el botón de "Descargar" usando `canvas.toDataURL()` para generar un archivo PNG/JPG.

---

## 📦 Backlog (Funciones para integrar después del MVP)
*   **Exportación a PDF:** Usar una librería como `jsPDF` para guardar el escaneo directo como documento.
*   **Modos de Color:** Añadir filtros seleccionables (Blanco y Negro puro, Escala de grises, o Color original mejorado).
*   **Rotación Manual:** Botones para girar la imagen final 90 grados por si quedó de lado.
*   **Optimización de Rendimiento:** Procesar la imagen en baja resolución para la previsualización y aplicar la matemática a la resolución original solo al exportar.