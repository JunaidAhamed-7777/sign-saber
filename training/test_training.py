"""Pipeline assertions; synthetic tensors here are unit tests, never training/evaluation evidence."""
import json
import random
import tempfile
import unittest
from pathlib import Path
import numpy as np
import torch
from upper_body import CONFIG, DATA, KEYPOINTS, UpperBodyDataset, UpperBodyNet, crop_input, decode_heatmaps, load_records, make_heatmaps, masked_heatmap_loss, upper_body_roi
from train import load_checkpoint, save_checkpoint

torch.set_num_threads(CONFIG["cpuThreads"])

class UpperBodyTests(unittest.TestCase):
    def test_missing_face_and_fingers_are_not_supervised(self):
        points = np.zeros((len(KEYPOINTS), 3), dtype=np.float32)
        points[5] = [12, 20, 2]
        points[7] = [18, 22, 1]
        points[9] = [CONFIG["heatmapSize"], 1, 2]
        maps, weights = make_heatmaps(points)
        self.assertEqual(maps.shape, (13, 48, 48))
        self.assertEqual(weights[5], 1)
        self.assertEqual(weights[7], CONFIG["occludedJointWeight"])
        self.assertEqual(weights[9], 0)
        self.assertEqual(float(maps[:5].sum()), 0)
        self.assertEqual(maps[5, 20, 12], 1)

    def test_roi_uses_head_arms_hips_rather_than_lower_body_box(self):
        points = np.zeros((13, 3), dtype=np.float32)
        points[0], points[5], points[9], points[11] = [30, 10, 2], [30, 30, 2], [80, 45, 2], [30, 70, 2]
        roi = upper_body_roi(points, [0, 0, 100, 1000], 100, 1000)
        self.assertLess(roi[1] + roi[3], 100)
        self.assertGreaterEqual(roi[0] + roi[2], 80)
        points[0] = 0
        head = upper_body_roi(points, [0, 0, 100, 1000], 100, 1000, [20, 1, 40, 20])
        self.assertLessEqual(head[1], 1)

    def test_masked_loss_does_not_optimize_absent_labels(self):
        prediction = torch.zeros((1, 13, 48, 48), requires_grad=True)
        target = torch.ones_like(prediction)
        weights = torch.zeros((1, 13))
        weights[0, 7] = 0.5
        loss = masked_heatmap_loss(prediction, target, weights)
        loss.backward()
        self.assertEqual(loss.item(), 1)
        self.assertEqual(prediction.grad[0, :7].abs().sum().item(), 0)
        self.assertGreater(prediction.grad[0, 7].abs().sum().item(), 0)
        with self.assertRaisesRegex(ValueError, "no supervised"):
            masked_heatmap_loss(prediction, target, torch.zeros_like(weights))

    def test_heatmap_coordinates_return_to_source_roi(self):
        heatmaps = torch.zeros((1, 13, 48, 48))
        heatmaps[:, :, 12, 24] = 2
        coordinates, scores = decode_heatmaps(heatmaps, torch.tensor([[10.0, 20.0, 192.0, 192.0]]))
        torch.testing.assert_close(coordinates[0, 0], torch.tensor([106.0, 68.0]))
        self.assertTrue((scores == 2).all())

    def test_quarter_cell_refinement_moves_toward_larger_neighbour(self):
        heatmaps = torch.zeros((1, 13, 48, 48))
        heatmaps[:, :, 12, 24] = 2
        heatmaps[:, :, 12, 25] = 1
        heatmaps[:, :, 11, 24] = 0.5
        heatmaps[:, 1, 0, 0] = 9  # Border peaks have no two-sided neighbour and stay unrefined.
        coordinates, _ = decode_heatmaps(heatmaps, torch.tensor([[0.0, 0.0, 48.0, 48.0]]))
        torch.testing.assert_close(coordinates[0, 0], torch.tensor([24.25, 11.75]))
        torch.testing.assert_close(coordinates[0, 1], torch.tensor([0.0, 0.0]))

    def test_augmented_crop_labels_follow_the_pixels(self):
        from PIL import Image
        size = CONFIG["imageSize"]
        flips, rotations = 0, 0
        for seed in range(24):
            source = Image.new("RGB", (400, 300))
            source.paste((255, 255, 255), (197, 147, 204, 154))  # 7x7 block whose continuous centre is (200.5, 150.5)
            points = np.zeros((13, 3), dtype=np.float32)
            points[5] = points[6] = [200.5, 150.5, 2]  # Both shoulders, so a left/right flip swap keeps the same location.
            rng = random.Random(seed)
            image, mapped = crop_input(source, points, np.array([100, 60, 240, 240], dtype=np.float32), rng)
            replay = random.Random(seed)
            flips += replay.random() < CONFIG["flipProbability"]
            replay.random()
            rotations += replay.random() < CONFIG["rotationProbability"]
            pixels = np.asarray(image, dtype=np.float32).mean(axis=2)
            ys, xs = np.nonzero(pixels > 0.5 * pixels.max())
            centre = np.array([xs.mean() + 0.5, ys.mean() + 0.5])  # Continuous centre of the bright block in the crop.
            self.assertTrue(0 <= mapped[5, 0] < size and 0 <= mapped[5, 1] < size)
            self.assertLess(float(np.abs(centre - mapped[5, :2]).max()), 1.0, f"seed {seed}")
            torch.testing.assert_close(torch.from_numpy(mapped[5]), torch.from_numpy(mapped[6]))
        self.assertGreater(flips, 0)
        self.assertGreater(rotations, 0)

    def test_unaugmented_crop_is_the_exact_oracle_extent(self):
        from PIL import Image
        source = Image.new("RGB", (64, 64))
        points = np.zeros((13, 3), dtype=np.float32)
        points[5] = [16, 32, 2]
        _, mapped = crop_input(source, points, np.array([0, 16, 32, 32], dtype=np.float32))
        torch.testing.assert_close(torch.from_numpy(mapped[5]), torch.tensor([96.0, 96.0, 2.0]))

    def test_schedule_and_resumable_epoch_order(self):
        from torch.utils.data import DataLoader
        from train import epoch_batches, learning_rate_scale
        warmup, floor = CONFIG["warmupSteps"], CONFIG["minLearningRateFraction"]
        self.assertAlmostEqual(learning_rate_scale(0, 10_000), 1 / warmup)
        self.assertAlmostEqual(learning_rate_scale(warmup - 1, 10_000), 1.0)
        self.assertAlmostEqual(learning_rate_scale(warmup, 10_000), 1.0)
        self.assertAlmostEqual(learning_rate_scale(10_000, 10_000), floor)
        decay = [learning_rate_scale(step, 10_000) for step in range(warmup, 10_001, 97)]
        self.assertTrue(all(a >= b for a, b in zip(decay, decay[1:])))
        for epoch in [0, 3]:
            expected = [batch.tolist() for batch in DataLoader(range(103), batch_size=CONFIG["batchSize"], shuffle=True, generator=torch.Generator().manual_seed(CONFIG["seed"] + epoch))]
            self.assertEqual(epoch_batches(103, epoch), expected)

    def test_actual_rgb_architecture_and_frozen_backbone(self):
        model = UpperBodyNet(pretrained=False)
        model.set_backbone_trainable(False)
        model.train()
        self.assertFalse(model.backbone.training)
        self.assertFalse(any(parameter.requires_grad for parameter in model.backbone.parameters()))
        with torch.no_grad():
            result = model(torch.zeros((2, 3, 192, 192)))
        self.assertEqual(tuple(result.shape), (2, 13, 48, 48))
        self.assertTrue(torch.isfinite(result).all())

    def test_real_prepared_validation_crops_are_deterministic(self):
        if not (DATA / "coco2017" / "val.jsonl").exists():
            self.skipTest("Official COCO annotations/images not locally acquired")
        rows, info = load_records(["coco2017"], "val", allow_partial=True)
        self.assertGreater(info["availableRecords"], 0)
        dataset = UpperBodyDataset(rows[:2], augment=True)
        first, second = dataset[0], dataset[0]
        self.assertEqual(tuple(first["image"].shape), (3, 192, 192))
        torch.testing.assert_close(first["image"], second["image"], rtol=0, atol=0)
        torch.testing.assert_close(first["target"], second["target"], rtol=0, atol=0)
        self.assertGreater(first["weights"].sum(), 0)
        self.assertIn("coco", first["sampleId"])

    def test_checkpoint_rejects_hash_corruption_and_preserves_resume_position(self):
        from upper_body import ROOT
        with tempfile.TemporaryDirectory(prefix="checkpoint-unit-", dir=ROOT) as temporary:
            model = torch.nn.Linear(2, 1)
            optimizer = torch.optim.AdamW(model.parameters())
            path = Path(temporary) / "latest.pt"
            manifest = {"configSha256": "unit-config", "dataFingerprint": {"unit": True}, "kind": "unit-only"}
            save_checkpoint(path, model, optimizer, 3, 9, 27, manifest)
            loaded = load_checkpoint(path)
            self.assertEqual((loaded["epoch"], loaded["nextBatch"], loaded["globalStep"]), (3, 9, 27))
            path.write_bytes(path.read_bytes() + b"corrupt")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                load_checkpoint(path)

if __name__ == "__main__":
    unittest.main()
