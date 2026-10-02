import * as THREE from 'three';

// Procedural textures for faked light (headlight pools, lamp pools, beacons) — no bloom pass needed.

export function radialTexture(size = 128, falloff = 2.2): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.pow(1 - d, falloff);
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Headlight beam on the road: bright near the car, fading ahead and to the sides. */
export function beamTexture(w = 64, h = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const along = y / (h - 1); // 0 = at the car, 1 = far end
    const spread = 0.25 + along * 0.75;
    for (let x = 0; x < w; x++) {
      const across = Math.abs((x + 0.5) / w - 0.5) * 2;
      const side = Math.max(0, 1 - Math.pow(across / spread, 2));
      const a = side * Math.pow(1 - along, 1.6) * Math.min(1, along * 8);
      const o = (y * w + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function additiveMaterial(map: THREE.Texture, color: THREE.ColorRepresentation, opacity: number) {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: true,
  });
}
