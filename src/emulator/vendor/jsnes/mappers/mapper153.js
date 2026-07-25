import Mapper16 from "./mapper16.js";

// Bandai LZ93D50 with 8 KB battery WRAM (Famicom Jump II).
// Registers only at $8000+; the CHR registers instead provide the PRG-A18
// outer-bank bit (CHR is RAM on this board).
// See https://www.nesdev.org/wiki/INES_Mapper_153
class Mapper153 extends Mapper16 {
  static mapperName = "Bandai LZ93D50 (WRAM)";

  constructor(nes) {
    super(nes);
    this.regsInLowArea = false;
  }

  setChrRegister(reg, value) {
    this.prgOuter = value & 1;
    this.applyPrg();
  }
}

export default Mapper153;
