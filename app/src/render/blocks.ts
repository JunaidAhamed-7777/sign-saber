/**
 * Sign Saber — render/blocks.ts
 *
 * Responsibility: Instanced target materials: bevelled glass shell with emissive trims, inner light
 * core, chamfer-shaded gesture glyphs and fracture shards with hot cross-sections.
 * Spec: docs/11-rendering-blocks-and-destruction.md §2 Intact blocks, §4 Shatter
 * Inputs: Instance matrices/colours written by the renderer; shared per-frame uniforms.
 * Outputs: ShaderMaterials (HDR linear output; bloom picks up trims, cores and hot faces).
 *
 * Colour encodes state: the renderer writes palette colour × brightness, already mixed toward the
 * failure tint, into `instanceColor`. Proximity to the hit plane is derived from the instance origin,
 * so no per-instance attribute buffers are needed and gameplay state is never read here.
 */
import * as THREE from 'three';
import {
  BLOCK_CORE_SPIN_RAD_S,
  SPAWN_DISTANCE,
  TARGET_FADE_IN_M,
  BLOCK_FILL_ALPHA,
  BLOCK_NEAR_GLOW_M,
  BLOCK_RIM_GAIN,
  BLOCK_TRIM_GAIN,
  BLOCK_TRIM_NEAR_GAIN,
  GLYPH_EDGE_GAIN,
  GLYPH_FRONT_GAIN,
  SHARD_INNER_GAIN,
} from '../core/constants';

/** Uniform values shared by every target material; written once per frame by the renderer. */
export interface TargetUniforms {
  readonly uTime: THREE.IUniform<number>;
  /** 0..1 smoothed bass energy (0 in Calm). */
  readonly uPulse: THREE.IUniform<number>;
  /** Beam orb spin rate in rad/s (0 in Calm). */
  readonly uSpin: THREE.IUniform<number>;
}
export function createTargetUniforms(): TargetUniforms {
  return { uTime: { value: 0 }, uPulse: { value: 0 }, uSpin: { value: BLOCK_CORE_SPIN_RAD_S } };
}

const INSTANCE = /* glsl */ `
#ifdef USE_INSTANCING
  mat4 instanceModel = modelMatrix * instanceMatrix;
#else
  mat4 instanceModel = modelMatrix;
#endif
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.0);
#endif
`;
/** Distance-based approach fade: targets materialise over TARGET_FADE_IN_M after spawning. */
const FADE = /* glsl */ `
  vFade = smoothstep(SPAWN_DISTANCE, SPAWN_DISTANCE - TARGET_FADE_IN_M, -instanceModel[3].z);
`;
const FADE_DEFINES = {
  SPAWN_DISTANCE: SPAWN_DISTANCE.toFixed(3),
  TARGET_FADE_IN_M: TARGET_FADE_IN_M.toFixed(3),
};
const OUTPUT = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
`;

function material(
  parameters: THREE.ShaderMaterialParameters,
  uniforms: TargetUniforms,
): THREE.ShaderMaterial {
  // Shared uniform objects (not clones) so one per-frame write reaches every target material.
  return new THREE.ShaderMaterial({
    fog: true,
    ...parameters,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
  });
}

/**
 * Translucent glass body (Slash slab, Beam orb): dark tinted fill, fresnel rim and authored `aTrim` trims that
 * brighten restrainedly near the hit plane. `spin` turns the body slowly about Y (the Beam orb; never in Calm).
 */
export function createShellMaterial(uniforms: TargetUniforms, spin = false): THREE.ShaderMaterial {
  return material(
    {
      name: spin ? 'target_beam_orb' : 'target_slash_slab',
      transparent: true,
      depthWrite: true,
      defines: {
        ...FADE_DEFINES,
        ...(spin ? { SPIN: '' } : {}),
        NEAR_GLOW_M: BLOCK_NEAR_GLOW_M.toFixed(3),
        FILL_ALPHA: BLOCK_FILL_ALPHA.toFixed(3),
        RIM_GAIN: BLOCK_RIM_GAIN.toFixed(3),
        TRIM_GAIN: BLOCK_TRIM_GAIN.toFixed(3),
        TRIM_NEAR_GAIN: BLOCK_TRIM_NEAR_GAIN.toFixed(3),
      },
      vertexShader: /* glsl */ `
        attribute float aTrim;
        uniform float uTime; uniform float uSpin;
        varying vec3 vTint; varying vec3 vNormalW; varying vec3 vViewW;
        varying float vTrim; varying float vNear; varying float vFade;
        #include <fog_pars_vertex>
        void main() {
          ${INSTANCE}
          ${FADE}
          vec3 p = position; vec3 nrm = normal;
          #ifdef SPIN
            float a = uTime * uSpin;
            mat3 turn = mat3(cos(a), 0.0, -sin(a), 0.0, 1.0, 0.0, sin(a), 0.0, cos(a));
            p = turn * p; nrm = turn * nrm;
          #endif
          vec4 world = instanceModel * vec4(p, 1.0);
          vNormalW = normalize(mat3(instanceModel) * nrm);
          vViewW = cameraPosition - world.xyz;
          vTrim = aTrim;
          vNear = 1.0 - smoothstep(0.0, NEAR_GLOW_M, -instanceModel[3].z);
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uPulse;
        varying vec3 vTint; varying vec3 vNormalW; varying vec3 vViewW;
        varying float vTrim; varying float vNear; varying float vFade;
        #include <fog_pars_fragment>
        void main() {
          vec3 n = normalize(vNormalW);
          vec3 v = normalize(vViewW);
          float fres = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.4);
          float trim = vTrim;
          vec3 fill = vTint * 0.07 + vec3(0.010, 0.014, 0.026);
          vec3 rim = vTint * fres * RIM_GAIN * (1.0 + vNear * 0.6);
          vec3 trims = vTint * trim * (TRIM_GAIN + vNear * TRIM_NEAR_GAIN + uPulse * 0.35);
          gl_FragColor = vec4((fill + rim + trims) * vFade, clamp(FILL_ALPHA + fres * 0.45 + trim, 0.0, 1.0) * vFade);
          ${OUTPUT}
        }`,
    },
    uniforms,
  );
}

/** Gesture glyph: bright front face, darker chamfer so the silhouette stays crisp under bloom. */
export function createGlyphMaterial(uniforms: TargetUniforms): THREE.ShaderMaterial {
  return material(
    {
      name: 'target_glyph',
      defines: {
        ...FADE_DEFINES,
        FRONT_GAIN: GLYPH_FRONT_GAIN.toFixed(3),
        EDGE_GAIN: GLYPH_EDGE_GAIN.toFixed(3),
      },
      vertexShader: /* glsl */ `
        varying vec3 vTint; varying vec3 vNormalW; varying float vFade;
        #include <fog_pars_vertex>
        void main() {
          ${INSTANCE}
          ${FADE}
          vNormalW = normalize(mat3(instanceModel) * normal);
          vec4 mvPosition = viewMatrix * instanceModel * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vTint; varying vec3 vNormalW; varying float vFade;
        #include <fog_pars_fragment>
        void main() {
          float front = smoothstep(0.55, 0.95, normalize(vNormalW).z);
          gl_FragColor = vec4(vTint * mix(EDGE_GAIN, FRONT_GAIN, front) * vFade, 1.0);
          ${OUTPUT}
        }`,
    },
    uniforms,
  );
}

/**
 * Smash bodies and shatter shards: dark armoured outer faces with a coloured rim; fracture faces (`aInner`)
 * glow — as cracks on the intact cracked cube, and as hot cross-sections once it shatters.
 */
export function createShardMaterial(uniforms: TargetUniforms): THREE.ShaderMaterial {
  return material(
    {
      name: 'target_shard',
      defines: {
        ...FADE_DEFINES,
        INNER_GAIN: SHARD_INNER_GAIN.toFixed(3),
        RIM_GAIN: BLOCK_RIM_GAIN.toFixed(3),
      },
      vertexShader: /* glsl */ `
        attribute float aInner;
        varying vec3 vTint; varying vec3 vNormalW; varying vec3 vViewW; varying float vInner; varying float vFade;
        #include <fog_pars_vertex>
        void main() {
          ${INSTANCE}
          ${FADE}
          vec4 world = instanceModel * vec4(position, 1.0);
          vNormalW = normalize(mat3(instanceModel) * normal);
          vViewW = cameraPosition - world.xyz;
          vInner = aInner;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vTint; varying vec3 vNormalW; varying vec3 vViewW; varying float vInner; varying float vFade;
        #include <fog_pars_fragment>
        void main() {
          vec3 n = normalize(vNormalW);
          float fres = pow(1.0 - clamp(abs(dot(n, normalize(vViewW))), 0.0, 1.0), 2.0);
          vec3 outer = vTint * (0.12 + fres * RIM_GAIN * 0.7);
          vec3 inner = vTint * INNER_GAIN;
          gl_FragColor = vec4(mix(outer, inner, vInner) * vFade, 1.0);
          ${OUTPUT}
        }`,
    },
    uniforms,
  );
}
