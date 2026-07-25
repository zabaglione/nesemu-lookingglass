import Mapper0 from "./mapper0.js";

// Jaleco SS88006 (Pizza Pop!, Magic John, Plasma Ball...).
// Nibble-based PRG/CHR registers and a down-counting CPU-cycle IRQ with a
// selectable counter width. The uPD7756 speech chip is not emulated.
// See https://www.nesdev.org/wiki/INES_Mapper_018
class Mapper18 extends Mapper0 {
  static mapperName = "Jaleco SS88006";

  constructor(nes) {
    super(nes);
    this.cpuClockedIrq = true;
    this.prgRegs = new Uint8Array(3);
    this.chrRegs = new Uint8Array(8);
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqEnabled = false;
    this.irqSizeMask = 0xffff;
    this.irqPending = false;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    const region = address & 0xf003;
    const high = (address & 1) !== 0;

    if (region >= 0x8000 && region <= 0x9001) {
      // PRG registers: $8000/1, $8002/3, $9000/1 (8 KB banks)
      const index = region >= 0x9000 ? 2 : (region & 2) >> 1;
      this.prgRegs[index] = this.setNibble(this.prgRegs[index], high, value);
      this.load8kRomBank(this.prgRegs[index] & 0x3f, 0x8000 + index * 0x2000);
      return;
    }
    if (region >= 0xa000 && region <= 0xd003) {
      // CHR registers: two nibbles per 1 KB slot
      const slot = (((address >> 12) & 0x0f) - 0xa) * 2 + ((address & 2) >> 1);
      this.chrRegs[slot] = this.setNibble(this.chrRegs[slot], high, value);
      this.load1kVromBank(this.chrRegs[slot], slot * 0x400);
      return;
    }
    if (region >= 0xe000 && region <= 0xe003) {
      const shift = (address & 3) * 4;
      this.irqLatch =
        (this.irqLatch & ~(0x0f << shift)) | ((value & 0x0f) << shift);
      return;
    }
    switch (region) {
      case 0xf000:
        this.irqCounter = this.irqLatch;
        this.irqPending = false;
        break;
      case 0xf001:
        this.irqPending = false;
        this.irqEnabled = (value & 1) !== 0;
        this.irqSizeMask =
          (value & 8) !== 0
            ? 0x000f
            : (value & 2) !== 0
              ? 0x00ff
              : (value & 4) !== 0
                ? 0x0fff
                : 0xffff;
        break;
      case 0xf002: {
        const mirroring = [
          this.nes.rom.HORIZONTAL_MIRRORING,
          this.nes.rom.VERTICAL_MIRRORING,
          this.nes.rom.SINGLESCREEN_MIRRORING,
          this.nes.rom.SINGLESCREEN_MIRRORING2,
        ][value & 3];
        this.nes.ppu.setMirroring(mirroring);
        break;
      }
      // 0xf003: expansion sound (ignored)
    }
  }

  setNibble(current, high, value) {
    if (high) {
      return (current & 0x0f) | ((value & 0x0f) << 4);
    }
    return (current & 0xf0) | (value & 0x0f);
  }

  clockCpuCycles(cycles) {
    if (this.irqEnabled) {
      for (let i = 0; i < cycles; i++) {
        const masked = this.irqCounter & this.irqSizeMask;
        const rest = this.irqCounter & ~this.irqSizeMask;
        const next = (masked - 1) & this.irqSizeMask;
        if (masked === 0) {
          this.irqPending = true;
        }
        this.irqCounter = rest | next;
      }
    }
    if (this.irqPending && !this.nes.cpu.irqRequested) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("SS88006: Invalid ROM! Unable to load.");
    }
    const last = this.nes.rom.romCount * 2 - 1;
    this.load8kRomBank(0, 0x8000);
    this.load8kRomBank(1, 0xa000);
    this.load8kRomBank(last - 1, 0xc000);
    this.load8kRomBank(last, 0xe000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.prgRegs = Array.from(this.prgRegs);
    s.chrRegs = Array.from(this.chrRegs);
    s.irqLatch = this.irqLatch;
    s.irqCounter = this.irqCounter;
    s.irqEnabled = this.irqEnabled;
    s.irqSizeMask = this.irqSizeMask;
    s.irqPending = this.irqPending;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgRegs.set(s.prgRegs);
    this.chrRegs.set(s.chrRegs);
    this.irqLatch = s.irqLatch;
    this.irqCounter = s.irqCounter;
    this.irqEnabled = s.irqEnabled;
    this.irqSizeMask = s.irqSizeMask;
    this.irqPending = s.irqPending;
  }
}

export default Mapper18;
