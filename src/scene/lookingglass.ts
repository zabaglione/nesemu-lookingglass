import {
  LookingGlassConfig,
  LookingGlassWebXRPolyfill,
} from "@lookingglass/webxr";
import type * as THREE from "three";

// Looking Glass WebXRポリフィルの初期化。
// navigator.xrを置き換えるため、three.jsのレンダラー生成前に呼ぶこと。
// キャリブレーションはLooking Glass Bridge経由で自動取得される。

let polyfill: LookingGlassWebXRPolyfill | null = null;
let animationFramePatched = false;
let frameEndPatched = false;

type WakeLockSentinelLike = EventTarget & {
  readonly released: boolean;
  release(): Promise<void>;
};
type WakeLockManagerLike = {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
};
const wakeLocks = new Map<Window, WakeLockSentinelLike>();
const wakeLockWindows = new WeakSet<Window>();
const wakeLockRetries = new WeakMap<Window, number>();
let wakeLockSessionActive = false;

type DeviceAnimationRequest = {
  frames: { win: Window; h: number }[];
  fallbackTimer: number;
};

type LookingGlassDevice = {
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  onFrameEnd?: (sessionId: unknown) => void;
};

type LookingGlassInternals = {
  popup?: Window | null;
  lkgCanvas?: HTMLCanvasElement | null;
  calibration?: {
    screenW?: { value?: number };
    screenH?: { value?: number };
  };
};

type LayerPrivateState = {
  LookingGlassEnabled: boolean;
  blitTextureToDefaultFramebufferIfNeeded: () => void;
};

export type LookingGlassRecoveryStatus =
  | "recovering"
  | "recovered"
  | "failed";

export type LookingGlassRecoverySnapshot = {
  contextLost: boolean;
  recovering: boolean;
  recoveryCount: number;
  stalledFrameCount: number;
  lastFrameAgeMs: number | null;
  lastError: string | null;
};

let recoveryRenderer: THREE.WebGLRenderer | null = null;
let recoveryContext: WebGLRenderingContext | WebGL2RenderingContext | null =
  null;
let recoveryStatusHandler:
  | ((status: LookingGlassRecoveryStatus, detail?: string) => void)
  | null = null;
let contextUnavailable = false;
let recoveryInProgress = false;
let recoveryTimer: number | null = null;
let recoveryAttempt = 0;
let recoveryCount = 0;
let stalledFrameCount = 0;
let lastDeviceFrameAt = 0;
let lastRecoveryError: string | null = null;
let nextAnimationHandle = 1;
const pendingAnimationFrames = new Map<number, DeviceAnimationRequest>();

export function initLookingGlass(appCanvas: HTMLCanvasElement): void {
  if (polyfill) return;
  polyfill = new LookingGlassWebXRPolyfill({
    // シーンは原点中心・幅約1のNES画面なので、カメラ焦点を原点に置く
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    targetDiam: 1.6,
    fovy: (14 * Math.PI) / 180,
  });
  // deviceの生成は非同期なので、ここでは存在する場合だけ先行適用する。
  // セッション開始時にも必ず再試行する。
  ensureDeviceAnimationFramePatched();
  suppressPolyfillCanvasControls(appCanvas);
}

/**
 * ポリフィルはセッション開始時、アプリのキャンバスに独自の
 * トラックボール操作(mousemove: ホログラムカメラ回転 / wheel: ズーム)を
 * 登録する。これが本アプリのドラッグ操作と競合し、さらに設定変更のたびに
 * quilt用フレームバッファが再確保されて表示が乱れる。
 * 操作体系はアプリ側(シーンGroupの回転/拡縮)に統一するため、
 * 先に停止リスナーを登録して無効化する(同一要素のリスナーは登録順に
 * 実行されるので、セッション開始前に登録しておけば必ず先行できる)。
 */
const suppressedCanvases = new WeakSet<HTMLCanvasElement>();

function suppressPolyfillCanvasControls(appCanvas: HTMLCanvasElement): void {
  if (suppressedCanvases.has(appCanvas)) return;
  suppressedCanvases.add(appCanvas);
  const stop = (e: Event) => e.stopImmediatePropagation();
  // captureで登録することで、ポリフィルのリスナーが先に登録済みの
  // Looking Glass側キャンバスにも確実に先行する。
  appCanvas.addEventListener("mousemove", stop, true);
  appCanvas.addEventListener("wheel", stop, { capture: true, passive: false });
}

/**
 * セッション放置中にOSやブラウザの省電力でLooking Glass出力が
 * 消灯しないよう、メインと表示用ポップアップの両方でWake Lockを保持する。
 * 非表示化などで自動解除された場合は、可視状態へ戻った時に再取得する。
 */
async function acquireWakeLock(target: Window): Promise<void> {
  wakeLockRetries.delete(target);
  if (
    !wakeLockSessionActive ||
    target.closed ||
    target.document.visibilityState !== "visible" ||
    wakeLocks.has(target)
  ) {
    return;
  }
  const manager = (
    target.navigator as Navigator & { wakeLock?: WakeLockManagerLike }
  ).wakeLock;
  if (!manager) return;
  try {
    const sentinel = await manager.request("screen");
    wakeLocks.set(target, sentinel);
    sentinel.addEventListener("release", () => {
      if (wakeLocks.get(target) === sentinel) wakeLocks.delete(target);
      scheduleWakeLockRetry(target);
    });
    if (!wakeLockWindows.has(target)) {
      wakeLockWindows.add(target);
      target.document.addEventListener("visibilitychange", () => {
        if (target.document.visibilityState === "visible") {
          void acquireWakeLock(target);
        }
      });
    }
  } catch {
    // 一時的に取得できない場合も、セッション中なら再試行する。
    scheduleWakeLockRetry(target);
  }
}

function scheduleWakeLockRetry(target: Window): void {
  if (
    !wakeLockSessionActive ||
    target.closed ||
    wakeLockRetries.has(target)
  ) {
    return;
  }
  const timer = window.setTimeout(() => {
    wakeLockRetries.delete(target);
    void acquireWakeLock(target);
  }, 1000);
  wakeLockRetries.set(target, timer);
}

async function holdDisplayAwake(): Promise<void> {
  wakeLockSessionActive = true;
  await acquireWakeLock(window);
  const popup = (LookingGlassConfig as unknown as { popup?: Window | null })
    .popup;
  if (popup && !popup.closed) await acquireWakeLock(popup);
}

async function releaseWakeLocks(): Promise<void> {
  wakeLockSessionActive = false;
  const locks = Array.from(wakeLocks.values());
  wakeLocks.clear();
  await Promise.allSettled(
    locks.filter((lock) => !lock.released).map((lock) => lock.release()),
  );
}

/**
 * ポリフィル内蔵のコントロール類でホログラムカメラ設定が動かされても、
 * 毎フレーム既定値へ戻す(視点操作はシーンGroup側で行う方針のため)。
 * 値が変わったときだけ書き戻す: 設定のsetterはon-config-changedを発火し
 * フレームバッファ再確保を伴うので、無条件書き込みは避ける。
 */
export function pinLookingGlassView(): void {
  const c = LookingGlassConfig;
  if (c.trackballX !== 0) c.trackballX = 0;
  if (c.trackballY !== 0) c.trackballY = 0;
  if (c.targetX !== 0) c.targetX = 0;
  if (c.targetY !== 0) c.targetY = 0;
  if (c.targetZ !== 0) c.targetZ = 0;
  // 1 = Center(単一ビュー)。メインウィンドウ側の表示が
  // Quilt(タイル一覧)に切り替わってしまうのを防ぐ
  if (c.inlineView !== 1) c.inlineView = 1;
}

const preparedOutputCanvases = new WeakSet<HTMLCanvasElement>();

/**
 * 全画面対象をcanvas単体ではなく出力ウィンドウ全体にする。
 * GPU復旧時にcanvasを差し替えても全画面状態を維持できる。
 */
function prepareOutputCanvas(canvas: HTMLCanvasElement): void {
  suppressPolyfillCanvasControls(canvas);
  if (preparedOutputCanvases.has(canvas)) return;
  preparedOutputCanvases.add(canvas);
  canvas.addEventListener(
    "dblclick",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const doc = canvas.ownerDocument;
      if (doc.fullscreenElement) return;
      void doc.documentElement.requestFullscreen().catch(() => {
        void canvas.requestFullscreen().catch(() => undefined);
      });
    },
    true,
  );
}

/**
 * 新規セッションやGPU復旧で作られた出力canvasを、既存のLooking Glass
 * ウィンドウへ確実に取り付ける。古いセッションのcanvasが残っていても
 * ここで置き換える。
 */
function mountOutputCanvas(): void {
  const config = LookingGlassConfig as unknown as LookingGlassInternals;
  const popup = config.popup;
  const canvas = config.lkgCanvas;
  if (!popup || popup.closed || !canvas) return;

  const width = config.calibration?.screenW?.value;
  const height = config.calibration?.screenH?.value;
  canvas.style.position = "fixed";
  canvas.style.bottom = "0";
  canvas.style.left = "0";
  if (typeof width === "number" && width > 0 && canvas.width !== width) {
    canvas.width = width;
  }
  if (typeof height === "number" && height > 0 && canvas.height !== height) {
    canvas.height = height;
  }

  const body = popup.document.body;
  for (const oldCanvas of Array.from(body.querySelectorAll("canvas"))) {
    if (oldCanvas !== canvas) oldCanvas.remove();
  }
  if (canvas.parentElement !== body) body.appendChild(canvas);
  prepareOutputCanvas(canvas);
}

function findLayerPrivateState(
  layer: object,
): { symbol: symbol; state: LayerPrivateState } | null {
  const record = layer as { [key: symbol]: unknown };
  for (const symbol of Object.getOwnPropertySymbols(layer)) {
    const candidate = record[symbol];
    if (
      candidate &&
      typeof candidate === "object" &&
      "blitTextureToDefaultFramebufferIfNeeded" in candidate &&
      typeof (candidate as LayerPrivateState)
        .blitTextureToDefaultFramebufferIfNeeded === "function"
    ) {
      return { symbol, state: candidate as LayerPrivateState };
    }
  }
  return null;
}

/**
 * WebGLコンテキスト復帰後はthree.js自身のリソースは再生成されるが、
 * Looking Glassポリフィルが直接作ったquilt用FBO/texture/shaderは
 * 再生成されない。セッションとポップアップは維持したまま新しいレイヤーを
 * 作り、そのGPUリソースだけを現在のベースレイヤーへ移植する。
 */
function rebuildLookingGlassLayer(renderer: THREE.WebGLRenderer): void {
  const session = renderer.xr.getSession();
  const currentLayer = renderer.xr.getBaseLayer();
  const gl = renderer.getContext();
  if (!session || !currentLayer || gl.isContextLost()) {
    throw new Error("XR session or WebGL context is unavailable");
  }

  const LayerConstructor = (
    globalThis as unknown as {
      XRWebGLLayer?: new (
        session: XRSession,
        context: WebGLRenderingContext | WebGL2RenderingContext,
        options?: XRWebGLLayerInit,
      ) => XRWebGLLayer;
    }
  ).XRWebGLLayer;
  if (typeof LayerConstructor !== "function") {
    throw new Error("XRWebGLLayer is unavailable");
  }

  const attributes = gl.getContextAttributes();
  const replacement = new LayerConstructor(session, gl, {
    alpha: true,
    antialias: attributes?.antialias ?? false,
    depth: attributes?.depth ?? true,
    stencil: attributes?.stencil ?? false,
    framebufferScaleFactor: 1,
  });
  const replacementPrivate = findLayerPrivateState(replacement);
  const currentPrivate = findLayerPrivateState(currentLayer);
  if (!replacementPrivate || !currentPrivate) {
    throw new Error("Looking Glass layer internals are unavailable");
  }

  replacementPrivate.state.LookingGlassEnabled = true;
  const currentRecord = currentLayer as unknown as {
    [key: symbol]: unknown;
  };
  currentRecord[currentPrivate.symbol] = replacementPrivate.state;
  renderer.resetState();
  mountOutputCanvas();
}

function restartSessionFrameLoop(session: XRSession): boolean {
  const record = session as unknown as { [key: symbol]: unknown };
  for (const symbol of Object.getOwnPropertySymbols(session)) {
    const candidate = record[symbol] as
      | {
          stopDeviceFrameLoop?: () => void;
          startDeviceFrameLoop?: () => void;
        }
      | undefined;
    if (
      typeof candidate?.stopDeviceFrameLoop === "function" &&
      typeof candidate.startDeviceFrameLoop === "function"
    ) {
      candidate.stopDeviceFrameLoop();
      candidate.startDeviceFrameLoop();
      return true;
    }
  }
  return false;
}

function scheduleLayerRecovery(delay = 100): void {
  if (recoveryTimer !== null || recoveryInProgress) return;
  recoveryTimer = window.setTimeout(() => {
    recoveryTimer = null;
    const renderer = recoveryRenderer;
    const gl = recoveryContext;
    if (!renderer || !gl || !renderer.xr.getSession()) {
      contextUnavailable = false;
      recoveryAttempt = 0;
      return;
    }
    if (gl.isContextLost()) {
      scheduleLayerRecovery(250);
      return;
    }

    recoveryInProgress = true;
    recoveryStatusHandler?.("recovering");
    try {
      rebuildLookingGlassLayer(renderer);
      contextUnavailable = false;
      recoveryAttempt = 0;
      recoveryCount++;
      lastRecoveryError = null;
      lastDeviceFrameAt = performance.now();
      recoveryStatusHandler?.("recovered");
    } catch (error) {
      contextUnavailable = true;
      recoveryAttempt++;
      lastRecoveryError =
        error instanceof Error ? error.message : String(error);
      if (recoveryAttempt < 8) {
        window.setTimeout(
          () => scheduleLayerRecovery(Math.min(250 * recoveryAttempt, 1500)),
          0,
        );
      } else {
        recoveryStatusHandler?.("failed", lastRecoveryError);
      }
    } finally {
      recoveryInProgress = false;
    }
  }, delay);
}

function isRecoverableFrameEndError(error: unknown): boolean {
  if (contextUnavailable || recoveryContext?.isContextLost()) return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("is not iterable") ||
    message.includes("Cannot read properties of null")
  );
}

function patchDeviceFrameEnd(device: LookingGlassDevice): void {
  if (frameEndPatched || typeof device.onFrameEnd !== "function") return;
  const original = device.onFrameEnd.bind(device);
  device.onFrameEnd = (sessionId: unknown): void => {
    if (contextUnavailable || recoveryContext?.isContextLost()) return;
    try {
      original(sessionId);
      lastDeviceFrameAt = performance.now();
    } catch (error) {
      if (!isRecoverableFrameEndError(error)) throw error;
      contextUnavailable = true;
      lastRecoveryError =
        error instanceof Error ? error.message : String(error);
      scheduleLayerRecovery();
    }
  };
  frameEndPatched = true;
}

function cancelAllDeviceAnimationFrames(): void {
  for (const request of pendingAnimationFrames.values()) {
    for (const frame of request.frames) {
      try {
        frame.win.cancelAnimationFrame(frame.h);
      } catch {
        // 閉じられたウィンドウは無視する。
      }
    }
    window.clearTimeout(request.fallbackTimer);
  }
  pendingAnimationFrames.clear();
}

/**
 * WebGLコンテキストの瞬断とXRフレーム停止を監視し、表示中のセッションを
 * 閉じずに復旧する。renderer生成後に一度だけ呼ぶ。
 */
export function installLookingGlassRecovery(
  renderer: THREE.WebGLRenderer,
  onStatus?: (status: LookingGlassRecoveryStatus, detail?: string) => void,
): void {
  recoveryRenderer = renderer;
  recoveryContext = renderer.getContext();
  recoveryStatusHandler = onStatus ?? null;
  const canvas = renderer.domElement;

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextUnavailable = true;
    recoveryAttempt = 0;
    lastRecoveryError = "WebGL context lost";
    if (renderer.xr.getSession()) recoveryStatusHandler?.("recovering");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    scheduleLayerRecovery();
  });

  window.setInterval(() => {
    if (!renderer.xr.getSession()) return;
    void holdDisplayAwake();
    mountOutputCanvas();

    const gl = recoveryContext;
    if (!gl) return;
    if (gl.isContextLost()) {
      contextUnavailable = true;
      return;
    }
    if (contextUnavailable) {
      scheduleLayerRecovery();
      return;
    }

    if (
      lastDeviceFrameAt > 0 &&
      performance.now() - lastDeviceFrameAt > 3000
    ) {
      const session = renderer.xr.getSession();
      if (session && restartSessionFrameLoop(session)) {
        stalledFrameCount++;
        lastDeviceFrameAt = performance.now();
      }
    }
  }, 2000);
}

export function getLookingGlassRecoverySnapshot(): LookingGlassRecoverySnapshot {
  return {
    contextLost: recoveryContext?.isContextLost() ?? false,
    recovering: contextUnavailable || recoveryInProgress,
    recoveryCount,
    stalledFrameCount,
    lastFrameAgeMs:
      lastDeviceFrameAt > 0 ? performance.now() - lastDeviceFrameAt : null,
    lastError: lastRecoveryError,
  };
}

/**
 * ポリフィルのXRセッションは既定でメインウィンドウのrAFで駆動されるため、
 * メインウィンドウが最小化・他ウィンドウに完全に隠れるとブラウザの
 * スロットリングで描画が止まり、Looking Glass側の表示が凍結する。
 * 対策: フレーム予約をメインとポップアップ(Looking Glass側・全画面なので
 * 通常は常に可視)の両方に行い、先に発火した方で駆動する。
 * どちらか一方でも可視なら表示が途絶えない。
 */
function ensureDeviceAnimationFramePatched(): boolean {
  const device = (
    polyfill as unknown as {
      device?: LookingGlassDevice;
    }
  ).device;
  if (!device) {
    return false;
  }
  patchDeviceFrameEnd(device);
  if (animationFramePatched) return true;

  device.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const handle = nextAnimationHandle++;
    const frames: { win: Window; h: number }[] = [];
    let done = false;
    const run = (t: number) => {
      if (done) return;
      done = true;
      const request = pendingAnimationFrames.get(handle);
      // まだ発火していない予約を取り消す
      for (const e of request?.frames ?? []) {
        try {
          e.win.cancelAnimationFrame(e.h);
        } catch {
          /* 閉じられたウィンドウは無視 */
        }
      }
      if (request) window.clearTimeout(request.fallbackTimer);
      pendingAnimationFrames.delete(handle);
      cb(t);
    };

    frames.push({ win: window, h: window.requestAnimationFrame(run) });
    const popup = (LookingGlassConfig as unknown as { popup?: Window | null })
      .popup;
    if (popup && !popup.closed) {
      try {
        frames.push({ win: popup, h: popup.requestAnimationFrame(run) });
      } catch {
        /* ポップアップが閉じかけている場合は無視 */
      }
    }
    // OSやブラウザが両ウィンドウのrAFを停止しても、タイマーが次フレームを
    // 再始動する。通常時はrAFが先に発火し、このタイマーは毎回破棄される。
    const fallbackTimer = window.setTimeout(
      () => run(performance.now()),
      500,
    );
    pendingAnimationFrames.set(handle, { frames, fallbackTimer });
    return handle;
  };

  device.cancelAnimationFrame = (handle: number): void => {
    const request = pendingAnimationFrames.get(handle);
    for (const e of request?.frames ?? []) {
      try {
        e.win.cancelAnimationFrame(e.h);
      } catch {
        /* ignore */
      }
    }
    if (request) window.clearTimeout(request.fallbackTimer);
    pendingAnimationFrames.delete(handle);
  };
  animationFramePatched = true;
  return true;
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
  // XRSessionは生成時点で最初のフレームを予約するため、requestSessionより
  // 前に内部deviceのrAFを差し替えておく。
  if (!ensureDeviceAnimationFramePatched()) {
    throw new Error("Looking Glass device initialization is incomplete");
  }
  cancelAllDeviceAnimationFrames();
  contextUnavailable = false;
  recoveryInProgress = false;
  recoveryAttempt = 0;
  lastRecoveryError = null;
  lastDeviceFrameAt = performance.now();
  const session = await xr.requestSession("immersive-vr", {
    optionalFeatures: ["local-floor", "bounded-floor", "layers"],
  });
  await renderer.xr.setSession(session);
  // lkgCanvasはXRWebGLLayer生成時に初めて作られるため、セッション設定後に
  // 内蔵トラックボール操作を停止する。ここを止めないとドラッグのたびに
  // on-config-changedが発火し、quiltバッファが再確保される。
  const lkgCanvas = (
    LookingGlassConfig as unknown as { lkgCanvas?: HTMLCanvasElement | null }
  ).lkgCanvas;
  if (lkgCanvas) prepareOutputCanvas(lkgCanvas);
  mountOutputCanvas();
  session.addEventListener("end", () => {
    cancelAllDeviceAnimationFrames();
    contextUnavailable = false;
    recoveryInProgress = false;
    recoveryAttempt = 0;
    lastDeviceFrameAt = 0;
    void releaseWakeLocks();
  });
  await holdDisplayAwake();
  return true;
}
