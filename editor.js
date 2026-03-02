/**
 * Dot SVG Maker — editor.js
 * Web-based pixel art editor with SVG / PNG / WebP export.
 */

(function () {
  'use strict';

  /* ============================================================
     State
     ============================================================ */
  const DEFAULT_W = 16;
  const DEFAULT_H = 16;
  const DEFAULT_CELL = 20;

  let gridW = DEFAULT_W;
  let gridH = DEFAULT_H;
  let cellSize = DEFAULT_CELL;

  // pixels[y][x] = color string | null (transparent)
  let pixels = [];

  let currentColor = '#000000';
  let currentTool = 'pencil';
  let showGrid = true;
  let transparentBg = false;
  let bgColor = '#ffffff';

  let isDrawing = false;
  let lastDrawnCell = null; // { x, y } — avoid re-drawing same cell

  // Undo / redo stacks — each entry is a flat copy of pixels
  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 50;

  // Default palette
  const DEFAULT_PALETTE = [
    '#000000', '#ffffff', '#ff0000', '#00cc00', '#0000ff',
    '#ffff00', '#ff8800', '#cc00cc', '#00cccc', '#888888',
    '#ff99aa', '#99ddff', '#aaffaa', '#ffddaa', '#ccbbff',
    '#663300',
  ];

  let palette = [...DEFAULT_PALETTE];

  /* ============================================================
     DOM references
     ============================================================ */
  const canvas = document.getElementById('dot-canvas');
  const ctx = canvas.getContext('2d');
  const wrapper = document.getElementById('canvas-wrapper');

  const colorPicker = document.getElementById('color-picker');
  const colorPreview = document.getElementById('color-preview');
  const bgColorPicker = document.getElementById('bg-color-picker');
  const transparentBgCheck = document.getElementById('transparent-bg');
  const showGridCheck = document.getElementById('show-grid');
  const zoomRange = document.getElementById('zoom-range');
  const zoomLabel = document.getElementById('zoom-label');

  const paletteEl = document.getElementById('palette');
  const exportScaleInput = document.getElementById('export-scale');

  /* ============================================================
     Initialise
     ============================================================ */
  function initPixels(w, h) {
    const newPixels = [];
    for (let y = 0; y < h; y++) {
      newPixels[y] = [];
      for (let x = 0; x < w; x++) {
        newPixels[y][x] = (pixels[y] && pixels[y][x] !== undefined) ? pixels[y][x] : null;
      }
    }
    return newPixels;
  }

  function init() {
    pixels = initPixels(gridW, gridH);
    resizeCanvas();
    buildPalette();
    render();
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = gridW * cellSize;
    const displayHeight = gridH * cellSize;

    // Set backing store size in physical pixels
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;

    // Set CSS size in logical pixels
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';

    // Scale drawing operations so existing code still uses logical coordinates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ============================================================
     Render
     ============================================================ */
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    if (!transparentBg) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Pixels
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const color = pixels[y][x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }
    }

    // Grid overlay
    if (showGrid && cellSize >= 4) {
      ctx.strokeStyle = 'rgba(128,128,128,0.35)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let x = 0; x <= gridW; x++) {
        ctx.moveTo(x * cellSize, 0);
        ctx.lineTo(x * cellSize, gridH * cellSize);
      }
      for (let y = 0; y <= gridH; y++) {
        ctx.moveTo(0, y * cellSize);
        ctx.lineTo(gridW * cellSize, y * cellSize);
      }
      ctx.stroke();
    }
  }

  /* ============================================================
     History (undo/redo)
     ============================================================ */
  function saveHistory() {
    undoStack.push(makeSnapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
  }

  function makeSnapshot() {
    return { w: gridW, h: gridH, pixels: pixels.map(row => [...row]) };
  }

  function restoreSnapshot(snap) {
    gridW = snap.w;
    gridH = snap.h;
    pixels = snap.pixels.map(row => [...row]);
    document.getElementById('canvas-width').value = gridW;
    document.getElementById('canvas-height').value = gridH;
    resizeCanvas();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(makeSnapshot());
    restoreSnapshot(undoStack.pop());
    render();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(makeSnapshot());
    restoreSnapshot(redoStack.pop());
    render();
  }

  /* ============================================================
     Drawing
     ============================================================ */
  function cellAt(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = Math.floor((e.clientX - rect.left) * scaleX / cellSize);
    const cy = Math.floor((e.clientY - rect.top) * scaleY / cellSize);
    if (cx < 0 || cy < 0 || cx >= gridW || cy >= gridH) return null;
    return { x: cx, y: cy };
  }

  function applyTool(cell) {
    if (!cell) return;
    const { x, y } = cell;

    if (currentTool === 'pencil') {
      pixels[y][x] = currentColor;
    } else if (currentTool === 'eraser') {
      pixels[y][x] = null;
    } else if (currentTool === 'eyedropper') {
      const picked = pixels[y][x] || bgColor;
      setColor(picked);
      setTool('pencil');
      return;
    }
    render();
  }

  function floodFill(x, y, targetColor, fillColor) {
    if (targetColor === fillColor) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= gridW || cy >= gridH) continue;
      if (pixels[cy][cx] !== targetColor) continue;
      pixels[cy][cx] = fillColor;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  /* ============================================================
     Color
     ============================================================ */
  function setColor(hex) {
    currentColor = hex;
    colorPicker.value = hex;
    colorPreview.style.background = hex;
    // Highlight selected swatch
    document.querySelectorAll('.palette-swatch').forEach(sw => {
      sw.classList.toggle('selected', sw.dataset.color === hex);
    });
  }

  /* ============================================================
     Tool selection
     ============================================================ */
  function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    // Update cursor
    wrapper.style.cursor = (tool === 'fill' || tool === 'eraser') ? 'cell' : 'crosshair';
  }

  /* ============================================================
     Palette
     ============================================================ */
  function buildPalette() {
    paletteEl.innerHTML = '';
    palette.forEach(color => {
      const sw = document.createElement('button');
      sw.className = 'palette-swatch' + (color === currentColor ? ' selected' : '');
      sw.style.background = color;
      sw.dataset.color = color;
      sw.title = color;
      sw.setAttribute('aria-label', color);
      sw.addEventListener('click', () => setColor(color));
      paletteEl.appendChild(sw);
    });
  }

  /* ============================================================
     SVG Export
     ============================================================ */
  function exportSVG() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('xmlns', ns);
    svg.setAttribute('width', String(gridW));
    svg.setAttribute('height', String(gridH));
    svg.setAttribute('viewBox', `0 0 ${gridW} ${gridH}`);
    svg.setAttribute('shape-rendering', 'crispEdges');

    // Background rect
    if (!transparentBg) {
      const bg = document.createElementNS(ns, 'rect');
      bg.setAttribute('x', '0');
      bg.setAttribute('y', '0');
      bg.setAttribute('width', String(gridW));
      bg.setAttribute('height', String(gridH));
      bg.setAttribute('fill', bgColor);
      svg.appendChild(bg);
    }

    // Merge adjacent same-color pixels in each row using run-length encoding
    // for a smaller SVG file.
    for (let y = 0; y < gridH; y++) {
      let x = 0;
      while (x < gridW) {
        const color = pixels[y][x];
        if (!color) { x++; continue; }
        let runLen = 1;
        while (x + runLen < gridW && pixels[y][x + runLen] === color) runLen++;
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(runLen));
        rect.setAttribute('height', '1');
        rect.setAttribute('fill', color);
        svg.appendChild(rect);
        x += runLen;
      }
    }

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    downloadBlob(blob, 'dot-art.svg');
  }

  /* ============================================================
     PNG / WebP Export
     ============================================================ */
  function exportRaster(format) {
    const scale = Math.max(1, parseInt(exportScaleInput.value, 10) || 1);
    const offscreen = document.createElement('canvas');
    offscreen.width = gridW * scale;
    offscreen.height = gridH * scale;
    const octx = offscreen.getContext('2d');

    if (!transparentBg) {
      octx.fillStyle = bgColor;
      octx.fillRect(0, 0, offscreen.width, offscreen.height);
    }

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const color = pixels[y][x];
        if (color) {
          octx.fillStyle = color;
          octx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }

    const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
    const ext = format === 'webp' ? 'webp' : 'png';
    offscreen.toBlob(blob => {
      if (blob) {
        downloadBlob(blob, `dot-art.${ext}`);
        return;
      }

      // Handle unsupported MIME types (e.g., WebP) or other failures.
      if (format === 'webp') {
        // Fallback: try exporting as PNG instead.
        offscreen.toBlob(fallbackBlob => {
          if (fallbackBlob) {
            // Inform the user that WebP is not supported and PNG was used.
            alert('Your browser does not support WebP export. Exported PNG instead.');
            downloadBlob(fallbackBlob, 'dot-art.png');
          } else {
            alert('Export failed: your browser does not support this image export.');
          }
        }, 'image/png');
      } else {
        alert('Export failed: your browser does not support this image export.');
      }
    }, mimeType);
  }

  /* ============================================================
     Download helper
     ============================================================ */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    // Defer cleanup to avoid cancelling/corrupting the download in some browsers
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  /* ============================================================
     Event listeners
     ============================================================ */

  // --- Canvas mouse events ---
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const cell = cellAt(e);
    if (!cell) return;

    if (currentTool === 'fill') {
      saveHistory();
      const target = pixels[cell.y][cell.x];
      floodFill(cell.x, cell.y, target, currentColor);
      render();
      return;
    }

    isDrawing = true;
    lastDrawnCell = null;
    saveHistory();
    lastDrawnCell = cell;
    applyTool(cell);
  });

  canvas.addEventListener('mousemove', e => {
    if (!isDrawing) return;
    const cell = cellAt(e);
    if (!cell) return;
    if (lastDrawnCell && cell.x === lastDrawnCell.x && cell.y === lastDrawnCell.y) return;
    lastDrawnCell = cell;
    applyTool(cell);
  });

  canvas.addEventListener('mouseup', () => { isDrawing = false; });
  canvas.addEventListener('mouseleave', () => { isDrawing = false; });

  // Touch support
  function touchCell(e) {
    e.preventDefault();
    const touch = e.touches[0];
    return cellAt({ clientX: touch.clientX, clientY: touch.clientY });
  }

  canvas.addEventListener('touchstart', e => {
    const cell = touchCell(e);
    if (!cell) return;
    if (currentTool === 'fill') {
      saveHistory();
      floodFill(cell.x, cell.y, pixels[cell.y][cell.x], currentColor);
      render();
      return;
    }
    isDrawing = true;
    lastDrawnCell = null;
    saveHistory();
    lastDrawnCell = cell;
    applyTool(cell);
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!isDrawing) return;
    const cell = touchCell(e);
    if (!cell) return;
    if (lastDrawnCell && cell.x === lastDrawnCell.x && cell.y === lastDrawnCell.y) return;
    lastDrawnCell = cell;
    applyTool(cell);
  }, { passive: false });

  canvas.addEventListener('touchend', () => { isDrawing = false; });

  // --- Tool buttons ---
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // --- Color picker ---
  colorPicker.addEventListener('input', e => setColor(e.target.value));

  // --- Background color ---
  bgColorPicker.addEventListener('input', e => {
    bgColor = e.target.value;
    render();
  });

  transparentBgCheck.addEventListener('change', e => {
    transparentBg = e.target.checked;
    render();
  });

  // --- Grid toggle ---
  showGridCheck.addEventListener('change', e => {
    showGrid = e.target.checked;
    render();
  });

  // --- Zoom ---
  zoomRange.addEventListener('input', e => {
    cellSize = parseInt(e.target.value, 10);
    zoomLabel.textContent = `${cellSize}px`;
    resizeCanvas();
    render();
  });

  // --- Resize canvas ---
  document.getElementById('btn-resize').addEventListener('click', () => {
    const newW = Math.max(1, Math.min(128, parseInt(document.getElementById('canvas-width').value, 10) || gridW));
    const newH = Math.max(1, Math.min(128, parseInt(document.getElementById('canvas-height').value, 10) || gridH));
    saveHistory();
    gridW = newW;
    gridH = newH;
    pixels = initPixels(gridW, gridH);
    resizeCanvas();
    render();
  });

  // --- Undo / redo ---
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  // --- Clear ---
  document.getElementById('btn-clear').addEventListener('click', () => {
    saveHistory();
    pixels = initPixels(gridW, gridH).map(row => row.map(() => null));
    render();
  });

  // --- Palette ---
  document.getElementById('btn-add-color').addEventListener('click', () => {
    if (!palette.includes(currentColor)) {
      palette.push(currentColor);
      buildPalette();
    }
  });

  document.getElementById('btn-clear-palette').addEventListener('click', () => {
    palette = [...DEFAULT_PALETTE];
    buildPalette();
  });

  // --- Export ---
  document.getElementById('btn-export-svg').addEventListener('click', exportSVG);
  document.getElementById('btn-export-png').addEventListener('click', () => exportRaster('png'));
  document.getElementById('btn-export-webp').addEventListener('click', () => exportRaster('webp'));

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }
    if (document.activeElement.tagName === 'INPUT') return;
    switch (e.key.toLowerCase()) {
      case 'p': setTool('pencil'); break;
      case 'e': setTool('eraser'); break;
      case 'f': setTool('fill'); break;
      case 'i': setTool('eyedropper'); break;
    }
  });

  /* ============================================================
     Boot
     ============================================================ */
  init();

})();
