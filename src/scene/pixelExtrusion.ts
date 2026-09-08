import * as THREE from "three";

export interface PixelExtrusionOptions {
  width: number;
  height: number;
  planeWidth: number;
  planeHeight: number;
}

/** Reusable boundary buffer for a pixel relief. Depth is normalized to -1. */
export class PixelExtrusionBuffer {
  readonly geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private uvs: Float32Array;
  private indices: Uint32Array;
  private readonly width: number;
  private readonly height: number;
  private readonly planeWidth: number;
  private readonly planeHeight: number;
  private quadCount = 0;

  constructor(options: PixelExtrusionOptions) {
    this.width = options.width;
    this.height = options.height;
    this.planeWidth = options.planeWidth;
    this.planeHeight = options.planeHeight;
    this.positions = new Float32Array(256 * 12);
    this.uvs = new Float32Array(256 * 8);
    this.indices = new Uint32Array(256 * 6);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage));
    this.update(new Uint8Array(options.width * options.height * 4));
  }

  update(rgba: Uint8Array): boolean {
    const pw = this.planeWidth / this.width;
    const ph = this.planeHeight / this.height;
    this.quadCount = 0;
    const opaque = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height &&
      rgba[(y * this.width + x) * 4 + 3] >= 128;
    const quad = (ax: number, ay: number, bx: number, by: number, u: number, v: number): void => {
      if (this.quadCount >= this.indices.length / 6) {
        const next = this.quadCount * 2;
        const positions = new Float32Array(next * 12); positions.set(this.positions); this.positions = positions;
        const uvs = new Float32Array(next * 8); uvs.set(this.uvs); this.uvs = uvs;
        const indices = new Uint32Array(next * 6); indices.set(this.indices); this.indices = indices;
        this.geometry.dispose();
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        this.geometry.setAttribute("uv", new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
        this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage));
      }
      const q = this.quadCount++;
      this.positions.set(
        [ax, ay, 0, bx, by, 0, bx, by, -1, ax, ay, -1],
        q * 12,
      );
      const uv = q * 8;
      for (let i = 0; i < 4; i++) {
        this.uvs[uv + i * 2] = u;
        this.uvs[uv + i * 2 + 1] = v;
      }
      const b = q * 4;
      this.indices.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
    };
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
      if (!opaque(x, y)) continue;
      const x0 = -this.planeWidth / 2 + x * pw;
      const x1 = x0 + pw;
      const y0 = -this.planeHeight / 2 + y * ph;
      const y1 = y0 + ph;
      const u = (x + 0.5) / this.width;
      const v = (y + 0.5) / this.height;
      if (!opaque(x - 1, y)) quad(x0, y0, x0, y1, u, v);
      if (!opaque(x + 1, y)) quad(x1, y1, x1, y0, u, v);
      if (!opaque(x, y - 1)) quad(x1, y0, x0, y0, u, v);
      if (!opaque(x, y + 1)) quad(x0, y1, x1, y1, u, v);
      }
    }
    const position = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const uv = this.geometry.getAttribute("uv") as THREE.BufferAttribute;
    position.needsUpdate = true;
    uv.needsUpdate = true;
    this.geometry.getIndex()!.needsUpdate = true;
    position.clearUpdateRanges(); position.addUpdateRange(0, this.quadCount * 12);
    uv.clearUpdateRanges(); uv.addUpdateRange(0, this.quadCount * 8);
    this.geometry.setDrawRange(0, this.quadCount * 6);
    this.geometry.computeBoundingSphere();
    return this.quadCount > 0;
  }

  get faces(): number { return this.quadCount; }
}

export function buildPixelExtrusionGeometry(rgba: Uint8Array, options: PixelExtrusionOptions): THREE.BufferGeometry {
  const buffer = new PixelExtrusionBuffer(options);
  buffer.update(rgba);
  return buffer.geometry;
}

export function pixelMaskHash(rgba: Uint8Array): number {
  let hash = 2166136261;
  for (let i = 3; i < rgba.length; i += 4) { hash ^= rgba[i] >= 128 ? 1 : 0; hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
