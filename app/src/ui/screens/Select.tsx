import { useShallow } from 'zustand/react/shallow';
import type { GameRuntime } from '../../core/runtime';
import type { BundledTrackEntry } from '../../beatmap/types';
import { MENU_LIBRARY_PAGE_SIZE } from '../../core/constants';
import { useStore } from '../../state/store';
import { Button, MenuShell, RailHeading } from '../components/MenuShell';
import type { MenuPage } from '../components/MenuShell';
import { CoverArt } from '../components/CoverArt';
import { duration, strings as t } from '../strings';
/** `cut` marks the bundled source of the currently prepared 80-second arrangement. */
type TrackState = 'idle' | 'selected' | 'loading' | 'failed' | 'cut';
function SongCard({
  runtime,
  track,
  state,
}: {
  runtime: GameRuntime;
  track: BundledTrackEntry;
  state: TrackState;
}) {
  const tag =
    state === 'loading'
      ? t.trackLoadingTag
      : state === 'failed'
        ? t.trackFailedTag
        : state === 'cut'
          ? t.arrangementReady
          : state === 'selected'
            ? t.selected
            : '';
  return (
    <Button
      runtime={runtime}
      id={`song:${track.slug}`}
      selected={state !== 'idle'}
      busy={state === 'loading'}
      className={`song-card${state === 'failed' ? ' failed' : ''}`}
    >
      <CoverArt track={track} />
      <span className="song-copy">
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
        {state === 'loading' || state === 'failed' || state === 'cut' ? (
          <small className={`song-tag ${state}`}>{tag}</small>
        ) : (
          <small>
            {duration(track.durationMs)}
            <span className="song-meta-tempo">
              {' · '}
              {track.bpm !== null ? `${track.bpm} ${t.bpm}` : t.tempoUnclear}
            </span>
          </small>
        )}
      </span>
      {(state === 'selected' || state === 'cut') && (
        <span className="song-check" aria-label={tag}>
          <span aria-hidden="true">✓</span>
        </span>
      )}
    </Button>
  );
}
export function Select({ runtime }: { runtime: GameRuntime }) {
  const s = useStore(
    useShallow((s) => ({
      library: s.library,
      libraryLoading: s.libraryLoading,
      libraryError: s.libraryError,
      selectedSlug: s.selectedSlug,
      map: s.map,
      difficulty: s.difficulty,
      loading: s.loading,
      error: s.error,
      camera: s.camera,
      cameraStage: s.cameraStage,
      calibrationReady: s.calibrationReady,
      audioReady: s.audioReady,
      trackingReady: s.trackingReady,
      figureAvailable: s.figureAvailable,
      leftPresent: s.hud.leftPresent,
      rightPresent: s.hud.rightPresent,
      preview: s.preview,
      warnings: s.warnings,
      generation: s.generation,
      hand: s.hand,
      fatal: s.fatal,
      arrangement: s.arrangement,
    })),
  );
  const selected = s.library.find((track) => track.slug === s.selectedSlug);
  // A prepared cut replaces the selection with its edited audio; keep its bundled source identifiable.
  const cutSource =
    !s.selectedSlug && s.arrangement?.ready && s.map
      ? s.library.find((track) => track.title === s.arrangement?.sourceTitle)
      : undefined;
  const selectionFailed = !!s.selectedSlug && !s.map && !s.loading && !!s.error;
  const trackState = (slug: string): TrackState =>
    slug === cutSource?.slug
      ? 'cut'
      : slug !== s.selectedSlug
        ? 'idle'
        : s.loading
          ? 'loading'
          : selectionFailed
            ? 'failed'
            : 'selected';
  const cards = s.library.map((track) => (
    <SongCard key={track.slug} runtime={runtime} track={track} state={trackState(track.slug)} />
  ));
  const cardPages: MenuPage[] = [];
  for (let start = 0; start < cards.length; start += MENU_LIBRARY_PAGE_SIZE)
    cardPages.push({
      id: `library-${start}`,
      label: t.library,
      content: <div className="song-list">{cards.slice(start, start + MENU_LIBRARY_PAGE_SIZE)}</div>,
    });
  const statusPages: MenuPage[] = [];
  if (s.libraryError)
    statusPages.push({
      id: 'library-error',
      label: t.library,
      content: (
        <div className="notice danger" role="alert">
          <p>{t.libraryError}</p>
          <p className="detail">{s.libraryError}</p>
          <Button runtime={runtime} id="library-retry">
            {t.retry}
          </Button>
        </div>
      ),
    });
  else if (s.libraryLoading)
    statusPages.push({
      id: 'library-loading',
      label: t.library,
      content: (
        <p className="notice busy-line" role="status">
          {t.loading}
        </p>
      ),
    });
  const upload = (
    <div className="upload-control">
      <label htmlFor="audio-file" className="visually-hidden">
        {t.upload}
      </label>
      <input
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a"
        id="audio-file"
        aria-describedby="audio-file-help"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void runtime.chooseUpload(file);
          event.target.value = '';
        }}
      />
      <p id="audio-file-help" className="note native-note">
        {t.uploadFormats} · {t.nativeOnly}
      </p>
    </div>
  );
  const generation = s.generation.active && (
    <div className="generation">
      <p role="status">
        {t.generating} · {Math.round(s.generation.fraction * 100)}%
      </p>
      <span className="meter" aria-hidden="true">
        <i style={{ transform: `scaleX(${s.generation.fraction})` }} />
      </span>
      <Button runtime={runtime} id="cancel-generation">
        {t.stopGeneration}
      </Button>
    </div>
  );
  const uploadPage: MenuPage = {
    id: 'upload',
    label: t.upload,
    content: (
      <>
        {upload}
        {generation}
      </>
    ),
  };
  const libraryPages: MenuPage[] = [...statusPages, ...cardPages, uploadPage].map((page) => ({
    ...page,
    content: (
      <>
        <RailHeading level={1} eyebrow={t.musicLibrary} title={page.id === 'upload' ? t.upload : t.library} />
        {page.content}
      </>
    ),
  }));
  const sound = s.audioReady ? (
    <Button runtime={runtime} id="preview" disabled={!s.map || s.loading} selected={s.preview}>
      {s.preview ? t.stopPreview : t.preview}
    </Button>
  ) : (
    <Button runtime={runtime} id="audio" nativeOnly className="native">
      <span>{t.enableAudio}</span>
      <small>{t.nativeShort}</small>
    </Button>
  );
  const preparing = !!s.arrangement?.active;
  const start = (
    <Button
      runtime={runtime}
      id="dataset-trial"
      primary
      busy={preparing}
      disabled={!s.map || s.loading || !s.audioReady}
      className="hero"
      describedBy="trial-reason"
    >
      <span className="hero-label">{t.datasetTrial}</span>
      <small>{t.datasetTrialCaption}</small>
    </Button>
  );
  const live = s.camera.calibrationValid;
  const cameraButton = (
    <Button
      runtime={runtime}
      id="camera"
      nativeOnly={!live}
      disabled={s.camera.state === 'setting-up'}
      busy={s.camera.state === 'setting-up'}
      className="with-caption"
    >
      <span>{live ? t.cameraReconfigure : t.cameraSetup}</span>
      <small>{live ? t.cameraReady : t.cameraSetupCaption}</small>
    </Button>
  );
  const liveStart = (
    <Button
      runtime={runtime}
      id="start"
      primary
      disabled={!s.map || s.loading || !s.audioReady || !s.trackingReady}
      className="hero"
      describedBy="trial-reason"
    >
      <span className="hero-label">{t.startLive}</span>
      <small>{t.startLiveCaption}</small>
    </Button>
  );
  const hero = live ? liveStart : start;
  const performer = (
    <Button
      runtime={runtime}
      id="performer-trial"
      disabled={!s.map || s.loading || !s.audioReady}
      busy={preparing}
      className="with-caption"
    >
      <span>{t.performerTrial}</span>
      <small>{t.performerTrialCaption}</small>
    </Button>
  );
  const arrange = (
    <Button runtime={runtime} id="arrange" disabled={!s.map || s.loading || preparing} busy={preparing}>
      {t.arrange}
    </Button>
  );
  const retrySelection = selectionFailed && s.selectedSlug && (
    <Button
      runtime={runtime}
      id="selection-retry"
      onAction={(source) => void runtime.command(`song:${s.selectedSlug}`, source)}
    >
      {t.retryTrack}
    </Button>
  );
  const errorText = s.error || s.camera.error || s.arrangement?.error;
  const guard = s.loading
    ? t.trackLoading
    : !s.map
      ? s.selectedSlug
        ? ''
        : t.startNoTrack
      : !s.audioReady
        ? t.startNoAudio
        : '';
  const notice = errorText ? (
    <div className="notice danger" role="alert" id="trial-reason">
      <p>
        {selectionFailed && <strong>{t.selectionFailed} </strong>}
        {errorText}
      </p>
      {retrySelection}
    </div>
  ) : (
    <p className={`notice${s.loading ? ' busy-line' : ''}`} role="status" id="trial-reason">
      {guard}
    </p>
  );
  const title = selected?.title ?? s.map?.song.title ?? t.selectTrack;
  const coverSource = selected ?? cutSource ?? { slug: title, title };
  const arrangementChip = s.arrangement?.active ? (
    <span className="chip busy-chip">
      {t.arrangementPreparing} · {Math.round(s.arrangement.fraction * 100)}%
    </span>
  ) : s.arrangement?.ready ? (
    <span className="chip cyan">
      {t.arrangementReady} · {duration(s.arrangement.durationMs ?? 0)}
    </span>
  ) : null;
  const trackHeader = (
    <div className="track-header">
      {(selected || s.map) && <CoverArt track={coverSource} size="large" />}
      <div className="track-copy">
        <span className="eyebrow">{t.selectedTrack}</span>
        <h2>{title}</h2>
        {s.map ? (
          <p className="meta">
            {duration(s.map.song.durationMs)} · {s.map.notes.length} {t.notes}
            {(selected ?? cutSource)?.artist ? ` · ${(selected ?? cutSource)!.artist}` : ''}
          </p>
        ) : selected ? (
          <p className="meta">{selected.artist}</p>
        ) : null}
      </div>
    </div>
  );
  const chips = (s.warnings.includes('lowTempoConfidence') ||
    s.warnings.includes('cacheUnavailable') ||
    arrangementChip) && (
    <div className="chips">
      {arrangementChip}
      {s.warnings.includes('lowTempoConfidence') && <span className="chip gold">{t.fallback}</span>}
      {s.warnings.includes('cacheUnavailable') && (
        <span className="chip gold" role="status">
          {t.cacheUnavailable}
        </span>
      )}
    </div>
  );
  const difficulties = (['easy', 'normal', 'hard'] as const).map((difficulty) => (
    <Button
      key={difficulty}
      runtime={runtime}
      id={`difficulty:${difficulty}`}
      selected={s.difficulty === difficulty}
      disabled={s.loading}
    >
      {t[difficulty]}
    </Button>
  ));
  const difficulty = (
    <div className="setting difficulty" role="group" aria-labelledby="difficulty-label">
      <span className="setting-label" id="difficulty-label">
        {t.difficulty}
      </span>
      <div className="segmented">{difficulties}</div>
    </div>
  );
  const readyPage: MenuPage = {
    id: 'ready',
    label: t.ready,
    content: (
      <>
        {trackHeader}
        {chips}
        {difficulty}
        <div className="action-pair">
          {sound}
          {cameraButton}
        </div>
        {hero}
        {performer}
        {live && start}
        {notice}
      </>
    ),
  };
  // The trial prepares its own cut; the explicit preparation lives on its own page with its explanation.
  const cutPage: MenuPage = {
    id: 'cut',
    label: t.arrange,
    content: (
      <>
        <RailHeading eyebrow={t.musicOptions} title={t.arrange} />
        <p className="note">{t.arrangementAbout}</p>
        {arrangementChip && <div className="chips">{arrangementChip}</div>}
        {arrange}
      </>
    ),
  };
  let rightPages: MenuPage[] = [readyPage, cutPage];
  const status = (
    <>
      <p className="compact-track">
        <strong>{title}</strong>
        {s.map && (
          <span>
            {' '}
            · {t[s.difficulty]} · {duration(s.map.song.durationMs)}
          </span>
        )}
      </p>
      {chips}
      {notice}
    </>
  );
  let compactPages: MenuPage[] = [
    {
      id: 'play',
      label: t.playPage,
      content: (
        <>
          {sound}
          {cameraButton}
          {hero}
          {performer}
        </>
      ),
    },
    { id: 'difficulty', label: t.difficulty, content: <>{difficulties}</> },
    {
      id: 'cut',
      label: t.arrange,
      content: (
        <>
          {arrange}
          <p className="note">{t.arrangementAbout}</p>
        </>
      ),
    },
  ];
  let compactStatus = status;
  if (s.camera.mode === 'camera-setup') {
    const confirm = (
      <Button runtime={runtime} id="camera-confirm" disabled={!s.calibrationReady} primary>
        {t.calibrate}
      </Button>
    );
    const cancel = (
      <Button runtime={runtime} id="camera-cancel">
        {t.cancel}
      </Button>
    );
    const hand = (
      <Button runtime={runtime} id="hand">
        {s.hand === 'right' ? t.handRight : t.handLeft}
      </Button>
    );
    const checks = [
      [t.checkBody, s.figureAvailable],
      [t.checkSteady, s.calibrationReady],
    ] as const;
    const checklist = (
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
    const readiness = (
      <p className={`notice${s.calibrationReady ? ' success' : ''}`} role="status">
        {s.calibrationReady ? t.framingReady : t.calibrationPending}
      </p>
    );
    rightPages = [
      {
        id: 'camera-setup',
        label: t.calibrationTitle,
        content: (
          <>
            <RailHeading eyebrow={t.cameraSetup} title={t.calibrationTitle} />
            {s.cameraStage && <p className="note busy-line">{s.cameraStage}</p>}
            {checklist}
            {readiness}
            {confirm}
            {cancel}
          </>
        ),
      },
      {
        id: 'camera-hand',
        label: t.cameraSettings,
        content: (
          <>
            <RailHeading eyebrow={t.cameraSettings} title={t.menuHand} />
            {hand}
            <p className="note">{t.menuHelp}</p>
            <p className="note">{t.cameraPrivacy}</p>
          </>
        ),
      },
    ];
    compactPages = [
      {
        id: 'setup-confirm',
        label: t.calibrate,
        content: (
          <>
            {confirm}
            {cancel}
            {hand}
          </>
        ),
      },
    ];
    compactStatus = (
      <>
        {checklist}
        {readiness}
      </>
    );
  }
  if (errorText && s.camera.mode === 'camera-setup')
    rightPages[0] = {
      ...rightPages[0]!,
      content: (
        <>
          {rightPages[0]!.content}
          <div className="notice danger" role="alert">
            <p>{errorText}</p>
          </div>
        </>
      ),
    };
  const leftSetup: MenuPage[] = [
    {
      id: 'positioning',
      label: t.calibrationTitle,
      content: (
        <>
          <RailHeading level={1} eyebrow={t.cameraSetup} title={t.liveCameraMode} />
          <p className="lead">{t.positioning}</p>
          <p className="note">{t.cameraPrivacy}</p>
          <p className="note">{t.safeSpace}</p>
        </>
      ),
    },
  ];
  const setupMode = s.camera.mode === 'camera-setup';
  return (
    <MenuShell
      runtime={runtime}
      leftPages={setupMode ? leftSetup : libraryPages}
      rightPages={rightPages}
      compactTopPages={setupMode ? undefined : [...statusPages, ...cardPages, uploadPage]}
      compactTop={setupMode ? <p className="compact-summary">{t.positioning}</p> : undefined}
      compactPages={compactPages}
      compactStatus={compactStatus}
      ownErrors
    />
  );
}
