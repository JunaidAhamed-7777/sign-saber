# Dataset acquisition status

Reconciled **2026-10-25 02:13:22 +05:30** (2026-10-24 20:43:22 UTC). Sources, terms and exact acquisition receipts are in [DATASETS.json](DATASETS.json). Large data, image pixels and models remain local ignored artifacts.

COCO's selected **8,503 CC-BY photo files and 8,503 corresponding receipt paths** match the prepared image index, with zero missing or extra photo paths in this inventory check. The eligible subset contains 20,121 training people in 8,131 images and 919 validation people in 372 images. This is not all COCO2017. This reconciliation checked filenames; the earlier actual-byte fingerprints and receipt audit are retained in [PREFLIGHT_EVIDENCE.json](PREFLIGHT_EVIDENCE.json).

MPII image acquisition finished. The official compressed archive is **12,088,943,206 bytes**, with independently recomputed SHA-256:

```text
6d26fbf89f49a7aeff4aa5f98123763f334693806b98eb15630f57a0b50998ce
```

The recomputed hash matches the acquisition receipt. No publisher checksum was available; this establishes consistency with the acquired bytes, not a publisher signature. A full streaming tar/gzip check passed through end of file, including gzip CRC/size checks and every tar member's header/path/type checks. The archive contains **24,984 unique JPEG members**, one directory, zero duplicate filenames and **12,140,043,353 bytes** of JPEG content. It covers every prepared MPII training image (15,727 unique images / 26,016 people) and development-validation image (1,677 unique images / 2,857 people), with zero missing indexed images.

The MPII archive is **unextracted**. JPEG pixels were not individually decoded, and no MPII optimizer steps were run. `downloaded: false` for MPII in the manifest refers to readiness as individual indexed image files; `archiveDownloaded: true` records the completed archive. The hidden test partition was not used for training. MPII's research/noncommercial restrictions and separate underlying image copyrights still apply.

The only model-training evidence remains bounded COCO CPU pipeline checks: two independent three-step preflights. The latest checkpoint has **three optimizer steps**, zero completed epochs and no production promotion. Its held-out heatmap loss worsened; successful ONNX numerical parity establishes export correctness, not pose quality. Full multi-dataset training, person localization outside annotation-supplied crops, browser model inference and physical-motion evaluation remain pending. No additional training was started during this acquisition reconciliation.
