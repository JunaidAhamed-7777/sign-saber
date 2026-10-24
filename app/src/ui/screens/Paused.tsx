import type { GameRuntime } from '../../core/runtime';
import { useStore } from '../../state/store';
import { Button, MenuShell } from '../components/MenuShell';
import type { MenuPage } from '../components/MenuShell';
import { strings as t } from '../strings';
export function Paused({ runtime }: { runtime: GameRuntime }) {
  const reason = useStore((s) => s.pauseReason),
    ready = useStore((s) => runtime.datasetTrialActive || (s.trackingReady && s.camera.calibrationValid)),
    countdown = useStore((s) => s.countdown),
    error = useStore((s) => s.error);
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
  const resume = (
    <Button runtime={runtime} id="resume" disabled={!ready || reason === 'fatal'} primary>
      {t.resume}
    </Button>
  );
  const songs = (
    <Button runtime={runtime} id="songs">
      {t.quit}
    </Button>
  );
  const count = (
    <p className="countdown" role="status">
      {t.countdown}
      {countdown !== null ? ` ${countdown}` : ''}
    </p>
  );
  const left: MenuPage[] = [
    {
      id: 'pause-reason',
      label: t.paused,
      content: (
        <>
          <h1>{t.paused}</h1>
          <p role="status">{message}</p>
          <p>{t.safeSpace}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      ),
    },
  ];
  const right: MenuPage[] = [
    {
      id: 'pause-actions',
      label: t.resume,
      content: (
        <>
          <h2>{t.ready}</h2>
          {runtime.resumeArmed ? count : resume}
          {songs}
        </>
      ),
    },
  ];
  const compact: MenuPage[] = runtime.resumeArmed
    ? [
        {
          id: 'resuming',
          label: t.resume,
          content: (
            <>
              {count}
              {songs}
            </>
          ),
        },
      ]
    : [
        {
          id: 'resume',
          label: t.resume,
          content: (
            <>
              {resume}
              <p>{message}</p>
            </>
          ),
        },
        { id: 'songs', label: t.quit, content: songs },
        ...(error
          ? [
              {
                id: 'error',
                label: t.paused,
                content: (
                  <p className="error" role="alert">
                    {error}
                  </p>
                ),
              },
            ]
          : []),
      ];
  return <MenuShell runtime={runtime} leftPages={left} rightPages={right} compactPages={compact} />;
}
