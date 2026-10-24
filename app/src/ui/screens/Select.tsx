import { useShallow } from 'zustand/react/shallow';
import type { GameRuntime } from '../../core/runtime';
import { MENU_LIBRARY_PAGE_SIZE } from '../../core/constants';
import { useStore } from '../../state/store';
import { Button, MenuShell } from '../components/MenuShell';
import type { MenuPage } from '../components/MenuShell';
import { duration, strings as t } from '../strings';
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
      preview: s.preview,
      warnings: s.warnings,
      generation: s.generation,
      hand: s.hand,
      fatal: s.fatal,
      arrangement: s.arrangement,
    })),
  );
  const selected = s.library.find((track) => track.slug === s.selectedSlug);
  const songs: MenuPage[] = s.library.map((track) => ({
    id: `song-${track.slug}`,
    label: track.title,
    content: (
      <div className="song-item">
        <Button runtime={runtime} id={`song:${track.slug}`} selected={s.selectedSlug === track.slug}>
          <span className={`song-art ${track.role}`} aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <path
                d={
                  track.role === 'intro'
                    ? 'M10 40L25 12L38 50L53 24'
                    : track.role === 'groove'
                      ? 'M12 15H52V49H12ZM22 24V40M32 24V40M42 24V40'
                      : 'M32 8L54 32L32 56L10 32ZM32 20L42 32L32 44L22 32Z'
                }
              />
            </svg>
          </span>
          <span className="song-copy">
            <strong>{track.title}</strong>
            <span>{track.artist}</span>
            <small>
              {duration(track.durationMs)}
              {track.bpm !== null ? ` · ${track.bpm} BPM` : ''}
            </small>
          </span>
          {s.selectedSlug === track.slug && (
            <span className="selected-mark" aria-label={t.selected}>
              ✓
            </span>
          )}
        </Button>
      </div>
    ),
  }));
  const libraryPages: MenuPage[] = [];
  for (let start = 0; start < songs.length; start += MENU_LIBRARY_PAGE_SIZE)
    libraryPages.push({
      id: `library-${start}`,
      label: t.library,
      content: (
        <>
          <h1>{t.library}</h1>
          <div className="song-list">
            {songs.slice(start, start + MENU_LIBRARY_PAGE_SIZE).map((page) => (
              <div key={page.id}>{page.content}</div>
            ))}
          </div>
        </>
      ),
    });
  if (s.libraryLoading)
    libraryPages.unshift({
      id: 'library-loading',
      label: t.library,
      content: <p role="status">{t.loading}</p>,
    });
  if (s.libraryError)
    libraryPages.unshift({
      id: 'library-error',
      label: t.library,
      content: (
        <>
          <p className="error" role="alert">
            {t.libraryError}
          </p>
          <Button runtime={runtime} id="library-retry">
            {t.retry}
          </Button>
        </>
      ),
    });
  const upload = (
    <div className="upload-control">
      <label htmlFor="audio-file">{t.upload}</label>
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
      <p id="audio-file-help" className="subtle">
        {t.uploadFormats} · {t.nativeOnly}
      </p>
    </div>
  );
  libraryPages.push({ id: 'upload', label: t.upload, content: upload });
  const generation = (
    <>
      <p role="status">
        {t.generating} · {Math.round(s.generation.fraction * 100)}%
      </p>
      <progress aria-label={t.generating} value={s.generation.fraction} max="1" />
      <Button runtime={runtime} id="cancel-generation">
        {t.stopGeneration}
      </Button>
    </>
  );
  if (s.generation.active) libraryPages.push({ id: 'generation', label: t.generating, content: generation });
  const sound = s.audioReady ? (
    <Button runtime={runtime} id="preview" disabled={!s.map || s.loading}>
      {s.preview ? t.stopPreview : t.preview}
    </Button>
  ) : (
    <Button runtime={runtime} id="audio" nativeOnly>
      {t.enableAudio}
    </Button>
  );
  const start = (
    <Button runtime={runtime} id="dataset-trial" primary disabled={!s.map || s.loading || !s.audioReady}>
      {t.datasetTrial}
    </Button>
  );
  const performer = (
    <Button runtime={runtime} id="performer-trial" disabled={!s.map || s.loading || !s.audioReady}>
      {t.performerTrial}
    </Button>
  );
  const trialReason = !s.map ? t.startNoTrack : !s.audioReady ? t.startNoAudio : '';
  const arrange = (
    <Button runtime={runtime} id="arrange" disabled={!s.map || s.loading || !!s.arrangement?.active}>
      {t.arrange}
    </Button>
  );
  const selection = (
    <div className="selected-track">
      <h2>{selected?.title ?? s.map?.song.title ?? t.selectTrack}</h2>
      {s.map && (
        <p className="subtle">
          {duration(s.map.song.durationMs)} · {s.map.notes.length} {t.notes}
        </p>
      )}
    </div>
  );
  const difficulties: MenuPage[] = (['easy', 'normal', 'hard'] as const).map((difficulty) => ({
    id: `difficulty-${difficulty}`,
    label: t.difficulty,
    content: (
      <Button
        runtime={runtime}
        id={`difficulty:${difficulty}`}
        selected={s.difficulty === difficulty}
        disabled={s.loading}
      >
        {t[difficulty]}
      </Button>
    ),
  }));
  const errors = s.error || s.camera.error || s.arrangement?.error;
  const rightPages: MenuPage[] = [
    {
      id: 'ready',
      label: t.ready,
      content: (
        <>
          {selection}
          {sound}
          {start}
          {performer}
          {arrange}
          <p className="guard-reason" role="status">
            {s.loading ? t.trackLoading : trialReason}
          </p>
          {s.arrangement?.active && (
            <p role="status">
              {s.arrangement.stage} · {Math.round(s.arrangement.fraction * 100)}%
            </p>
          )}
          {s.arrangement?.ready && (
            <p className="success" role="status">
              {t.arrangementReady} · {duration(s.arrangement.durationMs ?? 0)}
            </p>
          )}
        </>
      ),
    },
    {
      id: 'difficulty',
      label: t.difficulty,
      content: (
        <>
          <h2>{t.difficulty}</h2>
          <div className="difficulty-options">
            {difficulties.map((page) => (
              <div key={page.id}>{page.content}</div>
            ))}
          </div>
          {s.warnings.includes('lowTempoConfidence') && <p className="subtle">{t.fallback}</p>}
        </>
      ),
    },
  ];
  let compactPages: MenuPage[] = [
    ...songs,
    { id: 'ready-sound', label: s.audioReady ? t.preview : t.enableAudio, content: sound },
    {
      id: 'ready-start',
      label: t.datasetTrial,
      content: (
        <>
          {start}
          <p className="guard-reason">{s.loading ? t.trackLoading : trialReason}</p>
        </>
      ),
    },
    { id: 'ready-performer', label: t.performerTrial, content: performer },
    { id: 'arrange', label: t.arrange, content: arrange },
    { id: 'arrangement-about', label: t.arrange, content: <p>{t.arrangementAbout}</p> },
    ...difficulties,
    { id: 'upload', label: t.upload, content: upload },
  ];
  if (s.libraryLoading || s.libraryError)
    compactPages.unshift(
      ...libraryPages.filter((page) => page.id.startsWith('library-') && page.id !== 'library-0'),
    );
  if (errors)
    compactPages.push({
      id: 'error',
      label: t.retry,
      content: (
        <p className="error" role="alert">
          {errors}
        </p>
      ),
    });
  if (s.generation.active) compactPages.push({ id: 'generation', label: t.generating, content: generation });
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
    const readiness = (
      <p className={s.calibrationReady ? 'success' : 'subtle'} role="status">
        {s.calibrationReady ? t.framingReady : t.calibrationPending}
      </p>
    );
    const setupPages: MenuPage[] = [
      {
        id: 'camera-setup',
        label: t.calibrationTitle,
        content: (
          <>
            <h2>{t.calibrationTitle}</h2>
            <p>{t.positioning}</p>
            <p role="status">{s.cameraStage}</p>
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
            {hand}
            <p className="subtle">{t.menuHelp}</p>
            <p>{t.cameraPrivacy}</p>
          </>
        ),
      },
    ];
    rightPages.splice(0, rightPages.length, ...setupPages);
    compactPages = [
      {
        id: 'setup-confirm',
        label: t.calibrate,
        content: (
          <>
            {readiness}
            {confirm}
          </>
        ),
      },
      { id: 'setup-cancel', label: t.cancel, content: cancel },
      { id: 'setup-hand', label: t.cameraSettings, content: hand },
      { id: 'setup-guide', label: t.positioning, content: <p>{t.positioning}</p> },
      { id: 'setup-status', label: t.cameraSetup, content: <p role="status">{s.cameraStage}</p> },
    ];
  }
  return (
    <MenuShell
      runtime={runtime}
      leftPages={libraryPages}
      rightPages={rightPages}
      compactPages={compactPages}
    />
  );
}
