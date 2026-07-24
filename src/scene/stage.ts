import * as THREE from "three";
import type { DepthLayerName } from "../depth/estimator";
import { VISIBLE_H, VISIBLE_W, type LayerFrames } from "../emulator/core";

const RELIEF_SEGMENTS_X = 120;
const RELIEF_SEGMENTS_Y = 112;
export const PLANE_W = 1.0;
export const PLANE_H = (VISIBLE_H * 7) / (VISIBLE_W * 8);
const MIN_GAP = 0.004;

export type AspectMode = "tv" | "square";
export type DisplayMode = "layers" | "depth";

type DepthLayer = {
  data: Uint8Array<ArrayBuffer>;
  texture: THREE.DataTexture;
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
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
  private readonly planes: THREE.Mesh[] = [];
  private readonly layersGroup = new THREE.Group();
  private readonly depthGroup = new THREE.Group();
  private readonly depthBackdrop: THREE.Mesh;
  private readonly depthLayers: Record<DepthLayerName, DepthLayer>;
  private gap = 0.1;
  private mode: DisplayMode = "layers";

  constructor(frames: LayerFrames, compositeTexData: Uint8Array<ArrayBuffer>) {
    void compositeTexData;
    this.scene.add(this.root);
    this.root.add(this.screen);
    this.screen.add(this.layersGroup, this.depthGroup);

    const geo = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
    this.backdropMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
    });
    const backdrop = new THREE.Mesh(geo, this.backdropMat);
    this.behindTex = this.makeTexture(frames.sprBehind);
    this.bgTex = this.makeTexture(frames.bg);
    this.frontTex = this.makeTexture(frames.sprFront);
    const behind = new THREE.Mesh(geo, this.makeLayerMaterial(this.behindTex));
    const bg = new THREE.Mesh(geo, this.makeLayerMaterial(this.bgTex));
    const front = new THREE.Mesh(geo, this.makeLayerMaterial(this.frontTex));
    this.planes = [backdrop, behind, bg, front];
    this.layersGroup.add(...this.planes);

    this.depthBackdrop = new THREE.Mesh(geo, this.backdropMat);
    this.depthLayers = {
      behind: this.makeDepthLayer(this.behindTex),
      bg: this.makeDepthLayer(this.bgTex),
      front: this.makeDepthLayer(this.frontTex),
    };
    this.depthGroup.add(
      this.depthBackdrop,
      this.depthLayers.behind.mesh,
      this.depthLayers.bg.mesh,
      this.depthLayers.front.mesh,
    );
    this.depthGroup.visible = false;
    this.applyGap();
  }

  setDisplayMode(mode: DisplayMode): void {
    this.mode = mode;
    this.layersGroup.visible = mode === "layers";
    this.depthGroup.visible = mode === "depth";
  }

  get displayMode(): DisplayMode {
    return this.mode;
  }

  setDepthScale(v: number): void {
    for (const layer of Object.values(this.depthLayers)) {
      layer.material.uniforms.depthScale.value = v;
    }
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

  commitFrame(frames: LayerFrames): void {
    this.bgTex.needsUpdate = true;
    this.behindTex.needsUpdate = true;
    this.frontTex.needsUpdate = true;
    this.backdropMat.color.setRGB(...frames.backdrop, THREE.SRGBColorSpace);
  }

  private applyGap(): void {
    const g = Math.max(this.gap, MIN_GAP);
    const offsets = [-1.5, -0.5, 0.5, 1.5];
    this.planes.forEach((plane, i) => {
      plane.position.z = offsets[i] * g;
    });
    this.depthBackdrop.position.z = offsets[0] * g;
    this.depthLayers.behind.mesh.position.z = offsets[1] * g;
    this.depthLayers.bg.mesh.position.z = offsets[2] * g;
    this.depthLayers.front.mesh.position.z = offsets[3] * g;
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
