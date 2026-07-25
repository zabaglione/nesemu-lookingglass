import Mapper0 from "./mapper0.js";

// Irem H3001 (Daiku no Gen-san 2, Spartan X 2, Kaiketsu Yanchamaru 3).
// 8 KB PRG banking with a swap mode and a 16-bit CPU-cycle down-counter IRQ.
// See https://www.nesdev.org/wiki/INES_Mapper_065
class Mapper65 extends Mapper0 {
  static mapperName = "Irem H3001";

  constructor(nes) {
    super(nes);
    this.cpuClockedIrq = true;
    this.prgReg = 0;
    this.prgMode = 0;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqEnabled = false;
    this.irqPending = false;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    switch (address & 0xf007) {
      case 0x8000:
        this.prgReg = value & 0x3f;
        this.applyPrg();
        break;
      case 0x9000:
        this.prgMode = value & 1;
        this.applyPrg();
        break;
      case 0x9001: {
        const mode = value & 3;
        this.nes.ppu.setMirroring(
          mode === 0
            ? this.nes.rom.VERTICAL_MIRRORING
            : mode === 2
              ? this.nes.rom.HORIZONTAL_MIRRORING
              : this.nes.rom.SINGLESCREEN_MIRRORING,
        );
        break;
      }
      case 0x9003:
        this.irqEnabled = (value & 0x80) !== 0;
        this.irqPending = false;
        break;
      case 0x9004:
        this.irqCounter = this.irqLatch;
        this.irqPending = false;
        break;
      case 0x9005:
        this.irqLatch = ((value & 0xff) << 8) | (this.irqLatch & 0x00ff);
        break;
      case 0x9006:
        this.irqLatch = (this.irqLatch & 0xff00) | (value & 0xff);
        break;
      case 0xa000:
        this.load8kRomBank(value & 0x3f, 0xa000);
        break;
      default:
        if ((address & 0xf000) === 0xb000) {
          this.load1kVromBank(value, (address & 7) * 0x400);
        }
    }
  }

  applyPrg() {
    const last = this.nes.rom.romCount * 2 - 1;
    if (this.prgMode === 0) {
      this.load8kRomBank(this.prgReg, 0x8000);
      this.load8kRomBank(last - 1, 0xc000);
    } else {
      this.load8kRomBank(last - 1, 0x8000);
      this.load8kRomBank(this.prgReg, 0xc000);
    }
  }

  clockCpuCycles(cycles) {
    if (this.irqEnabled && this.irqCounter > 0) {
      this.irqCounter -= cycles;
      if (this.irqCounter <= 0) {
        this.irqCounter = 0;
        this.irqPending = true;
      }
    }
    if (this.irqPending && !this.nes.cpu.irqRequested) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("H3001: Invalid ROM! Unable to load.");
    }
    const last = this.nes.rom.romCount * 2 - 1;
    this.applyPrg();
    this.load8kRomBank(1, 0xa000);
    this.load8kRomBank(last, 0xe000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.prgReg = this.prgReg;
    s.prgMode = this.prgMode;
    s.irqLatch = this.irqLatch;
    s.irqCounter = this.irqCounter;
    s.irqEnabled = this.irqEnabled;
    s.irqPending = this.irqPending;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgReg = s.prgReg;
    this.prgMode = s.prgMode;
    this.irqLatch = s.irqLatch;
    this.irqCounter = s.irqCounter;
    this.irqEnabled = s.irqEnabled;
    this.irqPending = s.irqPending;
  }
}

export default Mapper65;
