import Mapper0 from "./mapper0.js";

// Taito TC0190 (Don Doko Don, Insector X, Akira).
// 2x8 KB PRG + 2x2 KB + 4x1 KB CHR. Mirroring in $8000 bit 6.
// See https://www.nesdev.org/wiki/INES_Mapper_033
class Mapper33 extends Mapper0 {
  static mapperName = "Taito TC0190";

  // Mapper 48 (TC0690) reuses this class and moves mirroring to $E000.
  hasMirroringInPrgReg = true;

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    switch (address & 0xe003) {
      case 0x8000:
        this.load8kRomBank(value & 0x3f, 0x8000);
        if (this.hasMirroringInPrgReg) {
          this.setMirroringBit((value >> 6) & 1);
        }
        break;
      case 0x8001:
        this.load8kRomBank(value & 0x3f, 0xa000);
        break;
      case 0x8002:
        this.load2kVromBank(value, 0x0000);
        break;
      case 0x8003:
        this.load2kVromBank(value, 0x0800);
        break;
      case 0xa000:
      case 0xa001:
      case 0xa002:
      case 0xa003:
        this.load1kVromBank(value, 0x1000 + (address & 3) * 0x400);
        break;
      default:
        this.writeUpperRegister(address, value);
    }
  }

  // Mapper 48 hooks IRQ/mirroring registers here.
  // eslint-disable-next-line no-unused-vars
  writeUpperRegister(address, value) {}

  setMirroringBit(bit) {
    this.nes.ppu.setMirroring(
      bit !== 0
        ? this.nes.rom.HORIZONTAL_MIRRORING
        : this.nes.rom.VERTICAL_MIRRORING,
    );
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("TC0190: Invalid ROM! Unable to load.");
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

export default Mapper33;
