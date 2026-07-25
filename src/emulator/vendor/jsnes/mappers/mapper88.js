import Mapper206 from "./mapper206.js";

// NAMCOT-3433/3443 (Quinty, Dragon Spirit...).
// Namco 108 variant where CHR A16 is wired so registers 0-1 address the low
// 64 KB and registers 2-5 the high 64 KB of CHR-ROM.
// See https://www.nesdev.org/wiki/INES_Mapper_088
class Mapper88 extends Mapper206 {
  static mapperName = "NAMCOT-3433";

  setBank(reg, value) {
    if (reg < 2) {
      this.load2kVromBank((value & 0x3f) >> 1, reg * 0x800);
      return;
    }
    if (reg < 6) {
      this.load1kVromBank((value & 0x3f) | 0x40, 0x1000 + (reg - 2) * 0x400);
      return;
    }
    super.setBank(reg, value);
  }
}

export default Mapper88;
