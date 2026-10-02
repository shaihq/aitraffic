import * as THREE from 'three';

// Soft "clay toy" surface: a matte standard material plus a gentle fresnel rim so rounded
// shapes read like modelling clay under studio light. Shared by vehicles, people, trees, props.

export const CLAY_RIM = /* glsl */ `
  {
    vec3 clayView = normalize(vViewPosition);
    float clayRim = pow(1.0 - clamp(dot(normal, clayView), 0.0, 1.0), 2.6);
    totalEmissiveRadiance += diffuseColor.rgb * clayRim * 0.32;
  }
`;

export function clayMaterial(params: THREE.MeshStandardMaterialParameters = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, ...params });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${CLAY_RIM}`);
  };
  return mat;
}
