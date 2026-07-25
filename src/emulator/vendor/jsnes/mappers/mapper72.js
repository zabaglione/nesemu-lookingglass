import Mapper0 from "./mapper0.js";

// Jaleco JF-17 (Pinball Quest, Moero!! Juudou Warriors).
// Latched banking: bit 7 applies the PRG bank, bit 6 the CHR bank.
// The uPD7756 speech chip is not emulated.
// See https://www.nesdev.org/wiki/INES_Mapper_072
class Mapper72 extends Mapper0 {
  static mapperName = "Jaleco JF-17";

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    if ((value & 0x80) !== 0) {
      this.applyPrg(value & 0x0f);
    }
    if ((value & 0x40) !== 0) {
      this.load8kVromBank((value & 0x0f) * 2, 0x0000);
    }
  }

  applyPrg(bank) {
    this.loadRomBank(bank & 0x07, 0x8000);
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("JF-17: Invalid ROM! Unable to load.");
    }
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper72;
