import "./style.css";
import * as THREE from "three";
import { NES_SAMPLE_RATE, NesAudio } from "./emulator/audio";
import { NesCore } from "./emulator/core";
import { InputManager } from "./emulator/input";
import { buildTestRom } from "./emulator/testRom";
import { SceneInteraction } from "./scene/interaction";
import {
  initLookingGlass,
  pinLookingGlassView,
  toggleLookingGlass,
} from "./scene/lookingglass";
import { Stage } from "./scene/stage";
import { Panel } from "./ui/panel";

const FRAME_MS = 1000 / 60.0988; // NTSC NESのフレームレート

const canvas = document.getElementById("stage") as HTMLCanvasElement;

// navigator.xrを置き換えるため、レンダラー生成より先に初期化する
initLookingGlass(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
camera.position.set(0, 0, 1.7);

const audio = new NesAudio();
const core = new NesCore(audio.pushSample, NES_SAMPLE_RATE);
const stage = new Stage(core.updateLayers(), core.updateComposite().tex);
stage.scene.background = new THREE.Color(0x05060a);
// キャンバスはXRセッション中にLooking Glass側ウィンドウへ移動するため、
// マウス操作はメインウィンドウに残る#appで受ける
const interaction = new SceneInteraction(
  stage.root,
  document.getElementById("app")!,
);
const input = new InputManager(core.nes);

let paused = false;

// AI深度モード(モジュールとモデルは初回切り替え時に動的読み込み)
let depthEstimator: InstanceType<
  typeof import("./depth/estimator").DepthEstimator
> | null = null;
let depthLoading = false;
const depthLayerNames = ["behind", "bg", "front"] as const;
const lastDepthVersions = { behind: 0, bg: 0, front: 0 };
// パネルの調整値(モデル読み込み前の変更も、読み込み後に反映する)
const depthSettings = { inferSize: 252, smoothing: 1 };

/**
 * 深度モデルがブラウザキャッシュ(transformers.jsのCache API)に
 * 保存済みかどうか。保存済みならダウンロード確認は不要。
 */
async function isDepthModelCached(): Promise<boolean> {
  try {
    if (!("caches" in window)) return false;
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    return keys.some(
      (req) =>
        req.url.includes("depth-anything-v2-small") &&
        req.url.includes(".onnx"),
    );
  } catch {
    return false;
  }
}

async function enableDepthMode(): Promise<void> {
  if (depthEstimator || depthLoading) {
    stage.setDisplayMode("depth");
    return;
  }

  // 未キャッシュならダウンロード前にユーザーへ確認する
  if (!(await isDepthModelCached())) {
    const ok = await panel.showConfirm(
      "AI深度には深度推定モデル「Depth Anything V2 small」(約50MB)のダウンロードが必要です。初回のみで、以後はブラウザ内にキャッシュされます。推論はブラウザ内で完結し、ゲーム画面が外部に送信されることはありません。",
      "ダウンロードして開始",
      "キャンセル",
    );
    if (!ok) {
      stage.setLayerGap(panel.layerGap);
      stage.setDisplayMode("layers");
      panel.setDisplayMode("layers");
      return;
    }
  }

  stage.setDisplayMode("depth");
  depthLoading = true;
  panel.showInfo("AI深度モデルを準備中…");
  try {
    const { DepthEstimator } = await import("./depth/estimator");
    const est = new DepthEstimator();
    await est.init((msg) => panel.showInfo(msg));
    est.setInferSize(depthSettings.inferSize);
    est.smoothing = depthSettings.smoothing;
    depthEstimator = est;
    if (est.usingWebGPU) {
      panel.showInfo("AI深度: WebGPUで実行中です。");
    } else {
      panel.showInfo(
        "AI深度: このブラウザはWebGPU非対応のためCPUで実行します(低速)。",
      );
    }
  } catch (e) {
    panel.showError(
      `深度モデルを読み込めませんでした: ${(e as Error).message}`,
    );
    stage.setLayerGap(panel.layerGap);
    stage.setDisplayMode("layers");
    panel.setDisplayMode("layers");
  } finally {
    depthLoading = false;
  }
}

const panel = new Panel(document.getElementById("panel-root")!, {
  onRomFile: (file) => void loadRomFile(file),
  onDemoRom: () => void loadRomBytes(buildTestRom(), "内蔵デモROM"),
  onEnterLookingGlass: () => void handleLookingGlass(),
  onDisplayMode: (mode) => {
    if (mode === "depth") {
      stage.setLayerGap(panel.depthGap);
      void enableDepthMode();
    } else {
      stage.setLayerGap(panel.layerGap);
      stage.setDisplayMode("layers");
      panel.clearMessage();
    }
  },
  onLayerGap: (v) => stage.setLayerGap(v),
  onDepthScale: (v) => stage.setDepthScale(v),
  onDepthInferSize: (px) => {
    depthSettings.inferSize = px;
    depthEstimator?.setInferSize(px);
  },
  onDepthSmoothing: (v) => {
    depthSettings.smoothing = v;
    if (depthEstimator) {
      depthEstimator.smoothing = v;
    }
  },
  onAspectMode: (mode) => {
    stage.setAspectMode(mode);
    fitCamera();
  },
  onVolume: (v) => audio.setVolume(v),
  onTogglePause: () => {
    if (!core.romLoaded) return;
    paused = !paused;
    panel.setPaused(paused);
  },
  onResetGame: () => core.resetGame(),
  onResetView: () => interaction.reset(),
});
stage.setLayerGap(panel.initialGap);
stage.setDepthScale(panel.initialDepthScale);

async function loadRomBytes(bytes: Uint8Array, name: string): Promise<void> {
  panel.clearMessage();
  try {
    await audio.ensureStarted();
  } catch (e) {
    console.warn("Audio initialization failed; continuing without sound.", e);
  }
  try {
    core.loadRom(bytes);
  } catch (e) {
    panel.showError(`ROMを読み込めませんでした: ${(e as Error).message}`);
    return;
  }
  paused = false;
  panel.setPaused(false);
  panel.setRomInfo(name, core.mapperType);
}

async function loadRomFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadRomBytes(bytes, file.name);
}

async function handleLookingGlass(): Promise<void> {
  try {
    const active = await toggleLookingGlass(renderer);
    panel.setLkgActive(active);
    if (active) {
      panel.showInfo(
        "開いたウィンドウをLooking Glass側ディスプレイへ移動し、ダブルクリックで全画面化してください。マウス操作はこのウィンドウで引き続き使えます。",
      );
    } else {
      panel.clearMessage();
    }
  } catch (e) {
    panel.showError(
      `Looking Glass表示を開始できません: ${(e as Error).message}。Looking Glass Bridgeが起動しているか確認してください。`,
    );
  }
}

renderer.xr.addEventListener("sessionend", () => {
  panel.setLkgActive(false);
});

// ---- ドラッグ&ドロップでROM読み込み ----
const dropOverlay = document.getElementById("drop-overlay")!;
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropOverlay.classList.add("active");
});
window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) dropOverlay.classList.remove("active");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dropOverlay.classList.remove("active");
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".nes")) {
    panel.showError("iNES形式(.nes)のファイルをドロップしてください。");
    return;
  }
  void loadRomFile(file);
});

// ---- リサイズ ----
// ウィンドウがどんな縦横比でも画面プレーン全体が視野に収まるよう、
// カメラ距離をフィットさせる(縦長ウィンドウで左右が切れるのを防ぐ)
const FIT_MARGIN = 1.15;
function fitCamera(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const zForHeight = ((stage.screenHeight / 2) * FIT_MARGIN) / Math.tan(halfFov);
  const zForWidth =
    ((stage.screenWidth / 2) * FIT_MARGIN) / (Math.tan(halfFov) * camera.aspect);
  camera.position.z = Math.max(zForHeight, zForWidth);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", fitCamera);
fitCamera();

// 開発時のみ: 動作検証用フック
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__nesDebug = {
    core,
    stage,
    renderer,
    camera,
    interaction,
    pinLookingGlassView,
    get depthEstimator() {
      return depthEstimator;
    },
    loadDemo: () => void loadRomBytes(buildTestRom(), "内蔵デモROM"),
    // rAFが止まる環境(非表示タブ等)でも手動でフレームを進められるように
    step: (n = 1) => {
      for (let i = 0; i < n; i++) {
        input.poll();
        core.frame();
      }
      if (stage.displayMode === "depth") {
        const frames = core.updateLayers();
        stage.commitFrame(frames);
        depthEstimator?.submit(frames);
      } else {
        stage.commitFrame(core.updateLayers());
      }
      renderer.render(stage.scene, camera);
    },
  };
}

// ---- メインループ ----
let last = performance.now();
let acc = 0;
let fpsWindowStart = last;
let fpsFrames = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  let dt = now - last;
  last = now;
  if (dt > 250) dt = 250; // タブ復帰時などの巨大なdtは捨てる

  if (core.romLoaded && !paused) {
    acc += dt;
    let steps = 0;
    while (acc >= FRAME_MS && steps < 3) {
      input.poll();
      core.frame();
      acc -= FRAME_MS;
      steps++;
      fpsFrames++;
    }
    if (steps === 3) acc = 0; // 追いつけないときは切り捨てる
  }

  if (stage.displayMode === "depth") {
    const frames = core.updateLayers();
    stage.commitFrame(frames);
    if (depthEstimator) {
      depthEstimator.submit(frames);
      for (const name of depthLayerNames) {
        const layer = depthEstimator.layers[name];
        if (layer.version !== lastDepthVersions[name]) {
          lastDepthVersions[name] = layer.version;
          stage.updateDepth(name, layer.depth);
        }
      }
    }
  } else {
    stage.commitFrame(core.updateLayers());
  }
  interaction.update(dt);

  // XRセッション中はポリフィルが各ビューのカメラを差し替える。
  // ホログラムカメラ設定はポリフィル内蔵コントロールに動かされないよう固定
  if (renderer.xr.isPresenting) {
    pinLookingGlassView();
  }
  renderer.render(stage.scene, camera);

  if (now - fpsWindowStart >= 1000) {
    panel.setFps(
      core.romLoaded && !paused
        ? (fpsFrames * 1000) / (now - fpsWindowStart)
        : null,
    );
    fpsFrames = 0;
    fpsWindowStart = now;
    panel.setGamepad(input.gamepadName());
  }
});
