"""Export a verified local research checkpoint and compare actual RGB crops in ONNX Runtime.

Exports remain local, including models trained on MPII research-only images. This does
not install a model in the game or establish browser/live-camera pose quality.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort
import torch
from upper_body import CONFIG, KEYPOINTS, ROOT, UpperBodyDataset, UpperBodyNet, decode_heatmaps, file_hash, load_records
from train import load_checkpoint, write_json

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--datasets", nargs="+", choices=["coco2017", "mpii"], default=["coco2017", "mpii"])
    parser.add_argument("--samples", type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.samples <= 64:
        parser.error("Export parity uses between one and 64 real held-out crops")
    torch.set_num_threads(CONFIG["cpuThreads"])
    checkpoint = load_checkpoint(args.checkpoint)
    if checkpoint["configSha256"] != file_hash(ROOT / "config.json"):
        raise ValueError("Export configuration differs from checkpoint")
    rows, info = load_records(args.datasets, "val", allow_partial=True)
    # Evenly spaced held-out crops so every requested dataset is represented in the parity check.
    rows = [rows[int(index)] for index in np.linspace(0, len(rows) - 1, min(args.samples, len(rows)))]
    crops = UpperBodyDataset(rows)
    images = torch.stack([crops[index]["image"] for index in range(len(crops))])
    rois = torch.stack([crops[index]["roi"] for index in range(len(crops))])
    model = UpperBodyNet(pretrained=False)
    model.load_state_dict(checkpoint["model"])
    model.eval()
    output_dir = ROOT / "exports" / args.checkpoint.resolve().parent.name
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / "upper-body.onnx"
    with torch.inference_mode():
        reference = model(images)
        torch.onnx.export(model, images[:1], target, input_names=["image"], output_names=["heatmaps"], dynamic_axes={"image": {0: "batch"}, "heatmaps": {0: "batch"}}, opset_version=17, dynamo=False)
    onnx.checker.check_model(str(target))
    options = ort.SessionOptions()
    options.intra_op_num_threads = CONFIG["cpuThreads"]
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(target), sess_options=options, providers=["CPUExecutionProvider"])
    actual = session.run(["heatmaps"], {"image": images.numpy()})[0]
    error = float(np.max(np.abs(actual - reference.numpy())))
    tolerance = CONFIG["exportAbsoluteTolerance"]
    reference_points, _ = decode_heatmaps(reference, rois)
    actual_points, _ = decode_heatmaps(torch.from_numpy(actual), rois)
    pixel_error = float((reference_points - actual_points).abs().max())
    report = {"version": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "checkpointSha256": file_hash(args.checkpoint), "onnxSha256": file_hash(target), "onnxBytes": target.stat().st_size, "opset": 17, "kind": checkpoint["kind"], "optimizerSteps": checkpoint["globalStep"], "keypoints": KEYPOINTS, "input": {"name": "image", "dtype": "float32", "shape": ["batch", 3, CONFIG["imageSize"], CONFIG["imageSize"]], "normalization": "RGB / 255, ImageNet mean/std; upper-body square ROI"}, "output": {"name": "heatmaps", "shape": ["batch", len(KEYPOINTS), CONFIG["heatmapSize"], CONFIG["heatmapSize"]]}, "parity": {"provider": "CPUExecutionProvider", "samples": len(crops), "sampleIds": [row["sampleId"] for row in rows], "validationData": info, "maxAbsoluteHeatmapError": error, "allowedAbsoluteHeatmapError": tolerance, "maxAbsoluteDecodedSourcePixelDifference": pixel_error, "passed": bool(np.isfinite(actual).all() and error <= tolerance and pixel_error == 0)}, "publication": "local-noncommercial-research-only", "promotedToGame": False, "limitations": ["Numerical parity is not pose accuracy", "No browser inference or live-camera evidence", "Preflight checkpoint is not a production pose model" if checkpoint["kind"] == "real-data-preflight" else "Research checkpoint; held-out accuracy is reported separately and it is not promoted to the game", "ROI supplied from ground-truth annotations during this parity check; production person localization remains a separate requirement"]}
    write_json(output_dir / "export.json", report)
    print(json.dumps(report, indent=2, allow_nan=False))
    if not report["parity"]["passed"]:
        raise ValueError("ONNX numerical parity failed; model is not promoted")

if __name__ == "__main__":
    main()
