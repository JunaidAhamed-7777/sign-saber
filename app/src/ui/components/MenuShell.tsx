import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActionSource } from '../menuTargets';
import type { GameRuntime } from '../../core/runtime';
import { useStore } from '../../state/store';
import { strings } from '../strings';
import { trialCopy } from '../trialCopy';
export function Button({
  runtime,
  id,
  children,
  disabled = false,
  nativeOnly = false,
  selected = false,
  primary = false,
  onAction,
  label,
}: {
  runtime: GameRuntime;
  id: string;
  children: ReactNode;
  disabled?: boolean;
  nativeOnly?: boolean;
  selected?: boolean;
  primary?: boolean;
  onAction?: (source: ActionSource) => void;
  label?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const action = useRef(onAction);
  useEffect(() => {
    action.current = onAction;
  }, [onAction]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const off = runtime.targets.register(id, element, (source) => {
      if (action.current) action.current(source);
      else void runtime.command(id, source);
    });
    const observer = new ResizeObserver(() => runtime.targets.invalidate());
    observer.observe(element);
    return () => {
      observer.disconnect();
      off();
    };
  }, [runtime, id, disabled, nativeOnly]);
  return (
    <button
      ref={ref}
      type="button"
      data-target={id}
      data-native-only={nativeOnly}
      disabled={disabled}
      aria-pressed={selected || undefined}
      aria-label={label}
      className={`${primary ? 'primary ' : ''}${selected ? 'selected' : ''}`}
      onClick={() => runtime.targets.activate(id, 'native')}
    >
      {children}
    </button>
  );
}
export interface MenuPage {
  id: string;
  label: string;
  content: ReactNode;
}
export function RailPager({
  runtime,
  id,
  pages,
  showStatus = false,
}: {
  runtime: GameRuntime;
  id: string;
  pages: readonly MenuPage[];
  showStatus?: boolean;
}) {
  const [selected, setSelected] = useState('');
  const index = Math.max(
    0,
    pages.findIndex((page) => page.id === selected),
  );
  const page = pages[index];
  const previous = useCallback(() => {
    const target = pages[index - 1];
    if (target) {
      runtime.targets.invalidate();
      setSelected(target.id);
    }
  }, [runtime, pages, index]);
  const next = useCallback(() => {
    const target = pages[index + 1];
    if (target) {
      runtime.targets.invalidate();
      setSelected(target.id);
    }
  }, [runtime, pages, index]);
  if (!page) return null;
  return (
    <div className="rail-pager">
      <div className="rail-page" key={page.id} aria-label={page.label}>
        {page.content}
        {showStatus && <StatusMessage />}
      </div>
      {pages.length > 1 && (
        <nav className="page-navigation" aria-label={strings.menuPages}>
          <Button
            runtime={runtime}
            id={`ui:${id}:previous`}
            onAction={previous}
            disabled={index === 0}
            label={`${strings.previous}: ${pages[index - 1]?.label ?? strings.firstPage}`}
          >
            ←<span>{strings.previous}</span>
          </Button>
          <span className="page-position" role="status">
            {page.label}
            <small>
              {index + 1} / {pages.length}
            </small>
          </span>
          <Button
            runtime={runtime}
            id={`ui:${id}:next`}
            onAction={next}
            disabled={index + 1 === pages.length}
            label={`${strings.next}: ${pages[index + 1]?.label ?? strings.lastPage}`}
          >
            <span>{strings.next}</span>→
          </Button>
        </nav>
      )}
    </div>
  );
}
export function StatusMessage() {
  const status = useStore((state) => state.status);
  const error = useStore((state) => state.error || state.camera.error || state.arrangement?.error);
  if (error)
    return (
      <p className="error status-message" role="alert">
        {error}
      </p>
    );
  return status ? (
    <p className="status-message" role="status">
      {status}
    </p>
  ) : null;
}
function useCompactMenu(): boolean {
  const [compact, setCompact] = useState(
    () => window.matchMedia('(max-width: 1099px), (max-height: 619px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1099px), (max-height: 619px)');
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}
export function Figure({ runtime }: { runtime: GameRuntime }) {
  const ref = useRef<HTMLDivElement>(null);
  const available = useStore((s) => s.figureAvailable);
  const state = useStore((s) => s.state);
  const camera = useStore((s) => s.camera);
  const highlight = useStore((s) => s.highlightAt);
  const mask = useStore((s) => s.maskAvailable);
  const replay = useStore((s) => s.replay);
  const trialSource = useStore((s) => s.trialSource);
  const live = available && (replay || camera.calibrationValid || camera.mode === 'camera-setup');
  const saved = state === 'RESULTS' && highlight !== null;
  const frozen = state === 'PAUSED' && !!runtime.renderer?.hasFrozenFigure;
  const placeholder =
    state === 'RESULTS'
      ? !saved
      : state === 'PAUSED'
        ? !frozen
        : !live && !camera.calibrationValid && state !== 'PLAYING';
  useEffect(() => {
    runtime.setStage(ref.current);
    return () => runtime.setStage(null);
  }, [runtime]);
  const label =
    state === 'RESULTS'
      ? saved
        ? replay && !runtime.flags?.replay
          ? trialCopy(trialSource).savedFigure
          : strings.savedFigure
        : strings.noHighlight
      : state === 'PAUSED'
        ? frozen
          ? strings.frozenFigure
          : strings.noHighlight
        : replay && available
          ? trialCopy(trialSource).figure
          : camera.mode === 'camera-setup' && available
            ? strings.setupPreview
            : live
              ? mask
                ? strings.liveFigure
                : strings.skeletonFallback
              : camera.calibrationValid
                ? strings.lostFigure
                : strings.placeholder;
  return (
    <div ref={ref} className={`figure-stage ${placeholder ? 'illustration' : ''}`} aria-label={label}>
      {placeholder && (
        <svg viewBox="0 0 360 350" className="person-illustration" aria-hidden="true">
          <defs>
            <linearGradient id="person-color" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#19F5FF" />
              <stop offset="1" stopColor="#B36BFF" />
            </linearGradient>
          </defs>
          <g fill="none" stroke="url(#person-color)" strokeWidth="2">
            <ellipse cx="180" cy="65" rx="31" ry="38" />
            <path d="M164 102 L161 121 L122 138 L98 211 L54 261 L66 276 L121 229 L140 180 L141 271 Q180 293 219 271 L220 180 L239 229 L294 276 L306 261 L262 211 L238 138 L199 121 L196 102" />
            <path
              d="M141 271 Q180 293 219 271 M161 121 L180 160 L199 121 M144 178 L180 194 L217 178 M180 194 L180 262"
              opacity=".5"
            />
            <path d="M54 261 L43 271 L39 290 M66 276 L58 292 M306 261 L317 271 L321 290 M294 276 L302 292" />
          </g>
          <ellipse cx="180" cy="319" rx="115" ry="15" fill="none" stroke="#243453" />
          <path
            d="M41 48 L41 25 L65 25 M295 25 L319 25 L319 48 M41 278 L41 301 L65 301 M295 301 L319 301 L319 278"
            stroke="#30425f"
            fill="none"
          />
        </svg>
      )}
      {state !== 'PLAYING' && (
        <p className="figure-caption">
          {label}
          {saved ? ` · ${Math.max(0, highlight! / 1000).toFixed(1)} s` : ''}
        </p>
      )}
    </div>
  );
}
export function MenuShell({
  runtime,
  left,
  right,
  leftPages,
  rightPages,
  compactPages,
}: {
  runtime: GameRuntime;
  left?: ReactNode;
  right?: ReactNode;
  leftPages?: readonly MenuPage[];
  rightPages?: readonly MenuPage[];
  compactPages?: readonly MenuPage[];
}) {
  const compact = useCompactMenu();
  const state = useStore((s) => s.state);
  const calm = useStore((s) => s.calm);
  const volume = useStore((s) => s.volume);
  const hand = useStore((s) => s.hand);
  const camera = useStore((s) => s.camera);
  const diagnostics = useStore((s) => s.stats);
  const canStartLive = useStore(
    (s) => !!s.map && s.audioReady && s.camera.calibrationValid && s.trackingReady && !s.loading && !s.fatal,
  );
  useStore((s) => s.status);
  useStore((s) => s.countdown);
  const armed = runtime.startArmed || runtime.resumeArmed;
  const utilityActions: MenuPage[] = [
    {
      id: 'settings-calm',
      label: strings.settings,
      content: (
        <Button runtime={runtime} id="calm" selected={calm}>
          {calm ? strings.calm : strings.standard}
        </Button>
      ),
    },
    {
      id: 'settings-hand',
      label: strings.settings,
      content: (
        <Button runtime={runtime} id="hand">
          {hand === 'left' ? strings.handLeft : strings.handRight}
        </Button>
      ),
    },
    {
      id: 'settings-volume-down',
      label: strings.soundSettings,
      content: (
        <Button runtime={runtime} id="volume-down" disabled={volume <= 0}>
          {strings.volumeDown} · {Math.round(volume * 100)}%
        </Button>
      ),
    },
    {
      id: 'settings-volume-up',
      label: strings.soundSettings,
      content: (
        <Button runtime={runtime} id="volume-up" disabled={volume >= 1}>
          {strings.volumeUp} · {Math.round(volume * 100)}%
        </Button>
      ),
    },
    {
      id: 'settings-camera-off',
      label: strings.cameraSettings,
      content: (
        <Button runtime={runtime} id="camera-off" disabled={!camera.calibrationValid}>
          {strings.cameraOff}
        </Button>
      ),
    },
    {
      id: 'settings-credits',
      label: strings.credits,
      content: (
        <Button runtime={runtime} id="credits">
          {strings.credits}
        </Button>
      ),
    },
  ];
  if (state === 'SELECT')
    utilityActions.unshift(
      {
        id: 'settings-camera-setup',
        label: strings.cameraSettings,
        content: (
          <Button
            runtime={runtime}
            id="camera"
            nativeOnly={!camera.calibrationValid}
            disabled={camera.state === 'setting-up'}
          >
            {camera.calibrationValid ? strings.cameraReconfigure : strings.cameraSetup}
          </Button>
        ),
      },
      {
        id: 'settings-live-play',
        label: strings.liveCameraMode,
        content: (
          <>
            <Button runtime={runtime} id="start" disabled={!canStartLive}>
              {strings.start}
            </Button>
            {!canStartLive && <p className="subtle">{strings.startRequirements}</p>}
          </>
        ),
      },
    );
  if (diagnostics)
    utilityActions.push({
      id: 'settings-diagnostics',
      label: strings.diagnostics,
      content: (
        <>
          <p className="subtle">{strings.diagnosticsLimit}</p>
          <Button runtime={runtime} id="evidence">
            {strings.exportEvidence}
          </Button>
        </>
      ),
    });
  const utilities = !armed && state !== 'CALIBRATION';
  const leftContent = leftPages ?? [{ id: 'left', label: strings.library, content: left }];
  const rightContent = rightPages ?? [{ id: 'right', label: strings.ready, content: right }];
  const rightWithUtilities = [...rightContent];
  if (utilities)
    for (let index = 0; index < utilityActions.length; index += 3)
      rightWithUtilities.push({
        id: `settings-${index}`,
        label: strings.settings,
        content: (
          <>
            <h2>{strings.settings}</h2>
            {utilityActions.slice(index, index + 3).map((page) => (
              <div key={page.id}>{page.content}</div>
            ))}
          </>
        ),
      });
  const compactContent = [
    ...(compactPages ?? [...leftContent, ...rightContent]),
    ...(utilities ? utilityActions : []),
  ];
  if (compact)
    return (
      <main className="menu-shell compact-shell">
        <Figure runtime={runtime} />
        <section className="rail compact-rail">
          <RailPager
            key={`${state}:${camera.mode}:${armed}`}
            runtime={runtime}
            id="compact"
            pages={compactContent}
            showStatus
          />
        </section>
      </main>
    );
  return (
    <main className="menu-shell">
      <section className="rail left-rail">
        <RailPager runtime={runtime} id="left" pages={leftContent} />
      </section>
      <Figure runtime={runtime} />
      <section className="rail right-rail">
        <RailPager runtime={runtime} id="right" pages={rightWithUtilities} showStatus />
      </section>
    </main>
  );
}
