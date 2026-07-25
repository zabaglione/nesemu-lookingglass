import Mapper0 from "./mapper0.js";

// Jaleco JF-13 (Moero!! Pro Yakyuu).
// Register at $6000-$6FFF: 32 KB PRG + 8 KB CHR (split bit 6).
// The uPD7756 speech chip is not emulated.
// See https://www.nesdev.org/wiki/INES_Mapper_086
class Mapper86 extends Mapper0 {
  static mapperName = "Jaleco JF-13";

  write(address, value) {
    if (address >= 0x6000 && address < 0x7000) {
      this.load32kRomBank((value >> 4) & 0x03, 0x8000);
      this.load8kVromBank(((value & 0x03) | ((value >> 4) & 0x04)) * 2, 0x0000);
      return;
    }
    if (address >= 0x7000 && address < 0x8000) {
      // Speech chip control (ignored)
      return;
    }
    super.write(address, value);
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("JF-13: Invalid ROM! Unable to load.");
    }
    this.load32kRomBank(0, 0x8000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper86;
