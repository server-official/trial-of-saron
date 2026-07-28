#!/usr/bin/env python3
"""
Generates a tiny synthetic placeholder dataset (speckled noise + a bright
blob standing in for a SAR target) across all 5 classes, so the repo runs
end-to-end immediately after cloning. Delete training/, test/ and
predictions/ and drop in real SAR chips + YOLO labels when ready, then
re-run scripts/generate_manifest.py.

Usage: python3 scripts/generate_sample_data.py
"""
import json
import os
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SIZE = 320

with open(os.path.join(ROOT, "classes.json")) as f:
    CLASSES = json.load(f)["classes"]

random.seed(7)


def speckle_bg():
    img = Image.new("L", (SIZE, SIZE))
    px = img.load()
    for y in range(SIZE):
        for x in range(SIZE):
            px[x, y] = random.randint(10, 55)
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    return img.convert("RGB")


def draw_target(img, class_idx):
    draw = ImageDraw.Draw(img)
    w = random.randint(28, 55)
    h = random.randint(int(w * 0.4), int(w * 0.8))
    cx = random.randint(w, SIZE - w)
    cy = random.randint(h, SIZE - h)
    angle_shapes = class_idx % 3

    brightness = random.randint(200, 255)
    x1, y1, x2, y2 = cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2

    if angle_shapes == 0:
        draw.ellipse([x1, y1, x2, y2], fill=(brightness, brightness, brightness))
    elif angle_shapes == 1:
        draw.rectangle([x1, y1, x2, y2], fill=(brightness, brightness, brightness))
    else:
        draw.polygon([(cx, y1), (x2, cy), (cx, y2), (x1, cy)], fill=(brightness, brightness, brightness))

    # a little glow / speckle around it for realism
    for _ in range(40):
        gx = cx + random.randint(-w, w)
        gy = cy + random.randint(-h, h)
        if 0 <= gx < SIZE and 0 <= gy < SIZE:
            draw.point((gx, gy), fill=(brightness, brightness, brightness))

    # normalized YOLO box, with a little padding
    pad = 1.15
    bw = min(1.0, (w * pad) / SIZE)
    bh = min(1.0, (h * pad) / SIZE)
    return {
        "classId": class_idx,
        "cx": cx / SIZE, "cy": cy / SIZE,
        "w": bw, "h": bh,
    }


def jitter_box(box, class_idx, num_classes, flip_class_prob=0.35, jitter=0.06):
    """Simulate an imperfect model prediction."""
    new = dict(box)
    new["cx"] = min(1, max(0, box["cx"] + random.uniform(-jitter, jitter)))
    new["cy"] = min(1, max(0, box["cy"] + random.uniform(-jitter, jitter)))
    new["w"] = min(1, max(0.02, box["w"] * random.uniform(0.8, 1.2)))
    new["h"] = min(1, max(0.02, box["h"] * random.uniform(0.8, 1.2)))
    if random.random() < flip_class_prob:
        new["classId"] = random.randrange(num_classes)
    else:
        new["classId"] = class_idx
    new["confidence"] = round(random.uniform(0.55, 0.98), 2)
    return new


def label_line(box):
    parts = [box["classId"], box["cx"], box["cy"], box["w"], box["h"]]
    if "confidence" in box:
        parts.append(box["confidence"])
    return " ".join(f"{p:.6f}" if isinstance(p, float) else str(p) for p in parts)


def make_split(split, count_per_class, with_predictions=False):
    for cls in CLASSES:
        cdir = os.path.join(ROOT, split, cls["name"])
        os.makedirs(cdir, exist_ok=True)
        if with_predictions:
            pdir = os.path.join(ROOT, "predictions", cls["name"])
            os.makedirs(pdir, exist_ok=True)

        for i in range(count_per_class):
            name = f"{cls['name']}_{i:03d}"
            img = speckle_bg()
            box = draw_target(img, cls["id"])
            img.save(os.path.join(cdir, f"{name}.jpg"), quality=90)
            with open(os.path.join(cdir, f"{name}.txt"), "w") as f:
                f.write(label_line(box) + "\n")

            if with_predictions:
                pred = jitter_box(box, cls["id"], len(CLASSES))
                with open(os.path.join(pdir, f"{name}.txt"), "w") as f:
                    f.write(label_line(pred) + "\n")


def main():
    print("Generating sample training set...")
    make_split("training", count_per_class=6, with_predictions=False)
    print("Generating sample test set + predictions...")
    make_split("test", count_per_class=3, with_predictions=True)
    print("Done. Now run scripts/generate_manifest.py")


if __name__ == "__main__":
    main()
