import Mapper0 from "./mapper0.js";

// Sunsoft-4 (After Burner, Maharaja).
// 4x2 KB CHR + 16 KB PRG. The board can also map CHR-ROM into the
// nametables; that mode is not supported by this emulator's nametable model
// and is approximated with standard mirroring (After Burner's intro
// backgrounds will look wrong; gameplay is unaffected).
// See https://www.nesdev.org/wiki/INES_Mapper_068
class Mapper68 extends Mapper0 {
  static mapperName = "Sunsoft-4";

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    switch (address & 0xf000) {
      case 0x8000:
      case 0x9000:
      case 0xa000:
      case 0xb000:
        this.load2kVromBank(
          value & 0x7f,
          (((address >> 12) & 0x0f) - 8) * 0x800,
        );
        break;
      case 0xc000:
      case 0xd000:
        // Nametable ROM select (unsupported; see note above)
        break;
      case 0xe000:
        this.setMirroring(value & 3);
        break;
      case 0xf000:
        this.loadRomBank(value & 0x0f, 0x8000);
        break;
    }
  }

  setMirroring(mode) {
    const mirroring = [
      this.nes.rom.VERTICAL_MIRRORING,
      this.nes.rom.HORIZONTAL_MIRRORING,
      this.nes.rom.SINGLESCREEN_MIRRORING,
      this.nes.rom.SINGLESCREEN_MIRRORING2,
    ][mode];
    this.nes.ppu.setMirroring(mirroring);
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("Sunsoft-4: Invalid ROM! Unable to load.");
    }
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}

export default Mapper68;
