"""Convert real licensed dataset annotations into one explicit upper-body image schema."""
from __future__ import annotations
import argparse
import gc
import hashlib
import json
import math
import re
import tarfile
import zipfile
from collections import Counter
from pathlib import Path
import numpy as np
from scipy.io import loadmat

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
KEYPOINTS = CONFIG["bodyKeypoints"]
# MPII head-top/neck are deliberately not assigned to the COCO nose/face semantics.
MPII_TO_UPPER = {12: 6, 11: 8, 10: 10, 13: 5, 14: 7, 15: 9, 3: 11, 2: 12}

def sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()

def write_lines(path: Path, rows) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    count = 0
    with path.open("wb") as target:
        for row in rows:
            encoded = (json.dumps(row, separators=(",", ":"), allow_nan=False) + "\n").encode()
            target.write(encoded)
            digest.update(encoded)
            count += 1
    return {"path": path.relative_to(DATA).as_posix(), "records": count, "sha256": digest.hexdigest()}

def valid_point(x, y) -> bool:
    return isinstance(x, (float, int, np.number)) and isinstance(y, (float, int, np.number)) and math.isfinite(float(x)) and math.isfinite(float(y))

def prepare_coco() -> dict:
    folder = DATA / "coco2017"
    archive = folder / "annotations_trainval2017.zip"
    summaries = {}
    image_plan = {}
    for split in ["train", "val"]:
        with zipfile.ZipFile(archive) as zipped:
            with zipped.open(f"annotations/person_keypoints_{split}2017.json") as entry:
                source = json.load(entry)
        licenses = {item["id"]: item for item in source["licenses"]}
        allowed = {key for key, value in licenses.items() if re.fullmatch(r"https?://creativecommons.org/licenses/by/(?:1\.0|2\.0|2\.5|3\.0|4\.0)/?", value["url"])}
        if not allowed:
            raise ValueError("No explicit attribution-only image license found; refusing an unlicensed training index")
        images = {item["id"]: item for item in source["images"] if item["license"] in allowed}
        counts = Counter()
        rows = []
        for annotation in source["annotations"]:
            image = images.get(annotation["image_id"])
            if not image or annotation.get("iscrowd"):
                continue
            raw = annotation.get("keypoints", [])
            if len(raw) != 17 * 3:
                raise ValueError("Unexpected COCO keypoint topology")
            points = [list(map(float, raw[index * 3:index * 3 + 3])) for index in range(len(KEYPOINTS))]
            if any(not valid_point(point[0], point[1]) or point[2] not in [0, 1, 2] for point in points):
                raise ValueError("Invalid COCO upper-body annotation")
            if sum(point[2] > 0 for point in points[5:]) < CONFIG["minLabeledUpperJoints"]:
                continue
            bbox = list(map(float, annotation["bbox"]))
            if len(bbox) != 4 or not all(math.isfinite(v) for v in bbox) or bbox[2] <= 0 or bbox[3] <= 0:
                continue
            local_path = f"images/{split}2017/{image['file_name']}"
            license_info = licenses[image["license"]]
            rows.append({"schema": 1, "dataset": "coco2017", "split": split, "sampleId": f"coco-{annotation['id']}", "imageId": image["id"], "image": f"coco2017/{local_path}", "width": image["width"], "height": image["height"], "bbox": bbox, "keypoints": points, "source": {"url": image["coco_url"], "flickrUrl": image.get("flickr_url"), "license": license_info["url"]}})
            image_plan[image["id"]] = {"imageId": image["id"], "path": local_path, "url": image["coco_url"], "license": license_info["url"]}
            counts["visibleJoints"] += sum(point[2] == 2 for point in points)
            counts["occludedLabeledJoints"] += sum(point[2] == 1 for point in points)
        summaries[split] = {**write_lines(folder / f"{split}.jsonl", rows), "images": len({row["imageId"] for row in rows}), "annotationCounts": dict(counts), "licenseAllowlist": sorted(allowed), "fullSourceImagesInSplit": len(source["images"]), "scope": "Only explicit attribution-only licensed images with sufficient upper-body annotations; not the entire COCO benchmark."}
        del source, images, rows
        gc.collect()
    plan = sorted(image_plan.values(), key=lambda image: ("/val2017/" not in image["url"], image["imageId"]))
    # Validation images first make the independent image path verifiable before a long acquisition.
    summaries["imagePlan"] = write_lines(folder / "images-to-acquire.jsonl", plan)
    return summaries

def as_items(value):
    if isinstance(value, dict):
        return [value]
    if isinstance(value, np.ndarray):
        return list(value.flat)
    if isinstance(value, (list, tuple)):
        return list(value)
    return []

def scalar(value, default=None):
    if value is None:
        return default
    array = np.asarray(value)
    if array.size != 1:
        return default
    item = array.item()
    return item

def prepare_mpii() -> dict:
    folder = DATA / "mpii"
    with zipfile.ZipFile(folder / "mpii_human_pose_v1_u12_2.zip") as zipped:
        names = [name for name in zipped.namelist() if name.endswith(".mat")]
        if len(names) != 1:
            raise ValueError("Expected one MPII annotation MAT")
        raw = loadmat(zipped.open(names[0]), simplify_cells=True)["RELEASE"]
    train_flags = np.asarray(raw["img_train"]).reshape(-1)
    rows = {"train": [], "val": []}
    missing = Counter()
    for image_index, image_annotation in enumerate(as_items(raw["annolist"])):
        if not bool(train_flags[image_index]) or not isinstance(image_annotation, dict):
            continue  # Official hidden test annotations are never used for training.
        name = str(image_annotation["image"]["name"])
        video = scalar(image_annotation.get("vidx"))
        group = f"video-{int(video)}" if isinstance(video, (int, float)) and math.isfinite(video) and video > 0 else name
        digest = hashlib.sha256(f"{CONFIG['seed']}:{group}".encode()).digest()
        split = "val" if int.from_bytes(digest[:8], "big") % CONFIG["mpiiValidationModulo"] == 0 else "train"
        for person_index, person in enumerate(as_items(image_annotation.get("annorect"))):
            if not isinstance(person, dict):
                continue
            annotation = person.get("annopoints")
            if not isinstance(annotation, dict):
                continue
            points = [[0.0, 0.0, 0.0] for _ in KEYPOINTS]
            all_points = []
            for point in as_items(annotation.get("point")):
                if not isinstance(point, dict):
                    continue
                key = scalar(point.get("id"))
                x, y = scalar(point.get("x")), scalar(point.get("y"))
                if key is None or not valid_point(x, y):
                    continue
                # MPII annotations are MATLAB 1-based image coordinates.
                x, y = float(x) - 1, float(y) - 1
                all_points.append([x, y])
                if int(key) in MPII_TO_UPPER:
                    visible = scalar(point.get("is_visible"))
                    points[MPII_TO_UPPER[int(key)]] = [x, y, 2.0 if visible == 1 else 1.0]
            if sum(point[2] > 0 for point in points) < CONFIG["minLabeledUpperJoints"]:
                continue
            if not all_points:
                continue
            xs, ys = zip(*all_points)
            bbox = [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)]
            if bbox[2] <= 0 or bbox[3] <= 0:
                continue
            head = [scalar(person.get(key)) for key in ["x1", "y1", "x2", "y2"]]
            head_box = [float(value) - 1 for value in head] if all(isinstance(value, (int, float)) and math.isfinite(value) for value in head) else None
            rows[split].append({"schema": 1, "dataset": "mpii", "split": split, "sampleId": f"mpii-{image_index}-{person_index}", "imageId": name, "image": f"mpii/images/{name}", "width": None, "height": None, "bbox": bbox, "headBox": head_box, "keypoints": points, "source": {"url": "https://www.mpi-inf.mpg.de/departments/computer-vision-and-machine-learning/software-and-datasets/mpii-human-pose-dataset/download", "license": "noncommercial-scientific-research-only", "splitGroup": group}})
            missing["faceLabelsUnavailable"] += 5
    result = {split: {**write_lines(folder / f"{split}.jsonl", items), "images": len({row["imageId"] for row in items})} for split, items in rows.items()}
    result["splitPolicy"] = "Deterministic video-group hash holdout inside official MPII training partition; official test excluded."
    result["semantics"] = "MPII head-top and neck are used for ROI where available; neither is relabelled as nose. Only eight canonical arm/hip labels are supervised."
    result["missingLabels"] = dict(missing)
    return result

def extract_mpii_images() -> None:
    folder = DATA / "mpii"
    target = folder.resolve()
    with tarfile.open(folder / "mpii_human_pose_v1.tar.gz", "r:gz") as archive:
        for member in archive:
            destination = (target / member.name).resolve()
            if not destination.is_relative_to(target) or member.issym() or member.islnk():
                raise ValueError("Unsafe image archive path")
            archive.extract(member, target, filter="data")

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=["all", "coco2017", "mpii"], default="all")
    parser.add_argument("--extract-mpii-images", action="store_true")
    args = parser.parse_args()
    if args.extract_mpii_images:
        extract_mpii_images()
    summaries = {}
    if args.dataset in ["all", "coco2017"]:
        summaries["coco2017"] = prepare_coco()
    if args.dataset in ["all", "mpii"]:
        summaries["mpii"] = prepare_mpii()
    previous = {}
    if (DATA / "preparation.json").exists():
        previous = json.loads((DATA / "preparation.json").read_text(encoding="utf-8")).get("sources", {})
    report = {"version": 1, "schema": KEYPOINTS, "configSha256": sha256(ROOT / "config.json"), "sources": {**previous, **summaries}, "trained": False}
    (DATA / "preparation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
