import * as THREE from 'three';
import { CLAY_RIM } from './clay';

// Golden-hour miniature facades: pastel walls (instance colour) with procedural windows — some
// already lit for the evening — shop fronts glowing at street level, and glassier tech parks.
// Windows come from world-space grid cells, so no textures are needed.

export function buildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aSeed;
        attribute float aGlass;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        varying float vSeed;
        varying float vGlass;
        varying float vBase;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        mat3 nm = mat3(modelMatrix);
        float base = 0.0;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          nm = nm * mat3(instanceMatrix);
          base = instanceMatrix[3].y;
        #endif
        vWPos = (modelMatrix * wp4).xyz;
        vWNormal = normalize(nm * objectNormal);
        vSeed = aSeed;
        vGlass = aGlass;
        vBase = base;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        varying float vSeed;
        varying float vGlass;
        varying float vBase;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 wn = normalize(vWNormal);
        float hgt = vWPos.y - vBase;
        if (abs(wn.y) < 0.5) {
          float hcoord = abs(wn.x) > abs(wn.z) ? vWPos.z : vWPos.x;
          vec3 glassCol = mix(vec3(0.34, 0.47, 0.6), vec3(0.62, 0.78, 0.9), fract(vWPos.y / 3.4) * 0.8);
          if (vGlass > 0.5) {
            // Curtain wall: mostly glass with thin mullions.
            vec2 c = vec2(hcoord / 2.2, vWPos.y / 3.4);
            float mull = step(0.08, fract(c.x)) * step(0.1, fract(c.y));
            diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, 0.85 * mull);
          } else if (hgt > 3.6) {
            vec2 cell = vec2(hcoord / 3.2, (hgt - 3.6) / 3.2);
            vec2 id = floor(cell);
            vec2 f = fract(cell);
            float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.8);
            float open = step(0.12, wHash(id + vSeed * 17.3));
            diffuseColor.rgb = mix(diffuseColor.rgb, glassCol * 0.85, win * open);
            // Little sill under each window.
            float sill = step(0.22, f.y) * step(f.y, 0.28) * step(0.18, f.x) * step(f.x, 0.82);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97), sill * 0.7);
          } else {
            // Ground floor: shop front.
            float door = step(0.3, fract(hcoord / 6.0)) * step(fract(hcoord / 6.0), 0.85) * step(0.25, hgt) * step(hgt, 2.9);
            diffuseColor.rgb = mix(diffuseColor.rgb * 0.92, vec3(0.28, 0.36, 0.44), door * 0.85);
          }
          // Soft contact shadow at street level.
          diffuseColor.rgb *= mix(0.72, 1.0, clamp(hgt / 2.5, 0.0, 1.0));
        } else if (wn.y > 0.5) {
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.85, 0.82), 0.55);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 en = normalize(vWNormal);
        float eh = vWPos.y - vBase;
        if (abs(en.y) < 0.5) {
          float hc = abs(en.x) > abs(en.z) ? vWPos.z : vWPos.x;
          vec3 warm = vec3(1.0, 0.7, 0.38);
          if (vGlass > 0.5) {
            vec2 gc = floor(vec2(hc / 2.2, vWPos.y / 3.4));
            totalEmissiveRadiance += warm * 0.14 * step(0.88, wHash(gc + vSeed * 13.0));
          } else if (eh > 3.6) {
            vec2 cell = vec2(hc / 3.2, (eh - 3.6) / 3.2);
            vec2 id = floor(cell);
            vec2 f = fract(cell);
            float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.8);
            float lit = step(0.74, wHash(id * 1.7 + vSeed * 23.1));
            totalEmissiveRadiance += warm * win * lit * (0.35 + 0.35 * wHash(id + 5.3));
          } else {
            float door = step(0.3, fract(hc / 6.0)) * step(fract(hc / 6.0), 0.85) * step(0.25, eh) * step(eh, 2.9);
            totalEmissiveRadiance += warm * door * 0.55 * step(0.35, fract(vSeed * 9.7));
          }
        }
        ${CLAY_RIM}`,
      );
  };
  return mat;
}
