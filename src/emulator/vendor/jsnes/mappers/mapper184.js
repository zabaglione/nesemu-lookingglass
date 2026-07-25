import Mapper0 from "./mapper0.js";

// Sunsoft-1 (Wing of Madoola, Atlantis no Nazo (alt)).
// Register at $6000-$7FFF: low nibble = 4 KB CHR at $0000, high nibble =
// 4 KB CHR at $1000 (upper half fixed into banks 4-7).
// See https://www.nesdev.org/wiki/INES_Mapper_184
class Mapper184 extends Mapper0 {
  static mapperName = "Sunsoft-1";

  write(address, value) {
    if (address >= 0x6000 && address < 0x8000) {
      this.loadVromBank(value & 0x07, 0x0000);
      this.loadVromBank(((value >> 4) & 0x07) | 0x04, 0x1000);
      return;
    }
    super.write(address, value);
  }
}

export default Mapper184;
