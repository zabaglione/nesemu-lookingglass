import test from "node:test";
import assert from "node:assert/strict";
import Mapper23 from "../src/emulator/vendor/jsnes/mappers/mapper23.js";
import Mappers from "../src/emulator/vendor/jsnes/mappers/index.js";

function createNes(subMapper) {
  const romCount = 4;
  const rom = Array.from({ length: romCount }, (_, bank16k) => {
    const data = new Uint8Array(0x4000);
    data.fill(bank16k * 2, 0, 0x2000);
    data.fill(bank16k * 2 + 1, 0x2000);
    return data;
  });
  const irqRequests = [];
  const mirroringWrites = [];

  const nes = {
    opts: {
      onBatteryRamWrite() {},
    },
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
      vromCount: 0,
      rom,
      vrom: [],
      vromTile: [],
      batteryRam: null,
      VERTICAL_MIRRORING: 0,
      HORIZONTAL_MIRRORING: 1,
      SINGLESCREEN_MIRRORING: 2,
      SINGLESCREEN_MIRRORING2: 3,
    },
  };

  return { nes, irqRequests, mirroringWrites };
}

test("mapper table exposes mapper 23", () => {
  assert.equal(Mappers[23], Mapper23);
});

test("VRC4f uses contiguous register addresses", () => {
  const { nes } = createNes(1);
  const mapper = new Mapper23(nes);

  mapper.write(0xb000, 0x0a);
  mapper.write(0xb001, 0x01);
  mapper.write(0xb002, 0x05);
  mapper.write(0xb003, 0x02);

  assert.equal(mapper.addressVariant, "f");
  assert.equal(mapper.chrBanks[0], 0x1a);
  assert.equal(mapper.chrBanks[1], 0x25);
});

test("VRC4e uses A2 and A3 for register selection", () => {
  const { nes } = createNes(2);
  const mapper = new Mapper23(nes);

  mapper.write(0xb000, 0x0a);
  mapper.write(0xb004, 0x01);
  mapper.write(0xb008, 0x05);
  mapper.write(0xb00c, 0x02);

  assert.equal(mapper.addressVariant, "e");
  assert.equal(mapper.chrBanks[0], 0x1a);
  assert.equal(mapper.chrBanks[1], 0x25);
});

test("legacy iNES selects VRC2b or VRC4e from the address layout", () => {
  const mapperE = new Mapper23(createNes(0).nes);
  const mapperB = new Mapper23(createNes(0).nes);

  mapperE.write(0xb004, 1);
  mapperB.write(0xb001, 1);

  assert.equal(mapperE.addressVariant, "e");
  assert.equal(mapperE.isVrc2, false);
  assert.equal(mapperB.addressVariant, "b");
  assert.equal(mapperB.isVrc2, true);
  assert.equal(mapperB.cpuClockedIrq, false);
});

test("VRC2b implements its one-bit latch and open bus", () => {
  const { nes } = createNes(3);
  const mapper = new Mapper23(nes);

  mapper.write(0x6123, 1);
  nes.cpu.dataBus = 0xa4;
  assert.equal(mapper.load(0x6000), 0xa5);
  assert.equal(mapper.load(0x6fff), 0xa5);

  mapper.write(0x6fff, 0);
  nes.cpu.dataBus = 0xa5;
  assert.equal(mapper.load(0x6000), 0xa4);

  mapper.write(0x7000, 1);
  nes.cpu.dataBus = 0xc3;
  assert.equal(mapper.load(0x7000), 0xc3);
  assert.equal(nes.cpu.mem[0x6123], 0);
});

test("VRC2b excludes VRC4-only mirroring and IRQ features", () => {
  const { nes, irqRequests, mirroringWrites } = createNes(3);
  const mapper = new Mapper23(nes);

  mapper.write(0x9000, 2);
  mapper.write(0xf000, 0x0e);
  mapper.write(0xf001, 0x0f);
  mapper.write(0xf002, 0x06);
  mapper.clockCpuCycles(4);

  assert.equal(mapper.cpuClockedIrq, false);
  assert.equal(mirroringWrites.at(-1), nes.rom.VERTICAL_MIRRORING);
  assert.deepEqual(irqRequests, []);
});

test("VRC4e IRQ counts CPU cycles and asserts until acknowledged", () => {
  const { nes, irqRequests } = createNes(2);
  const mapper = new Mapper23(nes);

  mapper.write(0xf000, 0x0e);
  mapper.write(0xf004, 0x0f);
  mapper.write(0xf008, 0x06);
  mapper.clockCpuCycles(2);

  assert.equal(mapper.irqLatch, 0xfe);
  assert.equal(mapper.irqPending, true);
  assert.deepEqual(irqRequests, [nes.cpu.IRQ_NORMAL]);

  mapper.write(0xf00c, 0);
  assert.equal(mapper.irqPending, false);
  assert.equal(mapper.irqEnabled, false);
});

test("VRC4 PRG swap mode selects the fixed and switchable banks", () => {
  const { nes } = createNes(1);
  const mapper = new Mapper23(nes);
  mapper.loadROM();

  mapper.write(0x8000, 3);
  assert.equal(nes.cpu.mem[0x8000], 3);
  assert.equal(nes.cpu.mem[0xc000], 6);

  mapper.write(0x9002, 3);
  assert.equal(mapper.wramEnabled, true);
  assert.equal(nes.cpu.mem[0x8000], 6);
  assert.equal(nes.cpu.mem[0xc000], 3);
});

test("VRC2 latch survives save-state round trips", () => {
  const mapper = new Mapper23(createNes(3).nes);
  mapper.write(0x6000, 1);
  const state = mapper.toJSON();

  const restored = new Mapper23(createNes(3).nes);
  restored.fromJSON(state);

  assert.equal(restored.vrc2Latch, 1);
  assert.equal(restored.isVrc2, true);
  assert.equal(restored.cpuClockedIrq, false);
});
