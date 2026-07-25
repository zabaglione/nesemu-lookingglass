import Mapper0 from "./mapper0.js";

// Irem TAM-S1 (Kaiketsu Yanchamaru).
// Unusual layout: the FIXED 16 KB bank sits at $8000 and the switchable
// bank at $C000. Bit 7 selects mirroring.
// See https://www.nesdev.org/wiki/INES_Mapper_097
class Mapper97 extends Mapper0 {
  static mapperName = "Irem TAM-S1";

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    this.loadRomBank(value & 0x0f, 0xc000);
    this.nes.ppu.setMirroring(
      (value & 0x80) !== 0
        ? this.nes.rom.VERTICAL_MIRRORING
        : this.nes.rom.HORIZONTAL_MIRRORING,
    );
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("TAM-S1: Invalid ROM! Unable to load.");
    }
    this.loadRomBank(this.nes.rom.romCount - 1, 0x8000);
    this.loadRomBank(0, 0xc000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper97;
