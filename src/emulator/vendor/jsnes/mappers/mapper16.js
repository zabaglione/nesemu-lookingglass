import Mapper0 from "./mapper0.js";

// Bandai FCG-1/2 + LZ93D50 (Dragon Ball Z series, SD Gundam Gaiden...).
// Registers respond both at $6000-$7FFF (FCG) and $8000-$FFFF (LZ93D50) so
// legacy iNES dumps of either board work. The serial EEPROM used for saving
// is stubbed (reads report "ready"); games run but cannot keep EEPROM saves.
// See https://www.nesdev.org/wiki/INES_Mapper_016
class Mapper16 extends Mapper0 {
  static mapperName = "Bandai FCG/LZ93D50";

  constructor(nes) {
    super(nes);
    this.cpuClockedIrq = true;
    // Mapper 153 keeps WRAM at $6000 and moves the registers to $8000+.
    this.regsInLowArea = true;
    this.prgBank = 0;
    this.prgOuter = 0;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqEnabled = false;
    this.irqPending = false;
  }

  load(address) {
    if (this.regsInLowArea && address >= 0x6000 && address < 0x8000) {
      // EEPROM read stub: bit 4 low = "not busy / data 0"
      return this.nes.cpu.dataBus & 0xef;
    }
    return super.load(address);
  }

  write(address, value) {
    if (address < 0x6000) {
      super.write(address, value);
      return;
    }
    if (address < 0x8000 && !this.regsInLowArea) {
      // Mapper 153: work RAM
      super.write(address, value);
      return;
    }
    this.writeRegister(address & 0x0f, value);
  }

  writeRegister(reg, value) {
    if (reg < 8) {
      this.setChrRegister(reg, value);
      return;
    }
    switch (reg) {
      case 0x8:
        this.prgBank = value & 0x0f;
        this.applyPrg();
        break;
      case 0x9: {
        const mirroring = [
          this.nes.rom.VERTICAL_MIRRORING,
          this.nes.rom.HORIZONTAL_MIRRORING,
          this.nes.rom.SINGLESCREEN_MIRRORING,
          this.nes.rom.SINGLESCREEN_MIRRORING2,
        ][value & 3];
        this.nes.ppu.setMirroring(mirroring);
        break;
      }
      case 0xa:
        this.irqPending = false;
        this.irqEnabled = (value & 1) !== 0;
        this.irqCounter = this.irqLatch;
        break;
      case 0xb:
        this.irqLatch = (this.irqLatch & 0xff00) | (value & 0xff);
        if (!this.irqEnabled) {
          this.irqCounter = (this.irqCounter & 0xff00) | (value & 0xff);
        }
        break;
      case 0xc:
        this.irqLatch = ((value & 0xff) << 8) | (this.irqLatch & 0x00ff);
        if (!this.irqEnabled) {
          this.irqCounter = ((value & 0xff) << 8) | (this.irqCounter & 0x00ff);
        }
        break;
      case 0xd:
        // EEPROM I2C control (stubbed)
        break;
    }
  }

  setChrRegister(reg, value) {
    this.load1kVromBank(value, reg * 0x400);
  }

  applyPrg() {
    const base = this.prgOuter << 4;
    this.loadRomBank(base | (this.prgBank & 0x0f), 0x8000);
    this.loadRomBank(base | 0x0f, 0xc000);
  }

  clockCpuCycles(cycles) {
    if (this.irqEnabled) {
      for (let i = 0; i < cycles; i++) {
        this.irqCounter = (this.irqCounter - 1) & 0xffff;
        if (this.irqCounter === 0) {
          this.irqPending = true;
          this.irqEnabled = false;
          break;
        }
      }
    }
    if (this.irqPending && !this.nes.cpu.irqRequested) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("Bandai FCG: Invalid ROM! Unable to load.");
    }
    this.applyPrg();
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.prgBank = this.prgBank;
    s.prgOuter = this.prgOuter;
    s.irqLatch = this.irqLatch;
    s.irqCounter = this.irqCounter;
    s.irqEnabled = this.irqEnabled;
    s.irqPending = this.irqPending;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgBank = s.prgBank;
    this.prgOuter = s.prgOuter;
    this.irqLatch = s.irqLatch;
    this.irqCounter = s.irqCounter;
    this.irqEnabled = s.irqEnabled;
    this.irqPending = s.irqPending;
  }
}

export default Mapper16;
