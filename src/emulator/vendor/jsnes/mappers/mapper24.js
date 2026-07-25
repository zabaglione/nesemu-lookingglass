import Mapper0 from "./mapper0.js";

// Konami VRC6a (Akumajou Densetsu, Mouryou Senki Madara).
// PRG: 16 KB @ $8000 + 8 KB @ $C000 + fixed 8 KB. CHR: 8x1 KB (mode 0; the
// rarely used other CHR modes are approximated as mode 0). The IRQ is the
// standard VRC scanline/cycle counter. Expansion audio is not emulated.
// See https://www.nesdev.org/wiki/VRC6
class Mapper24 extends Mapper0 {
  static mapperName = "VRC6a";

  constructor(nes) {
    super(nes);
    this.cpuClockedIrq = true;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqPrescaler = 341;
    this.irqEnabled = false;
    this.irqEnableAfterAck = false;
    this.irqCycleMode = false;
    this.irqPending = false;
  }

  // VRC6b (mapper 26) swaps A0/A1.
  registerIndex(address) {
    return address & 0x03;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    const region = address & 0xf000;
    const reg = this.registerIndex(address);
    switch (region) {
      case 0x8000:
        this.loadRomBank(value & 0x0f, 0x8000);
        break;
      case 0xc000:
        this.load8kRomBank(value & 0x1f, 0xc000);
        break;
      case 0xb000:
        if (reg === 3) {
          this.setMirroring((value >> 2) & 3);
        }
        break;
      case 0xd000:
        this.load1kVromBank(value, reg * 0x400);
        break;
      case 0xe000:
        this.load1kVromBank(value, 0x1000 + reg * 0x400);
        break;
      case 0xf000:
        this.writeIrqRegister(reg, value);
        break;
      // $9000/$A000: expansion audio (ignored)
    }
  }

  setMirroring(mode) {
    const mirroring = [
      this.nes.rom.VERTICAL_MIRRORING,
      this.nes.rom.HORIZONTAL_MIRRORING,
      this.nes.rom.SINGLESCREEN_MIRRORING,
      this.nes.rom.SINGLESCREEN_MIRRORING2,
    ][mode];
    this.nes.ppu.setMirroring(mirroring);
  }

  writeIrqRegister(register, value) {
    switch (register) {
      case 0:
        this.irqLatch = value & 0xff;
        break;
      case 1:
        this.irqPending = false;
        this.irqEnableAfterAck = (value & 1) !== 0;
        this.irqEnabled = (value & 2) !== 0;
        this.irqCycleMode = (value & 4) !== 0;
        this.irqPrescaler = 341;
        if (this.irqEnabled) this.irqCounter = this.irqLatch;
        break;
      case 2:
        this.irqPending = false;
        this.irqEnabled = this.irqEnableAfterAck;
        break;
    }
  }

  clockCpuCycles(cycles) {
    if (!this.irqEnabled) return;
    for (let i = 0; i < cycles; i++) {
      if (this.irqCycleMode) {
        this.clockVrcIrqCounter();
      } else {
        this.irqPrescaler -= 3;
        if (this.irqPrescaler <= 0) {
          this.irqPrescaler += 341;
          this.clockVrcIrqCounter();
        }
      }
    }
    if (this.irqPending && !this.nes.cpu.irqRequested) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }
  }

  clockVrcIrqCounter() {
    if (this.irqCounter === 0xff) {
      this.irqCounter = this.irqLatch;
      this.irqPending = true;
    } else {
      this.irqCounter = (this.irqCounter + 1) & 0xff;
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("VRC6: Invalid ROM! Unable to load.");
    }
    const last = this.nes.rom.romCount * 2 - 1;
    this.loadRomBank(0, 0x8000);
    this.load8kRomBank(last - 1, 0xc000);
    this.load8kRomBank(last, 0xe000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.irqLatch = this.irqLatch;
    s.irqCounter = this.irqCounter;
    s.irqPrescaler = this.irqPrescaler;
    s.irqEnabled = this.irqEnabled;
    s.irqEnableAfterAck = this.irqEnableAfterAck;
    s.irqCycleMode = this.irqCycleMode;
    s.irqPending = this.irqPending;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.irqLatch = s.irqLatch;
    this.irqCounter = s.irqCounter;
    this.irqPrescaler = s.irqPrescaler;
    this.irqEnabled = s.irqEnabled;
    this.irqEnableAfterAck = s.irqEnableAfterAck;
    this.irqCycleMode = s.irqCycleMode;
    this.irqPending = s.irqPending;
  }
}

export default Mapper24;
