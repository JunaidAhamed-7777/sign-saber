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
  BLOCK_CORE_GAIN,
  BLOCK_CORE_SPIN_RAD_S,
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
  /** Core spin rate in rad/s (0 in Calm). */
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

/** Translucent glass shell: dark tinted fill, fresnel rim and bevel trims that brighten near the hit plane. */
export function createShellMaterial(uniforms: TargetUniforms): THREE.ShaderMaterial {
  return material(
    {
      name: 'target_glass_shell',
      transparent: true,
      depthWrite: true,
      defines: {
        NEAR_GLOW_M: BLOCK_NEAR_GLOW_M.toFixed(3),
        FILL_ALPHA: BLOCK_FILL_ALPHA.toFixed(3),
        RIM_GAIN: BLOCK_RIM_GAIN.toFixed(3),
        TRIM_GAIN: BLOCK_TRIM_GAIN.toFixed(3),
        TRIM_NEAR_GAIN: BLOCK_TRIM_NEAR_GAIN.toFixed(3),
      },
      vertexShader: /* glsl */ `
        attribute float aTrim;
        varying vec3 vTint; varying vec3 vNormalW; varying vec3 vViewW; varying vec3 vLocal;
        varying float vTrim; varying float vNear;
        #include <fog_pars_vertex>
        void main() {
          ${INSTANCE}
          vec4 world = instanceModel * vec4(position, 1.0);
          vNormalW = normalize(mat3(instanceModel) * normal);
          vViewW = cameraPosition - world.xyz;
          vLocal = position;
          vTrim = aTrim;
          vNear = 1.0 - smoothstep(0.0, NEAR_GLOW_M, -instanceModel[3].z);
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uPulse;
        varying vec3 vTint; varying vec3 vNormalW; varying vec3 vViewW; varying vec3 vLocal;
        varying float vTrim; varying float vNear;
        #include <fog_pars_fragment>
        void main() {
          vec3 n = normalize(vNormalW);
          vec3 v = normalize(vViewW);
          float fres = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.4);
          // Procedural edge term keeps the unbevelled fallback cube trimmed as well.
          vec3 faceDist = 1.0 - abs(vLocal) / 0.5;
          float second = max(min(faceDist.x, faceDist.y), min(max(faceDist.x, faceDist.y), faceDist.z));
          float trim = max(vTrim, 1.0 - smoothstep(0.0, 0.08, second));
          vec3 fill = vTint * 0.07 + vec3(0.010, 0.014, 0.026);
          vec3 rim = vTint * fres * RIM_GAIN * (1.0 + vNear * 0.6);
          vec3 trims = vTint * trim * (TRIM_GAIN + vNear * TRIM_NEAR_GAIN + uPulse * 0.35);
          gl_FragColor = vec4(fill + rim + trims, clamp(FILL_ALPHA + fres * 0.45 + trim, 0.0, 1.0));
          ${OUTPUT}
        }`,
    },
    uniforms,
  );
}

/** Opaque faceted light core inside the shell; spins slowly (not in Calm) and brightens near the hit plane. */
export function createCoreMaterial(uniforms: TargetUniforms): THREE.ShaderMaterial {
  return material(
    {
      name: 'target_core',
      defines: { NEAR_GLOW_M: BLOCK_NEAR_GLOW_M.toFixed(3), CORE_GAIN: BLOCK_CORE_GAIN.toFixed(3) },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uSpin;
        varying vec3 vTint; varying vec3 vNormalW; varying float vNear;
        #include <fog_pars_vertex>
        void main() {
          ${INSTANCE}
          float a = uTime * uSpin;
          mat3 spin = mat3(cos(a), 0.0, -sin(a), 0.0, 1.0, 0.0, sin(a), 0.0, cos(a));
          vec4 world = instanceModel * vec4(spin * position, 1.0);
          vNormalW = normalize(mat3(instanceModel) * (spin * normal));
          vNear = 1.0 - smoothstep(0.0, NEAR_GLOW_M, -instanceModel[3].z);
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uPulse;
        varying vec3 vTint; varying vec3 vNormalW; varying float vNear;
        #include <fog_pars_fragment>
        void main() {
          vec3 n = normalize(vNormalW);
          float facet = 0.55 + 0.45 * abs(dot(n, normalize(vec3(0.35, 0.8, 0.5))));
          vec3 hot = mix(vTint, vec3(1.0), 0.3);
          gl_FragColor = vec4(hot * facet * CORE_GAIN * (0.75 + vNear * 0.9 + uPulse * 0.3), 1.0);
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
      defines: { FRONT_GAIN: GLYPH_FRONT_GAIN.toFixed(3), EDGE_GAIN: GLYPH_EDGE_GAIN.toFixed(3) },
      vertexShader: /* glsl */ `
        varying vec3 vTint; varying vec3 vNormalW;
        #include <fog_pars_vertex>
        void main() {
          ${INSTANCE}
          vNormalW = normalize(mat3(instanceModel) * normal);
          vec4 mvPosition = viewMatrix * instanceModel * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vTint; varying vec3 vNormalW;
        #include <fog_pars_fragment>
        void main() {
          float front = smoothstep(0.55, 0.95, normalize(vNormalW).z);
          gl_FragColor = vec4(vTint * mix(EDGE_GAIN, FRONT_GAIN, front), 1.0);
          ${OUTPUT}
        }`,
    },
    uniforms,
  );
}

/** Shatter shards: dark glass outer faces with a coloured rim; fracture faces glow from `aInner`. */
export function createShardMaterial(uniforms: TargetUniforms): THREE.ShaderMaterial {
  return material(
    {
      name: 'target_shard',
      defines: { INNER_GAIN: SHARD_INNER_GAIN.toFixed(3), RIM_GAIN: BLOCK_RIM_GAIN.toFixed(3) },
      vertexShader: /* glsl */ `
        attribute float aInner;
        varying vec3 vTint; varying vec3 vNormalW; varying vec3 vViewW; varying float vInner;
        #include <fog_pars_vertex>
        void main() {
          ${INSTANCE}
          vec4 world = instanceModel * vec4(position, 1.0);
          vNormalW = normalize(mat3(instanceModel) * normal);
          vViewW = cameraPosition - world.xyz;
          vInner = aInner;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vTint; varying vec3 vNormalW; varying vec3 vViewW; varying float vInner;
        #include <fog_pars_fragment>
        void main() {
          vec3 n = normalize(vNormalW);
          float fres = pow(1.0 - clamp(abs(dot(n, normalize(vViewW))), 0.0, 1.0), 2.0);
          vec3 outer = vTint * (0.16 + fres * RIM_GAIN * 1.4);
          vec3 inner = mix(vTint, vec3(1.0), 0.25) * INNER_GAIN;
          gl_FragColor = vec4(mix(outer, inner, vInner), 1.0);
          ${OUTPUT}
        }`,
    },
    uniforms,
  );
}
