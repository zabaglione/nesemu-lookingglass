import "./style.css";
import * as THREE from "three";
import { NES_SAMPLE_RATE, NesAudio } from "./emulator/audio";
import { NesCore } from "./emulator/core";
import { InputManager } from "./emulator/input";
import { buildTestRom } from "./emulator/testRom";
import { SceneInteraction } from "./scene/interaction";
import { initLookingGlass, toggleLookingGlass } from "./scene/lookingglass";
import { Stage } from "./scene/stage";
import { Panel } from "./ui/panel";

const FRAME_MS = 1000 / 60.0988; // NTSC NESのフレームレート

// navigator.xrを置き換えるため、レンダラー生成より先に初期化する
initLookingGlass();

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
camera.position.set(0, 0, 1.7);

const audio = new NesAudio();
const core = new NesCore(audio.pushSample, NES_SAMPLE_RATE);
const stage = new Stage(core.updateLayers());
stage.scene.background = new THREE.Color(0x05060a);
const interaction = new SceneInteraction(stage.root, canvas);
const input = new InputManager(core.nes);

let paused = false;

const panel = new Panel(document.getElementById("panel-root")!, {
  onRomFile: (file) => void loadRomFile(file),
  onDemoRom: () => void loadRomBytes(buildTestRom(), "内蔵デモROM"),
  onEnterLookingGlass: () => void handleLookingGlass(),
  onLayerGap: (v) => stage.setLayerGap(v),
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

async function loadRomBytes(bytes: Uint8Array, name: string): Promise<void> {
  panel.clearMessage();
  try {
    await audio.ensureStarted();
  } catch (e) {
    console.warn("音声の初期化に失敗しました(無音で続行):", e);
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
    loadDemo: () => void loadRomBytes(buildTestRom(), "内蔵デモROM"),
    // rAFが止まる環境(非表示タブ等)でも手動でフレームを進められるように
    step: (n = 1) => {
      for (let i = 0; i < n; i++) {
        input.poll();
        core.frame();
      }
      stage.commitFrame(core.updateLayers());
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

  stage.commitFrame(core.updateLayers());
  interaction.update(dt);

  // XRセッション中はポリフィルが各ビューのカメラを差し替える
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
