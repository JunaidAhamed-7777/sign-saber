"""Real RGB upper-body pose network and dataset adapter. Lower-body/finger labels are not fabricated."""
from __future__ import annotations
import hashlib
import json
import math
import random
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image, ImageEnhance
import torch
from torch import nn
from torch.utils.data import Dataset
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
KEYPOINTS = CONFIG["bodyKeypoints"]
FLIP_PAIRS = [(1, 2), (3, 4), (5, 6), (7, 8), (9, 10), (11, 12)]
IMAGE_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGE_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def load_records(datasets: list[str], split: str, allow_partial: bool = False):
    records, missing, sources = [], Counter(), []
    for dataset in datasets:
        index = DATA / dataset / f"{split}.jsonl"
        if not index.is_file():
            raise ValueError(f"Missing prepared index: {index}. Run training/prepare.py first.")
        sources.append({"dataset": dataset, "split": split, "indexSha256": file_hash(index)})
        with index.open(encoding="utf-8") as source:
            for line in source:
                row = json.loads(line)
                if row.get("schema") != 1 or row.get("dataset") != dataset or row.get("split") != split:
                    raise ValueError("Unexpected index schema/source/split")
                image = (DATA / row["image"]).resolve()
                if not image.is_relative_to(DATA.resolve()):
                    raise ValueError("Image path escapes local research data")
                points = np.asarray(row["keypoints"], dtype=np.float32)
                if points.shape != (len(KEYPOINTS), 3) or not np.isfinite(points).all() or not np.isin(points[:, 2], [0, 1, 2]).all():
                    raise ValueError("Invalid indexed ground truth")
                if not image.is_file():
                    missing[dataset] += 1
                    continue
                records.append(row)
    if missing and not allow_partial:
        raise ValueError(f"Full training requires all indexed images; missing records {dict(missing)}. Partial images are allowed only in an explicitly labelled preflight.")
    if not records:
        raise ValueError("No real indexed image/annotation pairs are available")
    return records, {"sources": sources, "availableRecords": len(records), "missingRecords": dict(missing), "partialData": bool(missing), "recordsByDataset": dict(Counter(row["dataset"] for row in records))}

def upper_body_roi(points: np.ndarray, bbox, width: int, height: int, head_box=None):
    visible = points[:, 2] > 0
    if not visible.any():
        raise ValueError("No upper-body annotation for crop")
    selected = points[visible, :2]
    left, top = selected.min(axis=0).astype(float)
    right, bottom = selected.max(axis=0).astype(float)
    if head_box is not None:
        left, top = min(left, head_box[0]), min(top, head_box[1])
        right = max(right, head_box[2])
    elif not (points[:5, 2] > 0).any():
        top = min(top, float(bbox[1]))
    span = max(right - left, bottom - top, 1)
    padding = CONFIG["cropPadding"] * span
    center_x, center_y = (left + right) / 2, (top + bottom) / 2
    side = span + 2 * padding
    # The crop is the union of head, arms and hips, including extended hands; knees/ankles never define it.
    return np.array([center_x - side / 2, center_y - side / 2, side, side], dtype=np.float32)

def make_heatmaps(points: np.ndarray):
    size, sigma = CONFIG["heatmapSize"], CONFIG["heatmapSigma"]
    axis = np.arange(size, dtype=np.float32)
    xx, yy = np.meshgrid(axis, axis)
    targets = np.zeros((len(KEYPOINTS), size, size), dtype=np.float32)
    weights = np.zeros(len(KEYPOINTS), dtype=np.float32)
    for joint, (x, y, visibility) in enumerate(points):
        if visibility <= 0 or not (0 <= x < size and 0 <= y < size):
            continue
        targets[joint] = np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma ** 2))
        weights[joint] = 1.0 if visibility == 2 else CONFIG["occludedJointWeight"]
    return targets, weights

def crop_input(image: Image.Image, original: np.ndarray, roi: np.ndarray, rng: random.Random | None = None):
    """Crop a square ROI to the network input and map labels with the same continuous-coordinate transform.

    Without an rng this is the exact oracle ROI crop used for evaluation and export parity. With an rng it applies
    the training augmentation: flip, scale/rotation/translation jitter and brightness/contrast jitter.
    """
    left, top, width, height = roi.tolist()
    size = CONFIG["imageSize"]
    points = original.copy()
    if rng is None:
        image = image.transform((size, size), Image.Transform.EXTENT, (left, top, left + width, top + height), resample=Image.Resampling.BILINEAR)
        points[:, 0] = (points[:, 0] - left) / width * size
        points[:, 1] = (points[:, 1] - top) / height * size
        return image, points
    flip = rng.random() < CONFIG["flipProbability"]
    # Geometric jitter makes the head robust to imperfect (non-oracle) ROIs; joints pushed outside the crop get zero weight.
    scale = 1 + rng.uniform(-CONFIG["scaleJitter"], CONFIG["scaleJitter"])
    angle = math.radians(rng.uniform(-CONFIG["rotationDegrees"], CONFIG["rotationDegrees"])) if rng.random() < CONFIG["rotationProbability"] else 0.0
    center_x = left + width / 2 + rng.uniform(-CONFIG["translationJitter"], CONFIG["translationJitter"]) * width
    center_y = top + height / 2 + rng.uniform(-CONFIG["translationJitter"], CONFIG["translationJitter"]) * height
    source_per_output = width * scale / size
    cosine, sine, half = math.cos(angle), math.sin(angle), size / 2
    # PIL AFFINE maps each continuous output coordinate to its continuous source coordinate (the inverse of the label mapping below).
    inverse = (source_per_output * cosine, source_per_output * sine, center_x - source_per_output * (cosine + sine) * half, -source_per_output * sine, source_per_output * cosine, center_y - source_per_output * (cosine - sine) * half)
    image = image.transform((size, size), Image.Transform.AFFINE, inverse, resample=Image.Resampling.BILINEAR)
    dx, dy = points[:, 0] - center_x, points[:, 1] - center_y
    points[:, 0] = half + (cosine * dx - sine * dy) / source_per_output
    points[:, 1] = half + (sine * dx + cosine * dy) / source_per_output
    if flip:
        image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        # Pixel i becomes size - 1 - i, so continuous coordinates mirror to size - x (the earlier size - 1 - x was off by one pixel).
        points[:, 0] = size - points[:, 0]
        for a, b in FLIP_PAIRS:
            points[[a, b]] = points[[b, a]]
    image = ImageEnhance.Brightness(image).enhance(1 + rng.uniform(-CONFIG["brightnessJitter"], CONFIG["brightnessJitter"]))
    image = ImageEnhance.Contrast(image).enhance(1 + rng.uniform(-CONFIG["contrastJitter"], CONFIG["contrastJitter"]))
    return image, points

class UpperBodyDataset(Dataset):
    def __init__(self, records, augment: bool = False):
        self.records, self.augment, self.epoch = records, augment, 0
    def __len__(self):
        return len(self.records)
    def __getitem__(self, index):
        row = self.records[index]
        path = (DATA / row["image"]).resolve()
        original = np.asarray(row["keypoints"], dtype=np.float32)
        with Image.open(path) as raw:
            image = raw.convert("RGB")
        roi = upper_body_roi(original, row["bbox"], image.width, image.height, row.get("headBox"))
        rng = None
        if self.augment:
            rng = random.Random(int.from_bytes(hashlib.sha256(f"{CONFIG['seed']}:{self.epoch}:{row['sampleId']}".encode()).digest()[:8], "big"))
        image, points = crop_input(image, original, roi, rng)
        size = CONFIG["imageSize"]
        heatmap_points = points.copy()
        heatmap_points[:, :2] *= CONFIG["heatmapSize"] / size
        targets, weights = make_heatmaps(heatmap_points)
        pixels = np.asarray(image, dtype=np.float32) / 255
        tensor = torch.from_numpy(((pixels - IMAGE_MEAN) / IMAGE_STD).transpose(2, 0, 1).copy())
        return {"image": tensor, "target": torch.from_numpy(targets), "weights": torch.from_numpy(weights), "groundTruth": torch.from_numpy(original.copy()), "roi": torch.from_numpy(roi), "sampleId": row["sampleId"], "dataset": row["dataset"]}

class UpperBodyNet(nn.Module):
    def __init__(self, pretrained: bool = True):
        super().__init__()
        torch.hub.set_dir(str(DATA / "torch-cache"))
        weights = MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
        self.backbone = mobilenet_v3_small(weights=weights, progress=False).features
        modules = []
        channels = 576  # Official MobileNetV3-Small final feature width.
        for out_channels in CONFIG["headChannels"]:
            modules.extend([nn.ConvTranspose2d(channels, out_channels, kernel_size=4, stride=2, padding=1, bias=False), nn.BatchNorm2d(out_channels), nn.ReLU(inplace=True)])
            channels = out_channels
        modules.append(nn.Conv2d(channels, len(KEYPOINTS), kernel_size=1))
        self.head = nn.Sequential(*modules)
        self.backbone_trainable = True
    def set_backbone_trainable(self, value: bool):
        self.backbone_trainable = value
        self.backbone.requires_grad_(value)
        if not value:
            self.backbone.eval()
    def train(self, mode: bool = True):
        super().train(mode)
        if not self.backbone_trainable:
            self.backbone.eval()
        return self
    def forward(self, images):
        return self.head(self.backbone(images))

def masked_heatmap_loss(prediction, target, weights):
    if prediction.shape != target.shape or prediction.shape[:2] != weights.shape:
        raise ValueError("Heatmap/weight dimensions disagree")
    per_joint = (prediction - target).square().mean(dim=(-1, -2))
    denominator = weights.sum()
    if denominator <= 0:
        raise ValueError("Batch has no supervised upper-body joints")
    return (per_joint * weights).sum() / denominator

def decode_heatmaps(heatmaps, rois):
    if heatmaps.ndim != 4 or heatmaps.shape[1] != len(KEYPOINTS):
        raise ValueError("Unexpected upper-body heatmap topology")
    batch, joints, height, width = heatmaps.shape
    values, indices = heatmaps.reshape(batch, joints, -1).max(dim=-1)
    column, row = indices % width, indices // width
    # Standard quarter-cell refinement toward the larger neighbour reduces argmax quantization.
    flat = heatmaps.reshape(batch, joints, -1)
    def neighbour_delta(offset_index, valid):
        safe = torch.where(valid, offset_index, indices)
        return flat.gather(-1, safe.unsqueeze(-1)).squeeze(-1)
    inner_x = (column > 0) & (column < width - 1)
    inner_y = (row > 0) & (row < height - 1)
    shift_x = torch.sign(neighbour_delta(indices + 1, inner_x) - neighbour_delta(indices - 1, inner_x)) * inner_x
    shift_y = torch.sign(neighbour_delta(indices + width, inner_y) - neighbour_delta(indices - width, inner_y)) * inner_y
    x = (column.to(torch.float32) + 0.25 * shift_x) / width * rois[:, None, 2] + rois[:, None, 0]
    y = (row.to(torch.float32) + 0.25 * shift_y) / height * rois[:, None, 3] + rois[:, None, 1]
    return torch.stack([x, y], dim=-1), values

class PoseMetrics:
    """Accumulates labelled-joint error/PCK (and optionally heatmap loss) with one shared definition."""
    def __init__(self):
        self.counts = np.zeros(len(KEYPOINTS), dtype=np.int64)
        self.errors = np.zeros(len(KEYPOINTS), dtype=np.float64)
        self.pck_hits = np.zeros(len(KEYPOINTS), dtype=np.int64)
        self.pck_counts = np.zeros(len(KEYPOINTS), dtype=np.int64)
        self.visible = Counter()
        self.loss_sum, self.loss_batches, self.batches, self.samples = 0.0, 0, 0, 0
    def add(self, predicted, ground, loss: float | None = None):
        self.batches += 1
        if loss is not None:
            self.loss_sum += loss
            self.loss_batches += 1
        if predicted is None:
            self.samples += len(ground)
            return
        distance = (predicted - ground[:, :, :2]).square().sum(dim=-1).sqrt().numpy()
        present = ground[:, :, 2].numpy() > 0
        self.counts += present.sum(axis=0)
        self.errors += (distance * present).sum(axis=0)
        for sample in range(len(ground)):
            self.samples += 1
            labels = ground[sample, :, 2].numpy()
            self.visible["visibleJoints"] += int((labels == 2).sum())
            self.visible["occludedLabeledJoints"] += int((labels == 1).sum())
            if ground[sample, 5, 2] > 0 and ground[sample, 6, 2] > 0:
                shoulder = float((ground[sample, 5, :2] - ground[sample, 6, :2]).square().sum().sqrt())
                if shoulder > np.finfo(np.float32).eps:
                    self.pck_counts += present[sample]
                    self.pck_hits += (distance[sample] <= shoulder * CONFIG["pckShoulderFraction"]) & present[sample]
            else:
                self.visible["samplesWithoutShoulderNormalization"] += 1
    def result(self):
        return {"samples": self.samples, "batches": self.batches, "meanHeatmapLoss": self.loss_sum / self.loss_batches if self.loss_batches else None, "metricDefinition": f"Unfiltered labelled-joint Euclidean error in source pixels and PCK@{CONFIG['pckShoulderFraction']} shoulder span, not COCO AP.", "joints": {name: {"labeled": int(self.counts[j]), "meanPixelError": float(self.errors[j] / self.counts[j]) if self.counts[j] else None, "pck": float(self.pck_hits[j] / self.pck_counts[j]) if self.pck_counts[j] else None, "pckSamples": int(self.pck_counts[j])} for j, name in enumerate(KEYPOINTS)}, "annotationBreakdown": dict(self.visible)}

@torch.inference_mode()
def evaluate(model, loader):
    model.eval()
    metrics = PoseMetrics()
    for batch in loader:
        heatmaps = model(batch["image"])
        predicted, _ = decode_heatmaps(heatmaps, batch["roi"])
        metrics.add(predicted, batch["groundTruth"], masked_heatmap_loss(heatmaps, batch["target"], batch["weights"]).item())
    return metrics.result()
