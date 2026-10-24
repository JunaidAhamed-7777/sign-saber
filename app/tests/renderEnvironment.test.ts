import { describe, expect, it } from 'vitest';
import { bandResponse, ARENA_NEON_BANDS } from '../src/render/environment';
import { ARENA_EMISSION_SLEW_PER_S } from '../src/core/constants';

describe('band-reactive arena response', () => {
  it('is slew-limited so a sudden full-scale level cannot strobe large areas', () => {
    const step = bandResponse(0, 1, 0, 1 / 60, false);
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThanOrEqual(ARENA_EMISSION_SLEW_PER_S / 60 + 1e-9);
  });
  it('settles to a bounded accent and decays to zero in Calm', () => {
    let value = 0;
    for (let i = 0; i < 600; i++) value = bandResponse(value, 1, 0.2, 1 / 60, false);
    expect(value).toBeGreaterThan(0.5);
    expect(value).toBeLessThanOrEqual(1);
    for (let i = 0; i < 600; i++) value = bandResponse(value, 1, 0.2, 1 / 60, true);
    expect(value).toBe(0);
  });
  it('maps bass to floor/stage, mids to pylons/towers and highs to the skyline', () => {
    expect(ARENA_NEON_BANDS.arena_neon_stage).toBe('low');
    expect(ARENA_NEON_BANDS.pylon_strip).toBe('mid');
    expect(ARENA_NEON_BANDS.arena_neon_magenta).toBe('mid');
    expect(ARENA_NEON_BANDS.arena_sky_window).toBe('high');
  });
});
