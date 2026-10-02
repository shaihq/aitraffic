import * as THREE from 'three';

// Miniature depth of field: blur grows with distance from the focus plane (the point the camera
// is looking at), plus a little extra toward the frame edges — like a macro lens on a toy city.
// Separable: run once horizontally, once vertically. Depth comes from the scene render target.

export function dofShader(direction: 'h' | 'v') {
  return {
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
      uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uDir: { value: direction === 'h' ? new THREE.Vector2(1, 0) : new THREE.Vector2(0, 1) },
      uNear: { value: 1 },
      uFar: { value: 20000 },
      uFocus: { value: 300 },
      uAperture: { value: 1 },
      uMaxBlur: { value: 6 },
      uEdge: { value: 2 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform vec2 uTexel;
      uniform vec2 uDir;
      uniform float uNear;
      uniform float uFar;
      uniform float uFocus;
      uniform float uAperture;
      uniform float uMaxBlur;
      uniform float uEdge;
      varying vec2 vUv;

      float sceneZ(vec2 uv) {
        float d = texture2D(tDepth, uv).x;
        return -perspectiveDepthToViewZ(d, uNear, uFar);
      }

      void main() {
        float z = sceneZ(vUv);
        // Things beyond the focus (the upper part of the frame) blur less than the foreground.
        float coc = clamp(abs(z - uFocus) / max(z, 1.0) * uAperture * (z > uFocus ? 0.3 : 1.0), 0.0, 1.0);
        vec2 c = vUv - 0.5;
        // Edge softening starts later toward the top so the skyline band stays readable.
        float edge = smoothstep(0.8, 1.4, length(vec2(c.x * 0.75, c.y * (c.y > 0.0 ? 0.7 : 1.0))) * 2.0);
        float k = max(coc * uMaxBlur, edge * uEdge);
        vec2 s = uDir * uTexel * k;
        vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270270;
        sum += texture2D(tDiffuse, vUv + s * 1.3846153846) * 0.3162162162;
        sum += texture2D(tDiffuse, vUv - s * 1.3846153846) * 0.3162162162;
        sum += texture2D(tDiffuse, vUv + s * 3.2307692308) * 0.0702702703;
        sum += texture2D(tDiffuse, vUv - s * 3.2307692308) * 0.0702702703;
        gl_FragColor = sum;
      }`,
  };
}
