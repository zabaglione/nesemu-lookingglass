import Mapper0 from "./mapper0.js";

// Namco 175/340 (Famista '91-'93, Splatterhouse: Wanpaku Graffiti,
// Wagyan Land 2/3, Dream Master).
// Cost-reduced Namco 163 without IRQ/audio. NES 2.0 submapper 2 (Namco 340)
// adds mirroring control at $E000; legacy iNES keeps header mirroring.
// See https://www.nesdev.org/wiki/INES_Mapper_210
class Mapper210 extends Mapper0 {
  static mapperName = "Namco 175/340";

  constructor(nes) {
    super(nes);
    this.is340 = (nes.rom.subMapper || 0) === 2;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    const region = address & 0xf800;
    if (region >= 0x8000 && region <= 0xbfff) {
      this.writeChrRegister((region - 0x8000) >> 11, value);
      return;
    }
    switch (region) {
      case 0xc000:
      case 0xc800:
      case 0xd000:
      case 0xd800:
        this.writeNametableRegister((region - 0xc000) >> 11, value);
        break;
      case 0xe000:
        this.load8kRomBank(value & 0x3f, 0x8000);
        if (this.is340) {
          const mirroring = [
            this.nes.rom.SINGLESCREEN_MIRRORING,
            this.nes.rom.VERTICAL_MIRRORING,
            this.nes.rom.SINGLESCREEN_MIRRORING2,
            this.nes.rom.HORIZONTAL_MIRRORING,
          ][(value >> 6) & 3];
          this.nes.ppu.setMirroring(mirroring);
        }
        break;
      case 0xe800:
        this.load8kRomBank(value & 0x3f, 0xa000);
        break;
      case 0xf000:
        this.load8kRomBank(value & 0x3f, 0xc000);
        break;
    }
  }

  writeChrRegister(slot, value) {
    this.load1kVromBank(value, slot * 0x400);
  }

  // Namco 175/340: $C000-$C7FF is the WRAM enable; others are unused.
  // Namco 163 (mapper 19) overrides this for nametable selection.
  // eslint-disable-next-line no-unused-vars
  writeNametableRegister(slot, value) {}

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("Namco 175/340: Invalid ROM! Unable to load.");
    }
    const last = this.nes.rom.romCount * 2 - 1;
    this.load8kRomBank(0, 0x8000);
    this.load8kRomBank(1, 0xa000);
    this.load8kRomBank(last - 1, 0xc000);
    this.load8kRomBank(last, 0xe000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper210;
