import NES from "./vendor/jsnes/nes.js";
import { LAYER_NONE } from "./vendor/jsnes/ppu/index.js";

// オーバースキャン相当を上下左右8pxクロップした表示領域。
// (クリッピング済み领域や左端のスクロールゴミを見せないため)
export const VISIBLE_W = 240;
export const VISIBLE_H = 224;
const CROP_X = 8;
const CROP_Y = 8;
// Looking Glassは各オブジェクトを多視点数ぶん描画するため上限を低く保つ。
export const MAX_SPRITE_GROUPS = 8;

export type SpritePriority = "behind" | "front";

export interface SpriteGroupFrame {
  rgba: Uint8Array<ArrayBuffer>;
  visible: boolean;
  priority: SpritePriority;
  /** 画面上端=0、下端=1。通常レイヤー表示内の微小なZ差に使う。 */
  depth: number;
}

/** 1フレーム分のレイヤー画像(RGBA、上下反転済み=three.jsのUV原点に合わせる) */
export interface LayerFrames {
  bg: Uint8Array<ArrayBuffer>;
  sprBehind: Uint8Array<ArrayBuffer>;
  sprFront: Uint8Array<ArrayBuffer>;
  spriteGroups: SpriteGroupFrame[];
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
  private spriteGroupMargin = 4;
  private spriteGroupLimit = 8;

  private readonly frames: LayerFrames = {
    bg: new Uint8Array(VISIBLE_W * VISIBLE_H * 4),
    sprBehind: new Uint8Array(VISIBLE_W * VISIBLE_H * 4),
    sprFront: new Uint8Array(VISIBLE_W * VISIBLE_H * 4),
    spriteGroups: Array.from({ length: MAX_SPRITE_GROUPS }, () => ({
      rgba: new Uint8Array(VISIBLE_W * VISIBLE_H * 4),
      visible: false,
      priority: "front" as SpritePriority,
      depth: 0.5,
    })),
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

  /** 通常レイヤー表示のスプライト自動グループ化を調整する。 */
  setSpriteGrouping(marginPx: number, groupLimit: number): void {
    this.spriteGroupMargin = Math.max(0, Math.min(16, Math.round(marginPx)));
    this.spriteGroupLimit = Math.max(
      2,
      Math.min(MAX_SPRITE_GROUPS, Math.round(groupLimit)),
    );
  }

  /**
   * PPUのレイヤーバッファをRGBAテクスチャ用に変換する。
   * 返すバッファは使い回しなので呼び出し側で保持しないこと。
   */
  updateLayers(groupSprites = true): LayerFrames {
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
    if (groupSprites) this.updateSpriteGroups(ppu);

    return this.frames;
  }

  /**
   * 実際に描画されたOAMスプライトを、近接する矩形同士でグループ化する。
   * 1キャラクターを構成する複数タイルを同じプレーンへまとめるための処理。
   */
  private updateSpriteGroups(ppu: any): void {
    type Rect = {
      owner: number;
      x: number;
      y: number;
      w: number;
      h: number;
      priority: SpritePriority;
      pixels: number;
    };
    type Component = {
      members: Rect[];
      priority: SpritePriority;
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      pixels: number;
      cx: number;
      cy: number;
    };

    const behindOwners: Uint8Array = ppu.sprBehindOwnerBuffer;
    const frontOwners: Uint8Array = ppu.sprFrontOwnerBuffer;
    const ownerPixels = new Uint32Array(64);
    for (let y = 0; y < VISIBLE_H; y++) {
      const row = (y + CROP_Y) << 8;
      for (let x = 0; x < VISIBLE_W; x++) {
        const s = row + x + CROP_X;
        const behindOwner = behindOwners[s];
        const frontOwner = frontOwners[s];
        if (behindOwner < 64) ownerPixels[behindOwner]++;
        if (frontOwner < 64) ownerPixels[frontOwner]++;
      }
    }

    const spriteHeight = ppu.f_spriteSize === 0 ? 8 : 16;
    const rects: Rect[] = [];
    for (let owner = 0; owner < 64; owner++) {
      if (ownerPixels[owner] === 0) continue;
      rects.push({
        owner,
        x: ppu.sprX[owner],
        y: ppu.sprY[owner] + 1,
        w: 8,
        h: spriteHeight,
        priority: ppu.bgPriority[owner] === 1 ? "behind" : "front",
        pixels: ownerPixels[owner],
      });
    }

    const parent = rects.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const unite = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const left = rects[a];
        const right = rects[b];
        if (left.priority !== right.priority) continue;
        const nearX =
          left.x <= right.x + right.w + this.spriteGroupMargin &&
          right.x <= left.x + left.w + this.spriteGroupMargin;
        const nearY =
          left.y <= right.y + right.h + this.spriteGroupMargin &&
          right.y <= left.y + left.h + this.spriteGroupMargin;
        if (nearX && nearY) unite(a, b);
      }
    }

    const componentMap = new Map<number, Rect[]>();
    rects.forEach((rect, i) => {
      const root = find(i);
      const members = componentMap.get(root);
      if (members) members.push(rect);
      else componentMap.set(root, [rect]);
    });
    const components: Component[] = Array.from(componentMap.values()).map(
      (members) => {
        const minX = Math.min(...members.map((r) => r.x));
        const minY = Math.min(...members.map((r) => r.y));
        const maxX = Math.max(...members.map((r) => r.x + r.w));
        const maxY = Math.max(...members.map((r) => r.y + r.h));
        return {
          members,
          priority: members[0].priority,
          minX,
          minY,
          maxX,
          maxY,
          pixels: members.reduce((sum, r) => sum + r.pixels, 0),
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
        };
      },
    );
    components.sort((a, b) => b.pixels - a.pixels);

    // 最大数を超えた小グループは、同じ優先度の最寄りグループへ統合する。
    const selected: Component[] = [];
    for (const priority of ["behind", "front"] as const) {
      const first = components.find((c) => c.priority === priority);
      if (first) selected.push(first);
    }
    for (const component of components) {
      if (
        selected.length < this.spriteGroupLimit &&
        !selected.includes(component)
      ) {
        selected.push(component);
      }
    }

    const componentSlot = new Map<Component, number>();
    selected.forEach((component, slot) => componentSlot.set(component, slot));
    for (const component of components) {
      if (componentSlot.has(component)) continue;
      let nearestSlot = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      selected.forEach((candidate, slot) => {
        if (candidate.priority !== component.priority) return;
        const dx = candidate.cx - component.cx;
        const dy = candidate.cy - component.cy;
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestSlot = slot;
        }
      });
      componentSlot.set(component, nearestSlot);
    }

    const ownerSlot = new Int16Array(64);
    ownerSlot.fill(-1);
    for (const component of components) {
      const slot = componentSlot.get(component) ?? -1;
      for (const member of component.members) ownerSlot[member.owner] = slot;
    }

    for (const group of this.frames.spriteGroups) {
      // 前フレームで使ったバッファだけを消去し、非表示スロットへの
      // 毎フレームの大容量書き込みを避ける。
      if (group.visible) group.rgba.fill(0);
      group.visible = false;
    }
    selected.forEach((component, slot) => {
      const group = this.frames.spriteGroups[slot];
      group.visible = true;
      group.priority = component.priority;
      group.depth = Math.max(
        0,
        Math.min(1, (component.maxY - CROP_Y) / VISIBLE_H),
      );
    });

    const copyPixel = (
      owner: number,
      source: Uint8Array<ArrayBuffer>,
      offset: number,
    ): void => {
      if (owner >= 64) return;
      const slot = ownerSlot[owner];
      if (slot < 0) return;
      const target = this.frames.spriteGroups[slot].rgba;
      target[offset] = source[offset];
      target[offset + 1] = source[offset + 1];
      target[offset + 2] = source[offset + 2];
      target[offset + 3] = source[offset + 3];
    };
    for (let y = 0; y < VISIBLE_H; y++) {
      const srcRow = (y + CROP_Y) << 8;
      let offset = (VISIBLE_H - 1 - y) * VISIBLE_W * 4;
      for (let x = 0; x < VISIBLE_W; x++, offset += 4) {
        const s = srcRow + x + CROP_X;
        copyPixel(behindOwners[s], this.frames.sprBehind, offset);
        copyPixel(frontOwners[s], this.frames.sprFront, offset);
      }
    }
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
