import {
  LookingGlassConfig,
  LookingGlassWebXRPolyfill,
} from "@lookingglass/webxr";
import type * as THREE from "three";

// Looking Glass WebXRポリフィルの初期化。
// navigator.xrを置き換えるため、three.jsのレンダラー生成前に呼ぶこと。
// キャリブレーションはLooking Glass Bridge経由で自動取得される。

let polyfill: LookingGlassWebXRPolyfill | null = null;

export function initLookingGlass(): void {
  if (polyfill) return;
  polyfill = new LookingGlassWebXRPolyfill({
    // シーンは原点中心・幅約1のNES画面なので、カメラ焦点を原点に置く
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    targetDiam: 1.6,
    fovy: (14 * Math.PI) / 180,
  });
  patchDeviceAnimationFrame();
}

/**
 * ポリフィルのXRセッションは既定でメインウィンドウのrAFで駆動されるため、
 * メインウィンドウが最小化・他ウィンドウに完全に隠れるとブラウザの
 * スロットリングで描画が止まり、Looking Glass側の表示が凍結する。
 * 対策: フレーム予約をメインとポップアップ(Looking Glass側・全画面なので
 * 通常は常に可視)の両方に行い、先に発火した方で駆動する。
 * どちらか一方でも可視なら表示が途絶えない。
 */
function patchDeviceAnimationFrame(): void {
  const device = (
    polyfill as unknown as {
      device?: {
        requestAnimationFrame: (cb: FrameRequestCallback) => number;
        cancelAnimationFrame: (handle: number) => void;
      };
    }
  ).device;
  if (!device) {
    console.warn("Looking Glass: deviceが見つからずrAFパッチを適用できません");
    return;
  }

  let nextHandle = 1;
  const pending = new Map<number, { win: Window; h: number }[]>();

  device.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const handle = nextHandle++;
    const entries: { win: Window; h: number }[] = [];
    let done = false;
    const run = (t: number) => {
      if (done) return;
      done = true;
      // まだ発火していない方の予約を取り消す
      for (const e of pending.get(handle) ?? []) {
        try {
          e.win.cancelAnimationFrame(e.h);
        } catch {
          /* 閉じられたウィンドウは無視 */
        }
      }
      pending.delete(handle);
      cb(t);
    };

    entries.push({ win: window, h: window.requestAnimationFrame(run) });
    const popup = (LookingGlassConfig as unknown as { popup?: Window | null })
      .popup;
    if (popup && !popup.closed) {
      try {
        entries.push({ win: popup, h: popup.requestAnimationFrame(run) });
      } catch {
        /* ポップアップが閉じかけている場合は無視 */
      }
    }
    pending.set(handle, entries);
    return handle;
  };

  device.cancelAnimationFrame = (handle: number): void => {
    for (const e of pending.get(handle) ?? []) {
      try {
        e.win.cancelAnimationFrame(e.h);
      } catch {
        /* ignore */
      }
    }
    pending.delete(handle);
  };
}

/**
 * Looking Glass表示の開始/終了をトグルする。
 * 開始するとポリフィルがポップアップウィンドウを開くので、
 * ユーザーがLooking Glass側ディスプレイへ移動して全画面化する。
 * @returns セッションが開始されたらtrue、終了したらfalse
 */
export async function toggleLookingGlass(
  renderer: THREE.WebGLRenderer,
): Promise<boolean> {
  const current = renderer.xr.getSession();
  if (current) {
    await current.end();
    return false;
  }
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) {
    throw new Error("WebXRが利用できません");
  }
  // three.jsは既定でlocal-floor基準空間を要求するため、
  // セッション機能として明示的に有効化しておく(three公式VRButtonと同じ)
  const session = await xr.requestSession("immersive-vr", {
    optionalFeatures: ["local-floor", "bounded-floor", "layers"],
  });
  await renderer.xr.setSession(session);
  return true;
}
