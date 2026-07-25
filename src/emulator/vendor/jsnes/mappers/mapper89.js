import Mapper0 from "./mapper0.js";

// Sunsoft-2 on the Sunsoft-3 board (Tenka no Goikenban: Mito Koumon).
// Single register [CPPP MCCC]: CHR high bit / PRG / one-screen select / CHR.
// See https://www.nesdev.org/wiki/INES_Mapper_089
class Mapper89 extends Mapper0 {
  static mapperName = "Sunsoft-2 (Sunsoft-3 board)";

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    this.loadRomBank((value >> 4) & 0x07, 0x8000);
    const chr = ((value >> 4) & 0x08) | (value & 0x07);
    this.load8kVromBank(chr * 2, 0x0000);
    this.nes.ppu.setMirroring(
      (value & 0x08) !== 0
        ? this.nes.rom.SINGLESCREEN_MIRRORING2
        : this.nes.rom.SINGLESCREEN_MIRRORING,
    );
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

export default Mapper89;
