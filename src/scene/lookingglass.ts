import { LookingGlassWebXRPolyfill } from "@lookingglass/webxr";
import type * as THREE from "three";

// Looking Glass WebXRポリフィルの初期化。
// navigator.xrを置き換えるため、three.jsのレンダラー生成前に呼ぶこと。
// キャリブレーションはLooking Glass Bridge経由で自動取得される。

let initialized = false;

export function initLookingGlass(): void {
  if (initialized) return;
  new LookingGlassWebXRPolyfill({
    // シーンは原点中心・幅約1のNES画面なので、カメラ焦点を原点に置く
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    targetDiam: 1.6,
    fovy: (14 * Math.PI) / 180,
  });
  initialized = true;
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
  const session = await xr.requestSession("immersive-vr");
  await renderer.xr.setSession(session);
  return true;
}
