# Upper-body image-model research

This is a separate local, noncommercial research pipeline. The game continues to use its documented tracker; this directory does not install a trained model into the browser. The dataset trial in [the fixture registry](../app/public/assets/fixtures/coco-upper-body-trial.json) renders **independent static ground-truth annotations**, not predictions from this network or a temporal recording.

[DATASETS.json](DATASETS.json) records publisher sources, annotation topology, image rights, access checks and acquisition state. [STATUS.json](STATUS.json) records actual optimizer steps and evaluation. Data, images, environments, run traces, checkpoints and exports stay ignored by Git. Do not redistribute research-only images or checkpoints.

[PREFLIGHT_EVIDENCE.json](PREFLIGHT_EVIDENCE.json) records the completed **three-step** CPU preflight over 24 real COCO photo crops, with all 20,121 eligible training records available and evaluation on 919 validation people. Training batch loss fell, while held-out mean heatmap loss worsened from 0.0174751 to 0.0202273; this establishes pipeline execution and does not establish useful pose accuracy. Export parity on eight real held-out crops passed with maximum heatmap difference 0.000001185 and zero decoded coordinate difference. The receipt audit found zero identical acquired-image hashes across the COCO train/validation partitions. Full multi-dataset training and deployment remain pending.

## What is trainable

[upper_body.py](upper_body.py) trains a real RGB network: an official torchvision MobileNetV3-Small ImageNet backbone and a new 13-channel heatmap head. The canonical points are nose, eyes, ears, shoulders, elbows, wrists and hips. No knee/ankle supervision is used. Missing labels receive zero loss; labelled occluded joints receive the configured lower weight. MPII's neck and head-top are **not** relabelled as nose. Finger joints need separate hand annotations and a separate hand localization model.

The training/evaluation crop comes from the **ground-truth head/arms/hips ROI**. This is an explicit oracle crop; a production system still needs person localization, ROI recovery, temporal association, confidence calibration and browser inference checks. Export parity establishes numerical equivalence, not pose quality. MediaPipe Gesture Recognizer customization is a category classifier over detected landmarks; it does not fine-tune arm landmark localization.

## Sources and rights

- COCO2017 base person keypoints: annotations are CC-BY-4.0; images retain their individual Flickr licenses. Preparation selects only the attribution-only image license URL and at least four labelled arm/hip joints. The acquired subset has **8,503 images**, with **20,121 train people / 8,131 images** and **919 validation people / 372 images**. This is a documented eligible subset, not all COCO2017 or the official full COCO benchmark. Each local image receipt records the downloaded bytes' SHA; the index retains its COCO image ID, Flickr source and license.
- MPII: official research/noncommercial terms; underlying image copyrights remain separate. Prepared annotations contain **26,016 training people / 15,727 images** and **2,857 development-validation people / 1,677 images**. The validation partition is a deterministic video-group holdout inside the official training partition; the hidden test partition is excluded. The full official image archive has completed download and streaming CRC/path/coverage verification; extraction and individual JPEG decode remain pending before a combined run. See [acquisition status](STATUS.md).
- COCO-WholeBody, Halpe, CrowdPose, AIC and MPI-INF-3DHP are researched candidates with explicit pending restrictions in the manifest. They are not represented as acquired or trained. A code license is not an image-data grant.

The primary publisher/license links and exact annotation hashes are in the manifest. Acquisition uses the official public HTTP COCO endpoint because HTTPS failed in this environment; there is no publisher-provided file checksum in the inspected metadata. Receipts hash actual acquired bytes and do not imply a publisher signature.

## Reproduce locally

The inspected Windows host has Python 3.12.14 in an isolated environment, PyTorch 2.9.1+cpu, 16 GB RAM and an AMD RX6600M. No supported GPU training stack was verified. The commands below use a bounded two-thread CPU run from [config.json](config.json).

```powershell
uv venv --python 3.12 training/.venv
uv pip install --python training/.venv/Scripts/python.exe --index-url https://download.pytorch.org/whl/cpu torch==2.9.1 torchvision==0.24.1
uv pip install --python training/.venv/Scripts/python.exe -r training/requirements-cpu.txt
node training/acquire.mjs annotations
training/.venv/Scripts/python.exe training/prepare.py
node training/acquire.mjs coco-images
node training/acquire.mjs mpii-images
training/.venv/Scripts/python.exe training/prepare.py --dataset mpii --extract-mpii-images
training/.venv/Scripts/python.exe training/prepare.py --verify-mpii-images
training/.venv/Scripts/python.exe -m unittest discover -s training -p test_training.py -v
```

The environment [lock](requirements-lock.txt) records installed versions. Acquisition is resumable, bounded by a free-disk reserve and per-file size limits, and verifies existing receipts before reuse. `--limit=N` on `coco-images` explicitly creates a partial acquisition. The downloader serializes independent dataset manifest updates. A stale `.acquisition-manifest.lock` after a process crash must be inspected before removing it.

A bounded real-image pipeline check:

```powershell
training/.venv/Scripts/python.exe training/train.py --datasets coco2017 --preflight-steps 3 --run-name my-coco-preflight
training/.venv/Scripts/python.exe training/export.py training/runs/my-coco-preflight/latest.pt --datasets coco2017 --samples 8
```

Every run saves real input hashes, an exact sample-ID selection, per-batch IDs/losses, source split hashes, baseline and final validation, and hash-checked optimizer checkpoints. `--selection training/runs/NAME/selection.json` reuses an exact selection. `--resume training/runs/NAME/latest.pt` requires identical inputs, configuration and run kind, and preserves the next batch. Increasing a preflight limit only continues a preflight; it never becomes a completed large-dataset run.

After all selected images are acquired, a full run uses:

```powershell
training/.venv/Scripts/python.exe training/train.py --datasets coco2017 mpii --epochs 20 --run-name upper-body-research
```

This full two-dataset run has **not completed**. It refuses missing indexed images. Loss and PCK are reported on every labelled joint, including occlusion; PCK uses the declared shoulder-span fraction and is **not COCO AP**. Actual first-epoch CPU step times are narrow pipeline observations, not a browser/frame-rate benchmark or an estimate of full convergence. The current preflight head is not suitable for gameplay.

ONNX exports stay under `training/exports/`. Export uses the supported legacy TorchScript exporter at opset 17 (PyTorch currently emits a deprecation notice), checks the model and compares real held-out RGB crops in ONNX Runtime CPU. Before production use, a fully trained candidate still needs held-out accuracy/occlusion comparisons, detector/ROI recovery, browser WASM/WebGPU capability and latency checks, and consented physical-motion evaluation.
