import {
  LookingGlassConfig,
  LookingGlassWebXRPolyfill,
} from "@lookingglass/webxr";
import * as THREE from "three";
import { fitTargetDiam } from "./stereoMath";
import {
  canvasCssSize,
  chooseLookingGlassScreen,
  getLookingGlassScreens,
  getCachedLookingGlassScreens,
  placeOutputWindow,
  prefetchLookingGlassScreens,
  pixelExactStatus,
} from "./lookingglassOutput";

// Looking Glass WebXRポリフィルの初期化。
// navigator.xrを置き換えるため、three.jsのレンダラー生成前に呼ぶこと。
// キャリブレーションはLooking Glass Bridge経由で自動取得される。

let polyfill: LookingGlassWebXRPolyfill | null = null;
let animationFramePatched = false;
let frameEndPatched = false;
let baseLayerPatched = false;
let sessionCleanupPatched = false;
let configPatched = false;
let removeTrackedConfigListeners: (() => void) | null = null;

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
  requestSession: (...args: unknown[]) => Promise<unknown>;
  onBaseLayerSet: (sessionId: unknown, layer: unknown) => void;
  onFrameEnd?: (sessionId: unknown) => void;
};

type LookingGlassInternals = {
  popup?: Window | null;
  lkgCanvas?: HTMLCanvasElement | null;
  calibration?: {
    screenW?: { value?: number };
    screenH?: { value?: number };
    serial?: string;
  };
};

let sceneWidth = 1;
let sceneHeight = 0.8166666667;
const SCENE_FIT_MARGIN = 1.15;

type LayerPrivateState = {
  LookingGlassEnabled: boolean;
  blitTextureToDefaultFramebufferIfNeeded: () => void;
  moveCanvasToWindow?: (show: boolean, onClose?: () => void) => void;
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

const expectedPolyfillWarnings = new Set([
  "XRSystem already defined on global.",
  "XRSession already defined on global.",
  "XRSessionEvent already defined on global.",
  "XRFrame already defined on global.",
  "XRView already defined on global.",
  "XRViewport already defined on global.",
  "XRViewerPose already defined on global.",
  "XRWebGLLayer already defined on global.",
  "XRSpace already defined on global.",
  "XRReferenceSpace already defined on global.",
  "XRReferenceSpaceEvent already defined on global.",
  "XRInputSource already defined on global.",
  "XRInputSourceEvent already defined on global.",
  "XRInputSourcesChangeEvent already defined on global.",
  "XRRenderState already defined on global.",
  "XRRigidTransform already defined on global.",
  "XRPose already defined on global.",
  'Looking Glass WebXR "polyfill" overriding native WebXR API.',
]);

function createLookingGlassPolyfill(): LookingGlassWebXRPolyfill {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]): void => {
    if (
      args.length === 1 &&
      typeof args[0] === "string" &&
      expectedPolyfillWarnings.has(args[0])
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };
  try {
    return new LookingGlassWebXRPolyfill({
      // シーンは原点中心・幅約1のNES画面なので、カメラ焦点を原点に置く
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      // This is replaced after the scene bounds and device calibration are
      // known. Keeping it close to the scene height avoids losing parallax
      // on displays whose calibrated aspect ratio is wider than the scene.
      targetDiam: Math.max(sceneHeight, sceneWidth / (16 / 9)) * SCENE_FIT_MARGIN,
      fovy: (14 * Math.PI) / 180,
      depthiness: 1.25,
    });
  } finally {
    console.warn = originalWarn;
  }
}

function fitLookingGlassTargetDiam(): void {
  const config = LookingGlassConfig as unknown as LookingGlassInternals & {
    targetDiam?: number;
  };
  const calibration = config.calibration;
  const screenW = calibration?.screenW?.value;
  const screenH = calibration?.screenH?.value;
  const aspect =
    typeof screenW === "number" && screenW > 0 && typeof screenH === "number" && screenH > 0
      ? screenW / screenH
      : 16 / 9;
  const targetDiam = fitTargetDiam(sceneWidth, sceneHeight, aspect, 1, SCENE_FIT_MARGIN);
  if (typeof config.targetDiam === "number" && Math.abs(config.targetDiam - targetDiam) < 1e-4) return;
  if (typeof config.targetDiam === "number") config.targetDiam = targetDiam;
}

export function setLookingGlassSceneBounds(width: number, height: number): void {
  if (!(width > 0) || !(height > 0)) return;
  sceneWidth = width;
  sceneHeight = height;
  fitLookingGlassTargetDiam();
}

export type LookingGlassDisplaySnapshot = {
  calibrated: boolean;
  screenWidth: number;
  screenHeight: number;
  viewCount: number;
  popupOpen: boolean;
  actualViewCount: number;
  viewPositionSpan: number;
  frontDisparity: number;
  backDisparity: number;
  fullscreen: boolean;
  pixelExact: boolean;
  pixelWidth: number;
  pixelHeight: number;
  targetMatched: boolean | null;
};

/** Read-only diagnostics from the active XR ArrayCamera and device output. */
export function getLookingGlassDisplaySnapshot(
  renderer: THREE.WebGLRenderer,
  baseCamera?: THREE.Camera,
): LookingGlassDisplaySnapshot {
  const config = LookingGlassConfig as unknown as LookingGlassInternals & {
    numViews?: number;
  };
  const calibration = config.calibration;
  const screenWidth = calibration?.screenW?.value ?? 0;
  const screenHeight = calibration?.screenH?.value ?? 0;
  const calibrated =
    Boolean(calibration?.serial) && screenWidth > 0 && screenHeight > 0;
  const popup = config.popup;
  const result: LookingGlassDisplaySnapshot = {
    calibrated,
    screenWidth,
    screenHeight,
    viewCount: config.numViews ?? 0,
    popupOpen: Boolean(popup && !popup.closed),
    actualViewCount: 0,
    viewPositionSpan: 0,
    frontDisparity: 0,
    backDisparity: 0,
    fullscreen: false,
    pixelExact: false,
    pixelWidth: 0,
    pixelHeight: 0,
    targetMatched: null,
  };
  if (!renderer.xr.isPresenting || !baseCamera) return result;
  const xrCamera = (renderer.xr as unknown as { getCamera(camera?: THREE.Camera): THREE.ArrayCamera }).getCamera(baseCamera);
  const views = xrCamera.cameras ?? [];
  result.actualViewCount = views.length;
  if (views.length < 2) return result;
  const first = views[0];
  const last = views[views.length - 1];
  result.viewPositionSpan = Math.abs(
    new THREE.Vector3().setFromMatrixPosition(first.matrixWorld).x -
      new THREE.Vector3().setFromMatrixPosition(last.matrixWorld).x,
  );
  const project = (view: THREE.Camera, z: number): number => {
    const p = new THREE.Vector4(0, 0, z, 1)
      .applyMatrix4(view.matrixWorldInverse)
      .applyMatrix4(view.projectionMatrix);
    return p.w === 0 ? 0 : p.x / p.w;
  };
  result.frontDisparity = project(first, 0.1) - project(last, 0.1);
  result.backDisparity = project(first, -0.1) - project(last, -0.1);
  const doc = popup?.document;
  const fullscreen = Boolean(doc?.fullscreenElement);
  const pixel = pixelExactStatus(
    popup?.innerWidth ?? 0,
    popup?.innerHeight ?? 0,
    popup?.devicePixelRatio ?? 1,
    screenWidth,
    screenHeight,
    fullscreen,
  );
  result.fullscreen = fullscreen;
  result.pixelExact = pixel.pixelExact;
  result.pixelWidth = Math.round((popup?.innerWidth ?? 0) * (popup?.devicePixelRatio ?? 1));
  result.pixelHeight = Math.round((popup?.innerHeight ?? 0) * (popup?.devicePixelRatio ?? 1));
  const selected = popup ? outputControllers.get(popup)?.selectedScreen : null;
  result.targetMatched = selected
    ? Math.round(popup?.screenX ?? 0) === Math.round(selected.left) && Math.round(popup?.screenY ?? 0) === Math.round(selected.top)
    : null;
  return result;
}

export function initLookingGlass(appCanvas: HTMLCanvasElement): void {
  if (polyfill) return;
  // ポリフィルはthree.jsサンプル用のVRButtonを5秒間探し、存在しないと
  // 警告を出す。本アプリは独自ボタンを使うため、非表示の互換要素を渡す。
  const compatibilityButton = document.createElement("button");
  compatibilityButton.id = "VRButton";
  compatibilityButton.type = "button";
  compatibilityButton.hidden = true;
  compatibilityButton.tabIndex = -1;
  compatibilityButton.setAttribute("aria-hidden", "true");
  polyfill = createLookingGlassPolyfill();
  document.body.append(compatibilityButton);
  stabilizeLookingGlassConfig();
  // deviceの生成は非同期なので、ここでは存在する場合だけ先行適用する。
  // セッション開始時にも必ず再試行する。
  ensureDeviceAnimationFramePatched();
  suppressPolyfillCanvasControls(appCanvas);
  prefetchLookingGlassScreens();
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
  appCanvas.addEventListener("keydown", stop, true);
  appCanvas.addEventListener("keyup", stop, true);
}

/**
 * ポリフィルの内蔵操作ループは、キー入力がない時もtargetX/Y/Zへ同じ値を
 * 毎フレーム再設定する。そのたびにquilt textureを再確保する実装なので、
 * 同値更新を抑止する。またXRレイヤーが登録した設定変更リスナーを追跡し、
 * WebGL復旧時に破棄済みGPUリソースを参照する旧リスナーを除去できるようにする。
 */
function stabilizeLookingGlassConfig(): void {
  if (configPatched) return;
  const config = LookingGlassConfig as unknown as {
    [key: string]: unknown;
    updateViewControls(
      value: Record<string, unknown> | undefined,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ): void;
  };
  const originalUpdate = config.updateViewControls.bind(config);
  const originalAdd = config.addEventListener.bind(config);
  const originalRemove = config.removeEventListener.bind(config);
  const tracked = new Set<EventListenerOrEventListenerObject>();

  config.updateViewControls = (
    value: Record<string, unknown> | undefined,
  ): void => {
    if (value) {
      const unchanged = Object.entries(value).every(([key, next]) => {
        const current = config[key];
        if (
          key === "quiltResolution" &&
          current &&
          next &&
          typeof current === "object" &&
          typeof next === "object"
        ) {
          const a = current as { width?: unknown; height?: unknown };
          const b = next as { width?: unknown; height?: unknown };
          return a.width === b.width && a.height === b.height;
        }
        return Object.is(current, next);
      });
      if (unchanged) return;
    }
    originalUpdate(value);
  };
  config.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    originalAdd(type, listener, options);
    if (type === "on-config-changed" && listener) tracked.add(listener);
  };
  config.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void => {
    originalRemove(type, listener, options);
    if (type === "on-config-changed" && listener) tracked.delete(listener);
  };
  removeTrackedConfigListeners = () => {
    for (const listener of Array.from(tracked)) {
      originalRemove("on-config-changed", listener);
    }
    tracked.clear();
  };
  configPatched = true;
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
  if (contextUnavailable || recoveryInProgress) return;
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
type OutputController = {
  selectedScreen: { left: number; top: number; width: number; height: number } | null;
  refresh: () => void;
  requestFullscreen: () => Promise<boolean>;
  dispose: () => void;
  resizeHandler: () => void;
  fullscreenHandler: () => void;
  disposed: boolean;
};
const outputControllers = new WeakMap<Window, OutputController>();

function outputFullscreenOptions(screen: OutputController["selectedScreen"]): unknown {
  return screen ? { screen, navigationUI: "hide" } : { navigationUI: "hide" };
}

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
      const popup = (LookingGlassConfig as unknown as LookingGlassInternals).popup;
      const controller = popup ? outputControllers.get(popup) : undefined;
      if (controller) void controller.requestFullscreen();
      else void doc.documentElement.requestFullscreen().catch(() => undefined);
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
  fitLookingGlassTargetDiam();

  const width = config.calibration?.screenW?.value;
  const height = config.calibration?.screenH?.value;
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.bottom = "auto";
  canvas.style.left = "0";
  const dpr = popup.devicePixelRatio > 0 ? popup.devicePixelRatio : 1;
  const css = canvasCssSize(width ?? canvas.width, height ?? canvas.height, dpr);
  canvas.style.width = `${css.width}px`;
  canvas.style.height = `${css.height}px`;
  canvas.style.display = "block";
  if (typeof width === "number" && width > 0 && canvas.width !== width) {
    canvas.width = width;
  }
  if (typeof height === "number" && height > 0 && canvas.height !== height) {
    canvas.height = height;
  }

  const body = popup.document.body;
  body.style.margin = "0";
  body.style.overflow = "hidden";
  for (const oldCanvas of Array.from(body.querySelectorAll("canvas"))) {
    if (oldCanvas !== canvas) oldCanvas.remove();
  }
  if (canvas.parentElement !== body) body.appendChild(canvas);
  prepareOutputCanvas(canvas);
  outputControllers.get(popup)?.refresh();
}

function hasLookingGlassCalibration(): boolean {
  const calibration = (LookingGlassConfig as unknown as LookingGlassInternals).calibration;
  return Boolean(
    calibration?.serial &&
      (calibration.screenW?.value ?? 0) > 0 &&
      (calibration.screenH?.value ?? 0) > 0,
  );
}

function openLookingGlassOutputWindow(): Window {
  const config = LookingGlassConfig as unknown as LookingGlassInternals;
  const calibrationWidth = config.calibration?.screenW?.value ?? 640;
  const calibrationHeight = config.calibration?.screenH?.value ?? 360;
  const screens = getCachedLookingGlassScreens();
  let selected = chooseLookingGlassScreen(screens ?? [], calibrationWidth, calibrationHeight, window.devicePixelRatio || 1);
  const features = selected
    ? `popup,fullscreen,left=${selected.left},top=${selected.top},width=${selected.width},height=${selected.height}`
    : "popup,width=640,height=360";
  const popup = window.open("", "looking-glass-output", features);
  if (!popup) throw new Error("Looking Glass出力ウィンドウを開けませんでした。ポップアップを許可してください。");
  if (selected) placeOutputWindow(popup, selected);
  const controller: OutputController = {
    selectedScreen: selected,
    disposed: false,
    resizeHandler: () => undefined,
    fullscreenHandler: () => undefined,
    requestFullscreen: async () => {
      if (controller.disposed || popup.closed) return false;
      const request = popup.document.documentElement.requestFullscreen as ((options?: unknown) => Promise<void>) | undefined;
      if (!request) return false;
      try {
        await request.call(popup.document.documentElement, outputFullscreenOptions(controller.selectedScreen));
        return true;
      } catch {
        status.textContent = "自動全画面を開始できません。出力ウィンドウ内の全画面表示ボタンをクリックしてください。";
        return false;
      }
    },
    refresh: () => {
      if (controller.disposed || popup.closed) return;
      const fullscreen = Boolean(popup.document.fullscreenElement);
      const exact = fullscreen && Math.round(popup.innerWidth * (popup.devicePixelRatio || 1)) === calibrationWidth && Math.round(popup.innerHeight * (popup.devicePixelRatio || 1)) === calibrationHeight;
      const targetMatched = controller.selectedScreen
        ? popup.screenX === controller.selectedScreen.left && popup.screenY === controller.selectedScreen.top
        : null;
      const ready = exact && targetMatched !== false;
      button.style.display = ready ? "none" : "block";
      status.style.display = ready ? "none" : "block";
      if (!fullscreen && !controller.selectedScreen) status.textContent = "Looking Glass画面を自動検出できません。出力をLooking Glass側へ移動し「全画面表示」を押してください。";
      else if (!fullscreen) status.textContent = "最大化ではなく枠なしの全画面表示を使用してください。";
      else if (!exact) status.textContent = "全画面サイズが校正値と異なります。Looking Glass側のOS解像度を確認してください。";
      else if (targetMatched === false) status.textContent = "選択したLooking Glass画面と表示先が一致しません。出力ウィンドウを手動配置してください。";
      else if (targetMatched === null) status.textContent = "表示先を確認できません。Looking Glass側の画面へ手動配置してください。";
    },
    dispose: () => {
      if (controller.disposed) return;
      controller.disposed = true;
      popup.removeEventListener("resize", controller.resizeHandler);
      popup.document.removeEventListener?.("fullscreenchange", controller.fullscreenHandler);
      outputControllers.delete(popup);
    },
  };
  const status = popup.document.createElement?.("div") ?? ({ style: {}, textContent: "" } as unknown as HTMLElement);
  const button = popup.document.createElement?.("button") ?? ({ style: {}, addEventListener() {} } as unknown as HTMLButtonElement);
  button.textContent = "全画面表示";
  button.style.position = "fixed";
  button.style.zIndex = "10";
  button.style.left = "8px";
  button.style.top = "8px";
  status.style.position = "fixed";
  status.style.zIndex = "10";
  status.style.left = "8px";
  status.style.top = "42px";
  status.style.color = "white";
  status.style.background = "rgba(0,0,0,.7)";
  status.style.padding = "4px";
  button.addEventListener("click", () => void controller.requestFullscreen());
  controller.resizeHandler = () => mountOutputCanvas();
  controller.fullscreenHandler = () => mountOutputCanvas();
  popup.document.addEventListener?.("fullscreenchange", controller.fullscreenHandler);
  popup.addEventListener("resize", controller.resizeHandler);
  popup.document.body.appendChild(status);
  popup.document.body.appendChild(button);
  outputControllers.set(popup, controller);
  controller.refresh();
  if (!screens) {
    void getLookingGlassScreens().then((resolved) => {
      const target = chooseLookingGlassScreen(resolved, calibrationWidth, calibrationHeight, window.devicePixelRatio || 1);
      if (target && !controller.disposed && !popup.closed) {
        selected = target;
        controller.selectedScreen = target;
        placeOutputWindow(popup, target);
        void controller.requestFullscreen();
        controller.refresh();
      } else if (!controller.disposed && !popup.closed) {
        status.textContent = "Looking Glass画面を検出できません。出力ウィンドウを手動配置してください。";
      }
    });
  }
  popup.document.title = "Looking Glass Output";
  popup.document.body.style.margin = "0";
  popup.document.body.style.background = "black";
  config.popup = popup;
  if (selected) void controller.requestFullscreen();
  return popup;
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

function patchLayerWindowMover(layer: object): void {
  const found = findLayerPrivateState(layer);
  if (!found || !found.state.moveCanvasToWindow) return;
  const original = found.state.moveCanvasToWindow;
  if ((found.state as LayerPrivateState & { __appMover?: boolean }).__appMover) return;
  (found.state as LayerPrivateState & { __appMover?: boolean }).__appMover = true;
  found.state.moveCanvasToWindow = (show, onClose) => {
    const config = LookingGlassConfig as unknown as LookingGlassInternals;
    const canvas = config.lkgCanvas;
    const popup = config.popup;
    if (!show) {
      if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
      if (popup && !popup.closed) popup.close();
      config.popup = null;
      return;
    }
    if (popup && !popup.closed && canvas) {
      if (canvas.parentElement !== popup.document.body) popup.document.body.appendChild(canvas);
      return;
    }
    // Do not fall back to the SDK mover here: it may await screen-details
    // permission and leave an immersive session with no output window.
  };
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

  // 旧レイヤーのリスナーは復帰前のWebGLTexture/FBOを閉包している。
  // 新レイヤーを作る前に必ず外し、無効なGPUオブジェクトへの書き込みを止める。
  removeTrackedConfigListeners?.();
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
  patchLayerWindowMover(replacement);

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
  patchDeviceSessionCleanup(device);
  patchDeviceBaseLayer(device);
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
 * three.jsがnear/farを更新すると、同じbaseLayerが再通知される。
 * ポリフィルはこれを二重設定として警告するため、同一参照の再通知を除外する。
 */
function patchDeviceBaseLayer(device: LookingGlassDevice): void {
  if (baseLayerPatched) return;
  const originalOnBaseLayerSet = device.onBaseLayerSet.bind(device);
  const layersBySession = new Map<unknown, unknown>();
  device.onBaseLayerSet = (sessionId: unknown, layer: unknown): void => {
    if (layersBySession.get(sessionId) === layer) return;
    layersBySession.set(sessionId, layer);
    patchLayerWindowMover(layer as object);
    originalOnBaseLayerSet(sessionId, layer);
  };
  baseLayerPatched = true;
}

/**
 * ポリフィルが登録するunloadは現在のChromiumでPermissions Policy警告に
 * なるため、同じ終了処理を推奨されるpagehideへ置き換える。
 */
function patchDeviceSessionCleanup(device: LookingGlassDevice): void {
  if (sessionCleanupPatched) return;
  const originalRequestSession = device.requestSession;
  device.requestSession = function (
    this: LookingGlassDevice,
    ...args: unknown[]
  ): Promise<unknown> {
    const originalAddEventListener = window.addEventListener;
    window.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void {
      if (type === "unload") {
        originalAddEventListener.call(window, "pagehide", listener, options);
        return;
      }
      originalAddEventListener.call(window, type, listener, options);
    } as typeof window.addEventListener;
    try {
      return originalRequestSession.apply(this, args);
    } finally {
      window.addEventListener = originalAddEventListener;
    }
  };
  sessionCleanupPatched = true;
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
  // three.jsが使用するlocal-floorだけを要求する。ポリフィル未対応の
  // bounded-floor/layersを渡すと、接続のたびに不要な警告が出る。
  // XRSessionは生成時点で最初のフレームを予約するため、requestSessionより
  // 前に内部deviceのrAFを差し替えておく。
  if (!ensureDeviceAnimationFramePatched()) {
    throw new Error("Looking Glass device initialization is incomplete");
  }
  if (!hasLookingGlassCalibration()) {
    throw new Error("Looking Glassの校正情報を取得できませんでした。Bridgeと機器接続を確認してください。");
  }
  const popup = openLookingGlassOutputWindow();
  cancelAllDeviceAnimationFrames();
  removeTrackedConfigListeners?.();
  contextUnavailable = false;
  recoveryInProgress = false;
  recoveryAttempt = 0;
  lastRecoveryError = null;
  lastDeviceFrameAt = performance.now();
  let session: XRSession | null = null;
  let popupClosing = false;
  const closePopupOnPageHide = () => {
    if (popupClosing) return;
    popupClosing = true;
    if (session) void session.end().catch(() => undefined);
  };
  popup.addEventListener("pagehide", closePopupOnPageHide);
  const cleanup = async (): Promise<void> => {
    popup.removeEventListener("pagehide", closePopupOnPageHide);
    removeTrackedConfigListeners?.();
    cancelAllDeviceAnimationFrames();
    outputControllers.get(popup)?.dispose();
    if (session) {
      try { await session.end(); } catch { /* session may not have started */ }
    }
    if (!popup.closed) popup.close();
    (LookingGlassConfig as unknown as LookingGlassInternals).popup = null;
    contextUnavailable = false;
    recoveryInProgress = false;
    recoveryAttempt = 0;
    lastRecoveryError = null;
    lastDeviceFrameAt = 0;
    void releaseWakeLocks();
  };
  try {
    session = await xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor"],
    });
    session.addEventListener("end", () => {
      popupClosing = true;
      popup.removeEventListener("pagehide", closePopupOnPageHide);
      cancelAllDeviceAnimationFrames();
      removeTrackedConfigListeners?.();
      outputControllers.get(popup)?.dispose();
      contextUnavailable = false;
      recoveryInProgress = false;
      recoveryAttempt = 0;
      lastDeviceFrameAt = 0;
      lastRecoveryError = null;
      if (!popup.closed) popup.close();
      (LookingGlassConfig as unknown as LookingGlassInternals).popup = null;
      void releaseWakeLocks();
    }, { once: true });
    if (popupClosing || popup.closed) throw new Error("Looking Glass出力ウィンドウが閉じられました。");
    await renderer.xr.setSession(session);
    if (popupClosing || popup.closed) throw new Error("Looking Glass出力ウィンドウが閉じられました。");
    // lkgCanvasはXRWebGLLayer生成時に初めて作られるため、セッション設定後に
    // 内蔵トラックボール操作を停止する。ここを止めないとドラッグのたびに
    // on-config-changedが発火し、quiltバッファが再確保される。
    const lkgCanvas = (
      LookingGlassConfig as unknown as { lkgCanvas?: HTMLCanvasElement | null }
    ).lkgCanvas;
    if (lkgCanvas) prepareOutputCanvas(lkgCanvas);
    mountOutputCanvas();
    if (!hasLookingGlassCalibration()) {
      throw new Error("Looking Glassの校正情報を取得できませんでした。Bridgeと機器接続を確認してください。");
    }
    const output = (LookingGlassConfig as unknown as LookingGlassInternals).popup;
    if (!output || output.closed) {
      throw new Error("Looking Glass出力ウィンドウに接続できませんでした。");
    }
    await holdDisplayAwake();
    return true;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
