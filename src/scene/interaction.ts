import type * as THREE from "three";

const ROT_SPEED = 0.008;
const PAN_SPEED = 0.0012;
const ZOOM_SPEED = 0.0012;
const MAX_PITCH = 1.2; // rad
const SMOOTHING = 12; // 大きいほどキビキビ動く

/**
 * シーンルートのGroupをマウスで操作する。
 * カメラではなくGroupを動かすことで、Looking Glass(WebXR)表示中も
 * 同じ操作が効く。
 *
 * リスナーはキャンバスではなく#app(メインウィンドウ側に常に残る要素)に
 * 付ける。XRセッション中はポリフィルがキャンバス自体をLooking Glass側の
 * ポップアップへ移動するため、キャンバスに付けるとメインウィンドウから
 * 操作できなくなる。パネルUI上で始まったイベントは無視する。
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
    // パネルUIなど操作対象外の要素で始まったイベントか
    const onUi = (e: Event): boolean =>
      e.target instanceof Element && e.target.closest(".panel") !== null;

    dom.addEventListener("pointerdown", (e) => {
      if (onUi(e)) return;
      if (e.button !== 0 && e.button !== 2) return;
      this.pointerId = e.pointerId;
      this.panning = e.button === 2 || e.shiftKey;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        /* キャプチャできなくてもドラッグ自体は継続できる */
      }
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
        if (onUi(e)) return; // パネル上はスクロールに使う
        e.preventDefault();
        this.targetScale *= Math.exp(-e.deltaY * ZOOM_SPEED);
        this.targetScale = Math.max(0.25, Math.min(6, this.targetScale));
      },
      { passive: false },
    );

    dom.addEventListener("dblclick", (e) => {
      if (onUi(e)) return;
      this.reset();
    });
    dom.addEventListener("contextmenu", (e) => {
      if (onUi(e)) return;
      e.preventDefault();
    });
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
