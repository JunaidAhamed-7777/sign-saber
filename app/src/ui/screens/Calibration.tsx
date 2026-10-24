import type { GameRuntime } from '../../core/runtime';
import { useStore } from '../../state/store';
import { Button, MenuShell, RailHeading } from '../components/MenuShell';
import type { MenuPage } from '../components/MenuShell';
import { GestureIcon } from '../components/GestureIcon';
import { strings as t } from '../strings';
import { useTrialCopy } from '../trialCopy';
const moves = [
  ['open', t.open],
  ['fist', t.fist],
  ['point', t.point],
  ['lean', t.lean],
] as const;
export function Calibration({ runtime }: { runtime: GameRuntime }) {
  const replay = useStore((s) => s.replay);
  const trial = useTrialCopy();
  const ready = useStore((s) => s.calibrationReady && s.trackingReady);
  const countdown = useStore((s) => s.countdown);
  const body = useStore((s) => s.figureAvailable);
  const left = useStore((s) => s.hud.leftPresent);
  const right = useStore((s) => s.hud.rightPresent);
  const steady = useStore((s) => s.calibrationReady);
  useStore((s) => s.status);
  const armed = runtime.startArmed;
  const back = (
    <Button runtime={runtime} id="back">
      {t.back}
    </Button>
  );
  const confirm = (
    <Button runtime={runtime} id="confirm" disabled={!ready} primary className="hero" autoFocus>
      {t.calibrationConfirm}
    </Button>
  );
  const count = (
    <div className="countdown" role="status">
      <span className="eyebrow">{countdown === null ? t.preparing : t.startsIn}</span>
      <span className="countdown-digit" key={countdown ?? 'preparing'}>
        {countdown === null ? '·' : countdown}
      </span>
    </div>
  );
  const checks = [
    [t.checkBody, body],
    [t.checkLeft, left],
    [t.checkRight, right],
    [t.checkSteady, steady],
  ] as const;
  const checklist = replay ? null : (
    <ul className="checklist" aria-label={t.inFrame}>
      {checks.map(([label, ok]) => (
        <li key={label} className={ok ? 'ok' : undefined}>
          <span className="check-mark" aria-hidden="true">
            {ok ? '✓' : '○'}
          </span>
          {label}
          <span className="visually-hidden"> · {ok ? t.checkOk : t.checkMissing}</span>
        </li>
      ))}
    </ul>
  );
  const coaching = (
    <p className={`notice${ready && !replay ? ' success' : ''}`} role="status">
      {replay ? trial.limitations : ready ? t.framingReady : t.calibrationPending}
    </p>
  );
  const moveList = (
    <ul className="moves" aria-label={t.moves}>
      {moves.map(([gesture, label]) => (
        <li key={gesture} className={`move gesture-${gesture}`}>
          <span className="move-glyph">
            <GestureIcon name={gesture} />
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
  const leftPages: MenuPage[] = [
    {
      id: 'framing',
      label: t.calibrationTitle,
      content: (
        <>
          <RailHeading
            level={1}
            eyebrow={replay ? trial.preroll : t.calibrationTitle}
            title={replay ? trial.preparing : t.calibrationTitle}
          />
          {!replay && <p className="lead">{t.positioning}</p>}
          {checklist}
          {coaching}
        </>
      ),
    },
  ];
  const rightPages: MenuPage[] = [
    {
      id: 'confirm',
      label: t.calibrationConfirm,
      content: (
        <>
          <RailHeading eyebrow={t.moves} />
          {moveList}
          {armed ? count : confirm}
          {back}
          <p className="note">{t.safeSpace}</p>
        </>
      ),
    },
  ];
  const compactPages: MenuPage[] = [
    {
      id: armed ? 'armed' : 'confirm',
      label: armed ? t.countdown : t.calibrationConfirm,
      content: (
        <>
          {armed ? count : confirm}
          {back}
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
          <strong>{replay ? trial.preparing : t.calibrationTitle}</strong>
          {checklist}
        </div>
      }
      compactPages={compactPages}
      // During an armed labelled-trial pre-roll the figure uses the play projection; keep the bottom row to
      // the countdown and Back so it does not cover the hips. The source banner remains visible above.
      compactStatus={replay && armed ? null : coaching}
    />
  );
}
