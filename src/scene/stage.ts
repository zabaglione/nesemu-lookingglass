import * as THREE from "three";
import { VISIBLE_H, VISIBLE_W, type LayerFrames, type SpritePriority } from "../emulator/core";
import { PixelExtrusionBuffer, pixelMaskHash } from "./pixelExtrusion";

export const PLANE_W = 1;
export const PLANE_H = (VISIBLE_H * 7) / (VISIBLE_W * 8);
const MIN_GAP = 0.004;
export const DEFAULT_LAYER_GAP = 0.09;
export const DEFAULT_DEPTH_SCALE = 1.35;
export type AspectMode = "tv" | "square";

type PixelLayer = {
  group: THREE.Group;
  front: THREE.Mesh;
  back: THREE.Mesh;
  side: THREE.Mesh;
  extrusion: PixelExtrusionBuffer;
  rgba: Uint8Array;
  mask: Uint8Array;
  hash: number;
  desiredThickness: number;
  thickness: number;
  priority: SpritePriority;
  depth: number;
};

export class Stage {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  private readonly screen = new THREE.Group();
  private readonly backdrop: THREE.Mesh;
  private readonly pixelGroup = new THREE.Group();
  private readonly bgTexture: THREE.DataTexture;
  private readonly bg: PixelLayer;
  private readonly sprites: PixelLayer[];
  private gap = DEFAULT_LAYER_GAP;
  private depthScale = DEFAULT_DEPTH_SCALE;
  private spriteDepthSpread = 0.8;
  private bgThickness = 0.06;
  private spriteThickness = 0.035;

  constructor(frames: LayerFrames) {
    this.scene.add(this.root);
    this.root.add(this.screen);
    this.screen.add(this.pixelGroup);
    this.pixelGroup.scale.z = this.depthScale;
    const plane = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
    const backdropMat = new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide });
    this.backdrop = new THREE.Mesh(plane, backdropMat);
    this.backdrop.frustumCulled = false;
    this.bgTexture = this.makeTexture(frames.bg);
    this.bg = this.makePixelLayer(this.bgTexture, frames.bg, "front", 0.5, this.bgThickness);
    this.sprites = frames.spriteGroups.map((group) =>
      this.makePixelLayer(this.makeTexture(group.rgba), group.rgba, group.priority, group.depth, this.spriteThickness),
    );
    this.pixelGroup.add(this.backdrop, this.bg.group, ...this.sprites.map((layer) => layer.group));
    this.commitFrame(frames);
  }

  setAspectMode(mode: AspectMode): void {
    const ratio = mode === "tv" ? (VISIBLE_W * 8) / (VISIBLE_H * 7) : VISIBLE_W / VISIBLE_H;
    this.screen.scale.x = (PLANE_H * ratio) / PLANE_W;
  }
  get screenWidth(): number { return PLANE_W * this.screen.scale.x; }
  get screenHeight(): number { return PLANE_H; }
  setLayerGap(value: number): void { this.gap = value; this.applyGap(); }
  setDepthScale(value: number): void {
    this.depthScale = Math.max(0.5, Math.min(2, value));
    this.pixelGroup.scale.z = this.depthScale;
    this.applyGap();
  }
  get currentDepthScale(): number { return this.depthScale; }
  setSpriteDepthSpread(value: number): void { this.spriteDepthSpread = Math.max(0, Math.min(1.5, value)); this.applyGap(); }
  setPixelBackgroundThickness(value: number): void { this.bgThickness = Math.max(0, Math.min(0.3, value)); this.bg.desiredThickness = this.bgThickness; this.applyGap(); }
  setPixelSpriteThickness(value: number): void { this.spriteThickness = Math.max(0, Math.min(0.3, value)); for (const layer of this.sprites) layer.desiredThickness = this.spriteThickness; this.applyGap(); }

  commitFrame(frames: LayerFrames): void {
    this.bgTexture.needsUpdate = true;
    this.updatePixel(this.bg, frames.bg);
    this.bg.priority = "front";
    this.sprites.forEach((layer, i) => {
      const frame = frames.spriteGroups[i];
      layer.group.visible = frame.visible;
      if (frame.visible) {
        (layer.front.material as THREE.MeshBasicMaterial).map!.needsUpdate = true;
      }
      layer.priority = frame.priority;
      layer.depth = frame.depth;
      if (frame.visible) this.updatePixel(layer, frame.rgba);
    });
    (this.backdrop.material as THREE.MeshBasicMaterial).color.setRGB(...frames.backdrop, THREE.SRGBColorSpace);
    this.applyGap();
  }

  private applyGap(): void {
    const g = Math.max(this.gap, MIN_GAP);
    this.pixelGroup.position.z = -0.5 * g * this.depthScale;
    this.backdrop.position.z = -1.5 * g;
    this.bg.group.position.z = 0.5 * g;
    const margin = Math.max(MIN_GAP * 0.25, g * 0.02);
    let bgMax = this.bg.group.position.z - this.backdrop.position.z - margin;
    for (let i = 0; i < this.sprites.length; i++) {
      const layer = this.sprites[i];
      const base = layer.priority === "behind" ? -0.5 : 1.5;
      layer.group.position.z = (base + (layer.depth - 0.5) * this.spriteDepthSpread) * g;
      if (layer.priority === "behind" && layer.group.visible) bgMax = Math.min(bgMax, this.bg.group.position.z - layer.group.position.z - margin);
    }
    this.setEffectiveThickness(this.bg, Math.min(this.bg.desiredThickness, Math.max(0, bgMax)));
    for (const layer of this.sprites) {
      const max = layer.priority === "behind"
        ? layer.group.position.z - this.backdrop.position.z - margin
        : layer.group.position.z - this.bg.group.position.z - margin;
      this.setEffectiveThickness(layer, Math.min(layer.desiredThickness, Math.max(0, max)));
    }
  }
  private setEffectiveThickness(layer: PixelLayer, value: number): void {
    if (value === layer.thickness) return;
    layer.thickness = value;
    layer.back.position.z = -value;
    layer.back.visible = value > 0;
    layer.side.scale.z = value;
    layer.side.visible = value > 0 && layer.extrusion.faces > 0;
  }
  private makeTexture(data: Uint8Array): THREE.DataTexture {
    const texture = new THREE.DataTexture(data as Uint8Array<ArrayBuffer>, VISIBLE_W, VISIBLE_H, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
    return texture;
  }
  private makePixelLayer(texture: THREE.DataTexture, rgba: Uint8Array, priority: SpritePriority, depth: number, thickness: number): PixelLayer {
    const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H), material);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H), material);
    const extrusion = new PixelExtrusionBuffer({ width: VISIBLE_W, height: VISIBLE_H, planeWidth: PLANE_W, planeHeight: PLANE_H });
    extrusion.update(rgba);
    const side = new THREE.Mesh(extrusion.geometry, new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide }));
    // Three.js XR culling uses the first view's frustum. Keep every pixel
    // layer available to the full quilt so edge views cannot lose geometry.
    front.frustumCulled = false;
    back.frustumCulled = false;
    side.frustumCulled = false;
    const group = new THREE.Group();
    group.add(back, side, front);
    side.scale.z = thickness;
    side.visible = thickness > 0 && extrusion.faces > 0;
    back.position.z = -thickness;
    back.visible = thickness > 0;
    const mask = new Uint8Array(VISIBLE_W * VISIBLE_H);
    for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
    return { group, front, back, side, extrusion, rgba, mask, hash: pixelMaskHash(rgba), desiredThickness: thickness, thickness, priority, depth };
  }
  private updatePixel(layer: PixelLayer, rgba: Uint8Array): void {
    const hash = pixelMaskHash(rgba);
    let changed = hash !== layer.hash || layer.rgba !== rgba;
    if (!changed) for (let i = 0; i < layer.mask.length; i++) if (layer.mask[i] !== (rgba[i * 4 + 3] >= 128 ? 1 : 0)) { changed = true; break; }
    if (!changed) return;
    layer.rgba = rgba; layer.extrusion.update(rgba); layer.hash = hash;
    for (let i = 0; i < layer.mask.length; i++) layer.mask[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
    layer.side.visible = layer.thickness > 0 && layer.extrusion.faces > 0;
  }
}
