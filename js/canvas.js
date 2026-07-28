class BoxCanvas {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.img = null;
    this.imgRect = { x: 0, y: 0, w: 0, h: 0 }; // where the image is drawn inside the canvas
    this.drawnBox = null;   // normalized {cx,cy,w,h} the player is drawing/has drawn
    this.overlays = [];     // [{box, color, label}] shown after confirm
    this.drawingEnabled = false;
    this._drag = null;

    this._bindEvents();
  }

  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.img = img;
        this._fit();
        this.drawnBox = null;
        this.overlays = [];
        this.render();
        resolve();
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  _fit() {
    // Canvas backing resolution matches its CSS width for crisp rendering,
    // height derived from image aspect ratio.
    const cssWidth = this.canvas.clientWidth || 640;
    const aspect = this.img.naturalHeight / this.img.naturalWidth;
    const height = Math.round(cssWidth * aspect);
    const maxH = window.innerHeight * 0.6;
    const scale = height > maxH ? maxH / height : 1;

    this.canvas.width = Math.round(cssWidth * scale);
    this.canvas.height = Math.round(height * scale);
    this.imgRect = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
  }

  _bindEvents() {
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    };

    const start = (e) => {
      if (!this.drawingEnabled) return;
      e.preventDefault();
      const p = getPos(e);
      this._drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      this.render();
    };
    const move = (e) => {
      if (!this.drawingEnabled || !this._drag) return;
      e.preventDefault();
      const p = getPos(e);
      this._drag.x1 = p.x;
      this._drag.y1 = p.y;
      this._commitDrag();
      this.render();
    };
    const end = (e) => {
      if (!this.drawingEnabled || !this._drag) return;
      this._commitDrag();
      this._drag = null;
      this.render();
      if (this.onBoxChange) this.onBoxChange(this.drawnBox);
    };

    this.canvas.addEventListener('mousedown', start);
    this.canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    this.canvas.addEventListener('touchstart', start, { passive: false });
    this.canvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
  }

  _commitDrag() {
    const d = this._drag;
    const x1 = Math.max(0, Math.min(d.x0, d.x1));
    const y1 = Math.max(0, Math.min(d.y0, d.y1));
    const x2 = Math.min(this.canvas.width, Math.max(d.x0, d.x1));
    const y2 = Math.min(this.canvas.height, Math.max(d.y0, d.y1));

    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 3 || h < 3) { this.drawnBox = null; return; }

    this.drawnBox = {
      cx: (x1 + w / 2) / this.canvas.width,
      cy: (y1 + h / 2) / this.canvas.height,
      w: w / this.canvas.width,
      h: h / this.canvas.height,
    };
  }

  refit() {
    if (!this.img) return;
    this._fit();
    this.render();
  }

  setDrawingEnabled(v) { this.drawingEnabled = v; }

  clearDrawnBox() { this.drawnBox = null; this.render(); }

  setOverlays(overlays) { this.overlays = overlays; this.render(); }

  _boxToPx(box) {
    return {
      x: (box.cx - box.w / 2) * this.canvas.width,
      y: (box.cy - box.h / 2) * this.canvas.height,
      w: box.w * this.canvas.width,
      h: box.h * this.canvas.height,
    };
  }

  _drawReticleBox(px, color, label) {
    const ctx = this.ctx;
    const { x, y, w, h } = px;
    const armLen = Math.max(8, Math.min(w, h) * 0.22);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // corner brackets
    ctx.lineWidth = 2.5;
    const corners = [
      [x, y, 1, 1], [x + w, y, -1, 1],
      [x, y + h, 1, -1], [x + w, y + h, -1, -1],
    ];
    for (const [cx, cy, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + armLen * dy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + armLen * dx, cy);
      ctx.stroke();
    }

    if (label) {
      ctx.font = '11px "JetBrains Mono", monospace';
      const padX = 5;
      const textW = ctx.measureText(label).width;
      const tagY = y - 16 >= 0 ? y - 16 : y + h + 2;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, tagY, textW + padX * 2, 15);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#04140d';
      ctx.fillText(label, x + padX, tagY + 11);
    }
    ctx.restore();
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.img) {
      ctx.drawImage(this.img, 0, 0, this.canvas.width, this.canvas.height);
    }

    // live drag rectangle (simple, while dragging)
    if (this._drag) {
      const x1 = Math.min(this._drag.x0, this._drag.x1);
      const y1 = Math.min(this._drag.y0, this._drag.y1);
      const w = Math.abs(this._drag.x1 - this._drag.x0);
      const h = Math.abs(this._drag.y1 - this._drag.y0);
      ctx.save();
      ctx.strokeStyle = '#00ff9c';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x1, y1, w, h);
      ctx.restore();
    } else if (this.drawnBox && this.overlays.length === 0) {
      this._drawReticleBox(this._boxToPx(this.drawnBox), '#00ff9c', 'YOUR BOX');
    }

    for (const o of this.overlays) {
      this._drawReticleBox(this._boxToPx(o.box), o.color, o.label);
    }
  }
}
