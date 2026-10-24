/**
 * Sign Saber — render/postfx.ts
 *
 * Responsibility: postprocessing EffectComposer: HDR half-float scene → mipmap bloom → vignette and
 * ACES tone mapping → tier antialiasing (SMAA high, FXAA medium, none low).
 * Spec: docs/13-rendering-environment-camera-postfx.md §6 Post FX, §7 Quality tiers
 * Inputs: Scene, camera, the resolved fixed quality tier, a bounded music accent.
 * Outputs: Final image to the default framebuffer.
 *
 * Only constructed when a renderable half-float target is available (otherwise the renderer keeps its
 * direct path and reports bloom as unsupported). Chromatic aberration and the obstacle glitch remain
 * unimplemented candidates; they are never reported as active.
 */
import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { ActiveQuality } from './quality';
import {
  BLOOM_ACCENT_MAX,
  BLOOM_RADIUS,
  BLOOM_SMOOTHING,
  BLOOM_THRESHOLD,
  VIGNETTE_DARKNESS,
  VIGNETTE_OFFSET,
} from '../core/constants';

/** True when the context can render to the HDR half-float buffers bloom requires. */
export function supportsHdrTargets(renderer: THREE.WebGLRenderer): boolean {
  // A context without an extensions registry (headless/test doubles) cannot promise HDR targets.
  const extensions = renderer.extensions as THREE.WebGLRenderer['extensions'] | undefined;
  return (
    !!extensions &&
    (extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float'))
  );
}

/**
 * Applies the tier's bloom resolution scale to the mip chain. The mipmap blur halves its input once,
 * so a base of `2 × scale × drawing buffer` makes its first level `scale × drawing buffer`.
 */
class TierBloomEffect extends BloomEffect {
  resolutionScaleForTier = 0.5;
  override setSize(width: number, height: number): void {
    super.setSize(width, height);
    const factor = Math.min(1, this.resolutionScaleForTier * 2);
    this.mipmapBlurPass.setSize(
      Math.max(1, Math.round(width * factor)),
      Math.max(1, Math.round(height * factor)),
    );
  }
}

export class PostFx {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: TierBloomEffect;
  private readonly aaPass: EffectPass | null;
  private baseIntensity: number;
  readonly antialiasing: ActiveQuality['antialiasing'];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    quality: ActiveQuality,
  ) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new TierBloomEffect({
      mipmapBlur: true,
      luminanceThreshold: BLOOM_THRESHOLD,
      luminanceSmoothing: BLOOM_SMOOTHING,
      intensity: quality.preset.bloomIntensity,
      radius: BLOOM_RADIUS,
      levels: quality.preset.bloomMipLevels,
    });
    this.bloom.resolutionScaleForTier = quality.preset.bloomResolutionScale;
    this.baseIntensity = quality.preset.bloomIntensity;
    const vignette = new VignetteEffect({ darkness: VIGNETTE_DARKNESS, offset: VIGNETTE_OFFSET });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new EffectPass(camera, this.bloom, vignette, tone));
    this.antialiasing = quality.antialiasing;
    this.aaPass =
      quality.antialiasing === 'smaa-medium'
        ? new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM }))
        : quality.antialiasing === 'fxaa'
          ? new EffectPass(camera, new FXAAEffect())
          : null;
    if (this.aaPass) this.composer.addPass(this.aaPass);
  }

  /** Re-applies tier settings that can change on resize (bloom intensity/levels/resolution). */
  configure(quality: ActiveQuality): void {
    this.baseIntensity = quality.preset.bloomIntensity;
    this.bloom.mipmapBlurPass.levels = quality.preset.bloomMipLevels;
    this.bloom.resolutionScaleForTier = quality.preset.bloomResolutionScale;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  /** `accent` 0..1 is a bounded music accent on bloom intensity (callers pass 0 in Calm). */
  render(deltaSeconds: number, accent: number): void {
    this.bloom.intensity = this.baseIntensity + BLOOM_ACCENT_MAX * Math.max(0, Math.min(1, accent));
    this.composer.render(deltaSeconds);
  }

  get passCount(): number {
    return this.composer.passes.length;
  }

  dispose(): void {
    this.composer.dispose();
  }
}
