import Mapper206 from "./mapper206.js";

// NAMCOT-3446 (Megami Tensei: Digital Devil Story).
// Namco 108 variant where all CHR windows are 2 KB (registers 2-5).
// See https://www.nesdev.org/wiki/INES_Mapper_076
class Mapper76 extends Mapper206 {
  static mapperName = "NAMCOT-3446";

  setBank(reg, value) {
    if (reg < 2) {
      // Registers 0-1 are not connected on this board.
      return;
    }
    if (reg < 6) {
      this.load2kVromBank(value & 0x3f, (reg - 2) * 0x800);
      return;
    }
    super.setBank(reg, value);
  }
}

export default Mapper76;
