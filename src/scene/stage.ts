import * as THREE from "three";
import type { DepthLayerName } from "../depth/estimator";
import {
  VISIBLE_H,
  VISIBLE_W,
  type LayerFrames,
  type SpritePriority,
} from "../emulator/core";

const RELIEF_SEGMENTS_X = 120;
const RELIEF_SEGMENTS_Y = 112;
export const PLANE_W = 1.0;
export const PLANE_H = (VISIBLE_H * 7) / (VISIBLE_W * 8);
const MIN_GAP = 0.004;

export type AspectMode = "tv" | "square";
export type DisplayMode = "layers" | "background-depth" | "depth";

type DepthLayer = {
  data: Uint8Array<ArrayBuffer>;
  texture: THREE.DataTexture;
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
};

type SpriteLayer = {
  texture: THREE.DataTexture;
  mesh: THREE.Mesh;
  hybridMesh: THREE.Mesh;
  priority: SpritePriority;
  depth: number;
};

/**
 * 通常モードではPPU層を平面として、AI深度モードでは各PPU層を
 * 独立したレリーフとして奥行き方向へ配置する。
 */
export class Stage {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  private readonly screen = new THREE.Group();
  private readonly backdropMat: THREE.MeshBasicMaterial;
  private readonly bgTex: THREE.DataTexture;
  private readonly behindTex: THREE.DataTexture;
  private readonly frontTex: THREE.DataTexture;
  private readonly layerBackdrop: THREE.Mesh;
  private readonly layerBackground: THREE.Mesh;
  private readonly spriteLayers: SpriteLayer[];
  private readonly layersGroup = new THREE.Group();
  private readonly hybridGroup = new THREE.Group();
  private readonly depthGroup = new THREE.Group();
  private readonly depthBackdrop: THREE.Mesh;
  private readonly hybridBackdrop: THREE.Mesh;
  private readonly hybridBackground: THREE.Mesh;
  private readonly depthLayers: Record<DepthLayerName, DepthLayer>;
  private gap = 0.1;
  private depthScale = 0.18;
  private spriteDepthSpread = 0.8;
  private mode: DisplayMode = "layers";

  constructor(frames: LayerFrames, compositeTexData: Uint8Array<ArrayBuffer>) {
    void compositeTexData;
    this.scene.add(this.root);
    this.root.add(this.screen);
    this.screen.add(this.layersGroup, this.hybridGroup, this.depthGroup);

    const geo = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
    this.backdropMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
    });
    this.layerBackdrop = new THREE.Mesh(geo, this.backdropMat);
    this.behindTex = this.makeTexture(frames.sprBehind);
    this.bgTex = this.makeTexture(frames.bg);
    this.frontTex = this.makeTexture(frames.sprFront);
    this.layerBackground = new THREE.Mesh(
      geo,
      this.makeLayerMaterial(this.bgTex),
    );
    this.spriteLayers = frames.spriteGroups.map((group) => {
      const texture = this.makeTexture(group.rgba);
      const material = this.makeLayerMaterial(texture);
      const mesh = new THREE.Mesh(geo, material);
      const hybridMesh = new THREE.Mesh(geo, material);
      mesh.visible = group.visible;
      hybridMesh.visible = group.visible;
      return {
        texture,
        mesh,
        hybridMesh,
        priority: group.priority,
        depth: group.depth,
      };
    });
    this.layersGroup.add(
      this.layerBackdrop,
      this.layerBackground,
      ...this.spriteLayers.map((layer) => layer.mesh),
    );

    this.depthBackdrop = new THREE.Mesh(geo, this.backdropMat);
    this.hybridBackdrop = new THREE.Mesh(geo, this.backdropMat);
    this.depthLayers = {
      behind: this.makeDepthLayer(this.behindTex),
      bg: this.makeDepthLayer(this.bgTex),
      front: this.makeDepthLayer(this.frontTex),
    };
    this.hybridBackground = new THREE.Mesh(
      this.depthLayers.bg.mesh.geometry,
      this.depthLayers.bg.material,
    );
    this.hybridGroup.add(
      this.hybridBackdrop,
      this.hybridBackground,
      ...this.spriteLayers.map((layer) => layer.hybridMesh),
    );
    this.depthGroup.add(
      this.depthBackdrop,
      this.depthLayers.behind.mesh,
      this.depthLayers.bg.mesh,
      this.depthLayers.front.mesh,
    );
    this.hybridGroup.visible = false;
    this.depthGroup.visible = false;
    this.applyGap();
  }

  setDisplayMode(mode: DisplayMode): void {
    this.mode = mode;
    this.layersGroup.visible = mode === "layers";
    this.hybridGroup.visible = mode === "background-depth";
    this.depthGroup.visible = mode === "depth";
  }

  get displayMode(): DisplayMode {
    return this.mode;
  }

  setDepthScale(v: number): void {
    this.depthScale = v;
    for (const layer of Object.values(this.depthLayers)) {
      layer.material.uniforms.depthScale.value = v;
    }
    this.applyGap();
  }

  /** 旧合成テクスチャAPIとの互換用。レイヤー別モードでは処理不要。 */
  commitComposite(): void {}

  updateDepth(
    name: DepthLayerName,
    depthTopDown: Float32Array<ArrayBuffer>,
  ): void {
    const layer = this.depthLayers[name];
    for (let y = 0; y < VISIBLE_H; y++) {
      const src = y * VISIBLE_W;
      const dst = (VISIBLE_H - 1 - y) * VISIBLE_W;
      for (let x = 0; x < VISIBLE_W; x++) {
        layer.data[dst + x] = (depthTopDown[src + x] * 255) | 0;
      }
    }
    layer.texture.needsUpdate = true;
  }

  setAspectMode(mode: AspectMode): void {
    const ratio =
      mode === "tv" ? (VISIBLE_W * 8) / (VISIBLE_H * 7) : VISIBLE_W / VISIBLE_H;
    this.screen.scale.x = (PLANE_H * ratio) / PLANE_W;
  }

  get screenWidth(): number {
    return PLANE_W * this.screen.scale.x;
  }

  get screenHeight(): number {
    return PLANE_H;
  }

  setLayerGap(gap: number): void {
    this.gap = gap;
    this.applyGap();
  }

  /** 同じ前後優先度内にあるスプライトグループ同士のZ差。 */
  setSpriteDepthSpread(spread: number): void {
    this.spriteDepthSpread = Math.max(0, Math.min(1.5, spread));
    this.applyGap();
  }

  commitFrame(frames: LayerFrames): void {
    this.bgTex.needsUpdate = true;
    this.behindTex.needsUpdate = true;
    this.frontTex.needsUpdate = true;
    this.spriteLayers.forEach((layer, i) => {
      const frame = frames.spriteGroups[i];
      // 非表示グループはGPUへ転送しない。再表示時には必ず更新される。
      if (frame.visible) layer.texture.needsUpdate = true;
      layer.mesh.visible = frame.visible;
      layer.hybridMesh.visible = frame.visible;
      layer.priority = frame.priority;
      layer.depth = frame.depth;
    });
    this.backdropMat.color.setRGB(...frames.backdrop, THREE.SRGBColorSpace);
    this.applyGap();
  }

  private applyGap(): void {
    const g = Math.max(this.gap, MIN_GAP);
    this.layerBackdrop.position.z = -1.5 * g;
    this.layerBackground.position.z = 0.5 * g;
    this.spriteLayers.forEach((layer) => {
      const base = layer.priority === "behind" ? -0.5 : 1.5;
      const groupOffset = (layer.depth - 0.5) * this.spriteDepthSpread;
      layer.mesh.position.z = (base + groupOffset) * g;
      layer.hybridMesh.position.z =
        (base + groupOffset) * g +
        (layer.priority === "front" ? this.depthScale : 0);
    });
    this.hybridBackdrop.position.z = -1.5 * g;
    this.hybridBackground.position.z = 0.5 * g;
    this.depthBackdrop.position.z = -1.5 * g;
    this.depthLayers.behind.mesh.position.z = -0.5 * g;
    this.depthLayers.bg.mesh.position.z = 0.5 * g;
    this.depthLayers.front.mesh.position.z = 1.5 * g;
  }

  private makeTexture(data: Uint8Array<ArrayBuffer>): THREE.DataTexture {
    const texture = new THREE.DataTexture(
      data,
      VISIBLE_W,
      VISIBLE_H,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private makeLayerMaterial(texture: THREE.DataTexture): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map: texture,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
  }

  private makeDepthLayer(map: THREE.DataTexture): DepthLayer {
    const data = new Uint8Array(VISIBLE_W * VISIBLE_H);
    const texture = new THREE.DataTexture(
      data,
      VISIBLE_W,
      VISIBLE_H,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map },
        depthMap: { value: texture },
        depthScale: { value: 0.18 },
      },
      vertexShader: /* glsl */ `
        uniform sampler2D depthMap;
        uniform float depthScale;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          float d = texture2D(depthMap, uv).r;
          vec3 p = vec3(position.xy, position.z + d * depthScale);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(map, vUv);
          if (color.a < 0.5) discard;
          gl_FragColor = color;
          #include <colorspace_fragment>
        }
      `,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(
        PLANE_W,
        PLANE_H,
        RELIEF_SEGMENTS_X,
        RELIEF_SEGMENTS_Y,
      ),
      material,
    );
    return { data, texture, material, mesh };
  }
}
