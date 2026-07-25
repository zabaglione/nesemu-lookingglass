import Mapper72 from "./mapper72.js";

// Jaleco JF-19/JF-21 (Moero!! Pro Soccer, Moero!! Pro Yakyuu '88).
// Like JF-17 but the switchable 16 KB PRG bank sits at $C000 and the first
// bank is fixed at $8000.
// See https://www.nesdev.org/wiki/INES_Mapper_092
class Mapper92 extends Mapper72 {
  static mapperName = "Jaleco JF-19";

  applyPrg(bank) {
    this.loadRomBank(bank & 0x0f, 0xc000);
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("JF-19: Invalid ROM! Unable to load.");
    }
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper92;
