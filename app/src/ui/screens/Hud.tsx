import { useStore } from '../../state/store';
import { duration, strings as t } from '../strings';
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
      <div className={`judgement ${hud.judgement}`} aria-hidden="true">
        {hud.judgement && t[hud.judgement as 'perfect']}
      </div>
      <footer className="song-progress">
        <span>{duration(hud.songTimeMs)}</span>
        <progress max={hud.durationMs || 1} value={Math.max(0, hud.songTimeMs)} />
        <span>{duration(hud.durationMs)}</span>
      </footer>
    </main>
  );
}
