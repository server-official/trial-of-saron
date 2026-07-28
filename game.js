/* ===========================================================
   TRIAL OF SARON — game.js
   Static playback engine over a precomputed manifest.json.
   The "model" here is not run live — its box/class/confidence
   were produced by a real forward pass through the trained
   PyTorch model, baked ahead of time by precompute.py, because
   GitHub Pages cannot execute Python/PyTorch in-browser.
   =========================================================== */

const TOTAL_ROUNDS = 10;
const CANVAS_RES = 500; // internal logical resolution for all stage canvases

let manifest = null;
let roundSamples = [];
let roundIndex = 0;      // 0-based
let playerScore = 0;
let modelScore = 0;
let roundOutcomes = [];  // 'win' | 'loss' | 'tie' per completed round

let currentSample = null;
let userBox = null;      // {x1,y1,x2,y2} normalized 0-1
let selectedClass = null;
let roundLocked = false; // true after confirm, until Next

let drawing = false;
let dragStart = null;

const $ = (id) => document.getElementById(id);

const imgCanvas = () => $("imgCanvas");
const overlayCanvas = () => $("overlayCanvas");
const drawCanvas = () => $("drawCanvas");

function log(msg, cls = "t-sys") {
  const el = $("terminalLog");
  const line = document.createElement("div");
  line.className = cls;
  const ts = new Date().toISOString().split("T")[1].split(".")[0];
  line.textContent = `[${ts}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 60) el.removeChild(el.firstChild);
}

function iou(a, b) {
  if (!a || !b) return 0;
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function boxArrToObj(arr) {
  if (!arr) return null;
  return { x1: arr[0], y1: arr[1], x2: arr[2], y2: arr[3] };
}

/* ---------------- Boot sequence ---------------- */
function runBoot(done) {
  const lines = [
    "SARON DETECTION NETWORK — OPERATOR TERMINAL",
    "----------------------------------------------",
    "> loading manifest.json ...............  OK",
    "> verifying baked inference cache .....  OK",
    "> calibrating operator display ........  OK",
    "> establishing signal uplink ..........  OK",
    "",
    "TRIAL OF SARON — 10 ROUNDS — GOOD LUCK, OPERATOR",
  ];
  const pre = $("bootText");
  let i = 0;
  function step() {
    if (i < lines.length) {
      pre.textContent += lines[i] + "\n";
      i++;
      setTimeout(step, 90);
    } else {
      setTimeout(() => {
        $("bootOverlay").style.transition = "opacity .4s ease";
        $("bootOverlay").style.opacity = "0";
        setTimeout(() => {
          $("bootOverlay").style.display = "none";
          done();
        }, 420);
      }, 500);
    }
  }
  step();
}

/* ---------------- Data loading ---------------- */
async function loadManifest() {
  const res = await fetch("data/manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error("manifest.json not found");
  return res.json();
}

function shuffledSample(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  if (copy.length >= n) return copy.slice(0, n);
  // not enough unique samples: allow repeats to fill out the session
  const out = [];
  while (out.length < n) out.push(...copy);
  return out.slice(0, n);
}

/* ---------------- Setup ---------------- */
function buildClassButtons() {
  const grid = $("classGrid");
  grid.innerHTML = "";
  manifest.classes.forEach((cls) => {
    const btn = document.createElement("button");
    btn.className = "class-btn";
    btn.textContent = cls;
    btn.dataset.cls = cls;
    btn.addEventListener("click", () => {
      if (roundLocked) return;
      selectedClass = cls;
      [...grid.children].forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      updateConfirmEnabled();
      $("statusLine").innerHTML = `&gt; Classification set to <b>${cls}</b>.`;
    });
    grid.appendChild(btn);
  });
}

function buildRoundTracker() {
  const tracker = $("roundTracker");
  tracker.innerHTML = "";
  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const pip = document.createElement("div");
    pip.className = "pip";
    tracker.appendChild(pip);
  }
  updateRoundTracker();
}

function updateRoundTracker() {
  const pips = $("roundTracker").children;
  for (let i = 0; i < pips.length; i++) {
    pips[i].className = "pip";
    if (i < roundOutcomes.length) {
      pips[i].classList.add(roundOutcomes[i]);
    } else if (i === roundIndex) {
      pips[i].classList.add("current");
    }
  }
}

function setCanvasSizes() {
  [imgCanvas(), overlayCanvas(), drawCanvas()].forEach((c) => {
    c.width = CANVAS_RES;
    c.height = CANVAS_RES;
  });
}

/* ---------------- Round lifecycle ---------------- */
function startNewGame() {
  playerScore = 0;
  modelScore = 0;
  roundIndex = 0;
  roundOutcomes = [];
  roundSamples = shuffledSample(manifest.samples, TOTAL_ROUNDS);
  $("playerScore").textContent = "0";
  $("modelScore").textContent = "0";
  $("roundTotal").textContent = TOTAL_ROUNDS;
  $("endScreen").classList.add("hidden");
  $("terminalLog").innerHTML = "";
  log("New trial initialized. 10 targets queued.", "t-sys");
  buildRoundTracker();
  loadRound();
}

function loadRound() {
  roundLocked = false;
  userBox = null;
  selectedClass = null;
  dragStart = null;
  drawing = false;

  currentSample = roundSamples[roundIndex];
  $("roundNum").textContent = roundIndex + 1;
  $("sampleId").textContent = currentSample.id.toUpperCase();
  $("stagePhase").textContent = "DRAW TARGET BOX";
  $("scanSweep").classList.remove("paused");

  updateRoundTracker();

  // reset UI
  [...$("classGrid").children].forEach((b) =>
    b.classList.remove("selected", "correct-flash", "wrong-flash")
  );
  $("confirmBtn").disabled = true;
  $("nextBtn").disabled = true;
  $("statusLine").innerHTML = "&gt; Awaiting bounding box + classification...";
  $("stageCaption").innerHTML =
    '&gt; Click and drag on the image to draw a bounding box around the target.<span class="blink">_</span>';

  clearCanvas(overlayCanvas());
  clearCanvas(drawCanvas());

  const img = new Image();
  img.onload = () => {
    const ctx = imgCanvas().getContext("2d");
    ctx.clearRect(0, 0, CANVAS_RES, CANVAS_RES);
    ctx.drawImage(img, 0, 0, CANVAS_RES, CANVAS_RES);
  };
  img.src = "data/" + currentSample.image;

  log(`Round ${roundIndex + 1}: signal ${currentSample.id} incoming.`, "t-sys");
}

function clearCanvas(c) {
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
}

function updateConfirmEnabled() {
  $("confirmBtn").disabled = !(userBox && selectedClass && !roundLocked);
}

/* ---------------- Drawing box ---------------- */
function canvasCoords(evt) {
  const rect = drawCanvas().getBoundingClientRect();
  const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
  const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
  const x = ((clientX - rect.left) / rect.width) * CANVAS_RES;
  const y = ((clientY - rect.top) / rect.height) * CANVAS_RES;
  return {
    x: Math.max(0, Math.min(CANVAS_RES, x)),
    y: Math.max(0, Math.min(CANVAS_RES, y)),
  };
}

function drawUserBoxPixels(p1, p2) {
  const ctx = drawCanvas().getContext("2d");
  ctx.clearRect(0, 0, CANVAS_RES, CANVAS_RES);
  ctx.strokeStyle = "#33ff99";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "rgba(51,255,153,0.7)";
  ctx.shadowBlur = 6;
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x);
  const h = Math.abs(p2.y - p1.y);
  ctx.strokeRect(x, y, w, h);
}

function attachDrawHandlers() {
  const c = drawCanvas();

  const onDown = (e) => {
    if (roundLocked) return;
    e.preventDefault();
    drawing = true;
    dragStart = canvasCoords(e);
  };
  const onMove = (e) => {
    if (!drawing || roundLocked) return;
    e.preventDefault();
    const p = canvasCoords(e);
    drawUserBoxPixels(dragStart, p);
  };
  const onUp = (e) => {
    if (!drawing || roundLocked) return;
    e.preventDefault();
    const p = canvasCoords(e);
    drawing = false;
    const x1 = Math.min(dragStart.x, p.x) / CANVAS_RES;
    const y1 = Math.min(dragStart.y, p.y) / CANVAS_RES;
    const x2 = Math.max(dragStart.x, p.x) / CANVAS_RES;
    const y2 = Math.max(dragStart.y, p.y) / CANVAS_RES;
    if (x2 - x1 < 0.02 || y2 - y1 < 0.02) {
      // too small, ignore
      $("statusLine").innerHTML = "&gt; Box too small — try again.";
      clearCanvas(drawCanvas());
      userBox = null;
      updateConfirmEnabled();
      return;
    }
    userBox = { x1, y1, x2, y2 };
    updateConfirmEnabled();
    $("statusLine").innerHTML = selectedClass
      ? `&gt; Box set. Classification: <b>${selectedClass}</b>.`
      : "&gt; Box set. Now select a classification.";
  };

  c.addEventListener("mousedown", onDown);
  c.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  c.addEventListener("touchstart", onDown, { passive: false });
  c.addEventListener("touchmove", onMove, { passive: false });
  c.addEventListener("touchend", onUp, { passive: false });
}

/* ---------------- Confirm + scoring ---------------- */
function drawBoxOnOverlay(boxNorm, color, dashed) {
  const ctx = overlayCanvas().getContext("2d");
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  if (dashed) ctx.setLineDash([7, 5]);
  const x = boxNorm.x1 * CANVAS_RES;
  const y = boxNorm.y1 * CANVAS_RES;
  const w = (boxNorm.x2 - boxNorm.x1) * CANVAS_RES;
  const h = (boxNorm.y2 - boxNorm.y1) * CANVAS_RES;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function confirmPrediction() {
  if (!userBox || !selectedClass || roundLocked) return;
  roundLocked = true;
  $("confirmBtn").disabled = true;
  $("scanSweep").classList.add("paused");
  $("stagePhase").textContent = "ANALYZING";

  const gtBox = boxArrToObj(currentSample.gt_box);
  const gtClass = currentSample.gt_class;
  const predBox = boxArrToObj(currentSample.pred_box);
  const predClass = currentSample.pred_class;
  const predConf = currentSample.pred_conf;

  const playerIoU = iou(userBox, gtBox);
  const playerCorrect = selectedClass === gtClass && playerIoU > 0.5;

  const modelIoU = predBox ? iou(predBox, gtBox) : 0;
  const modelCorrect = predBox && predClass === gtClass && modelIoU > 0.5;

  log(
    `Operator called ${selectedClass} @ IoU ${playerIoU.toFixed(2)} → ${
      playerCorrect ? "MATCH" : "NO MATCH"
    }`,
    playerCorrect ? "t-good" : "t-bad"
  );
  log(
    predBox
      ? `Model called ${predClass} (conf ${predConf.toFixed(2)}) @ IoU ${modelIoU.toFixed(
          2
        )} → ${modelCorrect ? "MATCH" : "NO MATCH"}`
      : `Model reported no detection.`,
    modelCorrect ? "t-good" : "t-bad"
  );
  log(`Ground truth: ${gtClass}.`, "t-sys");

  // Reveal sequence: model box first (amber dashed), then ground truth (blue)
  setTimeout(() => {
    if (predBox) drawBoxOnOverlay(predBox, "#ffb020", true);
    $("stageCaption").innerHTML = `&gt; MODEL PREDICTION: <span class="flash">${
      predClass || "NO DETECTION"
    }</span> ${predBox ? `(conf ${(predConf * 100).toFixed(0)}%, IoU ${modelIoU.toFixed(2)})` : ""}`;
  }, 350);

  setTimeout(() => {
    drawBoxOnOverlay(gtBox, "#4dd0ff", false);
    $("stageCaption").innerHTML = `&gt; GROUND TRUTH: <span class="flash">${gtClass}</span> confirmed.`;
    $("stagePhase").textContent = "RESULT";
  }, 900);

  setTimeout(() => {
    // class button feedback
    [...$("classGrid").children].forEach((b) => {
      if (b.dataset.cls === gtClass) b.classList.add("correct-flash");
      else if (b.dataset.cls === selectedClass) b.classList.add("wrong-flash");
    });

    if (playerCorrect) playerScore++;
    if (modelCorrect) modelScore++;
    $("playerScore").textContent = playerScore;
    $("modelScore").textContent = modelScore;

    let outcome = "tie";
    if (playerCorrect && !modelCorrect) outcome = "win";
    else if (modelCorrect && !playerCorrect) outcome = "loss";
    roundOutcomes.push(outcome);
    updateRoundTracker();

    $("statusLine").innerHTML = `&gt; Your IoU: <b>${playerIoU.toFixed(
      2
    )}</b> — ${playerCorrect ? "<b>POINT SCORED</b>" : "no point"}. Model IoU: <b>${modelIoU.toFixed(
      2
    )}</b> — ${modelCorrect ? "model scored" : "model missed"}.`;

    $("nextBtn").disabled = false;
    if (roundIndex === TOTAL_ROUNDS - 1) {
      $("nextBtn").textContent = "VIEW RESULTS ▶";
    }
  }, 1300);
}

function nextRound() {
  roundIndex++;
  if (roundIndex >= TOTAL_ROUNDS) {
    showEndScreen();
    return;
  }
  $("nextBtn").textContent = "NEXT ROUND ▶";
  loadRound();
}

function showEndScreen() {
  $("endScreen").classList.remove("hidden");
  $("endPlayerScore").textContent = playerScore;
  $("endModelScore").textContent = modelScore;
  let title = "TRIAL COMPLETE";
  let sub = "";
  if (playerScore > modelScore) {
    title = "OPERATOR VICTORY";
    sub = "You out-classified the network.";
  } else if (modelScore > playerScore) {
    title = "MODEL VICTORY";
    sub = "SARON takes this trial.";
  } else {
    title = "DEAD HEAT";
    sub = "Evenly matched. Run it back.";
  }
  $("endTitle").textContent = title;
  $("endSub").textContent = sub;
  log(`Trial complete: Operator ${playerScore} — ${modelScore} Model. ${sub}`, "t-sys");
}

/* ---------------- Database / archive modal ---------------- */
let dbActiveFilter = "ALL";

function buildDbModal() {
  const filters = $("dbFilters");
  filters.innerHTML = "";
  const allBtn = document.createElement("button");
  allBtn.textContent = "ALL";
  allBtn.className = "active";
  allBtn.addEventListener("click", () => setDbFilter("ALL", allBtn));
  filters.appendChild(allBtn);

  manifest.classes.forEach((cls) => {
    const btn = document.createElement("button");
    btn.textContent = cls;
    btn.addEventListener("click", () => setDbFilter(cls, btn));
    filters.appendChild(btn);
  });

  renderDbGrid();
}

function setDbFilter(cls, btnEl) {
  dbActiveFilter = cls;
  [...$("dbFilters").children].forEach((b) => b.classList.remove("active"));
  btnEl.classList.add("active");
  renderDbGrid();
}

function renderDbGrid() {
  const grid = $("dbGrid");
  grid.innerHTML = "";
  const items =
    dbActiveFilter === "ALL"
      ? manifest.samples
      : manifest.samples.filter((s) => s.gt_class === dbActiveFilter);

  items.forEach((s) => {
    const card = document.createElement("div");
    card.className = "db-card";

    const thumb = document.createElement("div");
    thumb.className = "db-thumb";
    const img = document.createElement("img");
    img.src = "data/" + s.image;
    thumb.appendChild(img);

    const [x1, y1, x2, y2] = s.gt_box;
    const boxDiv = document.createElement("div");
    boxDiv.className = "db-box";
    boxDiv.style.left = `${x1 * 100}%`;
    boxDiv.style.top = `${y1 * 100}%`;
    boxDiv.style.width = `${(x2 - x1) * 100}%`;
    boxDiv.style.height = `${(y2 - y1) * 100}%`;
    thumb.appendChild(boxDiv);

    card.appendChild(thumb);

    const cap = document.createElement("div");
    cap.className = "db-caption";
    cap.innerHTML = `<span>${s.id}</span><b>${s.gt_class}</b>`;
    card.appendChild(cap);

    grid.appendChild(card);
  });
}

/* ---------------- Wiring ---------------- */
function wireButtons() {
  $("confirmBtn").addEventListener("click", confirmPrediction);
  $("nextBtn").addEventListener("click", nextRound);
  $("clearBoxBtn").addEventListener("click", () => {
    if (roundLocked) return;
    userBox = null;
    clearCanvas(drawCanvas());
    updateConfirmEnabled();
    $("statusLine").innerHTML = "&gt; Box cleared. Draw again.";
  });
  $("restartBtn").addEventListener("click", () => {
    if (confirm("Restart the trial? Current progress will be lost.")) startNewGame();
  });
  $("playAgainBtn").addEventListener("click", startNewGame);

  $("openDbBtn").addEventListener("click", () => {
    $("dbModal").classList.add("open");
  });
  $("closeDbBtn").addEventListener("click", () => {
    $("dbModal").classList.remove("open");
  });
  $("dbModal").addEventListener("click", (e) => {
    if (e.target === $("dbModal")) $("dbModal").classList.remove("open");
  });
}

/* ---------------- Init ---------------- */
async function init() {
  setCanvasSizes();
  wireButtons();
  attachDrawHandlers();

  try {
    manifest = await loadManifest();
  } catch (err) {
    $("statusLine").innerHTML =
      "&gt; ERROR: could not load data/manifest.json. Run precompute.py or check the data/ folder.";
    console.error(err);
    return;
  }

  buildClassButtons();
  buildDbModal();

  runBoot(() => {
    if (manifest.is_demo_data) {
      log(
        "WARNING: running on DEMO placeholder data. Run precompute.py with your real weights + dataset to play against your actual model.",
        "t-bad"
      );
    }
    startNewGame();
  });
}

window.addEventListener("DOMContentLoaded", init);
