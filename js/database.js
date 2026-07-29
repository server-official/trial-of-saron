const THUMB_WIDTH = 260; // backing-store resolution; CSS scales it down to the grid column width

const Database = {
  modalCanvas: null,
  _observer: null,

  init() {
    this.grid = document.getElementById('dbGrid');
    this.classFilter = document.getElementById('dbClassFilter');
    this.modal = document.getElementById('dbModal');
    this.modalCanvasEl = document.getElementById('dbModalCanvas');
    this.modalCaption = document.getElementById('dbModalCaption');
    this.modalCanvas = new BoxCanvas(this.modalCanvasEl);

    document.getElementById('dbModalClose').addEventListener('click', () => this.closeModal());
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.closeModal(); });

    this._populateClassFilter();
    this.classFilter.addEventListener('change', () => this.renderGrid());

    this._observer = new IntersectionObserver((entries) => {
      for (const obs of entries) {
        if (obs.isIntersecting) {
          this._observer.unobserve(obs.target);
          this._drawThumb(obs.target);
        }
      }
    }, { root: this.grid, rootMargin: '200px' });

    this.renderGrid();
  },

  _populateClassFilter() {
    this.classFilter.innerHTML = '<option value="">ALL CLASSES</option>' +
      DataStore.classes.map(c => `<option value="${c.name}">${c.label}</option>`).join('');
  },

  renderGrid() {
    const filter = this.classFilter.value;
    const entries = DataStore.manifest.training.filter(e => !filter || e.class === filter);

    if (entries.length === 0) {
      this.grid.innerHTML = '<p class="hint">NO TRAINING RECORDS FOUND FOR THIS FILTER.</p>';
      return;
    }

    this.grid.innerHTML = '';
    for (const entry of entries) {
      const cls = DataStore.classByName[entry.class];
      const cell = document.createElement('div');
      cell.className = 'db-thumb';
      cell.dataset.image = entry.image;
      cell.dataset.label = entry.label;
      cell.dataset.class = entry.class;
      cell.innerHTML = `<canvas class="db-thumb-canvas"></canvas>
        <div class="tag" style="color:${cls ? cls.color : '#0f9'}">${cls ? cls.label : entry.class}</div>`;
      cell.addEventListener('click', () => this.openModal(entry));
      this.grid.appendChild(cell);
      this._observer.observe(cell);
    }
  },

  async _drawThumb(cell) {
    const canvasEl = cell.querySelector('.db-thumb-canvas');
    const imgSrc = cell.dataset.image;
    const labelSrc = cell.dataset.label;
    const clsName = cell.dataset.class;

    try {
      const [img, label] = await Promise.all([
        loadImageEl(imgSrc),
        DataStore.fetchLabel(labelSrc).catch(() => null),
      ]);

      const aspect = img.naturalHeight / img.naturalWidth;
      const w = THUMB_WIDTH;
      const h = Math.round(THUMB_WIDTH * aspect);
      canvasEl.width = w;
      canvasEl.height = h;

      const ctx = canvasEl.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      if (label) {
        const cls = DataStore.classById(label.classId) || DataStore.classByName[clsName];
        drawBoxOnContext(ctx, label, w, h, cls ? cls.color : '#00ff9c');
      }
    } catch (err) {
      canvasEl.replaceWith(Object.assign(document.createElement('div'), {
        className: 'db-thumb-error',
        textContent: 'LOAD FAILED',
      }));
    }
  },

  async openModal(entry) {
    this.modal.classList.add('open');
    this.modalCaption.textContent = 'LOADING RECORD...';
    await this.modalCanvas.loadImage(entry.image);
    const label = await DataStore.fetchLabel(entry.label);
    const cls = DataStore.classById(label ? label.classId : -1) || DataStore.classByName[entry.class];

    if (label) {
      this.modalCanvas.setOverlays([{
        box: label,
        color: cls ? cls.color : '#00ff9c',
        label: `GT: ${cls ? cls.label : entry.class}`,
      }]);
    }
    this.modalCaption.textContent = `${entry.image}  —  CLASS: ${cls ? cls.label : entry.class}`;
  },

  closeModal() {
    this.modal.classList.remove('open');
  },
};

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Lightweight, non-interactive version of BoxCanvas's reticle drawing —
// used for grid thumbnails, which don't need drag handling or overlays.
function drawBoxOnContext(ctx, box, canvasW, canvasH, color) {
  const x = (box.cx - box.w / 2) * canvasW;
  const y = (box.cy - box.h / 2) * canvasH;
  const w = box.w * canvasW;
  const h = box.h * canvasH;
  const armLen = Math.max(6, Math.min(w, h) * 0.25);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  ctx.lineWidth = 2;
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
  ctx.restore();
}
