import { useEffect } from 'react';
import type { GameRuntime } from './core/runtime';
import { useStore } from './state/store';
import { Select } from './ui/screens/Select';
import { Calibration } from './ui/screens/Calibration';
import { Paused } from './ui/screens/Paused';
import { Results } from './ui/screens/Results';
import { Hud } from './ui/screens/Hud';
import { Boot } from './ui/screens/Boot';
import { Button, RailPager } from './ui/components/MenuShell';
import type { MenuPage } from './ui/components/MenuShell';
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
  const replay = useStore((s) => s.replay);
  const trial = useTrialCopy();
  const camera = useStore((s) => s.camera);
  const ready = useStore((s) => s.trackingReady);
  return (
    <span className={`camera-status ${camera.calibrationValid && ready ? 'active' : ''}`} role="status">
      <i />
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
function Credits({ runtime }: { runtime: GameRuntime }) {
  const library = useStore((s) => s.library);
  const pages: MenuPage[] = [{ id: 'intro', label: t.credits, content: <p>{t.creditsIntro}</p> }];
  for (const track of library)
    pages.push(
      { id: `${track.slug}-credit`, label: track.title, content: <p>{track.rights.attribution}</p> },
      { id: `${track.slug}-changes`, label: track.title, content: <p>{track.rights.changes}</p> },
      {
        id: `${track.slug}-sources`,
        label: track.title,
        content: (
          <div className="credit-links">
            <a href={track.rights.sourceUrl} target="_blank" rel="noreferrer">
              {track.artist}
            </a>
            <a href={track.rights.licenseUrl} target="_blank" rel="noreferrer">
              {track.rights.license}
            </a>
          </div>
        ),
      },
    );
  return (
    <main className="credits">
      <h1>{t.credits}</h1>
      <RailPager runtime={runtime} id="credits" pages={pages} />
      <Button runtime={runtime} id="credits">
        {t.closeCredits}
      </Button>
    </main>
  );
}
export function App({ runtime }: { runtime: GameRuntime }) {
  const state = useStore((s) => s.state);
  const calm = useStore((s) => s.calm);
  const credits = useStore((s) => s.credits);
  const replay = useStore((s) => s.replay);
  const trial = useTrialCopy();
  const stats = useStore((s) => s.stats);
  const fatal = useStore((s) => s.fatal);
  useEffect(() => {
    document.documentElement.dataset.motion = calm ? 'calm' : 'standard';
  }, [calm]);
  return (
    <div className={`application state-${state.toLowerCase()}`}>
      <header className="app-header">
        <a className="wordmark" href="/" aria-label={t.title}>
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M6 25L24 7M6 16L16 6M16 26L26 16" />
          </svg>
          {t.title}
        </a>
        <Status />
        <span className="input-label">{t.nativeHelp}</span>
      </header>
      {replay && <div className="replay-label">{runtime.flags?.replay ? t.replay : trial.banner}</div>}
      {credits ? (
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
      {fatal && state !== 'BOOT' && (
        <aside className="renderer-error" role="alert">
          {t.fatalTitle}. {t.fatalHint}
        </aside>
      )}
      {state !== 'PLAYING' && (
        <footer className="app-footer">
          <p>{replay ? trial.controls : t.menuHelp}</p>
        </footer>
      )}
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
