"""Train a real RGB upper-body heatmap model; preflight is explicitly not full-dataset training."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import subprocess
import time
import numpy as np
import torch
from torch.utils.data import DataLoader
from upper_body import CONFIG, DATA, KEYPOINTS, ROOT, UpperBodyDataset, UpperBodyNet, evaluate, file_hash, load_records, masked_heatmap_loss

def write_json(path: Path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)

def input_fingerprint(records):
    unique = sorted({row["image"] for row in records})
    digest = hashlib.sha256()
    for relative in unique:
        digest.update((relative + ":" + file_hash(DATA / relative) + "\n").encode())
    return {"uniqueImages": len(unique), "imageBytesAggregateSha256": digest.hexdigest()}

def save_checkpoint(path, model, optimizer, epoch, next_batch, global_step, manifest):
    value = {"version": 1, "model": model.state_dict(), "optimizer": optimizer.state_dict(), "epoch": epoch, "nextBatch": next_batch, "globalStep": global_step, "torchRng": torch.get_rng_state(), "config": CONFIG, "configSha256": manifest["configSha256"], "dataFingerprint": manifest["dataFingerprint"], "kind": manifest["kind"]}
    temporary = path.with_suffix(".tmp")
    torch.save(value, temporary)
    temporary.replace(path)
    write_json(path.with_suffix(".sha256.json"), {"sha256": file_hash(path), "globalStep": global_step, "kind": manifest["kind"], "publication": "local-noncommercial-research-only"})

def load_checkpoint(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT.resolve()):
        raise ValueError("Only a local training checkpoint is accepted")
    receipt = json.loads(path.with_suffix(".sha256.json").read_text(encoding="utf-8"))
    if file_hash(path) != receipt["sha256"]:
        raise ValueError("Checkpoint hash mismatch")
    return torch.load(path, map_location="cpu", weights_only=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--datasets", nargs="+", choices=["coco2017", "mpii"], default=["coco2017", "mpii"])
    parser.add_argument("--epochs", type=int, default=CONFIG["epochs"])
    parser.add_argument("--preflight-steps", type=int, default=0, help="Explicit limited real-data pipeline check; never a completed large-dataset claim")
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--run-name")
    parser.add_argument("--selection", type=Path, help="Replay an earlier run's exact local sample-ID selection")
    args = parser.parse_args()
    if args.epochs <= 0 or args.preflight_steps < 0:
        parser.error("Epochs must be positive and preflight steps non-negative")
    torch.set_num_threads(CONFIG["cpuThreads"])
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(CONFIG["seed"])
    np.random.seed(CONFIG["seed"])
    random.seed(CONFIG["seed"])
    preflight = args.preflight_steps > 0
    train_rows, train_info = load_records(args.datasets, "train", allow_partial=preflight)
    validation_rows, validation_info = load_records(args.datasets, "val", allow_partial=preflight)
    if args.selection:
        selection = json.loads(args.selection.read_text(encoding="utf-8"))
        if selection.get("version") != 1 or selection.get("datasets") != args.datasets:
            raise ValueError("Selection version or datasets disagree")
        def selected(rows, split):
            available = {row["sampleId"]: row for row in rows}
            identifiers = selection[split]
            if not identifiers or len(set(identifiers)) != len(identifiers) or any(identifier not in available for identifier in identifiers):
                raise ValueError("Selection has missing, duplicate or unknown real samples")
            return [available[identifier] for identifier in identifiers]
        train_rows, validation_rows = selected(train_rows, "train"), selected(validation_rows, "validation")
        train_info["selectedRecords"], validation_info["selectedRecords"] = len(train_rows), len(validation_rows)
    # Input hashes refer to actual real image bytes, rather than claiming annotation-only training.
    print(f"Preparing real-image hashes: train {len(train_rows)} records; validation {len(validation_rows)} records", flush=True)
    fingerprint = {"train": input_fingerprint(train_rows), "validation": input_fingerprint(validation_rows), "indexSources": train_info["sources"] + validation_info["sources"]}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_name = args.run_name or f"{stamp}-{os.getpid()}"
    if not all(character.isalnum() or character in "-_" for character in run_name):
        raise ValueError("Unsafe run name")
    folder = ROOT / "runs" / run_name
    folder.mkdir(parents=True, exist_ok=False)
    selection = {"version": 1, "datasets": args.datasets, "train": [row["sampleId"] for row in train_rows], "validation": [row["sampleId"] for row in validation_rows]}
    write_json(folder / "selection.json", selection)
    fingerprint["selectionSha256"] = file_hash(folder / "selection.json")
    manifest = {"version": 1, "kind": "real-data-preflight" if preflight else "full-eligible-dataset-training", "status": "initializing", "startedAt": datetime.now(timezone.utc).isoformat(), "device": "cpu", "cpuThreads": CONFIG["cpuThreads"], "python": platform.python_version(), "torch": torch.__version__, "numpy": np.__version__, "config": CONFIG, "configSha256": file_hash(ROOT / "config.json"), "dataFingerprint": fingerprint, "trainData": train_info, "validationData": validation_info, "requestedEpochs": args.epochs, "requestedPreflightSteps": args.preflight_steps, "completedEpochs": 0, "completedSteps": 0, "fullDatasetTrainingCompleted": False, "publication": "local-noncommercial-research-only", "knownLimitations": ["No live-webcam evaluation", "No calibrated landmark visibility head", "Finger landmarks are not supervised by this body model", "A preflight checkpoint is not a production model", "Ground-truth upper-body ROI used; production person localization is a separate requirement"]}
    manifest["gitHead"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT.parent, text=True).strip()
    manifest["dirtyTree"] = bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT.parent, text=True).strip())
    write_json(folder / "run.json", manifest)
    try:
        model = UpperBodyNet(pretrained=True)
        pretrained = DATA / "torch-cache" / "checkpoints" / Path(CONFIG["pretrainedUrl"]).name
        manifest["initialization"] = {"kind": "ImageNet pretrained RGB backbone; newly initialized pose head", "source": CONFIG["pretrainedUrl"], "sha256": file_hash(pretrained), "bodyPoseWeightsPreviouslyTrainedByThisProject": False}
        optimizer = torch.optim.AdamW([{"params": model.head.parameters(), "lr": CONFIG["headLearningRate"]}, {"params": model.backbone.parameters(), "lr": CONFIG["backboneLearningRate"]}], weight_decay=CONFIG["weightDecay"])
        dataset = UpperBodyDataset(train_rows, augment=True)
        validation = DataLoader(UpperBodyDataset(validation_rows), batch_size=CONFIG["batchSize"], shuffle=False, num_workers=0)
        epoch, next_batch, step = 0, 0, 0
        if args.resume:
            checkpoint = load_checkpoint(args.resume)
            if checkpoint["configSha256"] != manifest["configSha256"] or checkpoint["dataFingerprint"] != fingerprint or checkpoint["kind"] != manifest["kind"]:
                raise ValueError("Resume requires identical configuration, real-image inputs and run kind")
            model.load_state_dict(checkpoint["model"])
            optimizer.load_state_dict(checkpoint["optimizer"])
            torch.set_rng_state(checkpoint["torchRng"])
            epoch, next_batch, step = checkpoint["epoch"], checkpoint["nextBatch"], checkpoint["globalStep"]
            manifest["initialization"]["bodyPoseWeightsPreviouslyTrainedByThisProject"] = True
            manifest["resumedCheckpoint"] = {"path": str(args.resume), "sha256": file_hash(args.resume), "epoch": epoch, "nextBatch": next_batch, "globalStep": step}
            if preflight and step >= args.preflight_steps:
                raise ValueError("Resume preflight limit must exceed the checkpoint's completed optimizer steps")
            if epoch >= args.epochs:
                raise ValueError("Resume epoch limit must exceed the checkpoint's completed epochs")
            manifest["completedEpochs"] = epoch
            manifest["completedSteps"] = step
        checkpoint_epoch, checkpoint_next_batch = epoch, next_batch
        baseline = evaluate(model, validation)
        write_json(folder / "baseline.json", baseline)
        manifest["baseline"] = baseline
        manifest["status"] = "training"
        write_json(folder / "run.json", manifest)
        stop = False
        with (folder / "steps.jsonl").open("a", encoding="utf-8", buffering=1) as trace:
            for current_epoch in range(epoch, args.epochs):
                dataset.epoch = current_epoch
                model.set_backbone_trainable(current_epoch >= CONFIG["freezeBackboneEpochs"])
                model.train()
                sampler = torch.Generator().manual_seed(CONFIG["seed"] + current_epoch)
                loader = DataLoader(dataset, batch_size=CONFIG["batchSize"], shuffle=True, generator=sampler, num_workers=0)
                for batch_index, batch in enumerate(loader):
                    if current_epoch == epoch and batch_index < next_batch:
                        continue
                    started = time.perf_counter()
                    optimizer.zero_grad(set_to_none=True)
                    loss = masked_heatmap_loss(model(batch["image"]), batch["target"], batch["weights"])
                    if not torch.isfinite(loss):
                        raise ValueError("Non-finite training loss; checkpoint is not promoted")
                    loss.backward()
                    optimizer.step()
                    step += 1
                    checkpoint_epoch, checkpoint_next_batch = current_epoch, batch_index + 1
                    row = {"step": step, "epoch": current_epoch, "batch": batch_index, "sampleIds": batch["sampleId"], "loss": loss.item(), "batchSamples": len(batch["image"]), "stepWallMs": (time.perf_counter() - started) * 1000, "backboneTrainable": model.backbone_trainable}
                    trace.write(json.dumps(row, allow_nan=False) + "\n")
                    manifest["completedSteps"] = step
                    if step % CONFIG["checkpointEverySteps"] == 0 or (preflight and step >= args.preflight_steps):
                        save_checkpoint(folder / "latest.pt", model, optimizer, current_epoch, batch_index + 1, step, manifest)
                        write_json(folder / "run.json", manifest)
                    if step % CONFIG["validationEverySteps"] == 0:
                        measured = evaluate(model, validation)
                        write_json(folder / f"evaluation-step-{step}.json", measured)
                        model.train()
                    if step % 10 == 0:
                        print(f"step={step} epoch={current_epoch} loss={loss.item():.6f} batch={len(batch['image'])}", flush=True)
                    if preflight and step >= args.preflight_steps:
                        stop = True
                        break
                if stop:
                    break
                manifest["completedEpochs"] = current_epoch + 1
                next_batch = 0
                checkpoint_epoch, checkpoint_next_batch = current_epoch + 1, 0
                save_checkpoint(folder / "latest.pt", model, optimizer, current_epoch + 1, 0, step, manifest)
                write_json(folder / "run.json", manifest)
        final = evaluate(model, validation)
        write_json(folder / "evaluation.json", final)
        manifest["evaluation"] = final
        manifest["completedSteps"] = step
        manifest["status"] = "preflight_completed_not_production" if preflight else "training_completed_evaluation_pending"
        manifest["fullDatasetTrainingCompleted"] = not preflight and manifest["completedEpochs"] == args.epochs
        manifest["finishedAt"] = datetime.now(timezone.utc).isoformat()
        save_checkpoint(folder / "latest.pt", model, optimizer, checkpoint_epoch, checkpoint_next_batch, step, manifest)
        write_json(folder / "run.json", manifest)
        # This compact report can be reviewed/committed; checkpoint/image bytes remain ignored.
        write_json(ROOT / "STATUS.json", {**manifest, "localRunDirectory": folder.relative_to(ROOT).as_posix(), "checkpointSha256": file_hash(folder / "latest.pt"), "promotedToGame": False})
        print(json.dumps({"run": str(folder), "status": manifest["status"], "steps": step, "fullDatasetTrainingCompleted": manifest["fullDatasetTrainingCompleted"], "checkpointSha256": file_hash(folder / "latest.pt")}), flush=True)
    except Exception as error:
        manifest["status"] = "failed"
        manifest["failure"] = str(error)
        write_json(folder / "run.json", manifest)
        write_json(ROOT / "STATUS.json", {**manifest, "localRunDirectory": folder.relative_to(ROOT).as_posix(), "promotedToGame": False})
        raise

if __name__ == "__main__":
    main()
