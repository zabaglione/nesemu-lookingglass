// AI単眼深度推定(Depth Anything V2 small)。
// 合成フレームから深度マップをリアルタイム生成し、レリーフ表示に使う。
// モデルはHugging Face Hubから初回のみダウンロードされる(ROMは送信しない。
// 送るのは画像でもなく、モデルの取得のみ)。推論は完全にローカルで実行される。
// このモジュールはmain側から動的importされ、バンドル本体を肥大化させない。

import {
  env,
  pipeline,
  RawImage,
  type DepthEstimationPipeline,
} from "@huggingface/transformers";
import { VISIBLE_H, VISIBLE_W } from "../emulator/core";

const MODEL_ID = "onnx-community/depth-anything-v2-small";

// 推論入力サイズ(14の倍数)。小さいほど速く、ドット絵なら十分
const INFER_SIZE = 252;

// 時間方向の平滑化係数(大きいほど追従が速く、ちらつきやすい)
const SMOOTHING = 0.35;

export type ProgressCallback = (message: string) => void;

export class DepthEstimator {
  private pipe: DepthEstimationPipeline | null = null;
  private busy = false;

  /** WebGPUで実行できているか(falseはWASMフォールバック=低速) */
  usingWebGPU = false;

  /** 平滑化済み深度マップ(0..1、240×224、行は上→下、1=手前) */
  readonly depth = new Float32Array(VISIBLE_W * VISIBLE_H);

  /** 結果が更新されるたびに増えるカウンタ(取り込み判定用) */
  version = 0;

  async init(onProgress: ProgressCallback): Promise<void> {
    env.allowLocalModels = false;

    const progress_callback = (p: {
      status: string;
      file?: string;
      progress?: number;
    }) => {
      if (
        p.status === "progress" &&
        typeof p.file === "string" &&
        p.file.endsWith(".onnx")
      ) {
        onProgress(
          `深度モデルをダウンロード中… ${Math.round(p.progress ?? 0)}%`,
        );
      }
    };

    this.usingWebGPU = "gpu" in navigator;
    try {
      this.pipe = await pipeline("depth-estimation", MODEL_ID, {
        device: this.usingWebGPU ? "webgpu" : "wasm",
        dtype: this.usingWebGPU ? "fp16" : "q8",
        progress_callback,
      });
    } catch (e) {
      if (!this.usingWebGPU) throw e;
      // WebGPUの初期化に失敗した環境ではWASMで再試行
      console.warn("WebGPUでの初期化に失敗、WASMで再試行します:", e);
      this.usingWebGPU = false;
      this.pipe = await pipeline("depth-estimation", MODEL_ID, {
        device: "wasm",
        dtype: "q8",
        progress_callback,
      });
    }

    // 入力を縮小して高速化(既定の518pxはNESのドット絵には過剰)
    const proc = this.pipe as unknown as {
      processor?: {
        feature_extractor?: { size?: { width: number; height: number } };
      };
    };
    if (proc.processor?.feature_extractor?.size) {
      proc.processor.feature_extractor.size = {
        width: INFER_SIZE,
        height: INFER_SIZE,
      };
    }
  }

  /**
   * 1フレーム分のRGBA(240×224、行は上→下)を推論に回す。
   * 前回の推論が終わっていなければ何もしない(フレームスキップ)。
   */
  submit(rgba: Uint8Array): void {
    if (!this.pipe || this.busy) return;
    this.busy = true;
    // 推論は非同期なのでバッファをコピーして渡す
    const img = new RawImage(rgba.slice(), VISIBLE_W, VISIBLE_H, 4);
    Promise.resolve(this.pipe(img))
      .then((out) => {
        const result = Array.isArray(out) ? out[0] : out;
        const d = result.depth; // RawImage(1ch, 0-255に正規化済み)
        const data = d.data as Uint8Array | Uint8ClampedArray;
        const w = d.width;
        const h = d.height;
        // 入力サイズと違う場合は最近傍でリサンプリングしつつEMAで平滑化
        for (let y = 0; y < VISIBLE_H; y++) {
          const sy = h === VISIBLE_H ? y : ((y * h) / VISIBLE_H) | 0;
          for (let x = 0; x < VISIBLE_W; x++) {
            const sx = w === VISIBLE_W ? x : ((x * w) / VISIBLE_W) | 0;
            const v = data[sy * w + sx] / 255;
            const i = y * VISIBLE_W + x;
            this.depth[i] += (v - this.depth[i]) * SMOOTHING;
          }
        }
        this.version++;
      })
      .catch((e) => {
        console.warn("深度推定に失敗しました:", e);
      })
      .finally(() => {
        this.busy = false;
      });
  }
}
