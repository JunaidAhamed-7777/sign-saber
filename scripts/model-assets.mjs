// Immutable upstream model revision + SHA-256 pins. Digests verified at acquisition.
export const modelAssets = [
  {
    file: "hand_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    sha256: "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1",
    bytes: 7819105,
    modelCard:
      "https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf",
  },
  {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
    bytes: 5777746,
    modelCard:
      "https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf",
  },
  {
    file: "selfie_segmenter.tflite",
    url: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite",
    sha256: "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b",
    bytes: 249537,
    optional: true,
    modelCard:
      "https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf",
  },
];
