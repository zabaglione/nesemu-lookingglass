// 日本語UIパネル。DOMを組み立ててコールバックを配線する。

import type { AspectMode } from "../scene/stage";

export interface PanelCallbacks {
  onRomFile(file: File): void;
  onDemoRom(): void;
  onEnterLookingGlass(): void;
  onLayerGap(value: number): void;
  onAspectMode(mode: AspectMode): void;
  onVolume(value: number): void;
  onTogglePause(): void;
  onResetGame(): void;
  onResetView(): void;
}

export class Panel {
  private readonly rootEl: HTMLElement;
  private romNameEl!: HTMLElement;
  private mapperEl!: HTMLElement;
  private padEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private pauseBtn!: HTMLButtonElement;
  private messageEl!: HTMLElement;
  private lkgBtn!: HTMLButtonElement;

  constructor(container: HTMLElement, cb: PanelCallbacks) {
    this.rootEl = document.createElement("div");
    this.rootEl.className = "panel";
    this.rootEl.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">NES × Looking Glass
          <small>立体視ファミコンエミュレーター</small>
        </div>
        <button class="panel-toggle" title="パネルの開閉">▲</button>
      </div>
      <div class="panel-body">
        <div class="panel-section">
          <h3>ROM</h3>
          <div class="btn-row">
            <button class="btn primary" data-id="open">ROMを開く…</button>
            <button class="btn" data-id="demo">内蔵デモ</button>
          </div>
          <input type="file" accept=".nes" data-id="file" hidden />
          <div class="status-line">ROM: <b data-id="rom-name">未読み込み</b></div>
          <div class="status-line">マッパー: <b data-id="mapper">-</b></div>
          <div class="status-line" data-id="pad-line">パッド: <b data-id="pad">未接続(キーボード可)</b></div>
          <div class="status-line">FPS: <b data-id="fps">-</b></div>
        </div>

        <div class="panel-section">
          <h3>表示</h3>
          <div class="slider-row">
            <label for="gap">層間距離</label>
            <input id="gap" type="range" min="0" max="0.3" step="0.005" value="0.1" />
            <output data-id="gap-out">0.10</output>
          </div>
          <div class="slider-row">
            <label for="aspect">画面比</label>
            <select id="aspect">
              <option value="tv" selected>TV(4:3相当)</option>
              <option value="square">ドット等倍</option>
            </select>
          </div>
          <div class="slider-row">
            <label for="vol">音量</label>
            <input id="vol" type="range" min="0" max="1" step="0.05" value="0.5" />
            <output data-id="vol-out">50%</output>
          </div>
          <div class="btn-row">
            <button class="btn" data-id="view-reset">視点リセット</button>
            <button class="btn" data-id="pause" disabled>ポーズ</button>
            <button class="btn" data-id="game-reset" disabled>リセット</button>
          </div>
        </div>

        <div class="panel-section">
          <h3>Looking Glass</h3>
          <button class="btn lkg" data-id="lkg">Looking Glassで表示</button>
          <div class="status-line" style="white-space: normal; margin-top: 6px">
            要 <b>Looking Glass Bridge</b>(起動済み)+ Chromium系ブラウザ。
            開いたウィンドウをLooking Glass側へ移動して全画面化してください。
          </div>
        </div>

        <div class="panel-section">
          <h3>操作方法</h3>
          <table class="help-table">
            <tr><td>ゲームパッド</td><td>十字キー/左スティック、右側ボタン=A、左側ボタン=B</td></tr>
            <tr><td>キーボード</td><td>矢印キー、X=A、Z=B、Enter=Start、Shift=Select</td></tr>
            <tr><td>左ドラッグ</td><td>回転</td></tr>
            <tr><td>ホイール</td><td>拡大縮小</td></tr>
            <tr><td>右ドラッグ</td><td>移動(Shift+ドラッグでも可)</td></tr>
            <tr><td>ダブルクリック</td><td>視点リセット</td></tr>
          </table>
        </div>

        <div class="message" data-id="message"></div>
      </div>
    `;
    container.appendChild(this.rootEl);

    const q = <T extends HTMLElement = HTMLElement>(sel: string): T => {
      const el = this.rootEl.querySelector<T>(sel);
      if (!el) throw new Error(`panel element not found: ${sel}`);
      return el;
    };

    this.romNameEl = q('[data-id="rom-name"]');
    this.mapperEl = q('[data-id="mapper"]');
    this.padEl = q('[data-id="pad"]');
    this.fpsEl = q('[data-id="fps"]');
    this.pauseBtn = q<HTMLButtonElement>('[data-id="pause"]');
    this.messageEl = q('[data-id="message"]');
    this.lkgBtn = q<HTMLButtonElement>('[data-id="lkg"]');

    const fileInput = q<HTMLInputElement>('[data-id="file"]');
    q('[data-id="open"]').addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) cb.onRomFile(f);
      fileInput.value = "";
    });
    q('[data-id="demo"]').addEventListener("click", () => cb.onDemoRom());
    this.lkgBtn.addEventListener("click", () => cb.onEnterLookingGlass());
    q('[data-id="view-reset"]').addEventListener("click", () =>
      cb.onResetView(),
    );
    this.pauseBtn.addEventListener("click", () => cb.onTogglePause());
    q<HTMLButtonElement>('[data-id="game-reset"]').addEventListener(
      "click",
      () => cb.onResetGame(),
    );

    const gap = q<HTMLInputElement>("#gap");
    const gapOut = q('[data-id="gap-out"]');
    gap.addEventListener("input", () => {
      gapOut.textContent = Number(gap.value).toFixed(2);
      cb.onLayerGap(Number(gap.value));
    });

    const aspect = q<HTMLSelectElement>("#aspect");
    aspect.addEventListener("change", () => {
      cb.onAspectMode(aspect.value as AspectMode);
    });

    const vol = q<HTMLInputElement>("#vol");
    const volOut = q('[data-id="vol-out"]');
    vol.addEventListener("input", () => {
      volOut.textContent = `${Math.round(Number(vol.value) * 100)}%`;
      cb.onVolume(Number(vol.value));
    });

    const toggle = q(".panel-toggle");
    toggle.addEventListener("click", () => {
      const collapsed = this.rootEl.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "▼" : "▲";
    });
    // ヘッダー全体でも開閉できるように(ボタン以外の部分)
    q(".panel-header").addEventListener("dblclick", () =>
      (toggle as HTMLButtonElement).click(),
    );
  }

  get initialGap(): number {
    return 0.1;
  }

  setRomInfo(name: string, mapper: number | null): void {
    this.romNameEl.textContent = name;
    this.mapperEl.textContent = mapper === null ? "-" : String(mapper);
    for (const id of ["pause", "game-reset"]) {
      this.rootEl
        .querySelector<HTMLButtonElement>(`[data-id="${id}"]`)!
        .removeAttribute("disabled");
    }
  }

  setGamepad(name: string | null): void {
    const line = this.padEl.closest(".status-line");
    if (name) {
      // 長いIDは適当に切り詰める
      this.padEl.textContent =
        name.length > 30 ? `${name.slice(0, 30)}…` : name;
      line?.classList.add("ok");
    } else {
      this.padEl.textContent = "未接続(キーボード可)";
      line?.classList.remove("ok");
    }
  }

  setFps(fps: number | null): void {
    this.fpsEl.textContent = fps === null ? "-" : fps.toFixed(1);
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.textContent = paused ? "再開" : "ポーズ";
  }

  setLkgActive(active: boolean): void {
    this.lkgBtn.textContent = active
      ? "Looking Glass表示を終了"
      : "Looking Glassで表示";
  }

  showError(msg: string): void {
    this.messageEl.className = "message error";
    this.messageEl.textContent = msg;
  }

  showInfo(msg: string): void {
    this.messageEl.className = "message info";
    this.messageEl.textContent = msg;
  }

  clearMessage(): void {
    this.messageEl.className = "message";
    this.messageEl.textContent = "";
  }
}
