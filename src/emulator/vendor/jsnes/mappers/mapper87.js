import Mapper0 from "./mapper0.js";

// Jaleco/Konami 74*139/74 discrete boards (Argus, City Connection (J),
// Ninja Jajamaru-kun). CHR register at $6000-$7FFF with swapped bits.
// See https://www.nesdev.org/wiki/INES_Mapper_087
class Mapper87 extends Mapper0 {
  static mapperName = "Jaleco JF-05/06/07/08/09/10";

  write(address, value) {
    if (address >= 0x6000 && address < 0x8000) {
      const bank = ((value & 1) << 1) | ((value >> 1) & 1);
      this.load8kVromBank(bank * 2, 0x0000);
      return;
    }
    super.write(address, value);
  }
}

export default Mapper87;
