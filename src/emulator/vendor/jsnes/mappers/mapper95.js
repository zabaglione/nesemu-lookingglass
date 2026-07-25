import Mapper206 from "./mapper206.js";

// NAMCOT-3425 (Dragon Buster).
// Namco 108 variant where CHR bank bit 5 drives the nametable selection.
// Approximated here as single-screen switching from register 0.
// See https://www.nesdev.org/wiki/INES_Mapper_095
class Mapper95 extends Mapper206 {
  static mapperName = "NAMCOT-3425";

  setBank(reg, value) {
    if (reg < 2) {
      const mirroring =
        (value & 0x20) !== 0
          ? this.nes.rom.SINGLESCREEN_MIRRORING2
          : this.nes.rom.SINGLESCREEN_MIRRORING;
      if (reg === 0) {
        this.nes.ppu.setMirroring(mirroring);
      }
      this.load2kVromBank((value & 0x1f) >> 1, reg * 0x800);
      return;
    }
    super.setBank(reg, value);
  }
}

export default Mapper95;
