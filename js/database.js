const Database = {
  modalCanvas: null,

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
      cell.innerHTML = `<img loading="lazy" src="${entry.image}" alt="${entry.class}">
        <div class="tag" style="color:${cls ? cls.color : '#0f9'}">${cls ? cls.label : entry.class}</div>`;
      cell.addEventListener('click', () => this.openModal(entry));
      this.grid.appendChild(cell);
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
