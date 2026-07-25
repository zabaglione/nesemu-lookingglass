import Mapper70 from "./mapper70.js";

// Bandai 74*161/161/32 with one-screen mirroring (Arkanoid II,
// Gegege no Kitarou 2, Saint Seiya Ougon Densetsu).
// Bit 7 selects the nametable page.
// See https://www.nesdev.org/wiki/INES_Mapper_152
class Mapper152 extends Mapper70 {
  static mapperName = "Bandai 74*161/161/32 (one-screen)";

  applyBanks(value) {
    this.loadRomBank((value >> 4) & 0x07, 0x8000);
    this.load8kVromBank((value & 0x0f) * 2, 0x0000);
    this.nes.ppu.setMirroring(
      (value & 0x80) !== 0
        ? this.nes.rom.SINGLESCREEN_MIRRORING2
        : this.nes.rom.SINGLESCREEN_MIRRORING,
    );
  }
}

export default Mapper152;
