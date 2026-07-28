"""
precompute.py — Trial of SARON data baking script
====================================================

WHY THIS EXISTS
----------------
GitHub Pages only serves static files (HTML/CSS/JS). It cannot run Python,
PyTorch, or your custom `torchcvnn` biquaternion/CZT layers in a browser.
So instead of trying to port your model to the browser, this script runs
your REAL trained model once, locally, on your real dataset, and "bakes"
the results into a small static file bundle:

    data/manifest.json   <- classes, ground truth boxes, model predictions
    data/images/*.png    <- viewable renders of each SAR chip (Pauli RGB)

The web game then just plays back this manifest: the player draws a box
and picks a class, and it's scored against the SAME ground truth your
model was scored against. The model's "move" (its box + class) was
produced by an actual forward pass through your network — it's just
computed ahead of time instead of live in-browser.

USAGE
-----
Place this file next to your model file (referred to below as `z.py`),
make sure `torchcvnn` and your dataset are available, then run:

    python precompute.py \
        --model-file z.py \
        --data-root "H:\Solomon\train-test-val\dataset_quad" \
        --weights "H:\Solomon\train-test-val\sar_best_model.pt" \
        --split test \
        --num-samples 60 \
        --out-dir ./game/data

Then copy the produced `game/data/` folder into the `game/` folder you
got from Claude (overwriting the demo `data/` folder), and push the whole
`game/` folder to GitHub Pages.

Requirements: torch, torchvision, torchcvnn, numpy, scipy, pillow, tqdm
(the same environment you used to train the model).
"""

import argparse
import importlib.util
import json
import os
import random
import sys
from pathlib import Path

import numpy as np
import torch
import torchvision
from PIL import Image


def load_model_module(model_file: str):
    """Import the user's model .py file (e.g. z.py) as a module without executing
    its `if __name__ == "__main__"` training block."""
    model_path = Path(model_file).resolve()
    spec = importlib.util.spec_from_file_location("sar_model_module", model_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["sar_model_module"] = module
    spec.loader.exec_module(module)
    return module


def pauli_rgb(tensor_data: torch.Tensor) -> np.ndarray:
    """Convert a (4, H, W) complex quadpol tensor (HH, HV, VH, VV) into a viewable
    Pauli RGB decomposition, a standard way to visualize quadpol SAR data:
        R = |HH - VV|   (double-bounce)
        G = |HV|        (volume scattering)
        B = |HH + VV|   (surface scattering)
    """
    hh, hv, vh, vv = tensor_data[0], tensor_data[1], tensor_data[2], tensor_data[3]
    cross = (hv + vh) / 2.0

    r = torch.abs(hh - vv)
    g = torch.abs(cross)
    b = torch.abs(hh + vv)

    channels = []
    for ch in (r, g, b):
        ch = ch.numpy().astype(np.float32)
        # Robust contrast stretch (SAR has huge dynamic range / speckle)
        lo, hi = np.percentile(ch, 2), np.percentile(ch, 98)
        if hi <= lo:
            hi = lo + 1e-6
        ch = np.clip((ch - lo) / (hi - lo), 0.0, 1.0)
        # Mild log-ish gamma to lift dark pixels (common for SAR display)
        ch = np.power(ch, 0.6)
        channels.append(ch)

    rgb = np.stack(channels, axis=-1)
    return (rgb * 255.0).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser(description="Bake SAR model predictions into a static game manifest.")
    ap.add_argument("--model-file", required=True, help="Path to your model .py file (e.g. z.py)")
    ap.add_argument("--data-root", required=True, help="Dataset root (same as data_root in your training script)")
    ap.add_argument("--weights", required=True, help="Path to sar_best_model.pt checkpoint")
    ap.add_argument("--split", default="test", choices=["train", "val", "test"],
                     help="Which split to draw game samples from (default: test — no augmentation, unseen data)")
    ap.add_argument("--num-samples", type=int, default=60, help="How many samples to bake (game only needs 10 per session, bake more for variety)")
    ap.add_argument("--display-size", type=int, default=256, help="Output PNG resolution (chip is upsampled for visibility)")
    ap.add_argument("--out-dir", default="./game/data", help="Output directory (point this at the game's data/ folder)")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    mod = load_model_module(args.model_file)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[INFO] Using device: {device}")

    checkpoint = torch.load(args.weights, map_location=device)
    if not (isinstance(checkpoint, dict) and "class_to_idx" in checkpoint):
        raise RuntimeError(
            "Checkpoint does not contain 'class_to_idx'/'grid_size'/'img_size'. "
            "This script expects the checkpoint format saved by your training script's "
            "`torch.save({'model_state': ..., 'class_to_idx': ..., 'grid_size': ..., 'img_size': ...}, ...)`."
        )

    class_to_idx = checkpoint["class_to_idx"]
    idx_to_class = {v: k for k, v in class_to_idx.items()}
    grid_size = checkpoint.get("grid_size", 4)
    img_size = checkpoint.get("img_size", 64)
    nms_iou_thresh = checkpoint.get("nms_iou_thresh", 0.5)
    num_classes = len(class_to_idx)

    print(f"[INFO] Classes ({num_classes}): {list(class_to_idx.keys())}")
    print(f"[INFO] grid_size={grid_size} img_size={img_size} nms_iou_thresh={nms_iou_thresh}")

    dataset = mod.SARComplexDataset(
        root_dir=args.data_root,
        split=args.split,
        class_to_idx=class_to_idx,
        grid_size=grid_size,
        img_size=img_size,
    )
    if len(dataset) == 0:
        raise RuntimeError(f"No samples found for split='{args.split}' under {args.data_root}")

    model = mod.BiquaternionSARResNetDetector(num_classes=num_classes, grid_size=grid_size).to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    out_dir = Path(args.out_dir)
    img_dir = out_dir / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    n = min(args.num_samples, len(dataset))
    indices = random.sample(range(len(dataset)), n)

    samples_out = []

    with torch.no_grad():
        for count, idx in enumerate(indices):
            tensor_data, _target, boxes_tensor, class_ids_tensor = dataset[idx]

            if boxes_tensor.shape[0] == 0:
                continue  # skip chips with no labeled object

            # --- Run the real model ---
            imgs = tensor_data.unsqueeze(0).to(device)  # (1, 4, H, W) complex
            preds, _aux = model(imgs)
            decoded = mod.decode_predictions(preds, grid_size=grid_size, img_size=img_size)
            pboxes, pscores, pclasses = decoded[0]
            keep = torchvision.ops.nms(pboxes, pscores, iou_threshold=nms_iou_thresh)
            pboxes, pscores, pclasses = pboxes[keep], pscores[keep], pclasses[keep]

            pred_box = pred_class = None
            pred_conf = None
            if pboxes.shape[0] > 0:
                best = torch.argmax(pscores).item()
                bx = pboxes[best].clamp(0, img_size).tolist()
                pred_box = [bx[0] / img_size, bx[1] / img_size, bx[2] / img_size, bx[3] / img_size]
                pred_class = idx_to_class.get(int(pclasses[best].item()), "unknown")
                pred_conf = float(pscores[best].item())

            # Ground truth: take the first labeled object in the chip
            gbox = boxes_tensor[0].tolist()
            gt_box = [gbox[0] / img_size, gbox[1] / img_size, gbox[2] / img_size, gbox[3] / img_size]
            gt_class = idx_to_class.get(int(class_ids_tensor[0].item()), "unknown")

            # --- Render a viewable PNG (Pauli RGB) ---
            rgb = pauli_rgb(tensor_data.cpu())
            im = Image.fromarray(rgb, mode="RGB").resize(
                (args.display_size, args.display_size), Image.NEAREST
            )
            sample_id = f"{args.split}_{idx:06d}"
            im.save(img_dir / f"{sample_id}.png")

            samples_out.append({
                "id": sample_id,
                "image": f"images/{sample_id}.png",
                "gt_box": gt_box,
                "gt_class": gt_class,
                "pred_box": pred_box,
                "pred_class": pred_class,
                "pred_conf": pred_conf,
            })

            if (count + 1) % 10 == 0:
                print(f"[INFO] Processed {count + 1}/{n}")

    manifest = {
        "classes": list(class_to_idx.keys()),
        "class_to_idx": class_to_idx,
        "img_display_size": args.display_size,
        "split": args.split,
        "samples": samples_out,
    }

    with open(out_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n[DONE] Wrote {len(samples_out)} samples to {out_dir}/manifest.json")
    print(f"[DONE] Wrote {len(samples_out)} PNGs to {img_dir}/")
    print("\nNext step: copy this data/ folder into the game/ folder and push to GitHub Pages.")


if __name__ == "__main__":
    main()
