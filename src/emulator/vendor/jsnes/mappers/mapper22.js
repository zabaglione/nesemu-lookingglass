import Mapper25 from "./mapper25.js";

// Konami VRC2a (TwinBee 3, Ganbare Pennant Race).
// VRC2 with the register lines A0/A1 swapped (same decode as VRC4b) and the
// CHR registers shifted right by one (CHR A10 comes from PPU A10).
// See https://www.nesdev.org/wiki/INES_Mapper_022
class Mapper22 extends Mapper25 {
  static mapperNumber = 22;
  static mapperName = "VRC2a";

  constructor(nes) {
    super(nes);
    this.addressVariant = "b"; // A0/A1 swapped decode, shared with VRC4b
    this.isVrc2 = true;
    this.wramEnabled = false;
    this.cpuClockedIrq = false;
  }

  writeChrRegister(region, register, value) {
    const bankIndex = (region - 0xb) * 2 + (register >> 1);
    if ((register & 1) === 0) {
      this.chrBanks[bankIndex] =
        (this.chrBanks[bankIndex] & 0xf0) | (value & 0x0f);
    } else {
      this.chrBanks[bankIndex] =
        ((value & 0x0f) << 4) | (this.chrBanks[bankIndex] & 0x0f);
    }
    // VRC2a: the register value addresses CHR in 2 KB steps.
    this.load1kVromBank(this.chrBanks[bankIndex] >> 1, bankIndex * 0x400);
  }
}

export default Mapper22;
