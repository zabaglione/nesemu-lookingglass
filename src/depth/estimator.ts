// PPUレイヤー単位のAI単眼深度推定。

import {
  env,
  pipeline,
  RawImage,
  type DepthEstimationPipeline,
} from "@huggingface/transformers";
import { VISIBLE_H, VISIBLE_W, type LayerFrames } from "../emulator/core";

const MODEL_ID = "onnx-community/depth-anything-v2-small";

export const DEPTH_LAYER_NAMES = ["behind", "bg", "front"] as const;
export type DepthLayerName = (typeof DEPTH_LAYER_NAMES)[number];
export type ProgressCallback = (message: string) => void;

type LayerState = {
  depth: Float32Array<ArrayBuffer>;
  version: number;
};

export class DepthEstimator {
  private pipe: DepthEstimationPipeline | null = null;
  private busy = false;
  private nextLayer = 0;
  private inferSize = 252;

  smoothing = 0.35;
  usingWebGPU = false;

  readonly layers: Record<DepthLayerName, LayerState> = {
    behind: { depth: new Float32Array(VISIBLE_W * VISIBLE_H), version: 0 },
    bg: { depth: new Float32Array(VISIBLE_W * VISIBLE_H), version: 0 },
    front: { depth: new Float32Array(VISIBLE_W * VISIBLE_H), version: 0 },
  };

  async init(onProgress: ProgressCallback): Promise<void> {
    env.allowLocalModels = false;
    env.useBrowserCache = true;
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
      console.warn("WebGPU initialization failed; retrying with WASM.", e);
      this.usingWebGPU = false;
      this.pipe = await pipeline("depth-estimation", MODEL_ID, {
        device: "wasm",
        dtype: "q8",
        progress_callback,
      });
    }
    this.applyInferSize();
  }

  setInferSize(px: number): void {
    this.inferSize = px;
    this.applyInferSize();
  }

  private applyInferSize(): void {
    const proc = this.pipe as unknown as {
      processor?: {
        feature_extractor?: { size?: { width: number; height: number } };
      };
    } | null;
    if (proc?.processor?.feature_extractor?.size) {
      proc.processor.feature_extractor.size = {
        width: this.inferSize,
        height: this.inferSize,
      };
    }
  }

  /**
   * 指定されたPPU層を順番に1層ずつ推論する。背景のみモードでは
   * layers=["bg"]を渡し、スプライトの不要な推論を省略する。
   * 透明部分は背景色で埋め、出力時にマスクして他層の形状混入を防ぐ。
   */
  submit(
    frames: LayerFrames,
    layers: readonly DepthLayerName[] = DEPTH_LAYER_NAMES,
  ): void {
    if (!this.pipe || this.busy || layers.length === 0) return;
    const name = layers[this.nextLayer % layers.length];
    this.nextLayer = (this.nextLayer + 1) % layers.length;
    const source =
      name === "behind"
        ? frames.sprBehind
        : name === "front"
          ? frames.sprFront
          : frames.bg;
    const input = new Uint8Array(VISIBLE_W * VISIBLE_H * 4);
    const mask = new Uint8Array(VISIBLE_W * VISIBLE_H);
    const backdrop = frames.backdrop.map((v) => Math.round(v * 255));

    for (let y = 0; y < VISIBLE_H; y++) {
      const sourceRow = (VISIBLE_H - 1 - y) * VISIBLE_W * 4;
      const targetRow = y * VISIBLE_W * 4;
      for (let x = 0; x < VISIBLE_W; x++) {
        const so = sourceRow + x * 4;
        const to = targetRow + x * 4;
        const opaque = source[so + 3] >= 128;
        mask[y * VISIBLE_W + x] = opaque ? 1 : 0;
        input[to] = opaque ? source[so] : backdrop[0];
        input[to + 1] = opaque ? source[so + 1] : backdrop[1];
        input[to + 2] = opaque ? source[so + 2] : backdrop[2];
        input[to + 3] = 255;
      }
    }

    this.busy = true;
    const img = new RawImage(input, VISIBLE_W, VISIBLE_H, 4);
    Promise.resolve(this.pipe(img))
      .then((out) => {
        const result = Array.isArray(out) ? out[0] : out;
        const data = result.depth.data as Uint8Array | Uint8ClampedArray;
        const w = result.depth.width;
        const h = result.depth.height;
        const state = this.layers[name];
        for (let y = 0; y < VISIBLE_H; y++) {
          const sy = h === VISIBLE_H ? y : ((y * h) / VISIBLE_H) | 0;
          for (let x = 0; x < VISIBLE_W; x++) {
            const i = y * VISIBLE_W + x;
            const sx = w === VISIBLE_W ? x : ((x * w) / VISIBLE_W) | 0;
            const value = mask[i] ? data[sy * w + sx] / 255 : 0;
            state.depth[i] +=
              (value - state.depth[i]) * this.smoothing;
          }
        }
        state.version++;
      })
      .catch((e) => {
        console.warn(`Depth estimation failed for layer ${name}.`, e);
      })
      .finally(() => {
        this.busy = false;
      });
  }
}
