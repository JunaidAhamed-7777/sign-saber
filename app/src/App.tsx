import { useEffect } from 'react';
import type { GameRuntime } from './core/runtime';
import { useStore } from './state/store';
import { Select } from './ui/screens/Select';
import { Calibration } from './ui/screens/Calibration';
import { Paused } from './ui/screens/Paused';
import { Results } from './ui/screens/Results';
import { Hud } from './ui/screens/Hud';
import { Boot } from './ui/screens/Boot';
import { Button, RailHeading, RailPager, useCompactMenu } from './ui/components/MenuShell';
import type { MenuPage } from './ui/components/MenuShell';
import { CoverArt } from './ui/components/CoverArt';
import { GestureIcon } from './ui/components/GestureIcon';
import type { BundledTrackEntry } from './beatmap/types';
import { strings as t } from './ui/strings';
import { useTrialCopy } from './ui/trialCopy';
function Pointer() {
  const pointer = useStore((s) => s.pointer);
  return pointer?.visible ? (
    <div
      className={`hand-pointer ${pointer.phase}`}
      style={{ left: pointer.xCss, top: pointer.yCss, '--progress': pointer.progress } as React.CSSProperties}
      aria-hidden="true"
    >
      <span />
    </div>
  ) : null;
}
function Status() {
  const trial = useTrialCopy();
  const replay = useStore((s) => s.replay);
  const camera = useStore((s) => s.camera);
  const ready = useStore((s) => s.trackingReady);
  const datasetCamera = useStore((s) => s.cameraSource === 'dataset');
  const tone =
    replay || datasetCamera ? 'dataset' : camera.calibrationValid ? (ready ? 'active' : 'warning') : 'idle';
  return (
    <span className={`camera-status ${tone}`} role="status">
      <i aria-hidden="true" />
      {replay
        ? trial.source
        : camera.calibrationValid
          ? ready
            ? t.cameraReady
            : t.lostFigure
          : t.cameraNotReady}
    </span>
  );
}
function CreditCard({ track }: { track: BundledTrackEntry }) {
  return (
    <article className="credit-card">
      <header>
        <CoverArt track={track} />
        <div>
          <h2>{track.title}</h2>
          <p className="meta">
            {track.artist} · <span className="chip">{track.rights.license}</span>
          </p>
        </div>
      </header>
      <dl>
        <div>
          <dt>{t.creditsAttribution}</dt>
          <dd>{track.rights.attribution}</dd>
        </div>
        <div>
          <dt>{t.creditsChanges}</dt>
          <dd>{track.rights.changes}</dd>
        </div>
      </dl>
      <p className="credit-links">
        <a href={track.rights.sourceUrl} target="_blank" rel="noreferrer">
          {t.creditsSource} · {track.artist}
        </a>
        <a href={track.rights.licenseUrl} target="_blank" rel="noreferrer">
          {t.creditsLicense} · {track.rights.license}
        </a>
      </p>
    </article>
  );
}
function Credits({ runtime }: { runtime: GameRuntime }) {
  const library = useStore((s) => s.library);
  const compact = useCompactMenu();
  const pages: MenuPage[] = library.map((track) => ({
    id: `${track.slug}-credit`,
    label: track.title,
    content: <CreditCard track={track} />,
  }));
  return (
    <main className="credits">
      <header className="credits-header">
        <RailHeading level={1} eyebrow={t.morePage} title={t.credits} />
        <Button runtime={runtime} id="credits">
          {t.closeCredits}
        </Button>
      </header>
      <p className="lead">{t.creditsIntro}</p>
      {compact ? (
        <RailPager runtime={runtime} id="credits" pages={pages} />
      ) : (
        <div className="credit-grid">
          {library.map((track) => (
            <CreditCard key={track.slug} track={track} />
          ))}
        </div>
      )}
    </main>
  );
}
function Legend({ replay }: { replay: boolean }) {
  const trial = useTrialCopy();
  if (replay)
    return (
      <footer className="app-footer">
        <p className="legend-dataset">{trial.controls}</p>
      </footer>
    );
  return (
    <footer className="app-footer">
      <p className="visually-hidden">{t.menuHelp}</p>
      <ul className="legend" aria-hidden="true">
        <li>
          <span className="legend-glyph open">
            <GestureIcon name="open" />
          </span>
          {t.legendMove}
        </li>
        <li>
          <span className="legend-glyph point">
            <GestureIcon name="point" />
          </span>
          {t.legendClick}
        </li>
        <li className="legend-rearm">{t.legendRearm}</li>
      </ul>
    </footer>
  );
}
export function App({ runtime }: { runtime: GameRuntime }) {
  const state = useStore((s) => s.state);
  const calm = useStore((s) => s.calm);
  const credits = useStore((s) => s.credits);
  const replay = useStore((s) => s.replay);
  const stats = useStore((s) => s.stats);
  const fatal = useStore((s) => s.fatal);
  useEffect(() => {
    document.documentElement.dataset.motion = calm ? 'calm' : 'standard';
  }, [calm]);
  return (
    <div
      className={`application state-${fatal ? 'boot' : state.toLowerCase()}${credits ? ' showing-credits' : ''}`}
    >
      <header className="app-header">
        <a className="wordmark" href="/" aria-label={t.title}>
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M6 25L24 7M6 16L16 6M16 26L26 16" />
          </svg>
          <span>{t.title}</span>
        </a>
        <Status />
        <span className="input-label">{t.nativeHelp}</span>
      </header>
      {fatal ? (
        <Boot runtime={runtime} />
      ) : credits ? (
        <Credits runtime={runtime} />
      ) : state === 'BOOT' ? (
        <Boot runtime={runtime} />
      ) : state === 'SELECT' ? (
        <Select runtime={runtime} />
      ) : state === 'CALIBRATION' ? (
        <Calibration runtime={runtime} />
      ) : state === 'PLAYING' ? (
        <Hud />
      ) : state === 'PAUSED' ? (
        <Paused runtime={runtime} />
      ) : (
        <Results runtime={runtime} />
      )}
      {!fatal && state !== 'PLAYING' && state !== 'BOOT' && <Legend replay={replay} />}
      {stats && state === 'PLAYING' && (
        <aside className="diagnostics">
          <p>{t.diagnosticsLimit}</p>
          <Button runtime={runtime} id="evidence">
            {t.exportEvidence}
          </Button>
        </aside>
      )}
      <Pointer />
    </div>
  );
}
