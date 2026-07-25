import Mapper16 from "./mapper16.js";

// Bandai LZ93D50 with the smaller 24C01 EEPROM (SD Gundam Gaiden series,
// Magical Taruruuto-kun). Behaves like mapper 16 here (EEPROM is stubbed).
// See https://www.nesdev.org/wiki/INES_Mapper_159
class Mapper159 extends Mapper16 {
  static mapperName = "Bandai LZ93D50 (24C01)";
}

export default Mapper159;
