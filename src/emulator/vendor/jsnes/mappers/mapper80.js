import Mapper0 from "./mapper0.js";

// Taito X1-005 (Minelvaton Saga, Kyonshiizu 2, Taito Grand Prix).
// Registers live at $7EF0-$7EFF. The optional 128-byte battery RAM at
// $7F00-$7FFF is backed by the flat CPU memory map.
// See https://www.nesdev.org/wiki/INES_Mapper_080
class Mapper80 extends Mapper0 {
  static mapperName = "Taito X1-005";

  write(address, value) {
    if (address >= 0x7ef0 && address <= 0x7eff) {
      this.writeRegister(address, value);
      return;
    }
    super.write(address, value);
  }

  writeRegister(address, value) {
    switch (address) {
      case 0x7ef0:
        this.load2kVromBank((value & 0x7f) >> 1, 0x0000);
        break;
      case 0x7ef1:
        this.load2kVromBank((value & 0x7f) >> 1, 0x0800);
        break;
      case 0x7ef2:
      case 0x7ef3:
      case 0x7ef4:
      case 0x7ef5:
        this.load1kVromBank(value, 0x1000 + (address - 0x7ef2) * 0x400);
        break;
      case 0x7ef6:
      case 0x7ef7:
        this.nes.ppu.setMirroring(
          (value & 1) !== 0
            ? this.nes.rom.VERTICAL_MIRRORING
            : this.nes.rom.HORIZONTAL_MIRRORING,
        );
        break;
      case 0x7ef8:
      case 0x7ef9:
        // RAM enable ($A3). The RAM itself is always present in cpu.mem.
        break;
      case 0x7efa:
      case 0x7efb:
        this.load8kRomBank(value & 0x3f, 0x8000);
        break;
      case 0x7efc:
      case 0x7efd:
        this.load8kRomBank(value & 0x3f, 0xa000);
        break;
      case 0x7efe:
      case 0x7eff:
        this.load8kRomBank(value & 0x3f, 0xc000);
        break;
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("X1-005: Invalid ROM! Unable to load.");
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

export default Mapper80;
