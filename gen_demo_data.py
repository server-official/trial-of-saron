"""Generates placeholder DEMO data so the game is playable immediately.
Not used once precompute.py output (from the real model) is dropped in.
"""
import json
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

random.seed(7)
np.random.seed(7)

CLASSES = ["Cargo Vessel", "Tanker", "Fishing Boat", "Naval Vessel", "Unknown Contact"]
SIZE = 256
N = 12

samples = []

for i in range(N):
    # speckly SAR-like background
    base = np.random.rayleigh(scale=18, size=(SIZE, SIZE)).clip(0, 255)
    base = base + np.random.normal(0, 6, (SIZE, SIZE))
    base = base.clip(0, 255).astype(np.uint8)
    img = Image.fromarray(base, mode="L").convert("RGB")
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    arr = np.array(img).astype(np.float32)

    # tint slightly per-channel to mimic Pauli RGB look
    tint = np.random.uniform(0.85, 1.15, size=3)
    arr = (arr * tint).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(arr, mode="RGB")

    draw = ImageDraw.Draw(img)

    # ground truth box: a brighter blob somewhere in frame
    bw, bh = random.randint(30, 60), random.randint(20, 45)
    bx = random.randint(20, SIZE - bw - 20)
    by = random.randint(20, SIZE - bh - 20)
    blob = Image.new("L", (bw, bh), 0)
    bd = ImageDraw.Draw(blob)
    bd.ellipse([2, 2, bw - 2, bh - 2], fill=random.randint(180, 255))
    blob = blob.filter(ImageFilter.GaussianBlur(2))
    img.paste(Image.merge("RGB", [blob, blob, blob]), (bx, by), blob)

    gt_class = random.choice(CLASSES)
    gt_box = [bx / SIZE, by / SIZE, (bx + bw) / SIZE, (by + bh) / SIZE]

    # fake "model prediction": jittered box + usually-correct-ish class
    jitter = lambda v: max(0.0, min(1.0, v + random.uniform(-0.04, 0.04)))
    pred_box = [jitter(c) for c in gt_box]
    if random.random() < 0.7:
        pred_class = gt_class
    else:
        pred_class = random.choice(CLASSES)
    pred_conf = round(random.uniform(0.55, 0.97), 3)

    sample_id = f"demo_{i:03d}"
    img.save(f"data/images/{sample_id}.png")

    samples.append({
        "id": sample_id,
        "image": f"images/{sample_id}.png",
        "gt_box": gt_box,
        "gt_class": gt_class,
        "pred_box": pred_box,
        "pred_class": pred_class,
        "pred_conf": pred_conf,
    })

manifest = {
    "classes": CLASSES,
    "class_to_idx": {c: idx for idx, c in enumerate(CLASSES)},
    "img_display_size": SIZE,
    "split": "demo",
    "is_demo_data": True,
    "samples": samples,
}

with open("data/manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

print(f"Wrote {len(samples)} demo samples.")
