import Mapper25 from "./mapper25.js";

// Konami VRC4a / VRC4c (Wai Wai World 2, Ganbare Goemon Gaiden).
// Same hardware core as mapper 25; only the CPU address lines that select the
// low two register bits differ (VRC4a: A1/A2, VRC4c: A6/A7).
// See https://www.nesdev.org/wiki/INES_Mapper_021
class Mapper21 extends Mapper25 {
  static mapperNumber = 21;
  static mapperName = "VRC4a/VRC4c";

  constructor(nes) {
    super(nes);
    const submapper = nes.rom.subMapper || 0;
    this.addressVariant = submapper === 1 ? "a" : submapper === 2 ? "c" : null;
    // Mapper 21 has no VRC2 boards.
    this.isVrc2 = false;
  }

  decodeRegister(address) {
    if (this.addressVariant === null) {
      if ((address & 0x06) !== 0) {
        this.addressVariant = "a";
      } else if ((address & 0xc0) !== 0) {
        this.addressVariant = "c";
      }
    }
    if (this.addressVariant === "c") {
      return ((address >> 6) & 1) | (((address >> 7) & 1) << 1);
    }
    return ((address >> 1) & 1) | (((address >> 2) & 1) << 1);
  }
}

export default Mapper21;
