import Mapper0 from "./mapper0.js";

// Irem 74HC161/32 (Holy Diver) / Jaleco JF-16 (Uchuusen Cosmo Carrier).
// Single register: PRG 16 KB, CHR 8 KB, and one mirroring bit whose meaning
// depends on the board. NES 2.0 submapper 1 = JF-16 (one-screen),
// submapper 3 = Holy Diver (H/V). Legacy iNES defaults to Holy Diver.
// See https://www.nesdev.org/wiki/INES_Mapper_078
class Mapper78 extends Mapper0 {
  static mapperName = "Holy Diver / JF-16";

  constructor(nes) {
    super(nes);
    this.singleScreenBoard = (nes.rom.subMapper || 0) === 1;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    this.loadRomBank(value & 0x07, 0x8000);
    this.load8kVromBank(((value >> 4) & 0x0f) * 2, 0x0000);
    if (this.singleScreenBoard) {
      this.nes.ppu.setMirroring(
        (value & 0x08) !== 0
          ? this.nes.rom.SINGLESCREEN_MIRRORING2
          : this.nes.rom.SINGLESCREEN_MIRRORING,
      );
    } else {
      this.nes.ppu.setMirroring(
        (value & 0x08) !== 0
          ? this.nes.rom.HORIZONTAL_MIRRORING
          : this.nes.rom.VERTICAL_MIRRORING,
      );
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("Mapper 78: Invalid ROM! Unable to load.");
    }
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper78;
