/**
 * Sign Saber — render/quality.ts
 *
 * Responsibility: Resolve the canonical fixed cosmetic tiers without changing gameplay.
 * Spec: docs/16-performance-budget.md §Quality tiers; docs/03-decisions.md ADR-014
 * Inputs: Requested tier, CSS viewport height, device DPR and declared renderer capabilities.
 * Outputs: Immutable requested settings, computed dimensions and explicit unsupported features.
 *
 * This is configuration, not a capability/probe result or performance measurement. Consumers
 * apply the returned settings on an explicit boundary and declare only features they implement.
 * Boot workload selection, runtime adaptation and live performance acceptance remain separate.
 */
import {
  FRAGMENT_LIFETIME_MS,
  QUALITY_DPR_CAP,
  QUALITY_MEDIUM_TALL_HEIGHT_PX,
  QUALITY_MEDIUM_TALL_RENDER_SCALE,
  QUALITY_TIER_PRESETS,
} from '../core/constants';

export type QualityTier = keyof typeof QUALITY_TIER_PRESETS;
export type QualityPreset = (typeof QUALITY_TIER_PRESETS)[QualityTier];
export type QualityFeature =
  | 'render-scale'
  | 'bloom'
  | 'smaa'
  | 'fxaa'
  | 'trail-particles'
  | 'ribbon-layers'
  | 'tip-sparks'
  | 'beam-noise'
  | 'skeleton'
  | 'mask-sampling'
  | 'mask-temporal-blend'
  | 'silhouette-halo'
  | 'hand-glow-spots'
  | 'fragments'
  | 'smash-geometry'
  | 'poof-sparks'
  | 'grid'
  | 'distinct-mask-upload'
  | 'dust'
  | 'pylons'
  | 'chromatic-aberration'
  | 'aim-assist-line';
export interface QualityOptions {
  readonly viewportHeightCss: number;
  readonly devicePixelRatio: number;
  readonly hdrSupported: boolean;
  /** Renderer implementation declarations; absent features remain explicitly unavailable. */
  readonly implemented?: readonly QualityFeature[];
  readonly chromaticAberration?: boolean;
  readonly aimAssistLine?: boolean;
}
export interface UnsupportedQualityFeature {
  readonly feature: QualityFeature;
  readonly reason: 'not-implemented' | 'hdr-unsupported';
}
export interface ActiveQuality {
  readonly tier: QualityTier;
  /** Full requested table. Its presence does not claim every feature is applied. */
  readonly preset: QualityPreset;
  readonly renderScale: number;
  readonly pixelRatio: number;
  readonly fragmentLifetimeMs: number;
  readonly bloomEnabled: boolean;
  readonly antialiasing: 'none' | 'fxaa' | 'smaa-medium';
  readonly chromaticAberration: boolean;
  readonly aimAssistLine: boolean;
  readonly implemented: readonly QualityFeature[];
  readonly unsupported: readonly UnsupportedQualityFeature[];
}

export function isQualityTier(value: unknown): value is QualityTier {
  return typeof value === 'string' && Object.hasOwn(QUALITY_TIER_PRESETS, value);
}

export function nextLowerTier(tier: QualityTier): QualityTier {
  if (!isQualityTier(tier)) throw new RangeError('Unknown quality tier.');
  return tier === 'high' ? 'medium' : 'low';
}

/** Pure, non-hot-path resolution. This never opens a camera, probes a GPU or changes a tier. */
export function resolveQuality(tier: QualityTier, options: QualityOptions): ActiveQuality {
  if (!isQualityTier(tier)) throw new RangeError('Unknown quality tier.');
  if (
    !Number.isFinite(options.viewportHeightCss) ||
    options.viewportHeightCss < 0 ||
    !Number.isFinite(options.devicePixelRatio) ||
    options.devicePixelRatio <= 0
  )
    throw new RangeError('Quality viewport height and device pixel ratio must be finite and valid.');
  const preset = QUALITY_TIER_PRESETS[tier];
  const renderScale =
    tier === 'medium' && options.viewportHeightCss > QUALITY_MEDIUM_TALL_HEIGHT_PX
      ? QUALITY_MEDIUM_TALL_RENDER_SCALE
      : preset.renderScale;
  const requested: QualityFeature[] = [
    'render-scale',
    'bloom',
    'trail-particles',
    'ribbon-layers',
    'skeleton',
    'mask-sampling',
    'hand-glow-spots',
    'fragments',
    'smash-geometry',
    'poof-sparks',
    'grid',
    'distinct-mask-upload',
    'dust',
    'pylons',
  ];
  if (preset.antialiasing === 'smaa-medium') requested.push('smaa');
  else if ((preset.antialiasing as string) === 'fxaa') requested.push('fxaa');
  if (preset.tipSparks) requested.push('tip-sparks');
  if (preset.beamNoiseOctaves > 0) requested.push('beam-noise');
  if (preset.maskTemporalBlend) requested.push('mask-temporal-blend');
  if (preset.silhouetteHalo) requested.push('silhouette-halo');
  if (options.chromaticAberration && preset.chromaticAberration === 'optional-drop')
    requested.push('chromatic-aberration');
  if (options.aimAssistLine && preset.aimAssistLine === 'optional') requested.push('aim-assist-line');
  const declared = new Set(options.implemented ?? []);
  const implemented: QualityFeature[] = [];
  const unsupported: UnsupportedQualityFeature[] = [];
  for (const feature of requested) {
    if (feature === 'bloom' && !options.hdrSupported)
      unsupported.push(Object.freeze({ feature, reason: 'hdr-unsupported' }));
    else if (!declared.has(feature)) unsupported.push(Object.freeze({ feature, reason: 'not-implemented' }));
    else implemented.push(feature);
  }
  const active = new Set(implemented);
  return Object.freeze({
    tier,
    preset,
    renderScale,
    pixelRatio: Math.min(options.devicePixelRatio, QUALITY_DPR_CAP) * renderScale,
    fragmentLifetimeMs: FRAGMENT_LIFETIME_MS * preset.fragmentLifetimeScale,
    bloomEnabled: active.has('bloom'),
    antialiasing: active.has('smaa') ? 'smaa-medium' : active.has('fxaa') ? 'fxaa' : 'none',
    chromaticAberration: active.has('chromatic-aberration'),
    aimAssistLine: active.has('aim-assist-line'),
    implemented: Object.freeze(implemented),
    unsupported: Object.freeze(unsupported),
  });
}
