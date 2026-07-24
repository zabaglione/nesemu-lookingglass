import * as THREE from "three";
import { VISIBLE_H, VISIBLE_W, type LayerFrames } from "../emulator/core";

// NESのピクセルアスペクト比(8:7)を反映した表示プレーンのサイズ。
// 幅 240px×8/7 : 高さ 224px
export const PLANE_W = 1.0;
export const PLANE_H = (VISIBLE_H * 7) / (VISIBLE_W * 8);

// 層間距離0でもZファイティングしないための最小間隔
const MIN_GAP = 0.004;

// 「厚み」を表現する積層スライス数(1メッシュに統合するのでドローコールは増えない)
const SLICES = 4;

/** 画面比モード: TV(実機の8:7ピクセルアスペクト) / ドット等倍 */
export type AspectMode = "tv" | "square";

/**
 * NESのレイヤーを奥行き方向に並べた3Dシーン(3DSen風ジオラマ近似)。
 * 奥から: 背景色 → 背面スプライト → 背景タイル → 前面スプライト(Y座標で
 * 8段の深度バケットに分かれ、画面の下にあるものほど手前に浮き出る)。
 * 各レイヤーは複数スライスを重ねた1メッシュで、ボクセル風の厚みを持つ。
 */
export class Stage {
  readonly scene = new THREE.Scene();
  /** マウス操作(回転・拡縮・パン)の対象となるルート */
  readonly root = new THREE.Group();
  /** 画面比の切り替え用(X方向のみスケール) */
  private readonly screen = new THREE.Group();

  private readonly backdropMat: THREE.MeshBasicMaterial;
  private readonly backdropMesh: THREE.Mesh;
  private readonly bgTex: THREE.DataTexture;
  private readonly behindTex: THREE.DataTexture;
  private readonly bucketTexs: THREE.DataTexture[];
  private readonly behindMesh: THREE.Mesh;
  private readonly bgMesh: THREE.Mesh;
  private readonly bucketMeshes: THREE.Mesh[];
  /** 全レイヤーが共有する積層クアッドジオメトリ(厚み変更時に作り直す) */
  private stackedGeo: THREE.BufferGeometry;

  private gap = 0.1;
  private thickness = 0.012;
  private spriteSpread = 0.08;

  constructor(frames: LayerFrames, buckets: Uint8Array<ArrayBuffer>[]) {
    this.scene.add(this.root);
    this.root.add(this.screen);

    this.backdropMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
    });
    this.backdropMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PLANE_W, PLANE_H),
      this.backdropMat,
    );
    this.screen.add(this.backdropMesh);

    this.stackedGeo = this.makeStackedGeometry();

    this.behindTex = this.makeTexture(frames.sprBehind);
    this.bgTex = this.makeTexture(frames.bg);
    this.behindMesh = this.makeLayerMesh(this.behindTex);
    this.bgMesh = this.makeLayerMesh(this.bgTex);

    this.bucketTexs = buckets.map((b) => this.makeTexture(b));
    this.bucketMeshes = this.bucketTexs.map((t) => this.makeLayerMesh(t));

    this.applyDepth();
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

  private makeLayerMesh(tex: THREE.DataTexture): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      // 二値アルファなのでalphaTestで十分(描画順に依存しない)
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.stackedGeo, mat);
    this.screen.add(mesh);
    return mesh;
  }

  /**
   * 同一テクスチャのクアッドをZ方向にSLICES枚重ねた1つのジオメトリを作る。
   * 斜めから見たときに層が「厚み」を持って見える(ボクセル風)。
   */
  private makeStackedGeometry(): THREE.BufferGeometry {
    const slices = this.thickness > 0 ? SLICES : 1;
    const step = slices > 1 ? this.thickness / (slices - 1) : 0;
    const positions = new Float32Array(slices * 4 * 3);
    const uvs = new Float32Array(slices * 4 * 2);
    const indices: number[] = [];
    const hw = PLANE_W / 2;
    const hh = PLANE_H / 2;
    for (let k = 0; k < slices; k++) {
      const z = k * step;
      const corners = [
        [-hw, -hh],
        [hw, -hh],
        [-hw, hh],
        [hw, hh],
      ];
      const uv = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ];
      for (let v = 0; v < 4; v++) {
        positions.set([corners[v][0], corners[v][1], z], (k * 4 + v) * 3);
        uvs.set(uv[v], (k * 4 + v) * 2);
      }
      const b = k * 4;
      indices.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
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

  /** 層間距離(0〜) */
  setLayerGap(gap: number): void {
    this.gap = gap;
    this.applyDepth();
  }

  /** 前面スプライトのジオラマ奥行き(バケット全体の広がり) */
  setSpriteSpread(spread: number): void {
    this.spriteSpread = spread;
    this.applyDepth();
  }

  /** 各レイヤーの厚み */
  setThickness(thickness: number): void {
    this.thickness = thickness;
    const old = this.stackedGeo;
    this.stackedGeo = this.makeStackedGeometry();
    for (const m of [this.behindMesh, this.bgMesh, ...this.bucketMeshes]) {
      m.geometry = this.stackedGeo;
    }
    old.dispose();
  }

  private applyDepth(): void {
    const g = Math.max(this.gap, MIN_GAP);
    this.backdropMesh.position.z = -1.5 * g;
    this.behindMesh.position.z = -0.5 * g;
    this.bgMesh.position.z = 0.5 * g;
    const n = this.bucketMeshes.length;
    this.bucketMeshes.forEach((m, i) => {
      // バケット0(画面上部=奥)→バケット末尾(画面下部=手前)
      m.position.z = 1.5 * g + (n > 1 ? (i / (n - 1)) * this.spriteSpread : 0);
    });
  }

  /** 毎フレーム、エミュレータのレイヤー変換後に呼ぶ */
  commitFrame(frames: LayerFrames): void {
    this.bgTex.needsUpdate = true;
    this.behindTex.needsUpdate = true;
    for (const t of this.bucketTexs) {
      t.needsUpdate = true;
    }
    // NESパレット値はsRGBとして解釈する(テクスチャ側のcolorSpaceと揃える)
    this.backdropMat.color.setRGB(...frames.backdrop, THREE.SRGBColorSpace);
  }
}
