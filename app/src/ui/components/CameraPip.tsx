/** Corner camera window: the live (mirrored) camera feed with MediaPipe landmarks drawn on top. Local only. */
import { useEffect, useRef } from 'react';
import type { GameRuntime } from '../../core/runtime';
import { useStore } from '../../state/store';
import { CAMERA_PIP_W, CAMERA_PIP_H } from '../../core/constants';

const POSE_EDGES: readonly [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [0, 11],
  [0, 12],
];
const HAND_EDGES: readonly [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
const HAND_COLORS = ['#19F5FF', '#FF2BD6'] as const;

export function CameraPip({ runtime }: { runtime: GameRuntime }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useStore((s) => s.camera.state !== 'not-set-up');
  useEffect(() => {
    if (!active) return;
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const w = element.width,
        h = element.height,
        video = runtime.video;
      ctx.fillStyle = '#05060D';
      ctx.fillRect(0, 0, w, h);
      if (video.readyState >= 2 && video.videoWidth > 0) {
        // Same 16:9 centre crop as tracking, mirrored once so it matches the landmarks.
        const vw = video.videoWidth,
          vh = video.videoHeight;
        const sw = Math.min(vw, (vh * 16) / 9),
          sh = Math.min(vh, (vw * 9) / 16);
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
        ctx.restore();
      }
      const view = runtime.liveView;
      if (performance.now() - view.at < 500) {
        ctx.lineWidth = 2;
        if (view.hasPose) {
          const p = view.pose;
          ctx.strokeStyle = '#FFC32B';
          ctx.beginPath();
          for (const [a, b] of POSE_EDGES) {
            if (p[a * 4 + 3]! < 0.3 || p[b * 4 + 3]! < 0.3) continue;
            ctx.moveTo(p[a * 4]! * w, p[a * 4 + 1]! * h);
            ctx.lineTo(p[b * 4]! * w, p[b * 4 + 1]! * h);
          }
          ctx.stroke();
        }
        for (let k = 0; k < view.handCount; k++) {
          const lm = view.hands[k]!;
          ctx.strokeStyle = HAND_COLORS[view.handedness[k] === 'left' ? 0 : 1];
          ctx.beginPath();
          for (const [a, b] of HAND_EDGES) {
            ctx.moveTo(lm[a * 3]! * w, lm[a * 3 + 1]! * h);
            ctx.lineTo(lm[b * 3]! * w, lm[b * 3 + 1]! * h);
          }
          ctx.stroke();
          ctx.fillStyle = ctx.strokeStyle;
          ctx.font = '12px Rajdhani, system-ui, sans-serif';
          ctx.fillText(`${view.handedness[k]} · ${view.gestures[k]}`, lm[0]! * w + 6, lm[1]! * h + 14);
        }
      }
      const stats = runtime.cameraStats;
      ctx.fillStyle = 'rgba(5, 6, 13, 0.7)';
      ctx.fillRect(0, h - 18, w, 18);
      ctx.fillStyle = '#E8F1FF';
      ctx.font = '12px Rajdhani, system-ui, sans-serif';
      ctx.fillText(
        `${stats.hz.toFixed(1)} Hz · ${stats.inferenceMs.toFixed(0)} ms · dropped ${stats.dropped}`,
        6,
        h - 5,
      );
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [active, runtime]);
  if (!active) return null;
  return (
    <aside className="camera-pip" aria-label="Camera view with tracking">
      <canvas ref={canvas} width={CAMERA_PIP_W} height={CAMERA_PIP_H} />
    </aside>
  );
}
