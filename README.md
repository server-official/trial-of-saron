# Trial of SARON

A browser-based "human vs. model" game: you're shown a SAR (synthetic aperture
radar) image chip, you draw a bounding box around the target and classify it,
then your trained detector's own prediction and the ground truth are revealed.
Whoever gets closer (IoU > 0.5) **and** the right class scores the point, best
of 10 rounds.

## Important: why this isn't "live" PyTorch inference in the browser

Your model (`z.py`) is a genuinely custom architecture — complex-valued
biquaternion convolutions, a Chirp Z-Transform spectral attention block, and a
custom `torchcvnn` dependency — operating on complex quadpol `.mat` SAR data.
GitHub Pages only serves static files (HTML/CSS/JS); it cannot run Python,
PyTorch, or your custom ops in a visitor's browser, and this model's ops don't
have a realistic path to ONNX/TensorFlow.js given the complex/biquaternion math.

So the game uses a **bake-then-play** approach, which is standard for this kind
of "play against an AI" demo:

1. `precompute.py` runs **your real trained model** on **your real dataset**,
   locally, once (or whenever you want fresh rounds).
2. It saves the model's actual predictions (box + class + confidence), the
   ground truth, and a viewable render of each SAR chip into a small static
   `data/` bundle (`manifest.json` + PNGs).
3. The static game (`index.html` / `style.css` / `game.js`) plays this bundle
   back: it's a real game against a real model's real outputs — the inference
   itself just isn't recomputed live in the visitor's browser.

Your model's "move" each round is not scripted or faked — it's whatever your
network actually predicted for that chip.

## Files in this bundle

```
index.html          The game page
style.css            Hacker/CRT terminal aesthetic
game.js              Game logic (drawing, scoring, database viewer)
precompute.py         Run this yourself, locally, with your weights + dataset
gen_demo_data.py      (optional) regenerates the placeholder demo data
data/
  manifest.json      Classes, ground truth, model predictions (DEMO data included)
  images/*.png        Viewable renders of each chip (DEMO data included)
```

**The `data/` folder currently contains placeholder demo data** (synthetic
noise chips, fake boxes) so you can open `index.html` immediately and see the
whole game working end to end. Replace it with your real baked data before
sharing the link — see below.

## Step 1 — Bake your real data

On the machine where you trained the model (with `torch`, `torchvision`,
`torchcvnn`, `scipy`, `numpy`, `pillow` installed, and your dataset + weights
available), run:

```bash
python precompute.py \
    --model-file z.py \
    --data-root "H:\Solomon\train-test-val\dataset_quad" \
    --weights "H:\Solomon\train-test-val\sar_best_model.pt" \
    --split test \
    --num-samples 60 \
    --out-dir ./data
```

- `--split test` uses held-out data your model wasn't trained on and applies
  no augmentation, which makes for a fair "trial."
- `--num-samples 60` bakes 60 chips; each playthrough randomly draws 10 of
  them, so baking more gives more variety across replays.
- This overwrites the `data/manifest.json` and `data/images/` in this folder
  with your real classes, real ground truth, and your model's real
  predictions (via an actual forward pass through
  `BiquaternionSARResNetDetector`, NMS'd exactly like your validation loop).

Re-run this any time you retrain, want a different split, or want more
rounds' worth of variety.

## Step 2 — Deploy to GitHub Pages

1. Create a new GitHub repo (or use an existing one).
2. Copy all the files in this folder into the repo (keeping `data/` alongside
   `index.html`).
3. Commit and push.
4. In the repo: **Settings → Pages → Source**, choose the branch (e.g. `main`)
   and root folder, save.
5. GitHub gives you a URL like `https://<username>.github.io/<repo>/` — that's
   your game.

No build step is required — it's plain HTML/CSS/JS plus static JSON/PNG data.

## Notes / things you can tune

- **Ground truth per chip**: the precompute script uses the first labeled
  object in each chip. If your SAR chips can contain multiple objects and you
  want a specific one, adjust the `# Ground truth:` section in
  `precompute.py`.
- **Number of rounds**: change `TOTAL_ROUNDS` at the top of `game.js` (game
  auto-adapts round tracker / progress UI).
- **IoU / class-name mismatches**: predicted and ground-truth class names come
  straight from your checkpoint's `class_to_idx`, so they'll always match
  what your model was trained on.
- **Archive / database viewer**: the "📡 ARCHIVE" button shows every baked
  chip with its ground-truth box, filterable by class — this is the
  "interactive database" of labelled training images.
- If a chip has no confident detection, `pred_box`/`pred_class` are `null` in
  the manifest and the game shows "NO DETECTION" for the model that round
  (an automatic loss for the model on that round).
