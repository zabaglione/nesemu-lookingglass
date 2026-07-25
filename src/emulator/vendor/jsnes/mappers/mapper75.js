import Mapper0 from "./mapper0.js";

// Konami VRC1 (King Kong 2, Jajamaru no Daibouken, Tetsuwan Atom).
// Three 8 KB PRG banks, two 4 KB CHR banks with a high bit in $9000.
// See https://www.nesdev.org/wiki/VRC1
class Mapper75 extends Mapper0 {
  static mapperName = "VRC1";

  constructor(nes) {
    super(nes);
    this.chrLow = [0, 0];
    this.chrHigh = [0, 0];
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    switch (address & 0xf000) {
      case 0x8000:
        this.load8kRomBank(value & 0x0f, 0x8000);
        break;
      case 0x9000:
        this.nes.ppu.setMirroring(
          (value & 1) !== 0
            ? this.nes.rom.HORIZONTAL_MIRRORING
            : this.nes.rom.VERTICAL_MIRRORING,
        );
        this.chrHigh[0] = (value >> 1) & 1;
        this.chrHigh[1] = (value >> 2) & 1;
        this.applyChr(0);
        this.applyChr(1);
        break;
      case 0xa000:
        this.load8kRomBank(value & 0x0f, 0xa000);
        break;
      case 0xc000:
        this.load8kRomBank(value & 0x0f, 0xc000);
        break;
      case 0xe000:
        this.chrLow[0] = value & 0x0f;
        this.applyChr(0);
        break;
      case 0xf000:
        this.chrLow[1] = value & 0x0f;
        this.applyChr(1);
        break;
    }
  }

  applyChr(slot) {
    const bank = (this.chrHigh[slot] << 4) | this.chrLow[slot];
    this.loadVromBank(bank, slot * 0x1000);
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("VRC1: Invalid ROM! Unable to load.");
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
    s.chrLow = this.chrLow.slice();
    s.chrHigh = this.chrHigh.slice();
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.chrLow = s.chrLow.slice();
    this.chrHigh = s.chrHigh.slice();
  }
}

export default Mapper75;
