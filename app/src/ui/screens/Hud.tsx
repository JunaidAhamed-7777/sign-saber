import { useEffect, useRef, useState } from 'react';
import { HUD_TWEEN_TAU_MS } from '../../core/constants';
import { useStore } from '../../state/store';
import { comboMilestone, multiplierProgress } from '../hudModel';
import { GestureIcon } from '../components/GestureIcon';
import { duration, strings as t } from '../strings';

const gestures = {
  open: { label: t.open },
  fist: { label: t.fist },
  point: { label: t.point },
  none: { label: t.noGesture },
};
function HandIndicator({
  side,
  present,
  gesture,
  charge,
}: {
  side: 'left' | 'right';
  present: boolean;
  gesture: string;
  charge: number;
}) {
  // A lost hand's remaining fields are stale. Never show its old gesture or charge.
  const recognized = present && (gesture === 'open' || gesture === 'fist' || gesture === 'point');
  const current = recognized ? gesture : 'none';
  const value = present && Number.isFinite(charge) ? Math.floor(Math.max(0, Math.min(1, charge)) * 100) : 0;
  const label = side === 'left' ? t.handLeft : t.handRight;
  const chargeText = value === 100 && current === 'point' ? t.beamCharged : `${t.beamCharge} ${value}%`;
  return (
    <section
      className={`hud-hand hud-hand-${side} gesture-${current}`}
      data-present={present}
      aria-label={`${label} ${t.handStatus}`}
    >
      <span className="hud-hand-label">{label}</span>
      <div className="hud-hand-symbol" aria-hidden="true">
        <svg className="hud-charge-ring" viewBox="0 0 80 80">
          <circle className="hud-charge-track" cx="40" cy="40" r="35" />
          {value > 0 && (
            <circle
              className="hud-charge-fill"
              cx="40"
              cy="40"
              r="35"
              pathLength="100"
              strokeDasharray={`${value} 100`}
              transform="rotate(-90 40 40)"
            />
          )}
        </svg>
        <GestureIcon name={current} className="hud-gesture-glyph" />
      </div>
      <span className="hud-gesture-label">{present ? gestures[current].label : t.unavailable}</span>
      {present ? (
        <span
          className="hud-charge-label"
          role="progressbar"
          aria-label={`${label} ${t.beamCharge.toLowerCase()}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={chargeText}
        >
          <span className="hud-charge-value" aria-hidden="true">
            {value}
            <span>%</span>
          </span>
          <span className="hud-charge-caption" aria-hidden="true">
            {value === 100 && current === 'point' ? t.charged : t.beamCharge}
          </span>
        </span>
      ) : (
        <span className="hud-charge-label">{t.noHandData}</span>
      )}
    </section>
  );
}
function useTweened(target: number, calm: boolean): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (calm) {
      current.current = target;
      return;
    }
    let frame = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = Math.max(0, now - last);
      last = now;
      const value = current.current + (target - current.current) * (1 - Math.exp(-dt / HUD_TWEEN_TAU_MS));
      current.current = Math.abs(target - value) < 0.5 ? target : value;
      setShown(Math.round(current.current));
      if (current.current !== target) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, calm]);
  return calm ? target : shown;
}
function MultiplierRing({ combo }: { combo: number }) {
  const { multiplier, progress } = multiplierProgress(combo);
  return (
    <div className="hud-ring" aria-label={`${t.multiplier} ×${multiplier}`}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle className="hud-ring-track" cx="40" cy="40" r="34" />
        {progress > 0 && (
          <circle
            className="hud-ring-fill"
            cx="40"
            cy="40"
            r="34"
            pathLength="100"
            strokeDasharray={`${Math.round(progress * 100)} 100`}
            transform="rotate(-90 40 40)"
          />
        )}
      </svg>
      <span className="hud-ring-value">×{multiplier}</span>
    </div>
  );
}
const MILESTONE_COPY = {
  10: t.milestone10,
  25: t.milestone25,
  50: t.milestone50,
  100: t.milestone100,
} as const;
export function Hud() {
  const hud = useStore((s) => s.hud);
  const calm = useStore((s) => s.calm);
  const score = useTweened(hud.score, calm);
  const milestone = comboMilestone(hud.combo);
  const progress = hud.durationMs > 0 ? Math.min(1, Math.max(0, hud.songTimeMs / hud.durationMs)) : 0;
  return (
    <main className="game-hud">
      <dl className="hud-stats">
        <div className="hud-score">
          <dt>{t.score}</dt>
          <dd>{score.toLocaleString()}</dd>
        </div>
        <div className="hud-combo">
          <dt>{t.combo}</dt>
          <dd>
            <MultiplierRing combo={hud.combo} />
            <span className="hud-combo-count">{hud.combo}</span>
            {milestone && (
              <span className="hud-milestone" key={milestone}>
                {MILESTONE_COPY[milestone]}
              </span>
            )}
          </dd>
        </div>
        <div className="hud-accuracy">
          <dt>{t.accuracy}</dt>
          <dd>{hud.accuracy === null ? '—' : `${(hud.accuracy * 100).toFixed(1)}%`}</dd>
        </div>
      </dl>
      <aside className="hud-hands" aria-label={t.handFeedback}>
        <HandIndicator side="left" present={hud.leftPresent} gesture={hud.left} charge={hud.leftCharge} />
        <HandIndicator side="right" present={hud.rightPresent} gesture={hud.right} charge={hud.rightCharge} />
      </aside>
      <div className="judgement-layer" aria-hidden="true">
        {hud.judgement && (
          <span className={`judgement ${hud.judgement}`} key={hud.judgementSeq}>
            {t[hud.judgement as 'perfect']}
          </span>
        )}
      </div>
      <footer className="song-progress">
        <span>{duration(hud.songTimeMs)}</span>
        <div className="song-track">
          <progress
            aria-label={t.songProgress}
            max={hud.durationMs || 1}
            value={Math.max(0, hud.songTimeMs)}
          />
          <i
            className="song-playhead"
            style={{ left: `${(progress * 100).toFixed(2)}%` }}
            aria-hidden="true"
          />
        </div>
        <span>{duration(hud.durationMs)}</span>
      </footer>
    </main>
  );
}
