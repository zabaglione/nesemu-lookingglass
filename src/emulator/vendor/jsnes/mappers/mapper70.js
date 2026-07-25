import Mapper0 from "./mapper0.js";

// Bandai 74*161/161/32 (Kamen Rider Club, Space Shadow, Family Trainer).
// Single register: high nibble = 16 KB PRG at $8000, low nibble = 8 KB CHR.
// See https://www.nesdev.org/wiki/INES_Mapper_070
class Mapper70 extends Mapper0 {
  static mapperName = "Bandai 74*161/161/32";

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    this.applyBanks(value);
  }

  applyBanks(value) {
    this.loadRomBank((value >> 4) & 0x0f, 0x8000);
    this.load8kVromBank((value & 0x0f) * 2, 0x0000);
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("Mapper 70: Invalid ROM! Unable to load.");
    }
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper70;
