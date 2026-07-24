import Controller from "./vendor/jsnes/controller.js";

// NESボタンのインデックス(jsnes Controller定数と同値)
const BUTTONS = [
  Controller.BUTTON_A,
  Controller.BUTTON_B,
  Controller.BUTTON_SELECT,
  Controller.BUTTON_START,
  Controller.BUTTON_UP,
  Controller.BUTTON_DOWN,
  Controller.BUTTON_LEFT,
  Controller.BUTTON_RIGHT,
] as const;

const IDX_A = 0;
const IDX_B = 1;
const IDX_SELECT = 2;
const IDX_START = 3;
const IDX_UP = 4;
const IDX_DOWN = 5;
const IDX_LEFT = 6;
const IDX_RIGHT = 7;

// キーボード割り当て(1P): 矢印 + X=A, Z=B, Enter=Start, Shift=Select
const KEY_MAP: Record<string, number> = {
  ArrowUp: IDX_UP,
  ArrowDown: IDX_DOWN,
  ArrowLeft: IDX_LEFT,
  ArrowRight: IDX_RIGHT,
  KeyX: IDX_A,
  KeyZ: IDX_B,
  Enter: IDX_START,
  ShiftLeft: IDX_SELECT,
  ShiftRight: IDX_SELECT,
};

const AXIS_THRESHOLD = 0.5;

/**
 * ゲームパッド(Gamepad API)とキーボードをNESコントローラ(1P)に割り当てる。
 * 毎フレームpoll()を呼ぶこと。
 */
export class InputManager {
  private prev = new Array<boolean>(8).fill(false);
  private keys = new Array<boolean>(8).fill(false);

  constructor(private readonly nes: any) {
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const idx = KEY_MAP[e.code];
    if (idx === undefined) return;
    // 入力対象がフォーム要素のときは奪わない
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    this.keys[idx] = down;
    e.preventDefault();
  }

  /** 接続中のゲームパッド名(未接続ならnull)。UI表示用。 */
  gamepadName(): string | null {
    for (const pad of navigator.getGamepads()) {
      if (pad && pad.connected) return pad.id;
    }
    return null;
  }

  /** 現在の入力状態を集約してエミュレータへ反映する */
  poll(): void {
    const state = this.keys.slice();

    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      const b = (i: number) => pad.buttons.length > i && pad.buttons[i].pressed;
      // 右側2ボタン(A/B等)→NES A、左側2ボタン(X/Y等)→NES B
      state[IDX_A] ||= b(0) || b(1);
      state[IDX_B] ||= b(2) || b(3);
      state[IDX_SELECT] ||= b(8);
      state[IDX_START] ||= b(9);
      state[IDX_UP] ||= b(12);
      state[IDX_DOWN] ||= b(13);
      state[IDX_LEFT] ||= b(14);
      state[IDX_RIGHT] ||= b(15);
      // 左スティックも十字キーとして使えるように
      if (pad.axes.length >= 2) {
        state[IDX_LEFT] ||= pad.axes[0] < -AXIS_THRESHOLD;
        state[IDX_RIGHT] ||= pad.axes[0] > AXIS_THRESHOLD;
        state[IDX_UP] ||= pad.axes[1] < -AXIS_THRESHOLD;
        state[IDX_DOWN] ||= pad.axes[1] > AXIS_THRESHOLD;
      }
      break; // 1Pのみ: 最初のパッドを使用
    }

    for (let i = 0; i < 8; i++) {
      if (state[i] === this.prev[i]) continue;
      if (state[i]) {
        this.nes.buttonDown(1, BUTTONS[i]);
      } else {
        this.nes.buttonUp(1, BUTTONS[i]);
      }
      this.prev[i] = state[i];
    }
  }
}
