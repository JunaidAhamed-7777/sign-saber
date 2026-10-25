/** Dark, faintly reflective side panels flanking the lane; never brighter than notes or the avatar. */
import * as THREE from 'three';
import {
  REFLECT_ENV_INTENSITY,
  REFLECT_ROUGHNESS,
  REFLECT_METALNESS,
  REFLECT_BASE_COLOR,
  REFLECT_LANE_CLEARANCE_X,
} from '../core/constants';

export interface Reflections {
  readonly group: THREE.Group;
  dispose(): void;
}

/** Builds floor strips and upright chrome panels outside the lane (|x| > clearance). */
export function buildReflections(): Reflections {
  const env = gradientEnvironment();

  const material = new THREE.MeshStandardMaterial({
    color: REFLECT_BASE_COLOR,
    metalness: REFLECT_METALNESS,
    roughness: REFLECT_ROUGHNESS,
    envMap: env,
    envMapIntensity: REFLECT_ENV_INTENSITY,
  });
  const floorGeo = new THREE.PlaneGeometry(2.4, 40);
  const panelGeo = new THREE.BoxGeometry(0.08, 2.6, 6);
  const group = new THREE.Group();
  group.name = 'reflections';
  for (const side of [-1, 1]) {
    const floor = new THREE.Mesh(floorGeo, material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(side * (REFLECT_LANE_CLEARANCE_X + 1.2), 0.002, -16);
    const panel = new THREE.Mesh(panelGeo, material);
    panel.position.set(side * (REFLECT_LANE_CLEARANCE_X + 2.6), 1.3, -9);
    group.add(floor, panel);
  }
  return {
    group,
    dispose() {
      group.removeFromParent();
      floorGeo.dispose();
      panelGeo.dispose();
      material.dispose();
      env.dispose();
    },
  };
}

/** Tiny equirect gradient (dark floor to cool-blue horizon band); three prefilters it on first use. */
function gradientEnvironment(): THREE.DataTexture {
  const width = 4,
    height = 16,
    data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const band = Math.max(0, 1 - Math.abs(y / (height - 1) - 0.55) * 4);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 20 + band * 60;
      data[i + 1] = 30 + band * 110;
      data[i + 2] = 60 + band * 195;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
