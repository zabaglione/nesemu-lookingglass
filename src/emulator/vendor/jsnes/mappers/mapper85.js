import Mapper0 from "./mapper0.js";

// Konami VRC7 (Lagrange Point, Tiny Toon Adventures 2 (J)).
// Banking plus the standard VRC IRQ. Both register layouts (VRC7a $x010 and
// VRC7b $x008) are accepted. The OPLL-derived FM expansion audio is NOT
// emulated, so Lagrange Point plays without most of its music.
// See https://www.nesdev.org/wiki/VRC7
class Mapper85 extends Mapper0 {
  static mapperName = "VRC7";

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

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    const region = address & 0xf000;
    // $x008 (VRC7b) and $x010/$x018 (VRC7a) address the second register.
    const second = (address & 0x18) !== 0;
    switch (region) {
      case 0x8000:
        if (second) {
          this.load8kRomBank(value & 0x3f, 0xa000);
        } else {
          this.load8kRomBank(value & 0x3f, 0x8000);
        }
        break;
      case 0x9000:
        if (!second) {
          this.load8kRomBank(value & 0x3f, 0xc000);
        }
        // $9010/$9030: FM audio ports (ignored)
        break;
      case 0xa000:
      case 0xb000:
      case 0xc000:
      case 0xd000: {
        const slot = ((region >> 12) - 0xa) * 2 + (second ? 1 : 0);
        this.load1kVromBank(value, slot * 0x400);
        break;
      }
      case 0xe000:
        if (second) {
          this.irqLatch = value & 0xff;
        } else {
          this.setMirroring(value & 3);
        }
        break;
      case 0xf000:
        if (second) {
          this.irqPending = false;
          this.irqEnabled = this.irqEnableAfterAck;
        } else {
          this.irqPending = false;
          this.irqEnableAfterAck = (value & 1) !== 0;
          this.irqEnabled = (value & 2) !== 0;
          this.irqCycleMode = (value & 4) !== 0;
          this.irqPrescaler = 341;
          if (this.irqEnabled) this.irqCounter = this.irqLatch;
        }
        break;
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
      throw new Error("VRC7: Invalid ROM! Unable to load.");
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

export default Mapper85;
