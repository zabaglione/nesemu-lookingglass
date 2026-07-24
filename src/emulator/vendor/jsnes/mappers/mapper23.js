import Mapper25 from "./mapper25.js";

// Konami VRC2b / VRC4e / VRC4f.
// The mapper hardware is shared with mapper 25. The board variants differ in
// which CPU address lines select the low two register bits.
// See https://www.nesdev.org/wiki/INES_Mapper_023
class Mapper23 extends Mapper25 {
  static mapperNumber = 23;
  static mapperName = "VRC2b/VRC4e/VRC4f";

  constructor(nes) {
    super(nes);

    const submapper = nes.rom.subMapper || 0;
    this.legacyMapper23 = submapper === 0;
    this.addressVariant =
      submapper === 1
        ? "f"
        : submapper === 2
          ? "e"
          : submapper === 3
            ? "b"
            : null;
    this.isVrc2 = submapper === 3;
    this.vrc2Latch = 0;

    // NES 2.0 identifies VRC2b exactly. It has a one-bit latch instead of
    // WRAM and no IRQ. Legacy iNES is resolved from the address layout:
    // official low-address boards are VRC2b, while high-address boards are
    // VRC4e. NES 2.0 submapper 1 keeps the uncommon VRC4f layout available.
    this.wramEnabled = false;
    this.cpuClockedIrq = !this.isVrc2;
  }

  load(address) {
    address &= 0xffff;
    if (
      this.legacyMapper23 &&
      this.addressVariant === null &&
      address >= 0x6000 &&
      address < 0x8000
    ) {
      this.selectLegacyVrc2b();
    }
    if (this.isVrc2 && address >= 0x6000 && address < 0x8000) {
      if (address < 0x7000) {
        return (this.nes.cpu.dataBus & 0xfe) | this.vrc2Latch;
      }
      return this.nes.cpu.dataBus;
    }
    return super.load(address);
  }

  write(address, value) {
    address &= 0xffff;
    if (
      this.legacyMapper23 &&
      this.addressVariant === null &&
      address >= 0x6000 &&
      address < 0x8000
    ) {
      this.selectLegacyVrc2b();
    }
    if (this.isVrc2 && address >= 0x6000 && address < 0x8000) {
      if (address < 0x7000) this.vrc2Latch = value & 1;
      return;
    }
    super.write(address, value);
  }

  decodeRegister(address) {
    const region = address >> 12;
    const registerAddressMatters = region === 0x9 || region >= 0xb;
    if (this.addressVariant === null && registerAddressMatters) {
      if ((address & 0x03) !== 0) {
        this.selectLegacyVrc2b();
      } else if ((address & 0x0c) !== 0) {
        this.addressVariant = "e";
      }
    }

    if (this.addressVariant === "e") {
      return ((address >> 2) & 1) | (((address >> 3) & 1) << 1);
    }
    return address & 0x03;
  }

  selectLegacyVrc2b() {
    this.addressVariant = "b";
    this.isVrc2 = true;
    this.wramEnabled = false;
    this.cpuClockedIrq = false;
    this.irqEnabled = false;
    this.irqPending = false;
    this.applyPrgBanks();
  }

  loadBatteryRam() {
    if (!this.isVrc2) super.loadBatteryRam();
  }

  toJSON() {
    const state = super.toJSON();
    state.vrc2Latch = this.vrc2Latch;
    return state;
  }

  fromJSON(state) {
    super.fromJSON(state);
    this.vrc2Latch = state.vrc2Latch || 0;
    this.cpuClockedIrq = !this.isVrc2;
  }
}

export default Mapper23;
