import NES from "./vendor/jsnes/nes.js";
import { LAYER_NONE } from "./vendor/jsnes/ppu/index.js";

// オーバースキャン相当を上下左右8pxクロップした表示領域。
// (クリッピング済み领域や左端のスクロールゴミを見せないため)
export const VISIBLE_W = 240;
export const VISIBLE_H = 224;
const CROP_X = 8;
const CROP_Y = 8;

/** 1フレーム分のレイヤー画像(RGBA、上下反転済み=three.jsのUV原点に合わせる) */
export interface LayerFrames {
  bg: Uint8Array<ArrayBuffer>;
  sprBehind: Uint8Array<ArrayBuffer>;
  sprFront: Uint8Array<ArrayBuffer>;
  /** 背景色(0-1のRGB) */
  backdrop: [number, number, number];
}

export type AudioSampleCallback = (left: number, right: number) => void;

/** 合成フレーム(AI深度モード用) */
export interface CompositeFrames {
  /** 上下反転済みRGBA(three.jsテクスチャ用) */
  tex: Uint8Array<ArrayBuffer>;
  /** 上→下の行順RGBA(深度モデル入力用) */
  model: Uint8Array<ArrayBuffer>;
}

/**
 * 改造版jsnesのラッパー。ROMのロード、フレーム実行、
 * レイヤー別フレームバッファのRGBA変換を担当する。
 */
export class NesCore {
  readonly nes: any;
  romLoaded = false;

  private readonly frames: LayerFrames = {
    bg: new Uint8Array(VISIBLE_W * VISIBLE_H * 4),
    sprBehind: new Uint8Array(VISIBLE_W * VISIBLE_H * 4),
    sprFront: new Uint8Array(VISIBLE_W * VISIBLE_H * 4),
    backdrop: [0, 0, 0],
  };

  private readonly composite: CompositeFrames = {
    tex: new Uint8Array(VISIBLE_W * VISIBLE_H * 4),
    model: new Uint8Array(VISIBLE_W * VISIBLE_H * 4),
  };

  constructor(onAudioSample: AudioSampleCallback, sampleRate: number) {
    this.nes = new NES({
      onFrame: () => {},
      onAudioSample,
      sampleRate,
      emulateSound: true,
    });
  }

  /** iNES形式のROMをロードする。失敗時は例外(日本語メッセージ化は呼び出し側)。 */
  loadRom(data: Uint8Array): void {
    this.nes.loadROM(data);
    this.romLoaded = true;
  }

  frame(): void {
    this.nes.frame();
  }

  /** ゲームをリセット(ROMを再ロード) */
  resetGame(): void {
    if (this.romLoaded) {
      this.nes.reloadROM();
    }
  }

  get mapperType(): number | null {
    return this.romLoaded ? this.nes.rom.mapperType : null;
  }

  /**
   * PPUのレイヤーバッファをRGBAテクスチャ用に変換する。
   * 返すバッファは使い回しなので呼び出し側で保持しないこと。
   */
  updateLayers(): LayerFrames {
    const ppu = this.nes.ppu;
    const bgbuf: Uint32Array = ppu.bgbuffer;
    const pix: Uint32Array = ppu.pixrendered;
    const behind: Uint32Array = ppu.sprBehindBuffer;
    const front: Uint32Array = ppu.sprFrontBuffer;

    const bgOut = this.frames.bg;
    const behindOut = this.frames.sprBehind;
    const frontOut = this.frames.sprFront;

    for (let y = 0; y < VISIBLE_H; y++) {
      const srcRow = (y + CROP_Y) << 8;
      // three.jsのテクスチャはV=0が下端なので行を上下反転して書き込む
      let o = (VISIBLE_H - 1 - y) * VISIBLE_W * 4;
      for (let x = 0; x < VISIBLE_W; x++, o += 4) {
        const s = srcRow + x + CROP_X;

        // 背景タイル層: pixrenderedのbit8が「不透明な背景ピクセル」
        // 色はjsnes内部の0xBBGGRR形式(赤が下位バイト)
        if (pix[s] > 0xff) {
          const c = bgbuf[s];
          bgOut[o] = c & 0xff;
          bgOut[o + 1] = (c >> 8) & 0xff;
          bgOut[o + 2] = (c >> 16) & 0xff;
          bgOut[o + 3] = 255;
        } else {
          bgOut[o + 3] = 0;
        }

        const b = behind[s];
        if (b !== LAYER_NONE) {
          behindOut[o] = b & 0xff;
          behindOut[o + 1] = (b >> 8) & 0xff;
          behindOut[o + 2] = (b >> 16) & 0xff;
          behindOut[o + 3] = 255;
        } else {
          behindOut[o + 3] = 0;
        }

        const f = front[s];
        if (f !== LAYER_NONE) {
          frontOut[o] = f & 0xff;
          frontOut[o + 1] = (f >> 8) & 0xff;
          frontOut[o + 2] = (f >> 16) & 0xff;
          frontOut[o + 3] = 255;
        } else {
          frontOut[o + 3] = 0;
        }
      }
    }

    const bd = ppu.layerBackdropColor >>> 0;
    this.frames.backdrop = [
      (bd & 0xff) / 255,
      ((bd >> 8) & 0xff) / 255,
      ((bd >> 16) & 0xff) / 255,
    ];

    return this.frames;
  }

  /**
   * PPUの合成済みフレーム(背景+スプライト)をRGBAへ変換する(AI深度モード用)。
   * 返すバッファは使い回しなので呼び出し側で保持しないこと。
   */
  updateComposite(): CompositeFrames {
    const buf: Uint32Array = this.nes.ppu.buffer; // 0xBBGGRR
    const tex = this.composite.tex;
    const model = this.composite.model;

    for (let y = 0; y < VISIBLE_H; y++) {
      const srcRow = (y + CROP_Y) << 8;
      let to = (VISIBLE_H - 1 - y) * VISIBLE_W * 4;
      let mo = y * VISIBLE_W * 4;
      for (let x = 0; x < VISIBLE_W; x++, to += 4, mo += 4) {
        const c = buf[srcRow + x + CROP_X];
        const r = c & 0xff;
        const g = (c >> 8) & 0xff;
        const b = (c >> 16) & 0xff;
        tex[to] = r;
        tex[to + 1] = g;
        tex[to + 2] = b;
        tex[to + 3] = 255;
        model[mo] = r;
        model[mo + 1] = g;
        model[mo + 2] = b;
        model[mo + 3] = 255;
      }
    }
    return this.composite;
  }
}
