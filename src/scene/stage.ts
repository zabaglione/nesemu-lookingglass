import * as THREE from "three";
import { VISIBLE_H, VISIBLE_W, type LayerFrames } from "../emulator/core";

// AI深度モードのレリーフメッシュの分割数
const RELIEF_SEGMENTS_X = 120;
const RELIEF_SEGMENTS_Y = 112;

// NESのピクセルアスペクト比(8:7)を反映した表示プレーンのサイズ。
// 幅 240px×8/7 : 高さ 224px
export const PLANE_W = 1.0;
export const PLANE_H = (VISIBLE_H * 7) / (VISIBLE_W * 8);

// 層間距離0でもZファイティングしないための最小間隔
const MIN_GAP = 0.004;

/** 画面比モード: TV(実機の8:7ピクセルアスペクト) / ドット等倍 */
export type AspectMode = "tv" | "square";

/** 表示モード: レイヤー分離(既定) / AI深度レリーフ */
export type DisplayMode = "layers" | "depth";

/**
 * NESのレイヤーを奥行き方向に並べた3Dシーン。
 * 奥から: 背景色 → 背面スプライト → 背景タイル → 前面スプライト
 * (NES PPUの合成順と同じ)
 */
export class Stage {
  readonly scene = new THREE.Scene();
  /** マウス操作(回転・拡縮・パン)の対象となるルート */
  readonly root = new THREE.Group();
  /** 画面比の切り替え用(X方向のみスケール) */
  private readonly screen = new THREE.Group();

  private readonly backdropMat: THREE.MeshBasicMaterial;
  private readonly bgTex: THREE.DataTexture;
  private readonly behindTex: THREE.DataTexture;
  private readonly frontTex: THREE.DataTexture;
  private readonly planes: THREE.Mesh[] = [];
  /** レイヤー分離モードの表示物一式(モード切替でまとめて隠す) */
  private readonly layersGroup = new THREE.Group();
  private gap = 0.1;

  // ---- AI深度モード ----
  private mode: DisplayMode = "layers";
  private readonly compositeTex: THREE.DataTexture;
  private readonly depthData: Uint8Array<ArrayBuffer>;
  private readonly depthTex: THREE.DataTexture;
  private readonly reliefMat: THREE.ShaderMaterial;
  private readonly reliefMesh: THREE.Mesh;

  constructor(frames: LayerFrames, compositeTexData: Uint8Array<ArrayBuffer>) {
    this.scene.add(this.root);
    this.root.add(this.screen);
    this.screen.add(this.layersGroup);

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

    // 奥→手前の順
    this.planes = [backdrop, behind, bg, front];
    for (const p of this.planes) {
      this.layersGroup.add(p);
    }
    this.applyGap();

    // ---- AI深度モード: 深度マップで頂点変位するレリーフメッシュ ----
    this.compositeTex = this.makeTexture(compositeTexData);

    this.depthData = new Uint8Array(VISIBLE_W * VISIBLE_H);
    this.depthTex = new THREE.DataTexture(
      this.depthData,
      VISIBLE_W,
      VISIBLE_H,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    // 変位を滑らかにするため深度は線形補間で読む
    this.depthTex.magFilter = THREE.LinearFilter;
    this.depthTex.minFilter = THREE.LinearFilter;
    this.depthTex.generateMipmaps = false;
    this.depthTex.needsUpdate = true;

    this.reliefMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.compositeTex },
        depthMap: { value: this.depthTex },
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
          gl_FragColor = texture2D(map, vUv);
          #include <colorspace_fragment>
        }
      `,
      side: THREE.DoubleSide,
    });
    this.reliefMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(
        PLANE_W,
        PLANE_H,
        RELIEF_SEGMENTS_X,
        RELIEF_SEGMENTS_Y,
      ),
      this.reliefMat,
    );
    this.reliefMesh.visible = false;
    this.screen.add(this.reliefMesh);
  }

  /** 表示モードを切り替える */
  setDisplayMode(mode: DisplayMode): void {
    this.mode = mode;
    this.layersGroup.visible = mode === "layers";
    this.reliefMesh.visible = mode === "depth";
  }

  get displayMode(): DisplayMode {
    return this.mode;
  }

  /** AI深度モードの変位の強さ */
  setDepthScale(v: number): void {
    this.reliefMat.uniforms.depthScale.value = v;
  }

  /** 合成フレームテクスチャの更新を通知(AI深度モード) */
  commitComposite(): void {
    this.compositeTex.needsUpdate = true;
  }

  /**
   * 深度マップを取り込む(行は上→下、0..1)。
   * テクスチャのV原点に合わせて上下反転して書き込む。
   */
  updateDepth(depthTopDown: Float32Array): void {
    for (let y = 0; y < VISIBLE_H; y++) {
      const src = y * VISIBLE_W;
      const dst = (VISIBLE_H - 1 - y) * VISIBLE_W;
      for (let x = 0; x < VISIBLE_W; x++) {
        this.depthData[dst + x] = (depthTopDown[src + x] * 255) | 0;
      }
    }
    this.depthTex.needsUpdate = true;
  }

  /** 画面比を切り替える */
  setAspectMode(mode: AspectMode): void {
    const ratio =
      mode === "tv" ? (VISIBLE_W * 8) / (VISIBLE_H * 7) : VISIBLE_W / VISIBLE_H;
    this.screen.scale.x = (PLANE_H * ratio) / PLANE_W;
  }

  /** 現在の画面プレーンの横幅(ワールド単位)。カメラのフィット計算用 */
  get screenWidth(): number {
    return PLANE_W * this.screen.scale.x;
  }

  get screenHeight(): number {
    return PLANE_H;
  }

  private makeTexture(data: Uint8Array<ArrayBuffer>): THREE.DataTexture {
    // NesCore側の使い回しバッファを直接ラップする(毎フレームのコピー不要)
    const tex = new THREE.DataTexture(
      data,
      VISIBLE_W,
      VISIBLE_H,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  private makeLayerMaterial(tex: THREE.DataTexture): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map: tex,
      // 二値アルファなのでalphaTestで十分(描画順に依存しない)
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
  }

  /** 層間距離(0〜) */
  setLayerGap(gap: number): void {
    this.gap = gap;
    this.applyGap();
  }

  private applyGap(): void {
    const g = Math.max(this.gap, MIN_GAP);
    const offsets = [-1.5, -0.5, 0.5, 1.5];
    this.planes.forEach((p, i) => {
      p.position.z = offsets[i] * g;
    });
  }

  /** 毎フレーム、エミュレータのレイヤー変換後に呼ぶ */
  commitFrame(frames: LayerFrames): void {
    this.bgTex.needsUpdate = true;
    this.behindTex.needsUpdate = true;
    this.frontTex.needsUpdate = true;
    // NESパレット値はsRGBとして解釈する(テクスチャ側のcolorSpaceと揃える)
    this.backdropMat.color.setRGB(...frames.backdrop, THREE.SRGBColorSpace);
  }
}
