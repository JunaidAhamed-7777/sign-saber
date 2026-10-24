import type { GameRuntime } from '../../core/runtime';
import { useStore } from '../../state/store';
import { Button, MenuShell } from '../components/MenuShell';
import type { MenuPage } from '../components/MenuShell';
import { strings as t } from '../strings';
export function Calibration({ runtime }: { runtime: GameRuntime }) {
  const replay = useStore((s) => s.replay);
  const ready = useStore((s) => s.calibrationReady && s.trackingReady);
  const countdown = useStore((s) => s.countdown);
  useStore((s) => s.status);
  const back = (
    <Button runtime={runtime} id="back">
      {t.back}
    </Button>
  );
  const confirm = (
    <Button runtime={runtime} id="confirm" disabled={!ready} primary>
      {t.calibrationConfirm}
    </Button>
  );
  const count = (
    <p className="countdown" role="status">
      {countdown === null ? t.preparing : `${t.countdown} ${countdown}`}
    </p>
  );
  const left: MenuPage[] = [
    {
      id: 'framing',
      label: t.calibrationTitle,
      content: (
        <>
          <h1>{replay ? t.datasetPreparing : t.calibrationTitle}</h1>
          <p>{replay ? t.datasetLimitations : t.positioning}</p>
          <p className={ready ? 'success' : 'subtle'} role="status">
            {replay ? t.datasetReplay : ready ? t.framingReady : t.calibrationPending}
          </p>
          {back}
        </>
      ),
    },
  ];
  const right: MenuPage[] = [
    {
      id: 'confirm',
      label: t.calibrationConfirm,
      content: (
        <>
          <h2>{t.calibrationHint}</h2>
          {runtime.startArmed ? count : confirm}
        </>
      ),
    },
  ];
  const compact: MenuPage[] = runtime.startArmed
    ? [
        {
          id: 'armed',
          label: t.countdown,
          content: (
            <>
              {count}
              {back}
            </>
          ),
        },
      ]
    : [
        {
          id: 'confirm',
          label: t.calibrationConfirm,
          content: (
            <>
              <p className={ready ? 'success' : 'subtle'}>
                {replay ? t.datasetReplay : ready ? t.framingReady : t.calibrationPending}
              </p>
              {confirm}
            </>
          ),
        },
        { id: 'back', label: t.back, content: back },
        { id: 'coaching', label: t.calibrationTitle, content: <p>{t.calibrationHint}</p> },
        {
          id: 'positioning',
          label: t.positioning,
          content: <p>{replay ? t.datasetLimitations : t.positioning}</p>,
        },
      ];
  return <MenuShell runtime={runtime} leftPages={left} rightPages={right} compactPages={compact} />;
}
