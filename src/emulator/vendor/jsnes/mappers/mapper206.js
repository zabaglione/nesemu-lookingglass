import Mapper0 from "./mapper0.js";

// Namco 108 family (DxROM / NAMCOT-3401/3405/3416, also many Tengen boards).
// A simplified MMC3 predecessor: the same bank-select/bank-data register pair
// but no IRQ, no mirroring control and no PRG mode toggle.
// See https://www.nesdev.org/wiki/INES_Mapper_206
class Mapper206 extends Mapper0 {
  static mapperName = "Namco 108";

  constructor(nes) {
    super(nes);
    this.reg = 0;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    switch (address & 0xe001) {
      case 0x8000:
        this.reg = value & 0x07;
        this.onSelectWrite(value);
        break;
      case 0x8001:
        this.setBank(this.reg, value);
        break;
    }
  }

  // Overridden by variants that latch extra state on $8000 writes.
  // eslint-disable-next-line no-unused-vars
  onSelectWrite(value) {}

  setBank(reg, value) {
    if (reg < 2) {
      this.load2kVromBank((value & 0x3f) >> 1, reg * 0x800);
    } else if (reg < 6) {
      this.load1kVromBank(value & 0x3f, 0x1000 + (reg - 2) * 0x400);
    } else if (reg === 6) {
      this.load8kRomBank(value & 0x0f, 0x8000);
    } else {
      this.load8kRomBank(value & 0x0f, 0xa000);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 1) {
      throw new Error("Namco 108: Invalid ROM! Unable to load.");
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
    s.reg = this.reg;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.reg = s.reg || 0;
  }
}

export default Mapper206;
