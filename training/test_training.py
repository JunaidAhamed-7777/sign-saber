"""Pipeline assertions; synthetic tensors here are unit tests, never training/evaluation evidence."""
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
import torch
from upper_body import CONFIG, DATA, KEYPOINTS, UpperBodyDataset, UpperBodyNet, decode_heatmaps, load_records, make_heatmaps, masked_heatmap_loss, upper_body_roi
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
