// 追加マッパーのバンク切替・IRQ・ミラーリングのスモークテスト。
// モックNES上でレジスタを叩き、CPUメモリ/VRAMに正しいバンクが
// ロードされるかを検証する(値=8KB PRGバンク番号 / 1KB CHRバンク番号)。
import test from "node:test";
import assert from "node:assert/strict";
import Mappers from "../src/emulator/vendor/jsnes/mappers/index.js";

function createNes({ subMapper = 0, romCount = 16, vromCount = 64 } = {}) {
  const rom = Array.from({ length: romCount }, (_, bank16k) => {
    const data = new Uint8Array(0x4000);
    data.fill(bank16k * 2, 0, 0x2000);
    data.fill(bank16k * 2 + 1, 0x2000);
    return data;
  });
  // vrom[b][i] = 1KBバンク番号(= b*4 + i>>10)を書き込んでおく
  const vrom = Array.from({ length: vromCount }, (_, b) => {
    const data = new Uint8Array(0x1000);
    for (let i = 0; i < 0x1000; i++) {
      data[i] = (b * 4 + (i >> 10)) & 0xff;
    }
    return data;
  });
  const vromTile = Array.from({ length: vromCount }, () =>
    new Array(256).fill(0),
  );
  const irqRequests = [];
  const mirroringWrites = [];

  const nes = {
    opts: { onBatteryRamWrite() {} },
    cpu: {
      mem: new Uint8Array(0x10000),
      dataBus: 0,
      irqRequested: false,
      IRQ_NORMAL: 1,
      IRQ_RESET: 2,
      requestIrq(type) {
        irqRequests.push(type);
        this.irqRequested = true;
      },
    },
    ppu: {
      vramMem: new Uint8Array(0x4000),
      ptTile: new Array(512),
      triggerRendering() {},
      setMirroring(mode) {
        mirroringWrites.push(mode);
      },
    },
    rom: {
      valid: true,
      subMapper,
      romCount,
      vromCount,
      rom,
      vrom,
      vromTile,
      batteryRam: null,
      VERTICAL_MIRRORING: 0,
      HORIZONTAL_MIRRORING: 1,
      SINGLESCREEN_MIRRORING: 2,
      SINGLESCREEN_MIRRORING2: 3,
    },
  };

  return { nes, irqRequests, mirroringWrites };
}

function make(number, options) {
  const ctx = createNes(options);
  const mapper = new Mappers[number](ctx.nes);
  mapper.loadROM();
  ctx.nes.cpu.irqRequested = false;
  ctx.irqRequests.length = 0;
  ctx.mirroringWrites.length = 0;
  return { mapper, ...ctx };
}

test("registry exposes all added mappers", () => {
  for (const n of [
    10, 16, 18, 19, 21, 22, 24, 26, 32, 33, 48, 65, 67, 68, 69, 70, 72, 73,
    75, 76, 78, 80, 85, 86, 87, 88, 89, 92, 93, 95, 97, 152, 153, 154, 159,
    184, 206, 210,
  ]) {
    assert.ok(Mappers[n], `mapper ${n} missing`);
  }
});

test("mapper 206 (Namco 108) PRG/CHR banking", () => {
  const { mapper, nes } = make(206);
  mapper.write(0x8000, 6);
  mapper.write(0x8001, 3);
  assert.equal(nes.cpu.mem[0x8000], 3);
  mapper.write(0x8000, 7);
  mapper.write(0x8001, 5);
  assert.equal(nes.cpu.mem[0xa000], 5);
  mapper.write(0x8000, 0);
  mapper.write(0x8001, 4); // 2KBバンク: 1KB番号4
  assert.equal(nes.ppu.vramMem[0x0000], 4);
  mapper.write(0x8000, 2);
  mapper.write(0x8001, 5);
  assert.equal(nes.ppu.vramMem[0x1000], 5);
});

test("mapper 88 maps upper CHR registers to the high 64KB", () => {
  const { mapper, nes } = make(88);
  mapper.write(0x8000, 2);
  mapper.write(0x8001, 5);
  assert.equal(nes.ppu.vramMem[0x1000], 0x45);
});

test("mapper 154 selects single-screen mirroring on $8000 writes", () => {
  const { mapper, nes, mirroringWrites } = make(154);
  mapper.write(0x8000, 0x46);
  assert.equal(mirroringWrites.at(-1), nes.rom.SINGLESCREEN_MIRRORING2);
});

test("mapper 24 (VRC6a) banking, mirroring and IRQ", () => {
  const { mapper, nes, irqRequests, mirroringWrites } = make(24);
  mapper.write(0x8000, 2);
  assert.equal(nes.cpu.mem[0x8000], 4);
  assert.equal(nes.cpu.mem[0xa000], 5);
  mapper.write(0xc000, 7);
  assert.equal(nes.cpu.mem[0xc000], 7);
  mapper.write(0xd002, 9);
  assert.equal(nes.ppu.vramMem[0x0800], 9);
  mapper.write(0xb003, 0x04); // mode 1 = horizontal
  assert.equal(mirroringWrites.at(-1), nes.rom.HORIZONTAL_MIRRORING);
  mapper.write(0xf000, 0xfe);
  mapper.write(0xf001, 0x06); // enable + cycle mode
  mapper.clockCpuCycles(2);
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);
});

test("mapper 26 (VRC6b) swaps A0/A1", () => {
  const { mapper, nes } = make(26);
  mapper.write(0xd001, 9); // swapped: reg 2
  assert.equal(nes.ppu.vramMem[0x0800], 9);
});

test("mapper 73 (VRC3) nibble latch and IRQ", () => {
  const { mapper, nes, irqRequests } = make(73);
  mapper.write(0x8000, 0x0e);
  mapper.write(0x9000, 0x0f);
  mapper.write(0xa000, 0x0f);
  mapper.write(0xb000, 0x0f);
  assert.equal(mapper.irqLatch, 0xfffe);
  mapper.write(0xc000, 0x02);
  mapper.clockCpuCycles(2);
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);
  mapper.write(0xf000, 3);
  assert.equal(nes.cpu.mem[0x8000], 6);
});

test("mapper 75 (VRC1) CHR high bits", () => {
  const { mapper, nes, mirroringWrites } = make(75);
  mapper.write(0x9000, 0x02); // vertical + chrHigh0=1
  mapper.write(0xe000, 3); // chr0 = 0x13
  assert.equal(mirroringWrites.at(-1), nes.rom.VERTICAL_MIRRORING);
  assert.equal(nes.ppu.vramMem[0x0000], (0x13 * 4) & 0xff);
  mapper.write(0x8000, 5);
  assert.equal(nes.cpu.mem[0x8000], 5);
});

test("mapper 85 (VRC7) banking and IRQ", () => {
  const { mapper, nes, irqRequests, mirroringWrites } = make(85);
  mapper.write(0x8000, 4);
  assert.equal(nes.cpu.mem[0x8000], 4);
  mapper.write(0x8010, 5);
  assert.equal(nes.cpu.mem[0xa000], 5);
  mapper.write(0x9000, 6);
  assert.equal(nes.cpu.mem[0xc000], 6);
  mapper.write(0xa008, 7);
  assert.equal(nes.ppu.vramMem[0x0400], 7);
  mapper.write(0xe000, 1);
  assert.equal(mirroringWrites.at(-1), nes.rom.HORIZONTAL_MIRRORING);
  mapper.write(0xe008, 0xfe);
  mapper.write(0xf000, 0x06);
  mapper.clockCpuCycles(2);
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);
});

test("mapper 67 (Sunsoft-3) CHR, IRQ and PRG", () => {
  const { mapper, nes, irqRequests, mirroringWrites } = make(67);
  mapper.write(0x8800, 3);
  assert.equal(nes.ppu.vramMem[0x0000], 6);
  mapper.write(0xc800, 0x00); // high
  mapper.write(0xc800, 0x02); // low
  mapper.write(0xd800, 0x10);
  mapper.clockCpuCycles(3);
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);
  assert.equal(mapper.irqEnabled, false);
  mapper.write(0xe800, 1);
  assert.equal(mirroringWrites.at(-1), nes.rom.HORIZONTAL_MIRRORING);
  mapper.write(0xf800, 2);
  assert.equal(nes.cpu.mem[0x8000], 4);
});

test("mapper 69 (FME-7) commands and IRQ", () => {
  const { mapper, nes, irqRequests } = make(69);
  mapper.write(0x8000, 0x9);
  mapper.write(0xa000, 3);
  assert.equal(nes.cpu.mem[0x8000], 3);
  mapper.write(0x8000, 0xb);
  mapper.write(0xa000, 5);
  assert.equal(nes.cpu.mem[0xc000], 5);
  mapper.write(0x8000, 0x2);
  mapper.write(0xa000, 9);
  assert.equal(nes.ppu.vramMem[0x0800], 9);
  // $6000にROMを割り当て
  mapper.write(0x8000, 0x8);
  mapper.write(0xa000, 0x02);
  assert.equal(nes.cpu.mem[0x6000], 2);
  assert.equal(mapper.ram6000, false);
  // IRQ
  mapper.write(0x8000, 0xd);
  mapper.write(0xa000, 0x81);
  mapper.write(0x8000, 0xe);
  mapper.write(0xa000, 2);
  mapper.write(0x8000, 0xf);
  mapper.write(0xa000, 0);
  mapper.clockCpuCycles(3);
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);
});

test("mapper 33 (TC0190) banking and mirroring", () => {
  const { mapper, nes, mirroringWrites } = make(33);
  mapper.write(0x8000, 5); // bit6=0 → vertical
  assert.equal(nes.cpu.mem[0x8000], 5);
  assert.equal(mirroringWrites.at(-1), nes.rom.VERTICAL_MIRRORING);
  mapper.write(0x8002, 3);
  assert.equal(nes.ppu.vramMem[0x0000], 6);
  mapper.write(0xa001, 9);
  assert.equal(nes.ppu.vramMem[0x1400], 9);
});

test("mapper 48 (TC0690) scanline IRQ with inverted latch", () => {
  const { mapper, nes, irqRequests } = make(48);
  mapper.write(0xc000, 0xfd); // latch = 2
  mapper.write(0xc001, 0);
  mapper.write(0xc002, 0);
  mapper.clockIrqCounter();
  mapper.clockIrqCounter();
  assert.equal(irqRequests.length, 0);
  mapper.clockIrqCounter();
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);
  mapper.write(0xe000, 0x40);
  assert.equal(
    mapper.nes.rom.HORIZONTAL_MIRRORING,
    nes.rom.HORIZONTAL_MIRRORING,
  );
});

test("mapper 32 (G-101) PRG swap modes", () => {
  const { mapper, nes } = make(32);
  const last = nes.rom.romCount * 2 - 1;
  mapper.write(0x9000, 0);
  mapper.write(0x8000, 3);
  assert.equal(nes.cpu.mem[0x8000], 3);
  assert.equal(nes.cpu.mem[0xc000], last - 1);
  mapper.write(0x9000, 2);
  assert.equal(nes.cpu.mem[0x8000], last - 1);
  assert.equal(nes.cpu.mem[0xc000], 3);
  mapper.write(0xb005, 7);
  assert.equal(nes.ppu.vramMem[0x1400], 7);
});

test("mapper 65 (H3001) IRQ and banking", () => {
  const { mapper, nes, irqRequests, mirroringWrites } = make(65);
  mapper.write(0x8000, 3);
  assert.equal(nes.cpu.mem[0x8000], 3);
  mapper.write(0x9001, 2);
  assert.equal(mirroringWrites.at(-1), nes.rom.HORIZONTAL_MIRRORING);
  mapper.write(0x9005, 0);
  mapper.write(0x9006, 4);
  mapper.write(0x9004, 0);
  mapper.write(0x9003, 0x80);
  mapper.clockCpuCycles(4);
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);
});

test("mapper 97 (TAM-S1) switches $C000 and fixes $8000", () => {
  const { mapper, nes, mirroringWrites } = make(97);
  assert.equal(nes.cpu.mem[0x8000], (nes.rom.romCount - 1) * 2);
  mapper.write(0x8000, 0x83);
  assert.equal(nes.cpu.mem[0xc000], 6);
  assert.equal(mirroringWrites.at(-1), nes.rom.VERTICAL_MIRRORING);
});

test("mapper 18 (SS88006) nibble registers and IRQ", () => {
  const { mapper, nes, irqRequests, mirroringWrites } = make(18);
  mapper.write(0x8000, 0x02);
  mapper.write(0x8001, 0x01);
  assert.equal(nes.cpu.mem[0x8000], 0x12);
  mapper.write(0xa000, 0x05);
  mapper.write(0xa001, 0x01);
  assert.equal(nes.ppu.vramMem[0x0000], 0x15);
  mapper.write(0xe000, 2);
  mapper.write(0xe001, 0);
  mapper.write(0xe002, 0);
  mapper.write(0xe003, 0);
  mapper.write(0xf000, 0);
  mapper.write(0xf001, 1);
  mapper.clockCpuCycles(3);
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);
  mapper.write(0xf002, 1);
  assert.equal(mirroringWrites.at(-1), nes.rom.VERTICAL_MIRRORING);
});

test("mapper 16 (Bandai FCG) registers in both areas, IRQ and EEPROM stub", () => {
  const { mapper, nes, irqRequests, mirroringWrites } = make(16);
  mapper.write(0x8008, 3);
  assert.equal(nes.cpu.mem[0x8000], 6);
  mapper.write(0x6008, 4);
  assert.equal(nes.cpu.mem[0x8000], 8);
  mapper.write(0x8003, 7);
  assert.equal(nes.ppu.vramMem[0x0c00], 7);
  mapper.write(0x8009, 1);
  assert.equal(mirroringWrites.at(-1), nes.rom.HORIZONTAL_MIRRORING);
  mapper.write(0x800b, 3);
  mapper.write(0x800c, 0);
  mapper.write(0x800a, 1);
  mapper.clockCpuCycles(3);
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);
  nes.cpu.dataBus = 0xff;
  assert.equal(mapper.load(0x6000), 0xef);
});

test("mapper 153 uses WRAM and CHR registers as PRG outer bank", () => {
  const { mapper, nes } = make(153, { romCount: 32 });
  mapper.write(0x6000, 5);
  assert.equal(nes.cpu.mem[0x6000], 5);
  mapper.write(0x8008, 2);
  assert.equal(nes.cpu.mem[0x8000], 4);
  mapper.write(0x8000, 1); // outer bank bit
  assert.equal(nes.cpu.mem[0x8000], (0x10 | 2) * 2);
});

test("mapper 210 (Namco 340) banking and mirroring", () => {
  const { mapper, nes, mirroringWrites } = make(210, { subMapper: 2 });
  mapper.write(0x8000, 5);
  assert.equal(nes.ppu.vramMem[0x0000], 5);
  mapper.write(0xe000, 0x42);
  assert.equal(nes.cpu.mem[0x8000], 2);
  assert.equal(mirroringWrites.at(-1), nes.rom.VERTICAL_MIRRORING);
});

test("mapper 19 (Namco 163) IRQ and nametable-derived mirroring", () => {
  const { mapper, nes, irqRequests, mirroringWrites } = make(19);
  mapper.write(0x5000, 0xfe);
  mapper.write(0x5800, 0xff);
  mapper.clockCpuCycles(1);
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);
  assert.equal(mapper.load(0x5000) & 0xff, 0xff);
  mapper.write(0xc000, 0xe0);
  mapper.write(0xc800, 0xe1);
  mapper.write(0xd000, 0xe0);
  mapper.write(0xd800, 0xe1);
  assert.equal(mirroringWrites.at(-1), nes.rom.VERTICAL_MIRRORING);
  const before = nes.ppu.vramMem[0x0000];
  mapper.write(0x8000, 0xe5); // CIRAMパターン(未対応)は無視される
  assert.equal(nes.ppu.vramMem[0x0000], before);
});

test("mapper 10 (MMC4) 16KB PRG banking and range latches", () => {
  const { mapper, nes } = make(10);
  mapper.write(0xa000, 3);
  assert.equal(nes.cpu.mem[0x8000], 6);
  mapper.write(0xb000, 2); // FD bank for $0000
  mapper.write(0xc000, 5); // FE bank for $0000
  mapper.latchAccess(0x0fd9);
  assert.equal(nes.ppu.vramMem[0x0000], 2 * 4);
  mapper.latchAccess(0x0fe9);
  assert.equal(nes.ppu.vramMem[0x0000], 5 * 4);
});

test("mapper 89 (Sunsoft-2) register bit layout", () => {
  const { mapper, nes, mirroringWrites } = make(89);
  mapper.write(0x8000, 0xab);
  assert.equal(nes.cpu.mem[0x8000], 4);
  // 8KB CHRバンク0x0b → 先頭1KB番号は 0x0b*8
  assert.equal(nes.ppu.vramMem[0x0000], (0x0b * 8) & 0xff);
  assert.equal(mirroringWrites.at(-1), nes.rom.SINGLESCREEN_MIRRORING2);
});

test("mappers 70/152 (Bandai 74*161)", () => {
  const a = make(70);
  a.mapper.write(0x8000, 0x35);
  assert.equal(a.nes.cpu.mem[0x8000], 6);
  assert.equal(a.nes.ppu.vramMem[0x0000], 5 * 8);

  const b = make(152);
  b.mapper.write(0x8000, 0xb5);
  assert.equal(b.nes.cpu.mem[0x8000], 6);
  assert.equal(b.mirroringWrites.at(-1), b.nes.rom.SINGLESCREEN_MIRRORING2);
});

test("mappers 72/92 (Jaleco latched banking)", () => {
  const a = make(72);
  a.mapper.write(0x8000, 0x83);
  assert.equal(a.nes.cpu.mem[0x8000], 6);
  a.mapper.write(0x8000, 0x45);
  assert.equal(a.nes.ppu.vramMem[0x0000], 5 * 8);

  const b = make(92);
  b.mapper.write(0x8000, 0x85);
  assert.equal(b.nes.cpu.mem[0xc000], 10);
});

test("mapper 86 (JF-13) 32KB PRG and split CHR", () => {
  const { mapper, nes } = make(86);
  mapper.write(0x6000, 0x31);
  assert.equal(nes.cpu.mem[0x8000], 12);
  assert.equal(nes.ppu.vramMem[0x0000], 1 * 8);
});

test("mapper 87 swaps the CHR bank bits", () => {
  const { mapper, nes } = make(87);
  mapper.write(0x6000, 0x02);
  assert.equal(nes.ppu.vramMem[0x0000], 1 * 8);
});

test("mapper 80 (X1-005) registers at $7EF0", () => {
  const { mapper, nes, mirroringWrites } = make(80);
  mapper.write(0x7efa, 5);
  assert.equal(nes.cpu.mem[0x8000], 5);
  mapper.write(0x7ef0, 6);
  assert.equal(nes.ppu.vramMem[0x0000], 6);
  mapper.write(0x7ef6, 1);
  assert.equal(mirroringWrites.at(-1), nes.rom.VERTICAL_MIRRORING);
});

test("mapper 184 (Sunsoft-1) fixes the upper CHR half to banks 4-7", () => {
  const { mapper, nes } = make(184);
  mapper.write(0x6000, 0x21);
  assert.equal(nes.ppu.vramMem[0x0000], 1 * 4);
  assert.equal(nes.ppu.vramMem[0x1000], 6 * 4);
});

test("mapper 78 defaults to Holy Diver H/V mirroring", () => {
  const { mapper, nes, mirroringWrites } = make(78);
  mapper.write(0x8000, 0x0a);
  assert.equal(nes.cpu.mem[0x8000], 4);
  assert.equal(mirroringWrites.at(-1), nes.rom.HORIZONTAL_MIRRORING);

  const single = make(78, { subMapper: 1 });
  single.mapper.write(0x8000, 0x0a);
  assert.equal(
    single.mirroringWrites.at(-1),
    single.nes.rom.SINGLESCREEN_MIRRORING2,
  );
});

test("mappers 21/22 VRC register decode variants", () => {
  const a = make(21, { subMapper: 1 }); // VRC4a: A1/A2
  a.mapper.write(0xb000, 0x0a);
  a.mapper.write(0xb002, 0x01);
  assert.equal(a.mapper.chrBanks[0], 0x1a);

  const b = make(22); // VRC2a
  b.mapper.write(0xb000, 0x0a);
  b.mapper.write(0xb002, 0x01);
  assert.equal(b.mapper.chrBanks[0], 0x1a);
  // CHRは1ビット右シフトされて1KBバンク0x0dがロードされる
  assert.equal(b.nes.ppu.vramMem[0x0000], 0x0d);
});
