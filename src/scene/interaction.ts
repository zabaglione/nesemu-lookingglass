import type * as THREE from "three";

const ROT_SPEED = 0.008;
const PAN_SPEED = 0.0012;
const ZOOM_SPEED = 0.0012;
const MAX_PITCH = 1.2; // rad
const SMOOTHING = 12; // 大きいほどキビキビ動く

/**
 * シーンルートのGroupをマウスで操作する。
 * カメラではなくGroupを動かすことで、Looking Glass(WebXR)表示中も
 * デスクトップ側ウィンドウから同じ操作ができる。
 *
 * 左ドラッグ: 回転 / ホイール: 拡大縮小 /
 * 右ドラッグ(またはShift+ドラッグ): 平行移動 / ダブルクリック: リセット
 */
export class SceneInteraction {
  private targetRotX = 0;
  private targetRotY = 0;
  private targetScale = 1;
  private targetX = 0;
  private targetY = 0;

  private pointerId: number | null = null;
  private panning = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly root: THREE.Group,
    dom: HTMLElement,
  ) {
    dom.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.pointerId = e.pointerId;
      this.panning = e.button === 2 || e.shiftKey;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });

    dom.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.pointerId) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.panning) {
        this.targetX += dx * PAN_SPEED;
        this.targetY -= dy * PAN_SPEED;
      } else {
        this.targetRotY += dx * ROT_SPEED;
        this.targetRotX += dy * ROT_SPEED;
        this.targetRotX = Math.max(
          -MAX_PITCH,
          Math.min(MAX_PITCH, this.targetRotX),
        );
      }
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) {
        this.pointerId = null;
      }
    };
    dom.addEventListener("pointerup", release);
    dom.addEventListener("pointercancel", release);

    dom.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.targetScale *= Math.exp(-e.deltaY * ZOOM_SPEED);
        this.targetScale = Math.max(0.25, Math.min(6, this.targetScale));
      },
      { passive: false },
    );

    dom.addEventListener("dblclick", () => this.reset());
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  reset(): void {
    this.targetRotX = 0;
    this.targetRotY = 0;
    this.targetScale = 1;
    this.targetX = 0;
    this.targetY = 0;
  }

  /** 毎フレーム呼ぶ(スムージング適用) */
  update(dtMs: number): void {
    const k = 1 - Math.exp((-SMOOTHING * dtMs) / 1000);
    const r = this.root;
    r.rotation.x += (this.targetRotX - r.rotation.x) * k;
    r.rotation.y += (this.targetRotY - r.rotation.y) * k;
    const s = r.scale.x + (this.targetScale - r.scale.x) * k;
    r.scale.setScalar(s);
    r.position.x += (this.targetX - r.position.x) * k;
    r.position.y += (this.targetY - r.position.y) * k;
  }
}
