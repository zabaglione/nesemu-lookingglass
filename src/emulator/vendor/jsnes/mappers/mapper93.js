import Mapper0 from "./mapper0.js";

// Sunsoft-2 on the Sunsoft-3R board (Fantasy Zone, Shanghai).
// Single register: bits 6-4 select 16 KB PRG at $8000. CHR-RAM board.
// See https://www.nesdev.org/wiki/INES_Mapper_093
class Mapper93 extends Mapper0 {
  static mapperName = "Sunsoft-2 (Sunsoft-3R board)";

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    this.loadRomBank((value >> 4) & 0x07, 0x8000);
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("Sunsoft-2: Invalid ROM! Unable to load.");
    }
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper93;
