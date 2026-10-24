import type { CSSProperties } from 'react';
import type { GameRuntime } from '../../core/runtime';
import { useStore } from '../../state/store';
import { Button, MenuShell, RailHeading } from '../components/MenuShell';
import type { MenuPage } from '../components/MenuShell';
import { strings as t } from '../strings';
import { useTrialCopy } from '../trialCopy';
const JUDGEMENTS = ['perfect', 'great', 'good', 'miss', 'badcut'] as const;
/** Rank colour follows docs14: SS/S gold, A cyan, B/C text, D muted. */
export function rankTone(rank: string): 'gold' | 'cyan' | 'text' | 'muted' {
  return rank === 'SS' || rank === 'S' ? 'gold' : rank === 'A' ? 'cyan' : rank === 'D' ? 'muted' : 'text';
}
const stagger = (index: number): CSSProperties => ({ '--i': index }) as CSSProperties;
export function Results({ runtime }: { runtime: GameRuntime }) {
  const stats = useStore((s) => s.results),
    replay = useStore((s) => s.replay),
    track = useStore((s) => s.map?.song.title ?? null),
    difficulty = useStore((s) => s.difficulty),
    ready = useStore((s) =>
      s.replay
        ? !!s.map && s.audioReady
        : s.audioReady && (s.replay || (s.trackingReady && s.camera.calibrationValid)),
    );
  const trial = useTrialCopy();
  const resultTitle = replay && !runtime.flags?.replay ? trial.results : t.results;
  const motionLabel = replay ? trial.motion : t.motion;
  const motionAbout = replay ? trial.motionAbout : t.motionAbout;
  const songs = (
    <Button runtime={runtime} id="songs" autoFocus={!ready || !stats}>
      {t.songs}
    </Button>
  );
  if (!stats)
    return (
      <MenuShell
        runtime={runtime}
        left={<RailHeading level={1} eyebrow={resultTitle} title={track ?? t.thisRun} />}
        right={songs}
        compactTop={<p className="compact-summary">{resultTitle}</p>}
        compactPages={[{ id: 'songs', label: t.songs, content: songs }]}
      />
    );
  const retry = (
    <Button runtime={runtime} id="retry" disabled={!ready} primary className="hero" autoFocus={ready}>
      {t.playAgain}
    </Button>
  );
  const accuracy = `${(stats.accuracy * 100).toFixed(1)}%`;
  const tone = rankTone(stats.rank);
  const rank = (
    <div className={`result-rank tone-${tone}`} aria-label={`${t.rank} ${stats.rank}`}>
      <span className="eyebrow">{t.rank}</span>
      <span className="rank-letter">{stats.rank}</span>
    </div>
  );
  const summary = (
    <dl className="result-stats">
      <div className="score-row" style={stagger(1)}>
        <dt>{t.score}</dt>
        <dd>{stats.score.toLocaleString()}</dd>
      </div>
      <div style={stagger(2)}>
        <dt>{t.accuracy}</dt>
        <dd>{accuracy}</dd>
      </div>
      <div style={stagger(3)}>
        <dt>{t.maxCombo}</dt>
        <dd>{stats.maxCombo}</dd>
      </div>
    </dl>
  );
  const largest = Math.max(1, ...JUDGEMENTS.map((key) => stats.counts[key]));
  const bars = (
    <dl className="judgement-bars" aria-label={t.judgements}>
      {JUDGEMENTS.map((key, index) => (
        <div key={key} className={`judgement-row j-${key}`} style={stagger(4 + index)}>
          <dt>{t[key]}</dt>
          <dd>
            <span className="bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${stats.counts[key] / largest})` }} />
            </span>
            <span className="count">{stats.counts[key]}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
  const motion = (
    <div className="motion" style={stagger(9)}>
      <span className="eyebrow">{motionLabel}</span>
      <p className="motion-value">≈ {(stats.kineticJoules / 1000).toFixed(2)} kJ</p>
      <p className="note">{motionAbout}</p>
    </div>
  );
  const guard = !ready && <p className="note">{replay ? t.startNoAudio : t.startNoTracking}</p>;
  const leftPages: MenuPage[] = [
    {
      id: 'results-summary',
      label: resultTitle,
      content: (
        <>
          <RailHeading level={1} eyebrow={resultTitle} title={track ?? t.thisRun} />
          <p className="meta">{t[difficulty]}</p>
          <div className="result-hero">
            {rank}
            {summary}
          </div>
        </>
      ),
    },
    {
      id: 'motion',
      label: motionLabel,
      content: (
        <>
          <RailHeading eyebrow={t.thisRun} title={motionLabel} />
          {motion}
        </>
      ),
    },
  ];
  const rightPages: MenuPage[] = [
    {
      id: 'results-actions',
      label: t.playAgain,
      content: (
        <>
          {retry}
          {songs}
          {guard}
          <RailHeading eyebrow={t.judgements} />
          {bars}
        </>
      ),
    },
  ];
  const compactPages: MenuPage[] = [
    {
      id: 'next',
      label: t.playAgain,
      content: (
        <>
          {retry}
          {songs}
          {guard}
        </>
      ),
    },
    { id: 'judgements', label: t.judgements, content: bars },
    { id: 'motion', label: motionLabel, content: motion },
  ];
  return (
    <MenuShell
      runtime={runtime}
      leftPages={leftPages}
      rightPages={rightPages}
      compactTop={
        <div className="compact-summary result-compact">
          {rank}
          {summary}
        </div>
      }
      compactPages={compactPages}
    />
  );
}
