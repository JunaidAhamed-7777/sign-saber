"""Held-out evaluation report for local upper-body research checkpoints.

Writes per-dataset, per-joint labelled-joint error and PCK for each checkpoint, the seeded untrained
head, a zero-heatmap loss reference and a mean-pose-in-ROI reference, plus a perturbed-ROI pass and
qualitative overlays. Every pass uses ground-truth (oracle) ROI crops unless marked perturbed; these
are not COCO AP, browser or live-camera results. Outputs stay in ignored local run folders.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import random
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import torch
from torch.utils.data import DataLoader, Dataset
from upper_body import CONFIG, DATA, KEYPOINTS, ROOT, PoseMetrics, UpperBodyDataset, UpperBodyNet, crop_input, decode_heatmaps, file_hash, load_records, masked_heatmap_loss, upper_body_roi
from train import load_checkpoint, write_json

ARCHITECTURE_KEYS = ["bodyKeypoints", "imageSize", "heatmapSize", "headChannels", "pretrained", "cropPadding"]
SKELETON = [(5, 6), (5, 7), (7, 9), (6, 8), (8, 10), (5, 11), (6, 12), (11, 12), (0, 1), (0, 2), (1, 3), (2, 4)]
IMAGE_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGE_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

class PerturbedRoiDataset(UpperBodyDataset):
    """Oracle ROI moved by a deterministic per-sample scale/shift; ground truth is unchanged and decoding uses the moved ROI."""
    def __init__(self, records, jitter: float):
        super().__init__(records, augment=False)
        self.jitter = jitter
    def __getitem__(self, index):
        row = self.records[index]
        original = np.asarray(row["keypoints"], dtype=np.float32)
        with Image.open((DATA / row["image"]).resolve()) as raw:
            image = raw.convert("RGB")
        left, top, side, _ = upper_body_roi(original, row["bbox"], image.width, image.height, row.get("headBox")).tolist()
        rng = random.Random(int.from_bytes(hashlib.sha256(f"perturbed-roi:{CONFIG['seed']}:{row['sampleId']}".encode()).digest()[:8], "big"))
        moved = side * (1 + rng.uniform(-self.jitter, self.jitter))
        center_x = left + side / 2 + rng.uniform(-self.jitter, self.jitter) * side
        center_y = top + side / 2 + rng.uniform(-self.jitter, self.jitter) * side
        roi = np.array([center_x - moved / 2, center_y - moved / 2, moved, moved], dtype=np.float32)
        image, points = crop_input(image, original, roi)
        pixels = np.asarray(image, dtype=np.float32) / 255
        tensor = torch.from_numpy(((pixels - IMAGE_MEAN) / IMAGE_STD).transpose(2, 0, 1).copy())
        from upper_body import make_heatmaps
        heatmap_points = points.copy()
        heatmap_points[:, :2] *= CONFIG["heatmapSize"] / CONFIG["imageSize"]
        targets, weights = make_heatmaps(heatmap_points)
        return {"image": tensor, "target": torch.from_numpy(targets), "weights": torch.from_numpy(weights), "groundTruth": torch.from_numpy(original.copy()), "roi": torch.from_numpy(roi), "sampleId": row["sampleId"], "dataset": row["dataset"]}

def mean_pose(rows):
    """Mean labelled joint position in normalized oracle-ROI coordinates over the training split."""
    sums, counts = np.zeros((len(KEYPOINTS), 2)), np.zeros(len(KEYPOINTS))
    for row in rows:
        points = np.asarray(row["keypoints"], dtype=np.float32)
        left, top, side, _ = upper_body_roi(points, row["bbox"], 0, 0, row.get("headBox")).tolist()
        labelled = points[:, 2] > 0
        sums[labelled] += (points[labelled, :2] - [left, top]) / side
        counts[labelled] += 1
    return torch.from_numpy(sums / np.maximum(counts, 1)[:, None]).to(torch.float32)

def load_model(label: str, path: Path | None):
    if path is None:
        torch.manual_seed(CONFIG["seed"])  # Same seeded head initialization as train.py's baseline.
        model = UpperBodyNet(pretrained=True)
        return model.eval(), {"label": label, "kind": "ImageNet backbone with seeded untrained head", "optimizerSteps": 0}
    checkpoint = load_checkpoint(path)
    differing = [key for key in ARCHITECTURE_KEYS if checkpoint["config"].get(key) != CONFIG.get(key)]
    if differing:
        raise ValueError(f"{label}: checkpoint architecture differs from config.json in {differing}")
    model = UpperBodyNet(pretrained=False)
    model.load_state_dict(checkpoint["model"])
    return model.eval(), {"label": label, "kind": checkpoint["kind"], "optimizerSteps": checkpoint["globalStep"], "epoch": checkpoint["epoch"], "checkpointSha256": file_hash(path), "configSha256": checkpoint["configSha256"]}

@torch.inference_mode()
def run_pass(models, dataset, loader_arguments, mean_points):
    metrics = {label: PoseMetrics() for label in models}
    zero, reference = PoseMetrics(), PoseMetrics()
    for batch in DataLoader(dataset, **loader_arguments):
        for label, model in models.items():
            heatmaps = model(batch["image"])
            predicted, _ = decode_heatmaps(heatmaps, batch["roi"])
            metrics[label].add(predicted, batch["groundTruth"], masked_heatmap_loss(heatmaps, batch["target"], batch["weights"]).item())
        zero.add(None, batch["groundTruth"], masked_heatmap_loss(torch.zeros_like(batch["target"]), batch["target"], batch["weights"]).item())
        rois = batch["roi"]
        reference.add(rois[:, None, :2] + mean_points[None] * rois[:, None, 2:3], batch["groundTruth"])
    result = {label: value.result() for label, value in metrics.items()}
    result["zero-heatmaps"] = zero.result()
    result["mean-pose-in-roi"] = reference.result()
    return result

def pooled(results):
    """Pool per-dataset per-joint sums into one combined result (heatmap loss is sample-weighted)."""
    joints, samples, loss = {}, 0, 0.0
    for result in results:
        samples += result["samples"]
        loss += (result["meanHeatmapLoss"] or 0.0) * result["samples"]
        for name, joint in result["joints"].items():
            entry = joints.setdefault(name, {"labeled": 0, "errorSum": 0.0, "hits": 0.0, "pckSamples": 0})
            entry["labeled"] += joint["labeled"]
            entry["errorSum"] += (joint["meanPixelError"] or 0.0) * joint["labeled"]
            entry["hits"] += (joint["pck"] or 0.0) * joint["pckSamples"]
            entry["pckSamples"] += joint["pckSamples"]
    has_loss = all(result["meanHeatmapLoss"] is not None for result in results)
    return {"samples": samples, "meanHeatmapLoss": loss / samples if has_loss and samples else None, "joints": {name: {"labeled": entry["labeled"], "meanPixelError": entry["errorSum"] / entry["labeled"] if entry["labeled"] else None, "pck": entry["hits"] / entry["pckSamples"] if entry["pckSamples"] else None, "pckSamples": entry["pckSamples"]} for name, entry in joints.items()}}

def overall_pck(result):
    joints = [joint for joint in result["joints"].values() if joint["pck"] is not None]
    total = sum(joint["pckSamples"] for joint in joints)
    return sum(joint["pck"] * joint["pckSamples"] for joint in joints) / total if total else None

@torch.inference_mode()
def overlays(model, rows, count, target: Path):
    picks = []
    for dataset in sorted({row["dataset"] for row in rows}):
        subset = [row for row in rows if row["dataset"] == dataset]
        picks += [subset[int(index)] for index in np.linspace(0, len(subset) - 1, count // 2 if count > 1 else 1)]
    data = UpperBodyDataset(picks)
    scale, tiles = 2, []
    for index, row in enumerate(picks):
        sample = data[index]
        heatmaps = model(sample["image"][None])
        roi = sample["roi"]
        predicted, confidence = decode_heatmaps(heatmaps, roi[None])
        to_crop = lambda xy: ((xy[0] - roi[0]) / roi[2] * CONFIG["imageSize"] * scale, (xy[1] - roi[1]) / roi[3] * CONFIG["imageSize"] * scale)
        pixels = sample["image"].numpy().transpose(1, 2, 0) * IMAGE_STD + IMAGE_MEAN
        tile = Image.fromarray((np.clip(pixels, 0, 1) * 255).astype(np.uint8)).resize((CONFIG["imageSize"] * scale,) * 2, Image.Resampling.BILINEAR)
        draw = ImageDraw.Draw(tile)
        ground = sample["groundTruth"]
        for a, b in SKELETON:
            draw.line([to_crop(predicted[0, a]), to_crop(predicted[0, b])], fill=(255, 64, 64), width=2)
        for joint in range(len(KEYPOINTS)):
            x, y = to_crop(predicted[0, joint])
            draw.line([(x - 4, y - 4), (x + 4, y + 4)], fill=(255, 64, 64), width=2)
            draw.line([(x - 4, y + 4), (x + 4, y - 4)], fill=(255, 64, 64), width=2)
            if ground[joint, 2] > 0:
                gx, gy = to_crop(ground[joint])
                draw.ellipse([gx - 4, gy - 4, gx + 4, gy + 4], outline=(64, 255, 64), width=2)
                draw.line([(gx, gy), (x, y)], fill=(255, 255, 0), width=1)
        draw.rectangle([0, 0, tile.width, 16], fill=(0, 0, 0))
        draw.text((4, 2), f"{row['sampleId']}  green=truth red=prediction", fill=(255, 255, 255))
        tiles.append(tile)
    columns = 4
    sheet = Image.new("RGB", (columns * tiles[0].width, -(-len(tiles) // columns) * tiles[0].height))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % columns) * tile.width, (index // columns) * tile.height))
    sheet.save(target)
    return [row["sampleId"] for row in picks]

def table(rows, labels):
    lines = ["| Joint | " + " | ".join(labels) + " |", "|---|" + "---|" * len(labels)]
    for name in KEYPOINTS + ["all labelled joints"]:
        cells = []
        for label in labels:
            result = rows[label]
            value = overall_pck(result) if name == "all labelled joints" else result["joints"][name]["pck"]
            cells.append("n/a" if value is None else f"{value:.3f}")
        lines.append(f"| {name} | " + " | ".join(cells) + " |")
    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", action="append", default=[], metavar="LABEL=PATH", help="Local checkpoint to evaluate; the first is used for overlays")
    parser.add_argument("--untrained", action="store_true", help="Include the seeded untrained head (train.py baseline)")
    parser.add_argument("--datasets", nargs="+", choices=["coco2017", "mpii"], default=["coco2017", "mpii"])
    parser.add_argument("--roi-jitter", type=float, default=0.15, help="Deterministic perturbed-ROI scale/shift fraction; 0 disables the pass")
    parser.add_argument("--overlays", type=int, default=16)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(CONFIG["cpuThreads"])
    output = args.output if args.output.is_absolute() else Path.cwd() / args.output
    if not output.resolve().is_relative_to((ROOT / "runs").resolve()):
        parser.error("Reports stay inside the ignored training/runs folder")
    output.mkdir(parents=True, exist_ok=True)
    specs = [(item.split("=", 1)[0], Path(item.split("=", 1)[1])) for item in args.checkpoint]
    if args.untrained:
        specs.append(("untrained", None))
    if not specs:
        parser.error("Provide at least one --checkpoint or --untrained")
    models, descriptions = {}, []
    for label, path in specs:
        models[label], description = load_model(label, path)
        descriptions.append(description)
    train_rows, _ = load_records(args.datasets, "train")
    validation_rows, validation_info = load_records(args.datasets, "val")
    mean_points = mean_pose(train_rows)
    loader_arguments = {"batch_size": CONFIG["batchSize"], "shuffle": False, "num_workers": CONFIG["dataLoaderWorkers"]}
    passes = {"oracleRoi": {}, "perturbedRoi": {}}
    for dataset in args.datasets:
        subset = [row for row in validation_rows if row["dataset"] == dataset]
        print(f"Evaluating {dataset}: {len(subset)} held-out people", flush=True)
        passes["oracleRoi"][dataset] = run_pass(models, UpperBodyDataset(subset), loader_arguments, mean_points)
        if args.roi_jitter > 0:
            passes["perturbedRoi"][dataset] = run_pass(models, PerturbedRoiDataset(subset, args.roi_jitter), loader_arguments, mean_points)
    labels = list(models) + ["zero-heatmaps", "mean-pose-in-roi"]
    for name, results in passes.items():
        if results:
            results["combined"] = {label: pooled([results[dataset][label] for dataset in args.datasets]) for label in labels}
    report = {"version": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "models": descriptions, "validationData": validation_info, "roiJitter": args.roi_jitter, "metricDefinition": f"Labelled-joint Euclidean error in source pixels and PCK@{CONFIG['pckShoulderFraction']} of shoulder span (samples with both shoulders labelled), not COCO AP. Oracle ROI = crop derived from ground-truth joints.", "references": {"zero-heatmaps": "Loss of an all-zero heatmap prediction; its coordinates are meaningless and only the loss is a reference.", "mean-pose-in-roi": "Predicts each joint at its mean normalized position inside the oracle training ROI; measures how much the oracle crop alone gives away."}, "passes": passes}
    if args.overlays > 0:
        first = next(iter(models))
        report["overlays"] = {"model": first, "file": f"overlays-{first}.png", "sampleIds": overlays(models[first], validation_rows, args.overlays, output / f"overlays-{first}.png")}
    write_json(output / "report.json", report)
    sections = [f"# Upper-body held-out report\n\nCreated {report['createdAt']}. {report['metricDefinition']}\n"]
    for name, results in passes.items():
        for split, rows in results.items():
            losses = ", ".join(f"{label} {rows[label]['meanHeatmapLoss']:.6f}" for label in labels if rows[label]["meanHeatmapLoss"] is not None)
            sections.append(f"## {name} — {split}\n\nMean heatmap loss: {losses}\n\nPCK@{CONFIG['pckShoulderFraction']} shoulder span:\n\n{table(rows, labels)}\n")
    (output / "report.md").write_text("\n".join(sections), encoding="utf-8")
    print("\n".join(sections), flush=True)

if __name__ == "__main__":
    main()
