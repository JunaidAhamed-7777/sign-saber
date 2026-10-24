import type { GameRuntime } from '../../core/runtime';
import { useStore } from '../../state/store';
import { Button, MenuShell } from '../components/MenuShell';
import type { MenuPage } from '../components/MenuShell';
import { strings as t } from '../strings';
export function Results({ runtime }: { runtime: GameRuntime }) {
  const stats = useStore((s) => s.results),
    replay = useStore((s) => s.replay),
    ready = useStore((s) =>
      s.replay
        ? !!s.map && s.audioReady
        : s.audioReady && (s.replay || (s.trackingReady && s.camera.calibrationValid)),
    );
  const resultTitle = replay && !runtime.flags?.replay ? t.datasetResults : t.results;
  const motionLabel = replay ? t.datasetMotion : t.motion;
  const motionAbout = replay ? t.datasetMotionAbout : t.motionAbout;
  const songs = (
    <Button runtime={runtime} id="songs">
      {t.songs}
    </Button>
  );
  if (!stats)
    return (
      <MenuShell
        runtime={runtime}
        left={<h1>{resultTitle}</h1>}
        right={songs}
        compactPages={[{ id: 'songs', label: t.songs, content: songs }]}
      />
    );
  const retry = (
    <Button runtime={runtime} id="retry" disabled={!ready} primary>
      {t.playAgain}
    </Button>
  );
  const summary = (
    <>
      <h1>{resultTitle}</h1>
      <div className="result-rank">{stats.rank}</div>
      <dl className="stats">
        <div>
          <dt>{t.score}</dt>
          <dd>{stats.score.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{t.accuracy}</dt>
          <dd>{(stats.accuracy * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>{t.maxCombo}</dt>
          <dd>{stats.maxCombo}</dd>
        </div>
      </dl>
    </>
  );
  const judgements = (['perfect', 'great', 'good', 'miss', 'badcut'] as const).map((key) => (
    <div key={key}>
      <dt>{t[key]}</dt>
      <dd>{stats.counts[key]}</dd>
    </div>
  ));
  const motion = (
    <>
      <h2>{motionLabel}</h2>
      <p className="motion-value">≈ {(stats.kineticJoules / 1000).toFixed(2)} kJ</p>
      <p className="subtle">{motionAbout}</p>
    </>
  );
  const left: MenuPage[] = [
    { id: 'results-summary', label: resultTitle, content: summary },
    {
      id: 'judgements',
      label: t.accuracy,
      content: (
        <>
          <h2>{t.accuracy}</h2>
          <dl className="judgements">{judgements}</dl>
        </>
      ),
    },
  ];
  const right: MenuPage[] = [
    {
      id: 'results-actions',
      label: t.playAgain,
      content: (
        <>
          {retry}
          {songs}
          {!ready && <p>{t.startNoTracking}</p>}
        </>
      ),
    },
    { id: 'motion', label: motionLabel, content: motion },
  ];
  const compact: MenuPage[] = [
    {
      id: 'retry',
      label: t.playAgain,
      content: (
        <>
          {retry}
          {!ready && <p className="subtle">{t.startNoTracking}</p>}
        </>
      ),
    },
    { id: 'songs', label: t.songs, content: songs },
    {
      id: 'result-score',
      label: resultTitle,
      content: (
        <dl className="stats">
          <div>
            <dt>{resultTitle}</dt>
            <dd>{stats.rank}</dd>
          </div>
          <div>
            <dt>{t.score}</dt>
            <dd>{stats.score.toLocaleString()}</dd>
          </div>
        </dl>
      ),
    },
    {
      id: 'result-accuracy',
      label: t.accuracy,
      content: (
        <dl className="stats">
          <div>
            <dt>{t.accuracy}</dt>
            <dd>{(stats.accuracy * 100).toFixed(1)}%</dd>
          </div>
          <div>
            <dt>{t.maxCombo}</dt>
            <dd>{stats.maxCombo}</dd>
          </div>
        </dl>
      ),
    },
    { id: 'counts-a', label: t.accuracy, content: <dl className="judgements">{judgements.slice(0, 3)}</dl> },
    { id: 'counts-b', label: t.accuracy, content: <dl className="judgements">{judgements.slice(3)}</dl> },
    {
      id: 'motion',
      label: motionLabel,
      content: (
        <>
          <h2>{motionLabel}</h2>
          <p className="motion-value">≈ {(stats.kineticJoules / 1000).toFixed(2)} kJ</p>
        </>
      ),
    },
    { id: 'motion-about', label: motionLabel, content: <p className="subtle">{motionAbout}</p> },
  ];
  return <MenuShell runtime={runtime} leftPages={left} rightPages={right} compactPages={compact} />;
}
