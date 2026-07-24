// 内蔵デモROM(検証用)をブラウザ内で生成する。
// 背景ストライプ+前面/背面の優先度が異なるスプライトを表示し、
// レイヤー分離が正しく動くことを外部ROMなしで確認できる。
// コードは本プロジェクトのオリジナル(著作物の取り込みなし)。

/** 6502ミニアセンブラ(このデモROMの生成にだけ使う最小実装) */
class Asm {
  readonly out: number[] = [];
  private readonly labels = new Map<string, number>();
  private readonly fixups: {
    at: number;
    label: string;
    kind: "rel" | "abs";
  }[] = [];

  constructor(private readonly origin: number) {}

  get pc(): number {
    return this.origin + this.out.length;
  }

  label(name: string): void {
    this.labels.set(name, this.pc);
  }

  db(...bytes: number[]): void {
    for (const b of bytes) {
      this.out.push(b & 0xff);
    }
  }

  private ref(label: string, kind: "rel" | "abs"): void {
    this.fixups.push({ at: this.out.length, label, kind });
    this.out.push(0);
    if (kind === "abs") {
      this.out.push(0);
    }
  }

  addressOf(name: string): number {
    const addr = this.labels.get(name);
    if (addr === undefined) {
      throw new Error(`未定義ラベル: ${name}`);
    }
    return addr;
  }

  resolve(): void {
    for (const f of this.fixups) {
      const target = this.labels.get(f.label);
      if (target === undefined) {
        throw new Error(`未定義ラベル: ${f.label}`);
      }
      if (f.kind === "abs") {
        this.out[f.at] = target & 0xff;
        this.out[f.at + 1] = (target >> 8) & 0xff;
      } else {
        const off = target - (this.origin + f.at + 1);
        if (off < -128 || off > 127) {
          throw new Error(`分岐が範囲外: ${f.label}`);
        }
        this.out[f.at] = off & 0xff;
      }
    }
  }

  // ---- 命令ヘルパー(使用する命令のみ) ----
  sei() { this.db(0x78); }
  cld() { this.db(0xd8); }
  txs() { this.db(0x9a); }
  txa() { this.db(0x8a); }
  tay() { this.db(0xa8); }
  inx() { this.db(0xe8); }
  dex() { this.db(0xca); }
  pha() { this.db(0x48); }
  pla() { this.db(0x68); }
  rti() { this.db(0x40); }
  lsrA() { this.db(0x4a); }
  ldaImm(v: number) { this.db(0xa9, v); }
  ldxImm(v: number) { this.db(0xa2, v); }
  andImm(v: number) { this.db(0x29, v); }
  eorImm(v: number) { this.db(0x49, v); }
  cpxImm(v: number) { this.db(0xe0, v); }
  ldaZp(a: number) { this.db(0xa5, a); }
  staZp(a: number) { this.db(0x85, a); }
  incZp(a: number) { this.db(0xe6, a); }
  decZp(a: number) { this.db(0xc6, a); }
  ldaAbs(a: number) { this.db(0xad, a & 0xff, a >> 8); }
  staAbs(a: number) { this.db(0x8d, a & 0xff, a >> 8); }
  stxAbs(a: number) { this.db(0x8e, a & 0xff, a >> 8); }
  bitAbs(a: number) { this.db(0x2c, a & 0xff, a >> 8); }
  staAbsX(a: number) { this.db(0x9d, a & 0xff, a >> 8); }
  ldaAbsX(label: string) { this.db(0xbd); this.ref(label, "abs"); }
  ldaAbsY(label: string) { this.db(0xb9); this.ref(label, "abs"); }
  bne(label: string) { this.db(0xd0); this.ref(label, "rel"); }
  bpl(label: string) { this.db(0x10); this.ref(label, "rel"); }
  jmp(label: string) { this.db(0x4c); this.ref(label, "abs"); }
}

const PRG_ORG = 0xc000; // NROM-128: $8000にもミラーされる

// スプライト定義 (Y, tile, attr, X)。attr bit5=1が「背景の後ろ」
// s0/s4: 移動、s1: 逆移動、s2/s3/s5: 固定
const SPRITES: [number, number, number, number][] = [
  [96, 4, 0x00, 64], // 前面 パレット0 →右へ移動
  [120, 4, 0x01, 160], // 前面 パレット1 →左へ移動
  [80, 4, 0x20, 100], // 背面 パレット0 固定
  [140, 4, 0x21, 180], // 背面 パレット1 固定
  [56, 4, 0x22, 32], // 背面 パレット2 →右へ移動
  [168, 4, 0x02, 208], // 前面 パレット2 固定
];

// パレット($3F00-$3F1F): 背景色は暗い紺
const PALETTE = [
  0x05, 0x30, 0x16, 0x2a, // BG0: ストライプ用
  0x05, 0x24, 0x12, 0x36,
  0x05, 0x1a, 0x28, 0x30,
  0x05, 0x00, 0x10, 0x30,
  0x05, 0x28, 0x16, 0x30, // SPR0
  0x05, 0x2c, 0x12, 0x30, // SPR1
  0x05, 0x24, 0x04, 0x30, // SPR2
  0x05, 0x1b, 0x0b, 0x30,
];

function buildPrg(): Uint8Array {
  const a = new Asm(PRG_ORG);

  a.label("reset");
  a.sei();
  a.cld();
  a.ldxImm(0x40);
  a.stxAbs(0x4017); // APUフレームIRQ無効
  a.ldxImm(0xff);
  a.txs();
  a.inx(); // X=0
  a.stxAbs(0x2000); // NMI無効
  a.stxAbs(0x2001); // 描画無効
  a.stxAbs(0x4010);
  a.bitAbs(0x2002);
  a.label("vwait1");
  a.bitAbs(0x2002);
  a.bpl("vwait1");
  a.ldaImm(0x00);
  a.staZp(0x10); // フレームカウンタ初期化
  a.label("vwait2");
  a.bitAbs(0x2002);
  a.bpl("vwait2");

  // パレット転送
  a.ldaAbs(0x2002); // アドレスラッチをリセット
  a.ldaImm(0x3f);
  a.staAbs(0x2006);
  a.ldaImm(0x00);
  a.staAbs(0x2006);
  a.ldxImm(0x00);
  a.label("palLoop");
  a.ldaAbsX("palData");
  a.staAbs(0x2007);
  a.inx();
  a.cpxImm(0x20);
  a.bne("palLoop");

  // ネームテーブル$2000を縦ストライプで埋める
  // (4ページ=1024バイト書き、属性テーブルは後で0に上書き)
  a.ldaAbs(0x2002);
  a.ldaImm(0x20);
  a.staAbs(0x2006);
  a.ldaImm(0x00);
  a.staAbs(0x2006);
  a.ldaImm(0x04);
  a.staZp(0x11); // ページカウンタ
  a.ldxImm(0x00);
  a.label("ntLoop");
  a.txa();
  a.andImm(0x03);
  a.tay();
  a.ldaAbsY("stripes");
  a.staAbs(0x2007);
  a.inx();
  a.bne("ntLoop");
  a.decZp(0x11);
  a.bne("ntLoop");

  // 属性テーブル($23C0-)を0で上書き
  a.ldaAbs(0x2002);
  a.ldaImm(0x23);
  a.staAbs(0x2006);
  a.ldaImm(0xc0);
  a.staAbs(0x2006);
  a.ldxImm(0x40);
  a.ldaImm(0x00);
  a.label("attrLoop");
  a.staAbs(0x2007);
  a.dex();
  a.bne("attrLoop");

  // OAMシャドウ($0200-)へスプライト定義をコピー、残りは$FF(画面外)
  a.ldxImm(0x00);
  a.label("oamCopy");
  a.ldaAbsX("oamData");
  a.staAbsX(0x0200);
  a.inx();
  a.cpxImm(SPRITES.length * 4);
  a.bne("oamCopy");
  a.ldaImm(0xff);
  a.label("oamFill");
  a.staAbsX(0x0200);
  a.inx();
  a.bne("oamFill");

  // APU: 音声経路確認用の小さなビープ(矩形波 約440Hz、音量小)
  a.ldaImm(0x01);
  a.staAbs(0x4015);
  a.ldaImm(0xb2); // duty=10, halt=1, 定音量=1, vol=2
  a.staAbs(0x4000);
  a.ldaImm(0xfd);
  a.staAbs(0x4002);
  a.ldaImm(0x00);
  a.staAbs(0x4003);

  // NMIと描画を有効化
  a.ldaImm(0x80);
  a.staAbs(0x2000);
  a.ldaImm(0x1e);
  a.staAbs(0x2001);
  a.label("forever");
  a.jmp("forever");

  // ---- NMI: OAM DMA→アニメーション→スクロール ----
  a.label("nmi");
  a.pha();
  a.ldaImm(0x00);
  a.staAbs(0x2003);
  a.ldaImm(0x02);
  a.staAbs(0x4014); // OAM DMA
  a.incZp(0x10);
  a.ldaZp(0x10);
  a.staAbs(0x0203); // s0 X →右
  a.staAbs(0x0213); // s4 X →右(背面)
  a.ldaZp(0x10);
  a.eorImm(0xff);
  a.staAbs(0x0207); // s1 X →左
  // 背景をゆっくりスクロール(ストライプ周期32pxに合わせてシームレス)
  a.ldaAbs(0x2002);
  a.ldaZp(0x10);
  a.andImm(0x1f);
  a.staAbs(0x2005);
  a.ldaImm(0x00);
  a.staAbs(0x2005);
  a.pla();
  a.rti();

  a.label("irq");
  a.rti();

  // ---- データ ----
  a.label("palData");
  a.db(...PALETTE);
  a.label("stripes");
  a.db(1, 0, 2, 0); // タイル1, 空, タイル2, 空
  a.label("oamData");
  for (const [y, tile, attr, x] of SPRITES) {
    a.db(y, tile, attr, x);
  }

  a.resolve();

  const prg = new Uint8Array(16384);
  prg.set(a.out);

  // 割り込みベクタ($FFFA: NMI / $FFFC: RESET / $FFFE: IRQ)
  const vecBytes: number[] = [];
  for (const name of ["nmi", "reset", "irq"] as const) {
    const addr = a.addressOf(name);
    vecBytes.push(addr & 0xff, (addr >> 8) & 0xff);
  }
  prg.set(vecBytes, 16384 - 6);
  return prg;
}

function buildChr(): Uint8Array {
  const chr = new Uint8Array(8192);
  const setTile = (index: number, plane0: number[], plane1: number[]) => {
    chr.set(plane0, index * 16);
    chr.set(plane1, index * 16 + 8);
  };

  // タイル1: 2x2市松(色1/色2)
  setTile(
    1,
    [0xcc, 0xcc, 0x33, 0x33, 0xcc, 0xcc, 0x33, 0x33],
    [0x33, 0x33, 0xcc, 0xcc, 0x33, 0x33, 0xcc, 0xcc],
  );
  // タイル2: 色1の枠+色3の塗り
  setTile(
    2,
    [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    [0x00, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x00],
  );
  // タイル4: ボール(色1の球+色3のハイライト)
  setTile(
    4,
    [0x3c, 0x7e, 0xff, 0xff, 0xff, 0xff, 0x7e, 0x3c],
    [0x00, 0x30, 0x30, 0x00, 0x00, 0x00, 0x00, 0x00],
  );
  return chr;
}

/** 内蔵デモROM(iNES形式)を生成する */
export function buildTestRom(): Uint8Array {
  const prg = buildPrg();
  const chr = buildChr();
  const rom = new Uint8Array(16 + prg.length + chr.length);
  // iNESヘッダ: PRG 16KB×1, CHR 8KB×1, マッパー0, 水平ミラーリング
  rom.set([0x4e, 0x45, 0x53, 0x1a, 1, 1, 0x00, 0x00]);
  rom.set(prg, 16);
  rom.set(chr, 16 + prg.length);
  return rom;
}
