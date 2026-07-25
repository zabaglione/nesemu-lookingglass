import Mapper0 from "./mapper0.js";

// Irem G-101 (Image Fight, Perman, Major League).
// 2x8 KB PRG with a swap mode, 8x1 KB CHR.
// See https://www.nesdev.org/wiki/INES_Mapper_032
class Mapper32 extends Mapper0 {
  static mapperName = "Irem G-101";

  constructor(nes) {
    super(nes);
    this.prgReg = 0;
    this.prgMode = 0;
    // Submapper 1 (Major League): hardwired one-screen, mode 0 only.
    this.fixedSingleScreen = (nes.rom.subMapper || 0) === 1;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    switch (address & 0xf000) {
      case 0x8000:
        this.prgReg = value & 0x1f;
        this.applyPrg();
        break;
      case 0x9000:
        if (!this.fixedSingleScreen) {
          this.prgMode = (value >> 1) & 1;
          this.nes.ppu.setMirroring(
            (value & 1) !== 0
              ? this.nes.rom.HORIZONTAL_MIRRORING
              : this.nes.rom.VERTICAL_MIRRORING,
          );
          this.applyPrg();
        }
        break;
      case 0xa000:
        this.load8kRomBank(value & 0x1f, 0xa000);
        break;
      case 0xb000:
        this.load1kVromBank(value, (address & 7) * 0x400);
        break;
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

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("G-101: Invalid ROM! Unable to load.");
    }
    const last = this.nes.rom.romCount * 2 - 1;
    this.applyPrg();
    this.load8kRomBank(1, 0xa000);
    this.load8kRomBank(last, 0xe000);
    if (this.fixedSingleScreen) {
      this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);
    }
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.prgReg = this.prgReg;
    s.prgMode = this.prgMode;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgReg = s.prgReg;
    this.prgMode = s.prgMode;
  }
}

export default Mapper32;
