import { useStore } from '../../state/store';
import { duration, strings as t } from '../strings';

const gestures = {
  open: { glyph: '✋︎', label: t.open },
  fist: { glyph: '✊︎', label: t.fist },
  point: { glyph: '☝︎', label: t.point },
  none: { glyph: '—', label: t.noGesture },
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
        <span className="hud-gesture-glyph">{gestures[current].glyph}</span>
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
export function Hud() {
  const hud = useStore((s) => s.hud);
  return (
    <main className="game-hud">
      <dl className="hud-stats">
        <div>
          <dt>{t.score}</dt>
          <dd>{hud.score.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{t.combo}</dt>
          <dd>
            {hud.combo}
            <span> ×{hud.multiplier}</span>
          </dd>
        </div>
        <div>
          <dt>{t.accuracy}</dt>
          <dd>{hud.accuracy === null ? '—' : `${(hud.accuracy * 100).toFixed(1)}%`}</dd>
        </div>
      </dl>
      <aside className="hud-hands" aria-label={t.handFeedback}>
        <HandIndicator side="left" present={hud.leftPresent} gesture={hud.left} charge={hud.leftCharge} />
        <HandIndicator side="right" present={hud.rightPresent} gesture={hud.right} charge={hud.rightCharge} />
      </aside>
      <div className={`judgement ${hud.judgement}`} aria-hidden="true">
        {hud.judgement && t[hud.judgement as 'perfect']}
      </div>
      <footer className="song-progress">
        <span>{duration(hud.songTimeMs)}</span>
        <progress aria-label="Song progress" max={hud.durationMs || 1} value={Math.max(0, hud.songTimeMs)} />
        <span>{duration(hud.durationMs)}</span>
      </footer>
    </main>
  );
}
