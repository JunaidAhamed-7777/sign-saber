# Training status

Updated **2026-10-25 04:55 +05:30**. Exact numbers are in [STATUS.json](STATUS.json); data, checkpoints, reports and ONNX files stay local and ignored. Dataset acquisition and rights are in [DATASETS.json](DATASETS.json).

## Data

COCO2017 eligible CC-BY subset (20,121 train / 919 validation people) and MPII (26,016 train / 2,857 video-group validation people). MPII was extracted and verified: 24,984 files and 12,140,043,353 bytes match the archive audit, and all 17,404 indexed images decode.

## Run: partial, stopped at step 1,800 of 7,210

- MobileNetV3-Small (ImageNet) + 13-joint heatmap head, CPU, batch 32, 6 threads. Epoch 0 trained the head with a frozen backbone (1,442 steps, 1,300 s); steps 1,443–1,800 fine-tuned the whole network.
- Stopped on request with the machine memory-thrashing (unfrozen steps 1.2–4.5 s instead of about 0.85 s). That is **1 of 5 planned epochs plus 358 batches (25% of steps)**; the cosine schedule never annealed. Epoch 0 used a 9-epoch learning-rate horizon and was resumed with a 5-epoch horizon (scale 0.980 → 0.935).

## Held-out results (oracle ground-truth crops, 3,776 people)

| Model | Heatmap loss | Pooled PCK@0.2 shoulder | COCO | MPII |
|---|---|---|---|---|
| Untrained head | 0.01808 | 0.016 | 0.017 | 0.016 |
| Earlier 3-step preflight | 0.02128 | 0.014 | 0.018 | 0.012 |
| Mean pose inside the oracle crop | n/a | 0.093 | 0.142 | 0.074 |
| All-zero heatmaps | 0.00545 | n/a | n/a | n/a |
| **Step 1,800 (this run)** | **0.00416** | **0.334** | **0.393** | **0.310** |

Per joint (step 1,800): face 0.44–0.61, shoulders 0.46–0.48, elbows 0.28–0.30, wrists 0.22–0.23, hips 0.25–0.26. ONNX export (opset 17) passed parity on 16 held-out crops (max heatmap difference 1.8e-6, zero decoded difference). That is numerical equivalence, not accuracy.

## Verdict

The model learned, but it is **not good enough to matter for the game**. Wrists and elbows, the joints the game needs most, are right only 22–30% of the time, even with ground-truth crops. There is also no person detector, ROI tracking, browser runtime or live-camera test. The game keeps MediaPipe. To continue, resume from `runs/upper-body-coco-mpii-5ep/step-1800.pt` with `--epochs 5` on an idle machine (about 1.3 h uncontended).
