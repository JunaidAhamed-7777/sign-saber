/** Rendered structure assertions; real layout/hand checks remain browser evidence. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Select } from '../src/ui/screens/Select';
import { Calibration } from '../src/ui/screens/Calibration';
import { Paused } from '../src/ui/screens/Paused';
import { Results } from '../src/ui/screens/Results';
import { App } from '../src/App';
import { useStore } from '../src/state/store';
import type * as StoreModule from '../src/state/store';
import type { GameRuntime } from '../src/core/runtime';
import type { BundledTrackEntry, BeatmapV1 } from '../src/beatmap/types';
import manifest from '../public/assets/tracks/manifest.json';
// Render current client state through a snapshot adapter; subscriptions are tested by browser/runtime paths.
vi.mock('../src/state/store', async () => {
  const actual = await vi.importActual<typeof StoreModule>('../src/state/store');
  let current = actual.useStore.getState();
  const useStore = Object.assign((selector: (state: typeof current) => unknown) => selector(current), {
    getState: () => current,
    setState: (patch: Partial<typeof current>, replace = false) => {
      current = replace ? (patch as typeof current) : { ...current, ...patch };
    },
  });
  return { useStore, display: (patch: Partial<typeof current>) => useStore.setState(patch) };
});
const initial = structuredClone(useStore.getState());
let compact = false,
  armed = false,
  frozen = false,
  dataset = false;
const runtime = {
  get startArmed() {
    return armed;
  },
  resumeArmed: false,
  get datasetTrialActive() {
    return dataset;
  },
  renderer: {
    get hasFrozenFigure() {
      return frozen;
    },
  },
  setStage: () => {},
  command: () => Promise.resolve(),
  targets: { invalidate: () => {}, register: () => () => {}, activate: () => false },
} as unknown as GameRuntime;
const targets = (html: string): string[] =>
  [...html.matchAll(/data-target="([^"]+)"/g)].map((match) => match[1]!);
beforeEach(() => {
  compact = armed = frozen = dataset = false;
  useStore.setState(structuredClone(initial), true);
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: compact, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('figure-centred paged menu structure', () => {
  it('shows three real starter songs, guarded actions and unique targets without camera input', () => {
    useStore.setState({
      state: 'SELECT',
      library: manifest.tracks as BundledTrackEntry[],
      libraryLoading: false,
    });
    const html = renderToStaticMarkup(<Select runtime={runtime} />),
      ids = targets(html);
    for (const track of manifest.tracks) expect(ids).toContain(`song:${track.slug}`);
    expect(ids).not.toContain('camera');
    expect(ids).toContain('audio');
    expect(ids).toContain('dataset-trial');
    expect(ids).toContain('arrange');
    expect(ids).toContain('ui:left:next');
    expect(ids).toContain('ui:right:next');
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toContain('Illustrative upper body');
    expect(html).toContain('viewBox="0 0 360 350"');
    expect(html).not.toContain('<video');
    expect(html).toMatch(/data-target="dataset-trial"[^>]*disabled/);
  });
  it('reflows compact rails above and below the figure with grouped full-size pages', () => {
    compact = true;
    useStore.setState({
      state: 'SELECT',
      library: manifest.tracks as BundledTrackEntry[],
      libraryLoading: false,
    });
    const html = renderToStaticMarkup(<Select runtime={runtime} />),
      ids = targets(html);
    // All three starter cards share one top row; actions are grouped below the stage, not one per page.
    expect(ids.filter((id) => id.startsWith('song:'))).toHaveLength(manifest.tracks.length);
    expect(ids).toEqual([
      'ui:compact-top:previous',
      ...manifest.tracks.map((track) => `song:${track.slug}`),
      'ui:compact-top:next',
      'ui:compact:previous',
      'audio',
      'dataset-trial',
      'performer-trial',
      'arrange',
      'ui:compact:next',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    const top = html.indexOf('compact-top'),
      stage = html.indexOf('figure-stage'),
      bottom = html.indexOf('compact-bottom');
    expect(top).toBeGreaterThan(-1);
    expect(stage).toBeGreaterThan(top);
    expect(bottom).toBeGreaterThan(stage);
    expect(html).toContain('1 of 2');
    expect(html).toContain('Choose a track to begin.');
  });
  it('surfaces the actual song-load error with a retry instead of a generic prompt', () => {
    useStore.setState({
      state: 'SELECT',
      library: manifest.tracks as BundledTrackEntry[],
      libraryLoading: false,
      selectedSlug: manifest.tracks[1]!.slug,
      map: null,
      loading: false,
      error: 'Packaged audio duration does not match its chart.',
    });
    for (const mode of [false, true]) {
      compact = mode;
      const html = renderToStaticMarkup(<Select runtime={runtime} />);
      expect(html).toContain('role="alert"');
      expect(html).toContain('This track could not load.');
      expect(html).toContain('Packaged audio duration does not match its chart.');
      expect(html).not.toContain('Choose a track to begin.');
      expect(targets(html)).toContain('selection-retry');
      expect(html).toMatch(/data-target="dataset-trial"[^>]*disabled/);
    }
    compact = false;
    const html = renderToStaticMarkup(<Select runtime={runtime} />);
    expect(html).toMatch(/class="btn selected song-card failed"/);
    expect(html).toContain('Could not load');
  });
  it('marks the loading card busy and keeps the generated cover art per track', () => {
    useStore.setState({
      state: 'SELECT',
      library: manifest.tracks as BundledTrackEntry[],
      libraryLoading: false,
      selectedSlug: manifest.tracks[0]!.slug,
      loading: true,
    });
    const html = renderToStaticMarkup(<Select runtime={runtime} />);
    expect(html).toMatch(new RegExp(`data-target="song:${manifest.tracks[0]!.slug}"[^>]*aria-busy="true"`));
    expect(html.match(/class="cover-art cover-/g)?.length).toBeGreaterThanOrEqual(manifest.tracks.length);
    expect(html).toContain('Loading selected music');
    expect(html).not.toContain('<img');
  });
  it('enables the dataset trial with music and sound while camera setup remains absent', () => {
    const map = { song: { title: 'Dataset test', durationMs: 5000 }, notes: [] } as unknown as BeatmapV1;
    useStore.setState({
      state: 'SELECT',
      library: manifest.tracks as BundledTrackEntry[],
      libraryLoading: false,
      map,
      audioReady: true,
      camera: { state: 'not-set-up', mode: 'browse', calibrationValid: false, error: null },
    });
    const html = renderToStaticMarkup(<Select runtime={runtime} />);
    expect(html).toMatch(/data-target="dataset-trial"[^>]*class="btn primary hero"/);
    // Difficulty is on the first ready page, not hidden behind paging.
    expect(targets(html)).toEqual(
      expect.arrayContaining(['difficulty:easy', 'difficulty:normal', 'difficulty:hard']),
    );
    expect(html).not.toMatch(/data-target="dataset-trial"[^>]*disabled/);
    expect(html).not.toContain('data-target="camera"');
  });
  it('keeps confirmation disabled until framing, then shows preparation with persistent Back when armed', () => {
    useStore.setState({
      state: 'CALIBRATION',
      trackingReady: true,
      calibrationReady: false,
      status: 'Hold your position.',
    });
    let html = renderToStaticMarkup(<Calibration runtime={runtime} />);
    expect(html).toMatch(/data-target="confirm"[^>]*disabled/);
    expect(html).toContain('Hold your position.');
    armed = true;
    html = renderToStaticMarkup(<Calibration runtime={runtime} />);
    expect(targets(html)).toContain('back');
    expect(targets(html)).not.toContain('confirm');
    expect(html).toContain('Preparing');
    compact = true;
    html = renderToStaticMarkup(<Calibration runtime={runtime} />);
    expect(targets(html)).toEqual(['back']);
    expect(html).toContain('compact-shell');
  });
  it('labels a real frozen figure even when current tracking is absent', () => {
    frozen = true;
    useStore.setState({ state: 'PAUSED', figureAvailable: false });
    const html = renderToStaticMarkup(<Paused runtime={runtime} />);
    expect(html).toContain('Paused · frozen figure');
    expect(html).not.toContain('person-illustration');
  });
  it('enables dataset resume without camera calibration and still blocks live or fatal recovery', () => {
    useStore.setState({ state: 'PAUSED', trackingReady: false, pauseReason: 'manual' });
    let html = renderToStaticMarkup(<Paused runtime={runtime} />);
    expect(html).toMatch(/data-target="resume"[^>]*disabled/);
    dataset = true;
    html = renderToStaticMarkup(<Paused runtime={runtime} />);
    expect(html).not.toMatch(/data-target="resume"[^>]*disabled/);
    expect(targets(html)).toContain('resume');
    useStore.setState({ pauseReason: 'fatal' });
    html = renderToStaticMarkup(<Paused runtime={runtime} />);
    expect(html).toMatch(/data-target="resume"[^>]*disabled/);
  });
  it('shows actual results and owned timestamp with recovery status rather than a live figure claim', () => {
    const stats = {
      score: 170,
      maxScore: 200,
      accuracy: 0.85,
      rank: 'A' as const,
      maxCombo: 2,
      counts: { perfect: 1, great: 1, good: 0, miss: 0, badcut: 0, obstaclesHit: 0, obstaclesDodged: 0 },
      kineticJoules: 20,
      kcal: 20 / 4184 / 0.25,
      peakComboSongTimeMs: 500,
    };
    useStore.setState({
      state: 'RESULTS',
      results: stats,
      highlightAt: 1234,
      figureAvailable: false,
      status: 'Restore the camera to retry.',
    });
    const html = renderToStaticMarkup(<Results runtime={runtime} />);
    expect(html).toContain('170');
    expect(html).toContain('85.0');
    expect(html).toContain('Saved session moment');
    expect(html).toContain('1.2 s');
    expect(html).toContain('Restore the camera to retry.');
    expect(html).not.toContain('Your live neon figure');
    expect(html).not.toContain('person-illustration');
  });
  it('keeps Credits close and paging targets unique and isolated from game actions', () => {
    useStore.setState({
      state: 'SELECT',
      credits: true,
      library: manifest.tracks as BundledTrackEntry[],
      map: null as BeatmapV1 | null,
    });
    let html = renderToStaticMarkup(<App runtime={runtime} />),
      ids = targets(html);
    expect(ids).toEqual(['credits']);
    for (const track of manifest.tracks) {
      expect(html).toContain(track.rights.licenseUrl);
      expect(html).toContain(track.title);
    }
    compact = true;
    html = renderToStaticMarkup(<App runtime={runtime} />);
    ids = targets(html);
    expect(ids).toEqual(['credits', 'ui:credits:previous', 'ui:credits:next']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
