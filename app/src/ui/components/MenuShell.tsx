import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActionSource } from '../menuTargets';
import type { GameRuntime } from '../../core/runtime';
import { MENU_COMPACT_MAX_HEIGHT_PX, MENU_COMPACT_MAX_WIDTH_PX } from '../../core/constants';
import { useStore } from '../../state/store';
import { strings } from '../strings';
import { trialCopy } from '../trialCopy';
const classes = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ');
/**
 * One registered semantic target. Mouse, keyboard and hand activation all resolve through runtime.targets.
 * The hand pointer's hover/armed/confirming/latched phase is mirrored onto the targeted button only.
 */
export function Button({
  runtime,
  id,
  children,
  disabled = false,
  nativeOnly = false,
  selected = false,
  primary = false,
  busy = false,
  className,
  onAction,
  label,
  describedBy,
  autoFocus = false,
}: {
  runtime: GameRuntime;
  id: string;
  children: ReactNode;
  disabled?: boolean;
  nativeOnly?: boolean;
  selected?: boolean;
  primary?: boolean;
  busy?: boolean;
  className?: string | undefined;
  onAction?: (source: ActionSource) => void;
  label?: string;
  describedBy?: string;
  /** Initial keyboard focus for a screen's primary action (docs14 §Focus management). */
  autoFocus?: boolean;
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
  }, [runtime, id, disabled, nativeOnly, busy]);
  const hand = useStore((s) =>
    s.pointer?.visible && s.pointer.targetId === id && s.pointer.phase !== 'idle' ? s.pointer.phase : null,
  );
  // Quantized so the targeted button re-renders at most ten times per arming interval.
  const progress = useStore((s) =>
    s.pointer?.visible && s.pointer.targetId === id ? Math.round(s.pointer.progress * 10) / 10 : 0,
  );
  return (
    <button
      ref={ref}
      type="button"
      data-target={id}
      data-native-only={nativeOnly}
      data-hand={hand ?? undefined}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-pressed={selected || undefined}
      aria-label={label}
      aria-describedby={describedBy}
      autoFocus={autoFocus}
      className={classes('btn', primary && 'primary', selected && 'selected', busy && 'busy', className)}
      style={hand ? ({ '--arm': progress } as React.CSSProperties) : undefined}
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
/**
 * Bounded pages with large Previous/Next targets. `rail` stacks navigation under the page;
 * `inline` flanks a horizontal page with the navigation for layouts above/below the figure.
 */
export function RailPager({
  runtime,
  id,
  pages,
  showStatus = false,
  statusErrors = true,
  variant = 'rail',
}: {
  runtime: GameRuntime;
  id: string;
  pages: readonly MenuPage[];
  showStatus?: boolean;
  statusErrors?: boolean;
  variant?: 'rail' | 'inline';
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
  const paged = pages.length > 1;
  const previousButton = paged && (
    <Button
      runtime={runtime}
      id={`ui:${id}:previous`}
      onAction={previous}
      disabled={index === 0}
      className="page-button"
      label={`${strings.previous}: ${pages[index - 1]?.label ?? strings.firstPage}`}
    >
      <span className="page-arrow" aria-hidden="true">
        ←
      </span>
      <span>{strings.previous}</span>
    </Button>
  );
  const nextButton = paged && (
    <Button
      runtime={runtime}
      id={`ui:${id}:next`}
      onAction={next}
      disabled={index + 1 === pages.length}
      className="page-button"
      label={`${strings.next}: ${pages[index + 1]?.label ?? strings.lastPage}`}
    >
      <span className="page-arrow" aria-hidden="true">
        →
      </span>
      <span>{strings.next}</span>
    </Button>
  );
  const position = paged && (
    <span className="page-position" role="status">
      <span className="page-label">{page.label}</span>
      <small>
        {index + 1} {strings.pageOf} {pages.length}
      </small>
      <span className="page-dots" aria-hidden="true">
        {pages.map((entry) => (
          <i key={entry.id} className={entry.id === page.id ? 'current' : undefined} />
        ))}
      </span>
    </span>
  );
  if (variant === 'inline')
    return (
      <div className={classes('rail-pager', 'inline-pager', paged && 'paged')}>
        {position}
        <div className="inline-row">
          {previousButton}
          <div className="rail-page" key={page.id} aria-label={page.label}>
            {page.content}
          </div>
          {nextButton}
        </div>
        {showStatus && <StatusMessage errors={statusErrors} />}
      </div>
    );
  return (
    <div className="rail-pager">
      <div className="rail-page" key={page.id} aria-label={page.label}>
        {page.content}
        {showStatus && <StatusMessage errors={statusErrors} />}
      </div>
      {paged && (
        <nav className="page-navigation" aria-label={strings.menuPages}>
          {previousButton}
          {position}
          {nextButton}
        </nav>
      )}
    </div>
  );
}
/** Transient runtime status plus, unless a screen presents errors itself, the current actionable error. */
export function StatusMessage({ errors = true }: { errors?: boolean }) {
  const status = useStore((state) => state.status);
  const error = useStore((state) => state.error || state.camera.error || state.arrangement?.error);
  if (error && errors)
    return (
      <p className="notice danger status-message" role="alert">
        {error}
      </p>
    );
  return status ? (
    <p className="status-message" role="status">
      {status}
    </p>
  ) : null;
}
/** Rails stay beside the figure only when the viewport can hold them with full-size targets. */
const COMPACT_QUERY = `(max-width: ${MENU_COMPACT_MAX_WIDTH_PX}px), (max-height: ${MENU_COMPACT_MAX_HEIGHT_PX}px)`;
export function useCompactMenu(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}
/** Small uppercase rail heading with an optional display title. */
export function RailHeading({
  eyebrow,
  title,
  level = 2,
}: {
  eyebrow: string;
  title?: ReactNode;
  level?: 1 | 2;
}) {
  const Title = level === 1 ? 'h1' : 'h2';
  return (
    <header className="rail-heading">
      <span className="eyebrow">{eyebrow}</span>
      {title !== undefined && <Title>{title}</Title>}
    </header>
  );
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
/** Secondary pages shared by SELECT, PAUSED and RESULTS. Each page keeps at most three primary targets. */
function useSettingsPages(runtime: GameRuntime, enabled: boolean): MenuPage[] {
  const state = useStore((s) => s.state);
  const calm = useStore((s) => s.calm);
  const volume = useStore((s) => s.volume);
  const hand = useStore((s) => s.hand);
  const camera = useStore((s) => s.camera);
  const diagnostics = useStore((s) => s.stats);
  const canStartLive = useStore(
    (s) => !!s.map && s.audioReady && s.camera.calibrationValid && s.trackingReady && !s.loading && !s.fatal,
  );
  if (!enabled) return [];
  const percent = Math.round(volume * 100);
  const visuals = calm ? strings.visualsCalm : strings.visualsStandard;
  const pages: MenuPage[] = [
    {
      id: 'settings-sound',
      label: strings.soundVisualsPage,
      content: (
        <>
          <RailHeading eyebrow={strings.settings} title={strings.soundVisualsPage} />
          <div className="setting">
            <span className="setting-label" id="setting-volume">
              {strings.volume}
            </span>
            <div className="stepper" role="group" aria-labelledby="setting-volume">
              <Button runtime={runtime} id="volume-down" disabled={volume <= 0} label={strings.volumeDown}>
                <span aria-hidden="true">−</span>
              </Button>
              <output className="stepper-value">{percent}%</output>
              <Button runtime={runtime} id="volume-up" disabled={volume >= 1} label={strings.volumeUp}>
                <span aria-hidden="true">+</span>
              </Button>
            </div>
          </div>
          <div className="setting">
            <span className="setting-label">{strings.visuals}</span>
            <Button
              runtime={runtime}
              id="calm"
              className={calm ? 'toggle-on' : undefined}
              label={`${strings.visuals}: ${visuals}`}
            >
              {calm ? strings.calm : strings.standard}
            </Button>
          </div>
          <div className="setting">
            <span className="setting-label">{strings.menuHand}</span>
            <Button
              runtime={runtime}
              id="hand"
              label={`${strings.menuHand}: ${hand === 'left' ? strings.handLeft : strings.handRight}`}
            >
              {hand === 'left' ? strings.handLeft : strings.handRight}
            </Button>
          </div>
        </>
      ),
    },
  ];
  if (state === 'SELECT')
    pages.push({
      id: 'settings-camera',
      label: strings.cameraPage,
      content: (
        <>
          <RailHeading eyebrow={strings.settings} title={strings.cameraPage} />
          <Button
            runtime={runtime}
            id="camera"
            nativeOnly={!camera.calibrationValid}
            disabled={camera.state === 'setting-up'}
            busy={camera.state === 'setting-up'}
          >
            {camera.calibrationValid ? strings.cameraReconfigure : strings.cameraSetup}
          </Button>
          {!camera.calibrationValid && <p className="note native-note">{strings.nativeCamera}</p>}
          <Button runtime={runtime} id="start" disabled={!canStartLive}>
            {strings.startLive}
          </Button>
          {!canStartLive && <p className="note">{strings.startRequirements}</p>}
          <Button runtime={runtime} id="camera-off" disabled={!camera.calibrationValid}>
            {strings.cameraOff}
          </Button>
        </>
      ),
    });
  pages.push({
    id: 'settings-more',
    label: strings.morePage,
    content: (
      <>
        <RailHeading eyebrow={strings.settings} title={strings.morePage} />
        <Button runtime={runtime} id="credits">
          {strings.credits}
        </Button>
        {state !== 'SELECT' && (
          <Button runtime={runtime} id="camera-off" disabled={!camera.calibrationValid}>
            {strings.cameraOff}
          </Button>
        )}
        {diagnostics && (
          <>
            <Button runtime={runtime} id="evidence">
              {strings.exportEvidence}
            </Button>
            <p className="note">{strings.diagnosticsLimit}</p>
          </>
        )}
      </>
    ),
  });
  return pages;
}
/**
 * Shared frame: left rail, protected figure stage, right rail. Compact viewports reflow the rails above and
 * below the stage (never over it) with full-size targets and inline paging.
 */
export function MenuShell({
  runtime,
  left,
  right,
  leftPages,
  rightPages,
  compactPages,
  compactTop,
  compactTopPages,
  compactStatus,
  ownErrors = false,
}: {
  runtime: GameRuntime;
  left?: ReactNode;
  right?: ReactNode;
  leftPages?: readonly MenuPage[];
  rightPages?: readonly MenuPage[];
  /** Grouped bottom-row pages for compact layouts; defaults to the right rail pages. */
  compactPages?: readonly MenuPage[];
  /** Non-interactive compact summary above the figure. */
  compactTop?: ReactNode | undefined;
  /** Interactive compact pages above the figure (for example song cards). */
  compactTopPages?: readonly MenuPage[] | undefined;
  /** Persistent compact status line above the bottom row. */
  compactStatus?: ReactNode;
  /** The screen renders its own error notice; the shell then shows only transient status. */
  ownErrors?: boolean;
}) {
  const compact = useCompactMenu();
  const state = useStore((s) => s.state);
  const mode = useStore((s) => s.camera.mode);
  useStore((s) => s.status);
  useStore((s) => s.countdown);
  const armed = runtime.startArmed || runtime.resumeArmed;
  const settings = useSettingsPages(runtime, !armed && state !== 'CALIBRATION');
  const leftContent = leftPages ?? [{ id: 'left', label: strings.library, content: left }];
  const rightContent = rightPages ?? [{ id: 'right', label: strings.ready, content: right }];
  if (compact) {
    const bottom = [...(compactPages ?? rightContent), ...settings];
    return (
      <main className="menu-shell compact-shell">
        <section className="rail compact-top">
          {compactTop ?? (
            <RailPager
              key={`${state}:top`}
              runtime={runtime}
              id="compact-top"
              pages={compactTopPages ?? leftContent}
              variant="inline"
            />
          )}
        </section>
        <Figure runtime={runtime} />
        <section className="rail compact-bottom">
          {compactStatus && <div className="compact-status">{compactStatus}</div>}
          <RailPager
            key={`${state}:${mode}:${armed}`}
            runtime={runtime}
            id="compact"
            pages={bottom}
            showStatus
            statusErrors={!ownErrors}
            variant="inline"
          />
        </section>
      </main>
    );
  }
  return (
    <main className="menu-shell">
      <section className="rail left-rail">
        <RailPager runtime={runtime} id="left" pages={leftContent} />
      </section>
      <Figure runtime={runtime} />
      <section className="rail right-rail">
        <RailPager
          key={`${state}:${mode}:${armed}`}
          runtime={runtime}
          id="right"
          pages={[...rightContent, ...settings]}
          showStatus
          statusErrors={!ownErrors}
        />
      </section>
    </main>
  );
}
