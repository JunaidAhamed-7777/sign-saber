/** Fixed cosmetic configuration only; these assertions do not measure rendering performance. */
import { describe, expect, it } from 'vitest';
import {
  FRAGMENT_LIFETIME_MS,
  MAX_FRAGMENTS,
  MAX_TRAIL_PARTICLES_PER_HAND,
  QUALITY_TIER_PRESETS,
} from '../src/core/constants';
import { isQualityTier, nextLowerTier, resolveQuality } from '../src/render/quality';
import type { QualityTier } from '../src/render/quality';

const viewport = { viewportHeightCss: 1080, devicePixelRatio: 2, hdrSupported: true };

describe('canonical fixed cosmetic quality', () => {
  it.each([
    ['high', 2160, 2, 1.5],
    ['medium', 1440, 2, 1.5],
    ['medium', 1441, 2, 1.275],
    ['medium', 2160, 0.8, 0.68],
    ['low', 1080, 2, 1.125],
    ['low', 1080, 0.8, 0.6],
  ] as const)('resolves %s at CSS height %s and DPR %s to %s', (tier, height, dpr, expected) => {
    const settings = resolveQuality(tier, {
      ...viewport,
      viewportHeightCss: height,
      devicePixelRatio: dpr,
    });
    expect(settings.pixelRatio).toBeCloseTo(expected);
    expect(settings.tier).toBe(tier);
    expect(settings.preset).toBe(QUALITY_TIER_PRESETS[tier]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])('rejects invalid DPR %s', (dpr) => {
    expect(() => resolveQuality('medium', { ...viewport, devicePixelRatio: dpr })).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects invalid CSS viewport height %s', (height) => {
    expect(() => resolveQuality('medium', { ...viewport, viewportHeightCss: height })).toThrow(RangeError);
  });

  it('does not represent requested postprocessing as an implemented capability', () => {
    const settings = resolveQuality('high', viewport);
    expect(settings.preset.bloomIntensity).toBe(1.2);
    expect(settings.preset.antialiasing).toBe('smaa-medium');
    expect(settings.bloomEnabled).toBe(false);
    expect(settings.antialiasing).toBe('none');
    expect(settings.implemented).toEqual([]);
    expect(settings.unsupported).toContainEqual({ feature: 'bloom', reason: 'not-implemented' });
    expect(settings.unsupported).toContainEqual({ feature: 'smaa', reason: 'not-implemented' });
  });

  it('preserves a forced tier and reports unavailable HDR rather than silently changing workload', () => {
    const settings = resolveQuality('high', {
      ...viewport,
      hdrSupported: false,
      implemented: ['bloom', 'smaa', 'render-scale', 'smaa'],
    });
    expect(settings.tier).toBe('high');
    expect(settings.pixelRatio).toBe(1.5);
    expect(settings.bloomEnabled).toBe(false);
    expect(settings.antialiasing).toBe('smaa-medium');
    expect(settings.implemented).toEqual(['render-scale', 'smaa']);
    expect(settings.unsupported).toContainEqual({ feature: 'bloom', reason: 'hdr-unsupported' });
  });

  it('uses only the requested tier AA, and enables bloom only when declared and supported', () => {
    const settings = resolveQuality('medium', { ...viewport, implemented: ['bloom', 'fxaa'] });
    expect(settings.bloomEnabled).toBe(true);
    expect(settings.antialiasing).toBe('none');
    expect(settings.implemented).not.toContain('fxaa');
    expect(settings.unsupported).toContainEqual({ feature: 'smaa', reason: 'not-implemented' });
    expect(resolveQuality('medium', { ...viewport, implemented: ['smaa'] }).antialiasing).toBe('smaa-medium');
    expect(resolveQuality('low', { ...viewport, implemented: ['fxaa', 'smaa'] }).antialiasing).toBe('none');
  });

  it('requires explicit opt-in and implementation for optional accents and aim assistance', () => {
    const implemented = ['chromatic-aberration', 'aim-assist-line'] as const;
    const defaults = resolveQuality('high', { ...viewport, implemented });
    expect(defaults.chromaticAberration).toBe(false);
    expect(defaults.aimAssistLine).toBe(false);
    const enabled = resolveQuality('high', {
      ...viewport,
      implemented,
      chromaticAberration: true,
      aimAssistLine: true,
    });
    expect(enabled.chromaticAberration).toBe(true);
    expect(enabled.aimAssistLine).toBe(true);
    const low = resolveQuality('low', {
      ...viewport,
      implemented,
      chromaticAberration: true,
      aimAssistLine: true,
    });
    expect(low.chromaticAberration).toBe(false);
    expect(low.aimAssistLine).toBe(false);
    expect(low.implemented).toEqual([]);
  });

  it('keeps low-tier readable cues and complete fallback geometry within retained capacities', () => {
    const settings = resolveQuality('low', viewport);
    expect(settings.preset.ribbonLayers).toBe(1);
    expect(settings.preset.ribbonCoreWidened).toBe(true);
    expect(settings.preset.handGlowSpots).toBe(true);
    expect(settings.preset.smashGeometry).toBe('complete-eight-octant-fallback');
    expect(settings.preset.maskTemporalBlend).toBe(false);
    expect(settings.preset.maskUpload).toBe('distinct-new-only');
    expect(settings.fragmentLifetimeMs).toBeCloseTo(FRAGMENT_LIFETIME_MS * 0.7);
    for (const preset of Object.values(QUALITY_TIER_PRESETS)) {
      expect(preset.fragmentCap).toBeLessThanOrEqual(MAX_FRAGMENTS);
      expect(preset.trailParticlesPerHand).toBeLessThanOrEqual(MAX_TRAIL_PARTICLES_PER_HAND);
    }
  });

  it('protects shared presets and returned capability reports from cross-renderer mutation', () => {
    const settings = resolveQuality('high', viewport);
    expect(Object.isFrozen(QUALITY_TIER_PRESETS)).toBe(true);
    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.preset)).toBe(true);
    expect(Object.isFrozen(settings.implemented)).toBe(true);
    expect(Object.isFrozen(settings.unsupported)).toBe(true);
    expect(Object.isFrozen(settings.unsupported[0])).toBe(true);
    expect(() => Object.defineProperty(settings.preset, 'fragmentCap', { value: 0 })).toThrow();
    expect(resolveQuality('high', viewport).preset.fragmentCap).toBe(MAX_FRAGMENTS);
  });

  it('accepts only declared own tier names and saturates explicit downgrades at low', () => {
    for (const value of ['high', 'medium', 'low']) expect(isQualityTier(value)).toBe(true);
    for (const value of ['constructor', '__proto__', 'HIGH', null, 1])
      expect(isQualityTier(value)).toBe(false);
    expect(nextLowerTier('high')).toBe('medium');
    expect(nextLowerTier('medium')).toBe('low');
    expect(nextLowerTier('low')).toBe('low');
    expect(() => resolveQuality('custom' as QualityTier, viewport)).toThrow(RangeError);
    expect(() => nextLowerTier('custom' as QualityTier)).toThrow(RangeError);
  });
});
