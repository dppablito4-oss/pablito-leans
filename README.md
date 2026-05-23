# 📸 Pablito Leans — Escáner Web de Documentos

Herramienta web estática que permite escanear documentos directamente desde el navegador. Detecta bordes automáticamente, permite ajustar las esquinas manualmente y exporta imágenes limpias y planas listas para imprimir o guardar.

**🌐 [leans.sypablitodp.site](https://leans.sypablitodp.site)**

---

## ✨ Características

- 📄 **Detección automática de bordes** con OpenCV.js (Canny + contornos)
- 🎯 **Ajuste manual de esquinas** con nodos arrastrables (mouse y touch)
- 🔄 **Transformación de perspectiva** para aplanar documentos
- 🎨 **Filtros**: Blanco & Negro, Escala de Grises, Color mejorado
- 📥 **Descarga directa** en PNG
- 📱 **Responsive** y compatible con cámaras de celular
- 🔒 **100% privado** — todo se procesa localmente, sin servidores

## 🛠️ Stack

- HTML5 / CSS3 / JavaScript (Vanilla)
- [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html) vía WebAssembly
- HTML5 Canvas
- GitHub Pages

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
│   ├── scanner.js      # Motor de visión (OpenCV.js)
│   └── corners.js      # Esquinas interactivas
├── assets/favicon.svg  # Favicon
├── CNAME               # Dominio custom
└── PLAN.MD             # Plan de desarrollo
```

## 📜 Licencia

MIT
