import type { GameRuntime } from '../../core/runtime';
import { useStore } from '../../state/store';
import { Button, MenuShell, RailHeading } from '../components/MenuShell';
import type { MenuPage } from '../components/MenuShell';
import { strings as t } from '../strings';
export function Paused({ runtime }: { runtime: GameRuntime }) {
  const reason = useStore((s) => s.pauseReason),
    ready = useStore((s) => runtime.datasetTrialActive || (s.trackingReady && s.camera.calibrationValid)),
    countdown = useStore((s) => s.countdown),
    error = useStore((s) => s.error),
    title = useStore((s) => s.map?.song.title ?? null);
  useStore((s) => s.status);
  const message =
    reason === 'tracking'
      ? t.pauseTracking
      : reason === 'hidden'
        ? t.pauseHidden
        : reason === 'audio'
          ? t.pauseAudio
          : reason === 'fatal'
            ? t.pauseFatal
            : t.pauseManual;
  const warning = reason === 'tracking' || reason === 'audio' || reason === 'fatal';
  const blocked = !ready && reason !== 'fatal' && !runtime.datasetTrialActive;
  const resume = (
    <Button
      runtime={runtime}
      id="resume"
      disabled={!ready || reason === 'fatal'}
      primary
      className="hero"
      autoFocus={ready && reason !== 'fatal'}
    >
      {t.resume}
    </Button>
  );
  const songs = (
    <Button runtime={runtime} id="songs" autoFocus={!ready || reason === 'fatal'}>
      {t.quit}
    </Button>
  );
  const count = (
    <div className="countdown" role="status">
      <span className="eyebrow">{t.resumesIn}</span>
      <span className="countdown-digit" key={countdown ?? 'pending'}>
        {countdown ?? '·'}
      </span>
    </div>
  );
  const errorNotice = error && (
    <div className="notice danger" role="alert">
      <p>{error}</p>
    </div>
  );
  const reasonNotice = (
    <p className={`notice reason${warning ? ' danger' : ''}`} role="status">
      {message}
    </p>
  );
  const leftPages: MenuPage[] = [
    {
      id: 'pause-reason',
      label: t.paused,
      content: (
        <>
          <RailHeading level={1} eyebrow={title ?? t.paused} title={t.paused} />
          {reasonNotice}
          <p className="note">{t.safeSpace}</p>
          {errorNotice}
        </>
      ),
    },
  ];
  const rightPages: MenuPage[] = [
    {
      id: 'pause-actions',
      label: t.resume,
      content: (
        <>
          <RailHeading eyebrow={t.ready} />
          {runtime.resumeArmed ? count : resume}
          {songs}
          {blocked && <p className="note">{t.resumeRequirements}</p>}
        </>
      ),
    },
  ];
  const compactPages: MenuPage[] = [
    {
      id: runtime.resumeArmed ? 'resuming' : 'resume',
      label: t.resume,
      content: (
        <>
          {runtime.resumeArmed ? count : resume}
          {songs}
        </>
      ),
    },
  ];
  return (
    <MenuShell
      runtime={runtime}
      leftPages={leftPages}
      rightPages={rightPages}
      compactTop={
        <div className="compact-summary">
          <strong>{t.paused}</strong>
          {reasonNotice}
        </div>
      }
      compactPages={compactPages}
      compactStatus={errorNotice || (blocked ? <p className="note">{t.resumeRequirements}</p> : null)}
      ownErrors
    />
  );
}
