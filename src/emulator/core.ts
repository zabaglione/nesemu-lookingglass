import NES from "./vendor/jsnes/nes.js";
import { LAYER_NONE } from "./vendor/jsnes/ppu/index.js";

// オーバースキャン相当を上下左右8pxクロップした表示領域。
// (クリッピング済み领域や左端のスクロールゴミを見せないため)
export const VISIBLE_W = 240;
export const VISIBLE_H = 224;
const CROP_X = 8;
const CROP_Y = 8;

// 前面スプライトをY座標で振り分ける深度バケット数(ジオラマ表示用)
export const SPRITE_BUCKETS = 8;

/** 1フレーム分のレイヤー画像(RGBA、上下反転済み=three.jsのUV原点に合わせる) */
export interface LayerFrames {
  bg: Uint8Array<ArrayBuffer>;
  sprBehind: Uint8Array<ArrayBuffer>;
  sprFront: Uint8Array<ArrayBuffer>;
  /** 背景色(0-1のRGB) */
  backdrop: [number, number, number];
}

export type AudioSampleCallback = (left: number, right: number) => void;

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

  /** 前面スプライトの深度バケット(奥→手前の順、RGBA) */
  readonly spriteBuckets: Uint8Array<ArrayBuffer>[] = Array.from(
    { length: SPRITE_BUCKETS },
    () => new Uint8Array(VISIBLE_W * VISIBLE_H * 4),
  );

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
   * 前面優先度のスプライトをOAM情報から自前でラスタライズし、
   * 画面Y座標に応じた深度バケットへ振り分ける(ジオラマ表示用)。
   * タイル選択・反転の規則はvendor側renderSpritesPartiallyに合わせている。
   * フレーム末尾のOAM状態を使うため、走査線単位の多重化を行うゲームでは
   * 近似になる(通常のゲームでは問題にならない)。
   */
  updateSpriteBuckets(): void {
    for (const b of this.spriteBuckets) {
      b.fill(0);
    }

    const ppu = this.nes.ppu;
    if (!this.romLoaded || ppu.f_spVisibility !== 1) return;

    const size16 = ppu.f_spriteSize === 1;
    const height = size16 ? 16 : 8;
    const ptTile = ppu.ptTile;
    const pal = ppu.sprPalette;

    // 番号の大きいスプライトから描き、小さい番号の上書きで手前を表現
    for (let i = 63; i >= 0; i--) {
      if (ppu.bgPriority[i] === 1) continue; // 背面は既存レイヤーで表示
      const oamY: number = ppu.sprY[i];
      if (oamY >= 0xef) continue; // 画面外に退避されたスプライト
      const sy = oamY + 1;
      const sx: number = ppu.sprX[i];
      const palAdd: number = ppu.sprCol[i];
      const hFlip = ppu.horiFlip[i] === 1;
      const vFlip = ppu.vertFlip[i] === 1;
      const tile: number = ppu.sprTile[i];

      // バケットはスプライト中心のY座標で決定(下ほど手前)
      let bucket = Math.floor(
        (((sy + height / 2 - CROP_Y) / VISIBLE_H) * SPRITE_BUCKETS) | 0,
      );
      bucket = Math.max(0, Math.min(SPRITE_BUCKETS - 1, bucket));
      const out = this.spriteBuckets[bucket];

      for (let row = 0; row < height; row++) {
        const ty = sy + row - CROP_Y;
        if (ty < 0 || ty >= VISIBLE_H) continue;

        let tileIndex: number;
        let srcRow: number;
        if (!size16) {
          tileIndex = ppu.f_spPatternTable === 0 ? tile : tile + 256;
          srcRow = vFlip ? 7 - row : row;
        } else {
          // 8x16: タイル番号bit0がパターンテーブルを選ぶ(vendorと同一の式)
          const topTileNum = tile & 0xfe;
          const top = (tile & 1) !== 0 ? topTileNum - 1 + 256 : topTileNum;
          const tileOffset = row < 8 ? (vFlip ? 1 : 0) : (vFlip ? 0 : 1);
          tileIndex = top + tileOffset;
          const r = row & 7;
          srcRow = vFlip ? 7 - r : r;
        }
        const pix: Uint8Array = ptTile[tileIndex].pix;

        const dstRowStart = (VISIBLE_H - 1 - ty) * VISIBLE_W;
        for (let c = 0; c < 8; c++) {
          const tx = sx + c - CROP_X;
          if (tx < 0 || tx >= VISIBLE_W) continue;
          const p = pix[srcRow * 8 + (hFlip ? 7 - c : c)];
          if (p === 0) continue;
          const color = pal[p + palAdd];
          const o = (dstRowStart + tx) * 4;
          out[o] = color & 0xff;
          out[o + 1] = (color >> 8) & 0xff;
          out[o + 2] = (color >> 16) & 0xff;
          out[o + 3] = 255;
        }
      }
    }
  }
}
