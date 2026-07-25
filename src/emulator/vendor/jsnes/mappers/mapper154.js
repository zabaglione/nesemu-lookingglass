import Mapper88 from "./mapper88.js";

// NAMCOT-3453 (Devil Man).
// Same as NAMCOT-3433 (mapper 88) plus single-screen mirroring selected by
// bit 6 of the bank-select register.
// See https://www.nesdev.org/wiki/INES_Mapper_154
class Mapper154 extends Mapper88 {
  static mapperName = "NAMCOT-3453";

  onSelectWrite(value) {
    this.nes.ppu.setMirroring(
      (value & 0x40) !== 0
        ? this.nes.rom.SINGLESCREEN_MIRRORING2
        : this.nes.rom.SINGLESCREEN_MIRRORING,
    );
  }
}

export default Mapper154;
