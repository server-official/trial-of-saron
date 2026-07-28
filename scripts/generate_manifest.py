#!/usr/bin/env python3
"""
Trial of SARON — manifest generator.

GitHub Pages can't list directory contents at runtime, so this script walks
training/, test/ and predictions/ ahead of time and writes a single
manifest.json at the repo root that the game loads in the browser.

Run this from the repo root any time you add/remove images:

    python3 scripts/generate_manifest.py

(The included GitHub Actions workflow also runs this automatically on every
push, so running it locally is optional — just convenient for testing.)

Expected layout:

  training/<class_name>/<image>.(jpg|jpeg|png|tif|tiff)
  training/<class_name>/<image>.txt         <- YOLO label, same basename
  test/<class_name>/<image>.(jpg|...)
  test/<class_name>/<image>.txt             <- YOLO ground-truth label
  predictions/<class_name>/<image>.txt      <- YOLO model prediction,
                                                same class_name + basename
                                                as the matching test image

YOLO label line format (one target per image is expected by the game):
  class_id cx cy w h [confidence]
  (all of cx, cy, w, h normalized 0-1; confidence is optional, predictions
  only)
"""
import json
import os
import sys

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def class_dirs(base):
    path = os.path.join(ROOT, base)
    if not os.path.isdir(path):
        return []
    return sorted(
        d for d in os.listdir(path)
        if os.path.isdir(os.path.join(path, d)) and not d.startswith(".")
    )


def basename_no_ext(fname):
    return os.path.splitext(fname)[0]


def scan_images_with_labels(base, cls):
    """Return list of {class, image, label} for a class dir under base."""
    folder = os.path.join(ROOT, base, cls)
    files = os.listdir(folder)
    images = {basename_no_ext(f): f for f in files if f.lower().endswith(IMAGE_EXTS)}
    labels = {basename_no_ext(f): f for f in files if f.lower().endswith(".txt")}

    entries = []
    for key, img in sorted(images.items()):
        if key not in labels:
            print(f"  [warn] {base}/{cls}/{img} has no matching .txt label — skipped")
            continue
        entries.append({
            "class": cls,
            "image": f"{base}/{cls}/{img}",
            "label": f"{base}/{cls}/{labels[key]}",
        })
    return entries


def scan_predictions(cls):
    folder = os.path.join(ROOT, "predictions", cls)
    if not os.path.isdir(folder):
        return {}
    out = {}
    for f in os.listdir(folder):
        if f.lower().endswith(".txt"):
            out[basename_no_ext(f)] = f"predictions/{cls}/{f}"
    return out


def main():
    manifest = {"training": [], "test": []}

    train_classes = class_dirs("training")
    test_classes = class_dirs("test")

    print("Scanning training/ ...")
    for cls in train_classes:
        entries = scan_images_with_labels("training", cls)
        manifest["training"].extend(entries)
        print(f"  {cls}: {len(entries)} image(s)")

    print("Scanning test/ + predictions/ ...")
    for cls in test_classes:
        entries = scan_images_with_labels("test", cls)
        preds = scan_predictions(cls)
        matched = 0
        for e in entries:
            base = basename_no_ext(os.path.basename(e["image"]))
            pred_path = preds.get(base)
            e["prediction"] = pred_path
            if pred_path:
                matched += 1
            else:
                print(f"  [warn] no prediction found for test/{cls}/{os.path.basename(e['image'])}")
        manifest["test"].extend(entries)
        print(f"  {cls}: {len(entries)} image(s), {matched} with predictions")

    out_path = os.path.join(ROOT, "manifest.json")
    with open(out_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nWrote {out_path}")
    print(f"  training entries: {len(manifest['training'])}")
    print(f"  test entries:     {len(manifest['test'])}")

    if len(manifest["test"]) < 10:
        print("\n[warn] fewer than 10 test images found — the game needs at least 10 for a full 10-round match.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
