import Mapper9 from "./mapper9.js";

// MMC4 (FxROM: Fire Emblem, Fire Emblem Gaiden, Famicom Wars).
// Like MMC2 but with 16 KB PRG banking and both CHR latches triggering on
// the full $xFD8-$xFDF / $xFE8-$xFEF ranges.
// See https://www.nesdev.org/wiki/MMC4
class Mapper10 extends Mapper9 {
  static mapperName = "MMC4";

  write(address, value) {
    if (address >= 0x8000 && (address & 0xf000) === 0xa000) {
      this.prgBank = value & 0x0f;
      this.loadRomBank(this.prgBank, 0x8000);
      return;
    }
    super.write(address, value);
  }

  latchAccess(address) {
    if (address >= 0x0fd8 && address <= 0x0fdf) {
      if (this.latch0 !== 0xfd) {
        this.latch0 = 0xfd;
        this._updateChr0();
      }
    } else if (address >= 0x0fe8 && address <= 0x0fef) {
      if (this.latch0 !== 0xfe) {
        this.latch0 = 0xfe;
        this._updateChr0();
      }
    } else if (address >= 0x1fd8 && address <= 0x1fdf) {
      if (this.latch1 !== 0xfd) {
        this.latch1 = 0xfd;
        this._updateChr1();
      }
    } else if (address >= 0x1fe8 && address <= 0x1fef) {
      if (this.latch1 !== 0xfe) {
        this.latch1 = 0xfe;
        this._updateChr1();
      }
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC4: Invalid ROM! Unable to load.");
    }
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper10;
