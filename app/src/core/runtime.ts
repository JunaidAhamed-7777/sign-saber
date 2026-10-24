/** Lifecycle integrator: semantic UI commands own resources, scoring only consumes fresh captures. */
import { StateMachine } from './stateMachine';
import type { PauseReason } from './stateMachine';
import { readFlags } from './flags';
import { Instrumentation } from './loop';
import type { TrackingFrame, SessionStats } from './types';
import type { MenuContext, MenuTarget } from './menuInput';
import { AudioPlayer, computePrerollMs } from '../audio/player';
import { SfxDirector } from '../audio/sfxDirector';
import { decodeForPlayback } from '../audio/decode';
import { arrangeAudio } from '../audio/arrange';
import type { AudioArrangementEdit } from '../audio/arrange';
import { loadBundledLibrary, loadBundledMap, loadBundledAudioBytes } from '../beatmap/bundled';
import type { Difficulty } from '../beatmap/types';
import { GeneratorClient } from '../beatmap/generatorClient';
import { CameraController } from '../tracking/camera';
import { WebcamSource, type CameraSourceKind, type CameraStreamSource } from '../tracking/cameraSource';
import { DatasetCameraSource } from '../tracking/datasetCamera';
import { PhotoReel } from '../tracking/datasetCameraReel';
import { JudgementTraceRecorder } from './judgementTrace';
import { InputPipeline } from '../tracking/pipeline';
import { DatasetTrial } from '../tracking/datasetTrial';
import { PerformerTrial } from '../performer/trial';
import { MenuPointerController } from '../gestures/menuPointer';
import { GameSession } from '../game/session';
import { ArenaRenderer } from '../render/renderer';
import { MenuTargets } from '../ui/menuTargets';
import type { ActionSource } from '../ui/menuTargets';
import { strings } from '../ui/strings';
import { display, useStore } from '../state/store';
import {
  PLAYBACK_DECODE_SR,
  CALIB_PRESENCE_MS,
  COUNTDOWN_STEPS,
  INPUT_MAX_AGE_MS,
  MENU_TRACK_MAX_AGE_MS,
  POP_LIFETIME_MS,
  RESUME_COUNTDOWN_MS,
  TRACKING_LOST_PAUSE_MS,
  TRACK_REGAIN_MS,
  UI_TEXT_HZ,
  START_COUNTDOWN_MS,
  TARGET_FPS,
} from './constants';

export class GameRuntime {
  readonly machine = new StateMachine();
  readonly pointer = new MenuPointerController();
  readonly targets = new MenuTargets(() => this.pointer.cancel(performance.now()));
  readonly pipeline = new InputPipeline();
  readonly camera = new CameraController();
  readonly instrumentation = new Instrumentation();
  readonly trace = new JudgementTraceRecorder();
  readonly flags = readFlags(location.search, import.meta.env.DEV);
  readonly video = document.createElement('video');
  readonly renderer: ArenaRenderer | null;
  private context: AudioContext | null = null;
  private player: AudioPlayer | null = null;
  /** Audio game feel: subscribes to game/menu events itself; see audio/sfxDirector.ts. */
  private readonly sfx = new SfxDirector(this.machine.events, useStore);
  private decoder: OfflineAudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private upload: File | null = null;
  /** Labelled non-camera trial source: COCO still annotations or the synthetic chart performer. */
  private dataset: DatasetTrial | PerformerTrial | null = null;
  private arrangementEdit: AudioArrangementEdit | null = null;
  private readonly generator = new GeneratorClient();
  private session: GameSession | null = null;
  private selectionRequest = 0;
  private bootRequest = 0;
  private setupRequest = 0;
  private lifecycle = 0;
  private audioRequest = 0;
  private lastTracking = -Infinity;
  private lastPresence = -Infinity;
  private readySince = Infinity;
  private freshSince = Infinity;
  private lastUi = 0;
  private lastFrame = 0;
  private animation = 0;
  private resumeAt = Infinity;
  private transitionBusy = false;
  private sessionAudioFailed = false;
  private pauseTask: Promise<void> | null = null;
  private disposed = false;
  private listeners: (() => void)[] = [];
  private stats: SessionStats | null = null;
  private pop = '';
  private popUntil = 0;
  private popSeq = 0;
  private countdownStepMs = START_COUNTDOWN_MS / COUNTDOWN_STEPS;
  private readonly countdownTargets: MenuTarget[] = [];
  private readonly countdownContext: MenuContext = {
    enabled: false,
    screenEpoch: 0,
    layoutEpoch: 0,
    viewport: { left: 0, top: 0, width: 1, height: 1 },
    targets: this.countdownTargets,
  };
  private readonly onFrame = (now: number): void => {
    this.frame(now);
    if (!this.disposed) this.animation = requestAnimationFrame(this.onFrame);
  };

  constructor(container: HTMLElement) {
    try {
      this.renderer = new ArenaRenderer(container, this.machine.events, {
        tier: this.flags.tier,
        contrast: this.flags.contrast,
      });
    } catch (error) {
      this.renderer = null;
      display({ fatal: this.message(error) || strings.fatalHint });
    }
    let calm: string | null = null;
    try {
      calm = localStorage.getItem('ss:calm');
    } catch {
      /* Storage is optional. */
    }
    display({
      calm: matchMedia('(prefers-reduced-motion: reduce)').matches || calm === 'true',
      difficulty: this.flags.difficulty,
      stats: this.flags.stats,
      replay: !!this.flags.replay,
    });
    this.trace.attach(this.machine.events);
    if (this.flags.stats) this.exposeDiagnostics();
    this.machine.events.on('state:change', () => {
      const state = this.machine.state;
      this.targets.surface(this.machine.epoch);
      this.pointer.cancel(performance.now());
      display({ state, epoch: this.machine.epoch, pauseReason: this.machine.pauseReason, countdown: null });
      this.renderer?.setMode(
        state === 'PLAYING' || (state === 'CALIBRATION' && !!this.session)
          ? 'play'
          : state === 'PAUSED'
            ? 'paused'
            : state === 'RESULTS'
              ? 'results'
              : 'menu',
      );
    });
    this.machine.events.on('note:hit', (event) => {
      this.pop = event.judgement;
      this.popUntil = performance.now() + POP_LIFETIME_MS;
      this.popSeq++;
    });
    this.machine.events.on('note:miss', () => {
      this.pop = 'miss';
      this.popUntil = performance.now() + POP_LIFETIME_MS;
      this.popSeq++;
    });
    this.machine.events.on('note:badcut', () => {
      this.pop = 'badcut';
      this.popUntil = performance.now() + POP_LIFETIME_MS;
      this.popSeq++;
    });
    this.machine.events.on('music:event', (event) => {
      if (event.kind === 'drop') this.player?.duck();
    });
    this.machine.events.on('beam:fire', (event) => this.pipeline.beamFired(event.hand, this.lastTracking));
    this.machine.events.on('highlight:capture', () =>
      display({ highlightAt: this.renderer?.highlightTimeMs ?? null }),
    );
    this.machine.events.on('session:end', (stats) => {
      this.stats = structuredClone(stats);
      this.renderer?.finish(stats);
      display({ highlightAt: this.renderer?.highlightTimeMs ?? null });
    });
    const native = (): void => this.pointer.cancel(performance.now(), true);
    const resize = (): void => {
      this.renderer?.resize();
      this.targets.invalidate();
    };
    const hidden = (): void => {
      native();
      this.readySince = this.freshSince = Infinity;
      if (document.hidden) {
        if (this.machine.state === 'PLAYING') void this.pause('hidden');
        else if (this.machine.state === 'CALIBRATION') this.back();
        else if (this.machine.state === 'SELECT') this.stopPreview();
      }
      this.camera.setCaptureVisible(!document.hidden);
    };
    const blur = (): void => {
      native();
      if (this.machine.state === 'PLAYING') void this.pause('manual');
    };
    const keyboard = (event: KeyboardEvent): void => {
      if (
        event.isComposing ||
        (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))
      )
        return;
      if (useStore.getState().credits) {
        if (event.code === 'Escape') {
          event.preventDefault();
          void this.command('credits');
        }
        return;
      }
      if ((event.code === 'Escape' || event.code === 'Space') && this.machine.state === 'PLAYING') {
        event.preventDefault();
        void this.pause('manual');
      } else if (event.code === 'Escape' && this.machine.state === 'CALIBRATION') {
        event.preventDefault();
        this.back();
      } else if (
        event.code === 'Escape' &&
        (this.machine.state === 'RESULTS' || this.machine.state === 'PAUSED')
      ) {
        event.preventDefault();
        this.songs();
      } else if (
        event.code === 'Enter' &&
        this.machine.state === 'RESULTS' &&
        !(event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault();
        void this.command('retry', 'native');
      } else if (event.code === 'KeyD' && import.meta.env.DEV) display({ stats: !useStore.getState().stats });
    };
    const observe = (
      target: EventTarget,
      name: string,
      listener: EventListener,
      options?: AddEventListenerOptions,
    ): void => {
      target.addEventListener(name, listener, options);
      this.listeners.push(() => target.removeEventListener(name, listener, options));
    };
    for (const event of ['pointerdown', 'keydown', 'wheel', 'scroll'])
      observe(window, event, native, { capture: true, passive: true });
    observe(window, 'resize', resize);
    observe(window, 'scroll', () => this.targets.invalidate(), { capture: true, passive: true });
    observe(window, 'blur', blur);
    observe(document, 'visibilitychange', hidden);
    observe(window, 'keydown', keyboard as EventListener);
    if (window.visualViewport) {
      observe(window.visualViewport, 'resize', resize);
      observe(window.visualViewport, 'scroll', resize);
    }
    this.animation = requestAnimationFrame(this.onFrame);
  }

  async boot(): Promise<void> {
    if (this.disposed) return;
    const request = ++this.bootRequest;
    display({ libraryLoading: true, libraryError: null });
    try {
      const library = await loadBundledLibrary();
      if (!this.disposed && request === this.bootRequest) display({ library });
    } catch (error) {
      if (!this.disposed && request === this.bootRequest) display({ libraryError: this.message(error) });
    }
    if (this.disposed || request !== this.bootRequest) return;
    display({ libraryLoading: false });
    // A bad catalog has a useful SELECT upload/retry path; a missing renderer is a truthful BOOT failure.
    if (this.machine.state === 'BOOT')
      this.machine.transition(this.renderer ? 'boot:ready' : 'boot:error', { ready: !!this.renderer });
  }
  setStage(stage: HTMLElement | null): void {
    this.renderer?.setStage(stage);
    this.targets.invalidate();
  }
  get startArmed(): boolean {
    return this.machine.state === 'CALIBRATION' && this.session !== null;
  }
  get resumeArmed(): boolean {
    return this.machine.state === 'PAUSED' && this.resumeAt !== Infinity;
  }
  get datasetTrialActive(): boolean {
    return this.dataset !== null;
  }
  async command(id: string, source: ActionSource = 'native'): Promise<void> {
    if (this.disposed) return;
    try {
      if (id.startsWith('song:')) {
        if (this.machine.state === 'SELECT') await this.select(id.slice(5));
        return;
      }
      if (id.startsWith('difficulty:')) {
        if (this.machine.state === 'SELECT') await this.difficulty(id.slice(11) as Difficulty);
        return;
      }
      switch (id) {
        case 'library-retry':
          await this.boot();
          break;
        case 'camera':
        case 'camera-dataset':
          if (this.machine.state === 'SELECT' && (source === 'native' || !!this.camera.identity))
            await this.setup(id === 'camera-dataset' ? 'dataset' : this.flags.camera);
          else display({ status: strings.nativeCamera });
          break;
        case 'camera-confirm':
          this.confirmCamera();
          break;
        case 'camera-cancel':
          this.cancelSetup();
          break;
        case 'camera-off':
          this.stopCamera();
          break;
        case 'audio':
          if (source === 'native') await this.enableAudio();
          else display({ status: strings.nativeSound });
          break;
        case 'preview':
          await this.preview();
          break;
        case 'start':
          await this.begin(false);
          break;
        case 'dataset-trial':
          await this.beginDataset(false, 'annotations');
          break;
        case 'performer-trial':
          await this.beginDataset(false, 'performer');
          break;
        case 'arrange':
          await this.makeArrangement();
          break;
        case 'confirm':
          await this.countIn();
          break;
        case 'back':
          this.back();
          break;
        case 'resume':
          await this.resume();
          break;
        case 'cancel-resume':
          this.cancelResume();
          break;
        case 'songs':
          this.songs();
          break;
        case 'retry':
          if (this.dataset)
            await this.beginDataset(
              true,
              this.dataset instanceof PerformerTrial ? 'performer' : 'annotations',
            );
          else await this.begin(true);
          break;
        case 'calm': {
          const systemReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
          const calm = systemReduced || !useStore.getState().calm;
          try {
            localStorage.setItem('ss:calm', String(calm));
          } catch {
            /* Storage is optional. */
          }
          display({ calm, ...(systemReduced ? { status: strings.calmSystem } : {}) });
          break;
        }
        case 'hand': {
          const hand = useStore.getState().hand === 'right' ? 'left' : 'right';
          this.pointer.setHand(hand, performance.now());
          display({ hand });
          break;
        }
        case 'credits':
          if (!['SELECT', 'PAUSED', 'RESULTS'].includes(this.machine.state)) break;
          display({ credits: !useStore.getState().credits });
          this.targets.surface(this.machine.epoch + (useStore.getState().credits ? 1 : 0));
          this.targets.invalidate();
          break;
        case 'cancel-generation':
          if (this.machine.state === 'SELECT') this.cancelGeneration();
          break;
        case 'volume-down':
          this.volume(-0.1);
          break;
        case 'volume-up':
          this.volume(0.1);
          break;
        case 'evidence':
          await this.exportEvidence();
          break;
      }
    } catch (error) {
      if (!this.disposed) display({ error: this.message(error) });
    }
  }
  private ensureAudio(): AudioPlayer {
    if (!this.context) {
      this.context = new AudioContext();
      this.player = new AudioPlayer(this.context);
      this.player.setVolume(useStore.getState().volume);
      this.sfx.attach(this.context, this.player.master);
      this.context.onstatechange = () => {
        if (this.context?.state === 'running' || this.disposed) return;
        display({ audioReady: false });
        if (this.machine.state === 'PLAYING') void this.pause('audio');
        else if (this.machine.state === 'CALIBRATION' && this.session)
          this.cancelArmedStart(strings.soundStopped);
      };
    }
    return this.player!;
  }
  private async enableAudio(): Promise<void> {
    if (this.machine.state === 'PAUSED') {
      await this.resume();
      return;
    }
    if (this.machine.state === 'PLAYING' || this.machine.state === 'BOOT') return;
    if (this.machine.state === 'CALIBRATION' && this.session) this.cancelArmedStart(strings.soundThenConfirm);
    const request = ++this.audioRequest;
    // The initial path has no pending pause: create/resume synchronously inside the native handler.
    if (this.pauseTask) await this.pauseTask;
    if (this.disposed || request !== this.audioRequest) return;
    const player = this.ensureAudio();
    await player.context.resume();
    if (this.disposed || request !== this.audioRequest) return;
    if (player.context.state !== 'running') throw new Error(strings.startNoAudio);
    display({ audioReady: true, error: null, status: strings.soundEnabledStatus });
  }
  private getDecoder(): BaseAudioContext {
    // Decode through the live context when it exists; otherwise a full-band offline decoder.
    if (this.context) return this.context;
    if (!this.decoder) this.decoder = new OfflineAudioContext(1, 1, PLAYBACK_DECODE_SR);
    return this.decoder;
  }
  private selectionCurrent(request: number): boolean {
    return !this.disposed && this.machine.state === 'SELECT' && request === this.selectionRequest;
  }
  private async select(slug: string): Promise<void> {
    const track = useStore.getState().library.find((entry) => entry.slug === slug);
    if (!track) return;
    const request = ++this.selectionRequest;
    this.generator.cancel();
    this.stopPreview();
    this.buffer = null;
    this.upload = null;
    this.arrangementEdit = null;
    display({
      selectedSlug: slug,
      map: null,
      loading: true,
      error: null,
      warnings: track.warnings,
      generation: { active: false, stage: '', fraction: 0 },
      arrangement: null,
    });
    try {
      const difficulty = useStore.getState().difficulty;
      const [map, bytes] = await Promise.all([
        loadBundledMap(track, difficulty),
        loadBundledAudioBytes(track),
      ]);
      if (!this.selectionCurrent(request)) return;
      const buffer = await decodeForPlayback(bytes, this.getDecoder());
      if (!this.selectionCurrent(request)) return;
      if (Math.abs(buffer.duration * 1000 - track.durationMs) > 50) {
        if (import.meta.env.DEV)
          console.warn(
            'Bundled audio duration mismatch',
            JSON.stringify({
              slug: track.slug,
              decodedDurationMs: buffer.duration * 1000,
              packagedDurationMs: track.durationMs,
              sampleRate: buffer.sampleRate,
              decodedSamples: buffer.length,
              deltaMs: buffer.duration * 1000 - track.durationMs,
            }),
          );
        throw new Error(strings.durationMismatch);
      }
      this.buffer = buffer;
      this.player?.prepare(buffer);
      display({ map, loading: false });
    } catch (error) {
      if (this.selectionCurrent(request)) display({ error: this.message(error), loading: false, map: null });
    }
  }
  private async difficulty(difficulty: Difficulty): Promise<void> {
    if (!['easy', 'normal', 'hard'].includes(difficulty) || difficulty === useStore.getState().difficulty)
      return;
    display({ difficulty });
    const slug = useStore.getState().selectedSlug;
    if (this.upload) await this.chooseUpload(this.upload);
    else if (slug) await this.select(slug);
  }
  private async makeArrangement(): Promise<void> {
    const state = useStore.getState(),
      source = this.buffer,
      map = state.map;
    if (this.machine.state !== 'SELECT' || !source || !map || state.loading || state.arrangement?.ready)
      return;
    const request = ++this.selectionRequest;
    this.stopPreview();
    this.generator.cancel();
    display({
      loading: true,
      error: null,
      arrangement: {
        active: true,
        stage: strings.arrangementRendering,
        fraction: 0,
        ready: false,
        sourceTitle: map.song.title,
        durationMs: null,
        error: null,
      },
    });
    try {
      const result = await arrangeAudio(
        source,
        { ...map.analysis, tempoConfidence: 0 },
        {
          sourceAudioSha256: map.song.sourceHash,
          title: map.song.title,
          artist: map.song.artist,
          source: map.song.source,
          checkCancelled: () => {
            if (!this.selectionCurrent(request)) throw new Error(strings.cancel);
          },
        },
      );
      if (!this.selectionCurrent(request)) return;
      const generated = await this.generator.generate(
        result.file,
        state.difficulty,
        (progress) => {
          if (this.selectionCurrent(request))
            display({
              arrangement: {
                active: true,
                stage: progress.stage,
                fraction: progress.fraction,
                ready: false,
                sourceTitle: map.song.title,
                durationMs: result.edit.outputDurationMs,
                error: null,
              },
            });
        },
        { title: result.edit.outputTitle, artist: result.edit.sourceArtist },
      );
      if (!this.selectionCurrent(request)) return;
      if (generated.map.song.sourceHash !== result.edit.outputAudioSha256)
        throw new Error(strings.arrangementIntegrity);
      this.buffer = generated.buffer;
      this.upload = result.file;
      this.arrangementEdit = result.edit;
      this.player?.prepare(generated.buffer);
      display({
        selectedSlug: null,
        map: generated.map,
        warnings: generated.warnings,
        loading: false,
        arrangement: {
          active: false,
          stage: strings.arrangementReady,
          fraction: 1,
          ready: true,
          sourceTitle: map.song.title,
          durationMs: result.edit.outputDurationMs,
          error: null,
        },
      });
    } catch (error) {
      if (this.selectionCurrent(request))
        display({
          loading: false,
          error: this.message(error),
          arrangement: {
            active: false,
            stage: '',
            fraction: 0,
            ready: false,
            sourceTitle: map.song.title,
            durationMs: null,
            error: this.message(error),
          },
        });
    }
  }
  private async beginDataset(retry: boolean, source: 'annotations' | 'performer'): Promise<void> {
    const state = useStore.getState();
    if (
      this.transitionBusy ||
      this.machine.state !== (retry ? 'RESULTS' : 'SELECT') ||
      !state.map ||
      !this.buffer ||
      state.loading ||
      !state.audioReady ||
      this.context?.state !== 'running' ||
      !this.renderer
    )
      return;
    if (!retry && !state.arrangement?.ready) {
      const originalHash = state.map.song.sourceHash;
      await this.makeArrangement();
      if (this.arrangementEdit?.sourceAudioSha256 === originalHash && useStore.getState().arrangement?.ready)
        await this.beginDataset(false, source);
      return;
    }
    const request = ++this.selectionRequest;
    this.transitionBusy = true;
    display({
      loading: true,
      error: null,
      status: source === 'performer' ? strings.performerLoading : strings.datasetLoading,
    });
    try {
      const data =
        source === 'performer'
          ? new PerformerTrial(state.map, performance.now())
          : retry && this.dataset instanceof DatasetTrial
            ? new DatasetTrial(this.dataset.fixture, performance.now())
            : await DatasetTrial.load(performance.now());
      if (
        this.disposed ||
        request !== this.selectionRequest ||
        this.machine.state !== (retry ? 'RESULTS' : 'SELECT')
      )
        return;
      if (
        this.context?.state !== 'running' ||
        !useStore.getState().audioReady ||
        document.hidden ||
        useStore.getState().credits ||
        this.pauseTask
      ) {
        display({ loading: false, error: strings.startRequirements });
        return;
      }
      this.lifecycle++;
      this.sessionAudioFailed = false;
      this.setupRequest++;
      this.stopPreview();
      this.camera.stop();
      this.pipeline.invalidateCalibration();
      this.renderer.reset();
      this.stats = null;
      this.dataset = data;
      display({
        replay: true,
        trialSource: source,
        loading: false,
        results: null,
        highlightAt: null,
        cameraSource: null,
        camera: { state: 'not-set-up', mode: 'browse', calibrationValid: false, error: null },
        status: source === 'performer' ? strings.performerLimitations : strings.datasetLimitations,
      });
      this.machine.transition(retry ? 'results:retry' : 'select:start', { ready: true });
      this.player!.prepare(this.buffer!);
      const map = useStore.getState().map!;
      this.renderer.setApproachMs(map.approachMs);
      this.trace.reset(
        `${source === 'performer' ? 'synthetic-performer-logic-replay' : 'dataset-static-annotation-trial'} epoch ${this.machine.epoch}`,
      );
      this.session = new GameSession(map, {
        songClock: this.player!.clock,
        epoch: this.machine.epoch,
        onEvent: (name, payload) => this.machine.events.emit(name, payload),
      });
      const at = this.player!.start(computePrerollMs(map, !state.warnings.includes('lowTempoConfidence')));
      this.countdownStepMs = state.warnings.includes('lowTempoConfidence')
        ? START_COUNTDOWN_MS / COUNTDOWN_STEPS
        : 60000 / map.song.bpm;
      this.sfx.beginSession({
        map,
        startAt: at,
        stepMs: this.countdownStepMs,
        confidentTempo: !state.warnings.includes('lowTempoConfidence'),
        music: this.buffer,
      });
      data.rebase(performance.now());
      this.targets.surface(this.machine.epoch + 1);
      this.pointer.cancel(performance.now());
      this.renderer.setMode('play');
      this.showStartCountdown(this.player!.clock.now());
    } catch (error) {
      if (!this.disposed && request === this.selectionRequest) {
        this.back();
        display({ error: this.message(error), loading: false });
      }
    } finally {
      this.transitionBusy = false;
    }
  }
  async chooseUpload(file: File): Promise<void> {
    if (this.machine.state !== 'SELECT' || this.disposed) return;
    const request = ++this.selectionRequest;
    this.stopPreview();
    if (this.upload !== file) {
      this.arrangementEdit = null;
      display({ arrangement: null });
    }
    this.buffer = null;
    this.upload = file;
    display({
      loading: true,
      selectedSlug: null,
      map: null,
      error: null,
      generation: { active: true, fraction: 0, stage: 'read' },
    });
    try {
      const result = await this.generator.generate(file, useStore.getState().difficulty, (progress) => {
        if (this.selectionCurrent(request))
          display({ generation: { active: true, fraction: progress.fraction, stage: progress.stage } });
      });
      if (!this.selectionCurrent(request)) return;
      this.buffer = result.buffer;
      this.player?.prepare(result.buffer);
      display({
        map: result.map,
        warnings: result.warnings,
        loading: false,
        generation: { active: false, fraction: 1, stage: 'ready' },
      });
    } catch (error) {
      if (this.selectionCurrent(request))
        display({
          loading: false,
          error: this.message(error),
          generation: { active: false, fraction: 0, stage: '' },
        });
    }
  }
  private cancelGeneration(): void {
    this.selectionRequest++;
    this.generator.cancel();
    display({ arrangement: null });
    this.arrangementEdit = null;
    this.buffer = null;
    this.upload = null;
    display({ loading: false, map: null, generation: { active: false, fraction: 0, stage: '' } });
  }
  private stopPreview(): void {
    this.player?.stop();
    this.sfx.stop();
    display({ preview: false });
  }
  private resetTrackingState(): void {
    this.lastTracking = this.lastPresence = -Infinity;
    this.readySince = this.freshSince = Infinity;
    this.pointer.setHand(useStore.getState().hand, performance.now());
  }
  /** Heard song time for a song-synchronized dataset reel; null outside an armed/active session. */
  private reelSongTime(): number | null {
    const state = this.machine.state;
    if (
      !this.session ||
      !this.player ||
      (state !== 'CALIBRATION' && state !== 'PLAYING' && state !== 'PAUSED')
    )
      return null;
    const time = this.player.clock.now();
    return Number.isFinite(time) ? time : null;
  }
  private cameraSource(kind: CameraSourceKind): CameraStreamSource {
    return kind === 'dataset'
      ? new DatasetCameraSource(
          new PhotoReel({ mode: this.flags.reel, holdMs: this.flags.reelHoldMs, seed: this.flags.reelSeed }),
          () => this.reelSongTime(),
        )
      : new WebcamSource();
  }
  private cameraLabel(message: string): string {
    return this.camera.sourceKind === 'dataset' ? `${message} · ${strings.datasetCamera}` : message;
  }
  private async setup(kind: CameraSourceKind = this.flags.camera): Promise<void> {
    if (this.machine.state !== 'SELECT' || useStore.getState().camera.state === 'setting-up') return;
    const request = ++this.setupRequest;
    this.stopPreview();
    this.resetTrackingState();
    this.pipeline.invalidateCalibration();
    this.renderer?.hideTracking();
    this.machine.transition('camera:setup');
    display({
      camera: { state: 'setting-up', mode: 'camera-setup', calibrationValid: false, error: null },
      cameraStage: strings.calibrationPending,
      cameraSource: kind,
      error: null,
      figureAvailable: false,
    });
    try {
      await this.camera.start(
        this.video,
        (frame) => {
          if (request === this.setupRequest && !this.disposed) this.tracking(frame);
        },
        (message) => {
          if (request === this.setupRequest && !this.disposed) this.cameraFailure(message);
        },
        (message) => {
          if (request === this.setupRequest && !this.disposed) display({ cameraStage: message });
        },
        this.cameraSource(kind),
      );
    } catch (error) {
      if (request === this.setupRequest && !this.disposed) this.cameraFailure(this.message(error));
    }
  }
  private confirmCamera(): void {
    if (this.machine.state !== 'SELECT' || useStore.getState().camera.mode !== 'camera-setup') return;
    if (!this.fresh() || !this.pipeline.result.calibrationReady) {
      // Readiness can lapse between the visible state and the click; say so instead of ignoring it.
      display({ status: strings.framingRequired });
      return;
    }
    const calibration = this.pipeline.calibrate(this.camera.identity);
    if (!calibration || calibration.identity !== this.camera.identity) return;
    this.machine.transition('camera:ready', { ready: true });
    display({
      camera: { state: 'ready', mode: 'browse', calibrationValid: true, error: null },
      error: null,
      status: this.cameraLabel(strings.cameraReady),
    });
  }
  private cancelSetup(): void {
    if (this.machine.state !== 'SELECT' || useStore.getState().camera.mode !== 'camera-setup') return;
    this.setupRequest++;
    this.camera.stop();
    this.pipeline.invalidateCalibration();
    this.resetTrackingState();
    this.renderer?.hideTracking();
    this.machine.transition('camera:cancel');
    display({
      camera: { state: 'not-set-up', mode: 'browse', calibrationValid: false, error: null },
      cameraSource: null,
      figureAvailable: false,
      trackingReady: false,
      calibrationReady: false,
    });
  }
  private stopCamera(): void {
    if (this.machine.state === 'PLAYING') void this.pause('fatal');
    else if (this.machine.state === 'CALIBRATION') this.back();
    if (this.machine.state === 'SELECT' && useStore.getState().camera.mode === 'camera-setup') {
      this.cancelSetup();
      return;
    }
    this.setupRequest++;
    this.camera.stop();
    this.pipeline.invalidateCalibration();
    this.resetTrackingState();
    this.renderer?.hideTracking();
    display({
      camera: { state: 'not-set-up', mode: 'browse', calibrationValid: false, error: null },
      cameraSource: null,
      figureAvailable: false,
      trackingReady: false,
      calibrationReady: false,
      status: strings.stopCamera,
    });
  }
  private cameraFailure(message: string): void {
    this.setupRequest++;
    display({ cameraSource: null });
    if (this.machine.state === 'PLAYING') void this.pause('fatal');
    else if (this.machine.state === 'CALIBRATION') this.back();
    this.camera.stop();
    this.pipeline.invalidateCalibration();
    this.resetTrackingState();
    this.renderer?.hideTracking();
    if (this.machine.state === 'SELECT') this.machine.transition('camera:error');
    display({
      camera: {
        state: 'error',
        mode: 'browse',
        calibrationValid: false,
        error: message.replace(/Run npm run models[^.]*\./gi, strings.trackingAssetsRequired),
      },
      figureAvailable: false,
      trackingReady: false,
      calibrationReady: false,
    });
  }
  private fresh(now = performance.now()): boolean {
    return (
      now - this.lastTracking <= INPUT_MAX_AGE_MS &&
      now >= this.lastTracking &&
      this.pipeline.result.body.present &&
      this.pipeline.result.hands.length === 2 &&
      this.pipeline.result.hands.every((hand) => hand.present)
    );
  }
  private matchingCalibration(): boolean {
    const state = useStore.getState();
    return (
      state.camera.calibrationValid &&
      !!this.camera.identity &&
      this.pipeline.calibration?.identity === this.camera.identity
    );
  }
  private ready(): boolean {
    const state = useStore.getState();
    return (
      !this.pauseTask &&
      !state.loading &&
      !!state.map &&
      !!this.buffer &&
      state.audioReady &&
      this.context?.state === 'running' &&
      this.matchingCalibration() &&
      this.fresh() &&
      !!this.renderer
    );
  }
  private async begin(retry: boolean): Promise<void> {
    if (this.transitionBusy || this.machine.state !== (retry ? 'RESULTS' : 'SELECT')) return;
    if (useStore.getState().credits) {
      display({ status: strings.closeCreditsFirst });
      return;
    }
    if (!this.ready()) {
      display({
        status: strings.startRequirements,
      });
      return;
    }
    this.lifecycle++;
    this.sessionAudioFailed = false;
    this.selectionRequest++;
    this.generator.cancel();
    this.stopPreview();
    this.session = null;
    this.stats = null;
    this.renderer?.reset();
    this.pipeline.reset();
    this.readySince = this.freshSince = Infinity;
    this.machine.transition(retry ? 'results:retry' : 'select:start', { ready: true });
    display({ results: null, highlightAt: null, preview: false, error: null });
  }
  private async countIn(): Promise<void> {
    if (this.machine.state !== 'CALIBRATION' || this.session) return;
    if (
      !this.ready() ||
      !this.pipeline.result.calibrationReady ||
      performance.now() - this.readySince < CALIB_PRESENCE_MS
    ) {
      display({ status: strings.framingRequired });
      return;
    }
    const state = useStore.getState(),
      map = state.map!,
      player = this.player!;
    const confident = !state.warnings.includes('lowTempoConfidence');
    this.countdownStepMs = confident ? 60000 / map.song.bpm : START_COUNTDOWN_MS / COUNTDOWN_STEPS;
    try {
      player.prepare(this.buffer!);
      this.sfx.stop();
      this.renderer?.setApproachMs(map.approachMs);
      this.trace.reset(`${this.camera.sourceLane ?? 'live-camera-unverified'} epoch ${this.machine.epoch}`);
      this.session = new GameSession(map, {
        songClock: player.clock,
        epoch: this.machine.epoch,
        physicalScale: this.pipeline.calibration!.physicalScale,
        onEvent: (name, payload) => this.machine.events.emit(name, payload),
      });
      const at = player.start(computePrerollMs(map, confident));
      this.sfx.beginSession({
        map,
        startAt: at,
        stepMs: this.countdownStepMs,
        confidentTempo: confident,
        music: this.buffer,
      });
      this.targets.surface(this.machine.epoch + 1);
      this.pointer.cancel(performance.now());
      this.renderer?.setMode('play');
      this.showStartCountdown(player.clock.now());
    } catch (error) {
      this.cancelArmedStart(this.message(error));
    }
  }
  private showStartCountdown(songTime: number): void {
    const span = COUNTDOWN_STEPS * this.countdownStepMs;
    display(
      songTime < -span
        ? { countdown: null, status: strings.preparing }
        : {
            countdown: Math.min(COUNTDOWN_STEPS, Math.max(1, Math.ceil(-songTime / this.countdownStepMs))),
            status: strings.readyStatus,
          },
    );
  }
  private cancelArmedStart(status: string): void {
    this.lifecycle++;
    this.player?.stop();
    this.sfx.stop();
    this.session = null;
    this.renderer?.reset();
    this.renderer?.setMode('menu');
    this.targets.surface(this.machine.epoch);
    this.pointer.cancel(performance.now());
    this.readySince = Infinity;
    display({ countdown: null, status });
  }
  private back(): void {
    if (this.machine.state !== 'CALIBRATION') return;
    this.cancelArmedStart(strings.chooseWhenReady);
    this.dataset = null;
    display({ replay: !!this.flags.replay, trialSource: null });
    this.machine.transition('calib:back');
  }
  private songs(): void {
    const state = this.machine.state;
    if (state === 'CALIBRATION') {
      this.back();
      return;
    }
    if (state !== 'PAUSED' && state !== 'RESULTS') return;
    this.lifecycle++;
    this.audioRequest++;
    this.selectionRequest++;
    this.player?.stop();
    this.sfx.stop();
    this.session = null;
    this.dataset = null;
    display({ replay: !!this.flags.replay, trialSource: null });
    this.stats = null;
    this.resumeAt = Infinity;
    this.transitionBusy = false;
    this.renderer?.reset();
    this.pipeline.reset();
    this.readySince = this.freshSince = Infinity;
    this.machine.transition(state === 'PAUSED' ? 'pause:quit' : 'results:songs');
    display({
      countdown: null,
      preview: false,
      audioReady: !this.pauseTask && this.context?.state === 'running',
      status: strings.chooseWhenReady,
    });
  }
  private async preview(): Promise<void> {
    const state = useStore.getState();
    if (this.machine.state !== 'SELECT') return;
    if (!state.audioReady || this.context?.state !== 'running' || !this.player) {
      display({ status: strings.enableSoundFirst });
      return;
    }
    if (!this.buffer) {
      display({ status: strings.musicNotReady });
      return;
    }
    if (state.preview) {
      this.stopPreview();
      return;
    }
    const track = state.library.find((entry) => entry.slug === state.selectedSlug);
    const start = track?.preview.startMs ?? 0,
      length = track?.preview.durationMs ?? Math.min(15000, this.buffer.duration * 1000);
    const request = this.selectionRequest;
    this.player.preview(this.buffer, start, length, () => {
      if (this.selectionCurrent(request)) display({ preview: false });
    });
    display({ preview: true });
  }
  private tracking(frame: TrackingFrame, now = performance.now(), source: 'live' | 'replay' = 'live'): void {
    const result = this.pipeline.process(frame, now, source);
    if (!result || this.disposed) return;
    this.lastTracking = frame.tCapture;
    if (result.body.present || result.hands.some((hand) => hand.present)) this.lastPresence = frame.tCapture;
    if (source === 'live') {
      this.camera.observeProcessed(frame.tCapture, result.hands);
      this.instrumentation.inferenceMs.add(frame.inferenceMs);
      this.instrumentation.inputAgeMs.add(now - frame.tCapture);
    }
    if (this.fresh(now)) {
      if (!Number.isFinite(this.freshSince)) this.freshSince = now;
    } else this.freshSince = Infinity;
    if (this.fresh(now) && result.calibrationReady) {
      if (!Number.isFinite(this.readySince)) this.readySince = now;
    } else this.readySince = Infinity;
    const state = useStore.getState(),
      show =
        result.body.present &&
        (!!this.dataset || state.camera.mode === 'camera-setup' || state.camera.calibrationValid);
    this.renderer?.tracking(frame, show);
    this.renderer?.hands(result.hands);
    if (this.machine.state === 'PLAYING') this.sfx.hands(result.hands);
    if (this.machine.state === 'PLAYING')
      this.session?.consume(
        {
          seq: frame.seq,
          epoch: this.session.epoch,
          tCapture: frame.tCapture,
          hands: result.hands,
          body: result.body,
        },
        now,
      );
    else {
      const context = this.menuContext(this.machine.state !== 'BOOT');
      const sample = result.menuHands.find((hand) => hand.hand === state.hand);
      if (sample) {
        const activation = this.pointer.update(sample, context, now);
        this.sfx.pointer(this.pointer.state);
        if (activation && this.targets.activate(activation.targetId, 'hand', activation))
          this.sfx.menuAction(activation.targetId);
      }
    }
  }
  private menuContext(enabled: boolean): MenuContext {
    const base = this.targets.snapshot(enabled);
    const startArmed = this.machine.state === 'CALIBRATION' && !!this.session,
      resumeArmed = this.machine.state === 'PAUSED' && this.resumeAt !== Infinity;
    const credits = useStore.getState().credits;
    if (!credits && !startArmed && !resumeArmed) return base;
    this.countdownTargets.length = 0;
    for (const target of base.targets)
      if (
        credits
          ? target.id === 'credits' || target.id.startsWith('ui:credits:')
          : startArmed
            ? target.id === 'back'
            : target.id === 'songs' || target.id === 'cancel-resume'
      )
        this.countdownTargets.push(target);
    this.countdownContext.enabled = base.enabled;
    this.countdownContext.screenEpoch = base.screenEpoch;
    this.countdownContext.layoutEpoch = base.layoutEpoch;
    this.countdownContext.viewport = base.viewport;
    return this.countdownContext;
  }
  async pause(reason: PauseReason): Promise<void> {
    if (this.pauseTask) return this.pauseTask;
    if (this.machine.state !== 'PLAYING') return;
    const session = this.session,
      player = this.player,
      lifecycle = ++this.lifecycle;
    session?.pause();
    this.transitionBusy = true;
    this.resumeAt = Infinity;
    this.machine.transition(
      reason === 'tracking'
        ? 'track:lost'
        : reason === 'audio'
          ? 'audio:interrupted'
          : reason === 'fatal'
            ? 'tracking:fatal'
            : 'pause:request',
      { reason },
    );
    display({ audioReady: false, countdown: null });
    const task = (async (): Promise<void> => {
      try {
        await player?.pause();
        if (
          this.disposed ||
          lifecycle !== this.lifecycle ||
          this.machine.state !== 'PAUSED' ||
          this.session !== session
        )
          return;
        const time = player?.clock.now() ?? session?.latestTime ?? 0;
        session?.freezeAt(time);
        this.renderer?.setFrozenTime(time);
      } catch (error) {
        if (!this.disposed && lifecycle === this.lifecycle) this.failActiveAudio(error);
      } finally {
        if (lifecycle === this.lifecycle) this.transitionBusy = false;
      }
    })();
    this.pauseTask = task;
    try {
      await task;
    } finally {
      if (this.pauseTask === task) this.pauseTask = null;
    }
  }
  private async resume(): Promise<void> {
    if (
      this.machine.state !== 'PAUSED' ||
      this.transitionBusy ||
      this.pauseTask ||
      this.resumeAt !== Infinity
    )
      return;
    if (this.sessionAudioFailed) {
      display({ status: strings.unsafePause });
      return;
    }
    if (
      (!this.dataset && (!this.fresh() || !this.matchingCalibration())) ||
      document.hidden ||
      this.machine.pauseReason === 'fatal'
    ) {
      display({
        status: strings.resumeRequirements,
      });
      return;
    }
    if (this.context?.state !== 'suspended' && this.context?.state !== 'running') {
      display({ error: strings.audioUnavailable });
      return;
    }
    this.resumeAt = performance.now() + RESUME_COUNTDOWN_MS;
    this.targets.surface(this.machine.epoch + 1);
    this.pointer.cancel(performance.now());
    display({ status: strings.resumePreparing });
  }
  private cancelResume(): void {
    if (this.machine.state !== 'PAUSED') return;
    this.lifecycle++;
    this.resumeAt = Infinity;
    this.targets.surface(this.machine.epoch);
    this.pointer.cancel(performance.now());
    display({ countdown: null, status: strings.stillPaused });
  }
  private async finishResume(): Promise<void> {
    if (this.transitionBusy || this.machine.state !== 'PAUSED') return;
    this.transitionBusy = true;
    const lifecycle = this.lifecycle,
      epoch = this.machine.epoch,
      session = this.session;
    try {
      await this.player?.resume();
      if (
        this.disposed ||
        epoch !== this.machine.epoch ||
        this.machine.state !== 'PAUSED' ||
        this.session !== session
      )
        return;
      if (lifecycle !== this.lifecycle) {
        await this.player?.pause();
        const time = this.player?.clock.now() ?? session?.latestTime ?? 0;
        session?.freezeAt(time);
        this.renderer?.setFrozenTime(time);
        return;
      }
      if ((!this.dataset && (!this.fresh() || !this.matchingCalibration())) || document.hidden) {
        await this.player?.pause();
        return;
      }
      this.pipeline.reset();
      this.dataset?.rebase(performance.now());
      session?.resume(performance.now());
      this.machine.transition('pause:resume', { ready: true, epoch });
      display({ audioReady: this.context?.state === 'running', countdown: null });
    } catch (error) {
      if (!this.disposed && lifecycle === this.lifecycle) {
        if (this.context?.state === 'running') this.failActiveAudio(error);
        else display({ error: this.message(error), audioReady: false });
      }
    } finally {
      if (lifecycle === this.lifecycle || (this.session === session && this.machine.state === 'PAUSED')) {
        this.resumeAt = Infinity;
        this.transitionBusy = false;
        this.targets.surface(this.machine.epoch);
        this.pointer.cancel(performance.now());
      }
    }
  }
  private frame(now: number): void {
    if (document.hidden) {
      this.lastFrame = 0;
      return;
    }
    const begin = performance.now();
    let state = this.machine.state;
    if (this.dataset && this.session && (state === 'CALIBRATION' || state === 'PLAYING'))
      try {
        this.dataset.advance(
          now,
          (time) => this.player!.clock.fromPerformanceTime(time),
          (frame, arrival, changed) => {
            if (changed) this.pipeline.reset();
            this.tracking(frame, arrival, 'replay');
            // The performer stands still before its first stroke; calibrate its lean reference once.
            if (
              this.dataset instanceof PerformerTrial &&
              !this.pipeline.calibration &&
              this.pipeline.result.calibrationReady
            )
              this.pipeline.calibrate('synthetic-performer');
          },
        );
      } catch (error) {
        display({ error: this.message(error) });
        if (state === 'CALIBRATION') this.back();
        else void this.pause('fatal');
      }
    if (!this.fresh(now)) this.readySince = this.freshSince = Infinity;
    if (now - this.lastTracking > MENU_TRACK_MAX_AGE_MS) this.pointer.cancel(now);
    if (now - this.lastTracking > INPUT_MAX_AGE_MS && state !== 'PAUSED' && state !== 'RESULTS')
      this.renderer?.hideTracking();
    if (
      state === 'PLAYING' &&
      !this.dataset &&
      (now - this.lastTracking > TRACKING_LOST_PAUSE_MS || now - this.lastPresence > TRACKING_LOST_PAUSE_MS)
    )
      void this.pause('tracking');
    state = this.machine.state;
    if (state === 'CALIBRATION' && this.session) {
      if (
        (!this.dataset && (!this.ready() || !this.pipeline.result.calibrationReady)) ||
        this.context?.state !== 'running'
      )
        this.cancelArmedStart(strings.countdownCancelled);
      else {
        const time = this.player!.clock.now();
        this.session.tick(time);
        if (time >= 0) {
          this.machine.transition('calib:complete', { ready: true });
          this.session.resume(now);
        } else if (now - this.lastUi >= 1000 / UI_TEXT_HZ) this.showStartCountdown(time);
      }
    }
    state = this.machine.state;
    if (state === 'PLAYING' && this.session) {
      this.session.tick();
      if (this.session.needsTrackingPause) void this.pause('tracking');
      else if (this.session.finished && this.stats) {
        this.machine.transition('song:ended', { ready: true });
        display({
          results: this.stats,
          status:
            this.dataset instanceof PerformerTrial
              ? strings.performerComplete
              : this.dataset
                ? strings.datasetComplete
                : strings.results,
        });
      }
    }
    state = this.machine.state;
    if (
      state === 'PAUSED' &&
      !this.dataset &&
      this.machine.pauseReason === 'tracking' &&
      this.resumeAt === Infinity &&
      !this.transitionBusy &&
      this.fresh(now) &&
      now - this.freshSince >= TRACK_REGAIN_MS
    )
      void this.resume();
    if (state === 'PAUSED' && this.resumeAt !== Infinity) {
      if (!this.dataset && (!this.fresh(now) || !this.matchingCalibration())) this.cancelResume();
      else if (now >= this.resumeAt) void this.finishResume();
      else if (now - this.lastUi >= 1000 / UI_TEXT_HZ)
        display({ countdown: Math.ceil((this.resumeAt - now) / 1000) });
    }
    const audioDt = this.lastFrame ? (now - this.lastFrame) / 1000 : 1 / TARGET_FPS;
    if (this.player && (state === 'PLAYING' || useStore.getState().preview))
      this.renderer?.setMusicBands?.(this.player.analyser.update(audioDt));
    if (this.lastFrame && state === 'PLAYING') this.instrumentation.frameIntervalMs.add(now - this.lastFrame);
    this.lastFrame = now;
    const songTime = this.player?.clock.now() ?? 0;
    this.renderer?.setCalm(useStore.getState().calm);
    this.renderer?.draw(
      Number.isFinite(songTime) ? songTime : 0,
      this.session?.notes,
      this.session?.obstacles,
    );
    if (now - this.lastUi >= 1000 / UI_TEXT_HZ) {
      this.lastUi = now;
      const displayState = useStore.getState(),
        result = this.pipeline.result,
        handsFresh =
          (!this.dataset || this.dataset instanceof PerformerTrial) &&
          now >= this.lastTracking &&
          now - this.lastTracking <= INPUT_MAX_AGE_MS,
        left = result.hands.find((hand) => hand.hand === 'left'),
        right = result.hands.find((hand) => hand.hand === 'right'),
        leftPresent = handsFresh && !!left?.present,
        rightPresent = handsFresh && !!right?.present;
      display({
        trackingReady: this.fresh(now),
        figureAvailable: now - this.lastTracking <= INPUT_MAX_AGE_MS && result.body.present,
        maskAvailable: this.renderer?.hasMaskFrame ?? false,
        calibrationReady: result.calibrationReady && this.fresh(now),
        pointer: { ...this.pointer.state },
        hud: {
          score: this.session?.score ?? 0,
          combo: this.session?.combo ?? 0,
          multiplier: this.session?.multiplier ?? 1,
          accuracy: this.session?.liveAccuracy ?? null,
          songTimeMs: Number.isFinite(songTime) ? songTime : 0,
          durationMs: displayState.map?.song.durationMs ?? 0,
          left: leftPresent ? left!.gesture : 'none',
          right: rightPresent ? right!.gesture : 'none',
          leftPresent,
          rightPresent,
          leftCharge: leftPresent ? left!.charge : 0,
          rightCharge: rightPresent ? right!.charge : 0,
          judgement: now < this.popUntil ? this.pop : '',
          judgementSeq: this.popSeq,
        },
      });
    }
    if (state === 'PLAYING') this.instrumentation.frameWorkMs.add(performance.now() - begin);
  }
  private volume(delta: number): void {
    const volume = Math.max(0, Math.min(1, useStore.getState().volume + delta));
    this.player?.setVolume(volume);
    display({ volume });
  }
  private failActiveAudio(error: unknown): void {
    this.sessionAudioFailed = true;
    this.player?.stop();
    this.sfx.stop();
    display({
      error: `${this.message(error)} Return to Songs to restart safely.`,
      audioReady: false,
      countdown: null,
    });
  }
  async exportEvidence(): Promise<void> {
    const content = await this.evidence();
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }),
      ),
      link = document.createElement('a');
    link.href = url;
    link.download = 'sign-saber-diagnostics.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async evidence(): Promise<Record<string, unknown>> {
    const lane =
      this.dataset instanceof PerformerTrial
        ? 'synthetic-performer-logic-replay'
        : this.dataset
          ? 'dataset-static-annotation-trial'
          : this.flags.replay
            ? 'logic-replay'
            : (this.camera.sourceLane ?? 'live-camera-unverified');
    const calibration = this.pipeline.calibration;
    return {
      schema: 2,
      lane,
      createdAt: new Date().toISOString(),
      releaseEvidence: false,
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      state: this.machine.state,
      pauseReason: this.machine.pauseReason,
      cameraSource: this.camera.sourceKind,
      camera: { ...this.camera.settings, deviceId: undefined, groupId: undefined },
      tracking: { ...this.camera.stats },
      calibration: calibration
        ? {
            centerX: calibration.centerX,
            shoulderWidthNorm: calibration.shoulderWidthNorm,
            headY: calibration.headY,
            physicalScale: calibration.physicalScale,
            matchesCurrentCamera: calibration.identity === this.camera.identity,
          }
        : null,
      flags: this.flags,
      datasetTrial:
        this.dataset instanceof DatasetTrial
          ? { temporalRecording: false, handGestures: false, depth: false, annotationOnly: true }
          : null,
      performerTrial:
        this.dataset instanceof PerformerTrial
          ? { synthetic: true, camera: false, plannedUnplayableNotes: this.dataset.unplayable }
          : null,
      datasetCamera: this.camera.sourceEvidence(),
      arrangement: this.arrangementEdit,
      limitations: [
        'No consented human/hardware acceptance recorded',
        'GPU and motion-to-photon timing unavailable',
        ...(this.camera.sourceKind === 'dataset'
          ? ['Dataset camera: still photos through the live camera path; not a webcam, no motion or gestures']
          : []),
      ],
      results: this.stats,
      judgementTrace: await this.trace.export(),
      samples: this.instrumentation.export(),
      session: this.session?.diagnostics,
    };
  }
  /** Read-only automation/diagnostics snapshot, only with `?stats=1`. Actions still use the real UI. */
  private exposeDiagnostics(): void {
    const target = window as unknown as Record<string, unknown>;
    target.__signSaberDiagnostics = Object.freeze({
      snapshot: () => {
        const s = useStore.getState();
        return {
          state: s.state,
          pauseReason: s.pauseReason,
          status: s.status,
          error: s.error,
          camera: s.camera,
          cameraSource: s.cameraSource,
          cameraStage: s.cameraStage,
          calibrationReady: s.calibrationReady,
          trackingReady: s.trackingReady,
          figureAvailable: s.figureAvailable,
          audioReady: s.audioReady,
          loading: s.loading,
          mapReady: !!s.map,
          arrangementReady: !!s.arrangement?.ready,
          countdown: s.countdown,
          hud: s.hud,
          results: s.results,
          tracking: { ...this.camera.stats },
          songTimeMs: this.player?.clock.now() ?? null,
        };
      },
      evidence: () => this.evidence(),
    });
    this.listeners.push(() => delete target.__signSaberDiagnostics);
  }
  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycle++;
    this.audioRequest++;
    this.setupRequest++;
    this.selectionRequest++;
    this.bootRequest++;
    cancelAnimationFrame(this.animation);
    this.camera.stop();
    this.trace.dispose();
    this.generator.dispose();
    this.sfx.dispose();
    this.player?.dispose();
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
    this.buffer = null;
    this.upload = null;
    this.decoder = null;
    this.session = null;
    this.renderer?.dispose();
    for (const off of this.listeners) off();
    this.listeners = [];
    this.targets.dispose();
    this.machine.events.clear();
  }
}
