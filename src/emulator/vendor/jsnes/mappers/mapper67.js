import Mapper0 from "./mapper0.js";

// Sunsoft-3 (Fantasy Zone II, Mito Koumon II).
// 4x2 KB CHR, 16 KB PRG, and a 16-bit CPU-cycle down-counter IRQ that is
// loaded with two writes (high byte first).
// See https://www.nesdev.org/wiki/INES_Mapper_067
class Mapper67 extends Mapper0 {
  static mapperName = "Sunsoft-3";

  constructor(nes) {
    super(nes);
    this.cpuClockedIrq = true;
    this.irqCounter = 0;
    this.irqEnabled = false;
    this.irqPending = false;
    this.irqWriteToggle = false;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    switch (address & 0xf800) {
      case 0x8000:
        this.irqPending = false;
        break;
      case 0x8800:
      case 0x9800:
      case 0xa800:
      case 0xb800:
        this.load2kVromBank(
          value & 0x3f,
          (((address & 0xf800) - 0x8800) >> 12) * 0x800,
        );
        break;
      case 0xc800:
        if (this.irqWriteToggle) {
          this.irqCounter = (this.irqCounter & 0xff00) | (value & 0xff);
        } else {
          this.irqCounter = (this.irqCounter & 0x00ff) | (value << 8);
        }
        this.irqWriteToggle = !this.irqWriteToggle;
        break;
      case 0xd800:
        this.irqWriteToggle = false;
        this.irqEnabled = (value & 0x10) !== 0;
        this.irqPending = false;
        break;
      case 0xe800:
        this.setMirroring(value & 3);
        break;
      case 0xf800:
        this.loadRomBank(value & 0x0f, 0x8000);
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
    if (this.irqEnabled) {
      for (let i = 0; i < cycles; i++) {
        this.irqCounter = (this.irqCounter - 1) & 0xffff;
        if (this.irqCounter === 0xffff) {
          // Underflow: fire once and stop counting.
          this.irqPending = true;
          this.irqEnabled = false;
          break;
        }
      }
    }
    if (this.irqPending && !this.nes.cpu.irqRequested) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("Sunsoft-3: Invalid ROM! Unable to load.");
    }
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.irqCounter = this.irqCounter;
    s.irqEnabled = this.irqEnabled;
    s.irqPending = this.irqPending;
    s.irqWriteToggle = this.irqWriteToggle;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.irqCounter = s.irqCounter;
    this.irqEnabled = s.irqEnabled;
    this.irqPending = s.irqPending;
    this.irqWriteToggle = s.irqWriteToggle;
  }
}

export default Mapper67;
