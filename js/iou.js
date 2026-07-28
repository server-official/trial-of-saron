// All boxes are normalized (0-1) in {cx, cy, w, h} form (YOLO convention),
// converted internally to {x1, y1, x2, y2} for the IoU calc.

function toCorners(box) {
  return {
    x1: box.cx - box.w / 2,
    y1: box.cy - box.h / 2,
    x2: box.cx + box.w / 2,
    y2: box.cy + box.h / 2,
  };
}

function iou(boxA, boxB) {
  const a = toCorners(boxA);
  const b = toCorners(boxB);

  const interX1 = Math.max(a.x1, b.x1);
  const interY1 = Math.max(a.y1, b.y1);
  const interX2 = Math.min(a.x2, b.x2);
  const interY2 = Math.min(a.y2, b.y2);

  const interW = Math.max(0, interX2 - interX1);
  const interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;

  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const unionArea = areaA + areaB - interArea;

  if (unionArea <= 0) return 0;
  return interArea / unionArea;
}

// Parses a YOLO-style label file's text content.
// Line format: class_id cx cy w h [confidence]
// Returns the FIRST valid line as the target (Trial of SARON expects one
// target per image). Returns null if the file has no valid line.
function parseYoloLabel(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/\s+/).map(Number);
    if (parts.length < 5 || parts.some(Number.isNaN)) continue;
    const [classId, cx, cy, w, h, conf] = parts;
    return {
      classId,
      cx, cy, w, h,
      confidence: conf !== undefined ? conf : null,
    };
  }
  return null;
}
