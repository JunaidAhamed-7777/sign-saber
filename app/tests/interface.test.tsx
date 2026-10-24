/** Interface presentation contracts: generated covers, HUD helpers, results and the shared compact breakpoint. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { coverModel, hashString } from '../src/ui/coverArt';
import { comboMilestone, multiplierProgress } from '../src/ui/hudModel';
import { Hud } from '../src/ui/screens/Hud';
import { Results, rankTone } from '../src/ui/screens/Results';
import { Paused } from '../src/ui/screens/Paused';
import { trialCopy } from '../src/ui/trialCopy';
import { strings } from '../src/ui/strings';
import { HUD_COMBO_MILESTONES, MULTIPLIER_LADDER } from '../src/core/constants';
import { useStore } from '../src/state/store';
import type * as StoreModule from '../src/state/store';
import type { GameRuntime } from '../src/core/runtime';
import manifest from '../public/assets/tracks/manifest.json';
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
const runtime = {
  startArmed: false,
  resumeArmed: false,
  datasetTrialActive: false,
  renderer: { hasFrozenFigure: false },
  setStage: () => {},
  command: () => Promise.resolve(),
  targets: { invalidate: () => {}, register: () => () => {}, activate: () => false },
} as unknown as GameRuntime;
beforeEach(() => {
  useStore.setState(structuredClone(initial), true);
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});
describe('generated cover art', () => {
  it('is deterministic, bounded and distinct for each bundled track', () => {
    const models = manifest.tracks.map((track) => coverModel(track as Parameters<typeof coverModel>[0]));
    expect(models).toEqual(
      manifest.tracks.map((track) => coverModel(track as Parameters<typeof coverModel>[0])),
    );
    expect(new Set(models.map((model) => JSON.stringify(model))).size).toBe(models.length);
    expect(new Set(models.map((model) => model.accent)).size).toBe(3);
    for (const model of models) {
      expect(Math.min(...model.bars)).toBeGreaterThan(0);
      expect(Math.max(...model.bars)).toBeLessThanOrEqual(56);
      expect(Math.min(...model.slash)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...model.slash)).toBeLessThanOrEqual(64);
      expect(model.initial).toMatch(/^[A-Z]$/);
    }
  });
  it('accepts uploads without a role or tempo', () => {
    const model = coverModel({ slug: 'my-file.mp3', title: 'my file' });
    expect(['cyan', 'magenta', 'gold']).toContain(model.accent);
    expect(model.initial).toBe('M');
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
describe('HUD presentation helpers', () => {
  it('maps combo to the multiplier ladder with progress toward the next rung', () => {
    expect(multiplierProgress(0)).toEqual({ multiplier: 1, progress: 0, nextAt: MULTIPLIER_LADDER[1]![0] });
    const [from, multiplier] = MULTIPLIER_LADDER[1]!;
    const next = MULTIPLIER_LADDER[2]![0];
    const mid = multiplierProgress(from + 1);
    expect(mid.multiplier).toBe(multiplier);
    expect(mid.progress).toBeCloseTo(1 / (next - from));
    const top = MULTIPLIER_LADDER[MULTIPLIER_LADDER.length - 1]!;
    expect(multiplierProgress(top[0] + 50)).toEqual({ multiplier: top[1], progress: 1, nextAt: null });
    expect(multiplierProgress(Number.NaN).multiplier).toBe(1);
  });
  it('reports the highest reached combo milestone only', () => {
    expect(comboMilestone(HUD_COMBO_MILESTONES[0] - 1)).toBeNull();
    for (const milestone of HUD_COMBO_MILESTONES) expect(comboMilestone(milestone)).toBe(milestone);
    expect(comboMilestone(1000)).toBe(HUD_COMBO_MILESTONES[HUD_COMBO_MILESTONES.length - 1]);
  });
  it('renders score/combo/accuracy edges, the multiplier ring and a keyed judgement pop', () => {
    useStore.setState({
      state: 'PLAYING',
      hud: {
        ...initial.hud,
        score: 1234,
        combo: 12,
        multiplier: 2,
        accuracy: 0.5,
        judgement: 'miss',
        judgementSeq: 7,
      },
    });
    const html = renderToStaticMarkup(<Hud />);
    expect(html).toContain('hud-score');
    expect(html).toContain('1,234');
    expect(html).toContain('×2');
    expect(html).toContain(strings.milestone10);
    expect(html).toContain('50.0%');
    expect(html).toContain('class="judgement miss"');
    expect(html).toContain(`aria-label="${strings.songProgress}"`);
    useStore.setState({ hud: { ...useStore.getState().hud, judgement: '' } });
    expect(renderToStaticMarkup(<Hud />)).not.toContain('class="judgement ');
  });
});
describe('pause and trial labelling', () => {
  it('summarises the run so far beside the frozen figure', () => {
    useStore.setState({
      state: 'PAUSED',
      pauseReason: 'manual',
      hud: {
        ...initial.hud,
        score: 6000,
        combo: 23,
        multiplier: 4,
        accuracy: 1,
        songTimeMs: 14000,
        durationMs: 80000,
      },
    });
    const html = renderToStaticMarkup(<Paused runtime={runtime} />);
    expect(html).toContain('run-so-far');
    expect(html).toContain('0:14 / 1:20');
    expect(html).toContain('6,000');
    expect(html).toContain('23 · ×4');
    expect(html).toContain('100.0%');
  });
  it('never labels the synthetic performer as dataset footage', () => {
    const performer = trialCopy('performer');
    for (const value of Object.values(performer)) expect(value.toLowerCase()).not.toContain('dataset');
    expect(trialCopy('annotations').controls).toBe(strings.datasetControls);
  });
});
describe('results presentation', () => {
  it('shows rank, stats and per-judgement bars that sum to the actual counts', () => {
    const counts = { perfect: 3, great: 2, good: 1, miss: 4, badcut: 0, obstaclesHit: 0, obstaclesDodged: 0 };
    useStore.setState({
      state: 'RESULTS',
      replay: true,
      results: {
        score: 520,
        maxScore: 1000,
        accuracy: 0.52,
        rank: 'C',
        maxCombo: 4,
        counts,
        kineticJoules: 1500,
        kcal: 0.1,
        peakComboSongTimeMs: 0,
      },
    });
    const html = renderToStaticMarkup(<Results runtime={runtime} />);
    expect(html).toContain('rank-letter');
    expect(html).toContain('>C<');
    expect(html).toContain('52.0%');
    const shown = [...html.matchAll(/class="count">(\d+)</g)].map((match) => Number(match[1]));
    expect(shown).toEqual([3, 2, 1, 4, 0]);
    expect(html).toContain('scaleX(0.75)');
    expect(html).toContain(strings.datasetResults);
  });
  it('colours ranks by the documented tone mapping', () => {
    expect(rankTone('SS')).toBe('gold');
    expect(rankTone('S')).toBe('gold');
    expect(rankTone('A')).toBe('cyan');
    expect(rankTone('B')).toBe('text');
    expect(rankTone('D')).toBe('muted');
  });
});
