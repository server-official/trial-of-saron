const ROUNDS_TOTAL = 10;
const IOU_THRESHOLD = 0.5;

const COLOR_PLAYER = '#00ff9c';
const COLOR_MODEL = '#ffb000';
const COLOR_TRUTH = '#ff2e63';

const Game = {
  pool: [],
  round: 0,
  playerScore: 0,
  modelScore: 0,
  selectedClass: null,
  currentEntry: null,
  locked: false, // true once a round has been confirmed, until "next round"

  async boot() {
    try {
      await DataStore.load();
    } catch (err) {
      this.fatal(err.message);
      return;
    }

    this.stage = new BoxCanvas(document.getElementById('stage'));
    this.stage.onBoxChange = () => this.refreshConfirmState();

    Database.init();
    this.renderClassButtons();
    this.bindUI();

    const readyCount = DataStore.manifest.test.filter(e => e.prediction).length;
    document.getElementById('poolCount').textContent = readyCount;

    if (readyCount === 0) {
      this.fatal('No test images with matching predictions were found. Check that predictions/<class>/<filename>.txt mirrors test/<class>/<filename>.*');
      return;
    }

    document.getElementById('bootScreen').classList.remove('active');
  },

  fatal(msg) {
    const el = document.getElementById('bootScreen');
    el.innerHTML = `<div class="center-screen">
      <p class="big-title" style="font-size:22px;color:var(--danger)">SYSTEM ERROR</p>
      <p class="tagline">${msg}</p>
    </div>`;
  },

  bindUI() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    document.getElementById('startBtn').addEventListener('click', () => this.startMatch());
    document.getElementById('confirmBtn').addEventListener('click', () => this.confirmRound());
    document.getElementById('nextBtn').addEventListener('click', () => this.nextRound());
    document.getElementById('clearBoxBtn').addEventListener('click', () => {
      this.stage.clearDrawnBox();
      this.refreshConfirmState();
    });
    document.getElementById('restartBtn').addEventListener('click', () => this.startMatch());

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.stage.refit(), 120);
    });
  },

  switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
  },

  renderClassButtons() {
    const grid = document.getElementById('classGrid');
    grid.innerHTML = '';
    for (const cls of DataStore.classes) {
      const btn = document.createElement('button');
      btn.className = 'class-btn';
      btn.dataset.name = cls.name;
      btn.innerHTML = `<span class="swatch" style="background:${cls.color}"></span>${cls.label}`;
      btn.addEventListener('click', () => this.selectClass(cls.name, btn));
      grid.appendChild(btn);
    }
  },

  selectClass(name, btnEl) {
    if (this.locked) return;
    this.selectedClass = name;
    document.querySelectorAll('.class-btn').forEach(b => b.classList.toggle('selected', b === btnEl));
    this.refreshConfirmState();
  },

  refreshConfirmState() {
    const ready = !!this.stage.drawnBox && !!this.selectedClass && !this.locked;
    document.getElementById('confirmBtn').disabled = !ready;
  },

  buildPool() {
    const ready = DataStore.manifest.test.filter(e => e.prediction);
    const shuffled = [...ready].sort(() => Math.random() - 0.5);
    this.pool = shuffled.slice(0, Math.min(ROUNDS_TOTAL, shuffled.length));
  },

  startMatch() {
    this.buildPool();
    this.round = 0;
    this.playerScore = 0;
    this.modelScore = 0;
    document.getElementById('startScreen').classList.remove('active');
    document.getElementById('endScreen').classList.remove('active');
    document.getElementById('matchArea').classList.add('active');
    this.switchTab('match');
    this.updateScoreboard();
    this.loadRound();
  },

  updateScoreboard() {
    document.getElementById('playerScoreHud').textContent = this.playerScore;
    document.getElementById('modelScoreHud').textContent = this.modelScore;
    document.getElementById('roundHud').textContent = `${Math.min(this.round + 1, this.pool.length)}/${this.pool.length}`;
    const track = document.getElementById('progressTrack');
    track.innerHTML = '';
    for (let i = 0; i < this.pool.length; i++) {
      const seg = document.createElement('div');
      seg.className = 'seg' + (i < this.round ? ' done' : i === this.round ? ' current' : '');
      track.appendChild(seg);
    }
  },

  async loadRound() {
    this.locked = false;
    this.selectedClass = null;
    this.currentEntry = this.pool[this.round];
    document.getElementById('resultPanel').style.display = 'none';
    document.getElementById('predictBlock').style.display = '';
    document.getElementById('nextBtn').style.display = 'none';
    document.getElementById('confirmBtn').style.display = '';
    document.getElementById('clearBoxBtn').disabled = false;
    document.getElementById('classGrid').classList.remove('locked');

    await this.stage.loadImage(this.currentEntry.image);
    this.stage.setDrawingEnabled(true);
    this.stage.setOverlays([]);
    document.querySelectorAll('.class-btn').forEach(b => b.classList.remove('selected'));
    this.refreshConfirmState();
    this.updateScoreboard();

    document.getElementById('imgPathCaption').textContent = this.currentEntry.image.split('/').pop();
  },

  async confirmRound() {
    if (this.locked) return;
    this.locked = true;
    this.stage.setDrawingEnabled(false);
    document.getElementById('confirmBtn').style.display = 'none';
    document.getElementById('clearBoxBtn').disabled = true;
    document.getElementById('classGrid').classList.add('locked');

    const entry = this.currentEntry;
    const [gt, pred] = await Promise.all([
      DataStore.fetchLabel(entry.label),
      DataStore.fetchLabel(entry.prediction),
    ]);

    const gtClass = DataStore.classById(gt.classId);
    const predClass = pred ? DataStore.classById(pred.classId) : null;
    const playerBox = this.stage.drawnBox;

    const playerIoU = playerBox ? iou(playerBox, gt) : 0;
    const modelIoU = pred ? iou(pred, gt) : 0;

    const playerClassCorrect = this.selectedClass === gtClass.name;
    const modelClassCorrect = predClass && predClass.name === gtClass.name;

    const playerPoint = playerClassCorrect && playerIoU > IOU_THRESHOLD;
    const modelPoint = modelClassCorrect && modelIoU > IOU_THRESHOLD;

    if (playerPoint) this.playerScore++;
    if (modelPoint) this.modelScore++;

    const overlays = [];
    if (playerBox) overlays.push({ box: playerBox, color: COLOR_PLAYER, label: `YOU: ${this.selectedClass || '?'}` });
    if (pred) overlays.push({ box: pred, color: COLOR_MODEL, label: `MODEL: ${predClass ? predClass.name : '?'}` });
    overlays.push({ box: gt, color: COLOR_TRUTH, label: `TRUTH: ${gtClass.name}` });
    this.stage.setOverlays(overlays);

    this.renderResult({ gtClass, playerIoU, modelIoU, playerPoint, modelPoint, predClass });
    this.updateScoreboard();

    document.getElementById('nextBtn').style.display = '';
    document.getElementById('nextBtn').textContent = (this.round + 1 >= this.pool.length) ? 'SEE RESULTS >>' : 'NEXT ROUND >>';
  },

  renderResult({ gtClass, playerIoU, modelIoU, playerPoint, modelPoint, predClass }) {
    const panel = document.getElementById('resultPanel');
    panel.style.display = '';
    panel.innerHTML = `
      <div class="verdict ${playerPoint ? 'good' : 'bad'}">YOU: ${playerPoint ? '+1 POINT' : 'NO POINT'}</div>
      <div>Ground truth class: <b style="color:${gtClass.color}">${gtClass.label}</b></div>
      <div>Your class pick: <b>${this.selectedClass ? DataStore.classByName[this.selectedClass].label : 'NONE'}</b></div>
      <div>Your box IoU vs truth: <b>${playerIoU.toFixed(3)}</b> (need &gt; ${IOU_THRESHOLD})</div>
      <hr style="border-color: var(--line); margin: 10px 0;">
      <div class="verdict ${modelPoint ? 'good' : 'bad'}" style="color:${modelPoint ? 'var(--secondary)' : 'var(--danger)'}">MODEL: ${modelPoint ? '+1 POINT' : 'NO POINT'}</div>
      <div>Model class pick: <b>${predClass ? predClass.label : 'NONE'}</b></div>
      <div>Model box IoU vs truth: <b>${modelIoU.toFixed(3)}</b></div>
    `;
  },

  nextRound() {
    this.round++;
    if (this.round >= this.pool.length) {
      this.showEndScreen();
    } else {
      this.loadRound();
    }
  },

  showEndScreen() {
    document.getElementById('matchArea').classList.remove('active');
    document.getElementById('endScreen').classList.add('active');
    document.getElementById('finalPlayerScore').textContent = this.playerScore;
    document.getElementById('finalModelScore').textContent = this.modelScore;

    const verdict = document.getElementById('finalVerdict');
    if (this.playerScore > this.modelScore) {
      verdict.textContent = 'ANALYST VICTORY — YOU OUTPERFORMED THE MODEL';
      verdict.style.color = 'var(--primary)';
    } else if (this.playerScore < this.modelScore) {
      verdict.textContent = 'MODEL VICTORY — THE MACHINE WINS THIS TRIAL';
      verdict.style.color = 'var(--secondary)';
    } else {
      verdict.textContent = 'STALEMATE — TRIAL ENDS IN A DRAW';
      verdict.style.color = 'var(--info)';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => Game.boot());
