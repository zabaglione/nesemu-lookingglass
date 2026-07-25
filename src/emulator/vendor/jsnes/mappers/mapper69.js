import Mapper0 from "./mapper0.js";

// Sunsoft FME-7 / 5A / 5B (Gimmick!, Hebereke, Batman: Return of the Joker).
// Command/parameter interface with full 8 KB PRG/1 KB CHR banking, $6000
// RAM/ROM switching and a 16-bit CPU-cycle IRQ. The 5B expansion audio
// (used only by Gimmick!) is not emulated.
// See https://www.nesdev.org/wiki/Sunsoft_FME-7
class Mapper69 extends Mapper0 {
  static mapperName = "FME-7";

  constructor(nes) {
    super(nes);
    this.cpuClockedIrq = true;
    this.command = 0;
    this.ram6000 = true;
    this.irqEnabled = false;
    this.irqCounterEnabled = false;
    this.irqCounter = 0;
    this.irqPending = false;
  }

  write(address, value) {
    if (address < 0x6000) {
      super.write(address, value);
      return;
    }
    if (address < 0x8000) {
      if (this.ram6000) {
        super.write(address, value);
      }
      // ROM mapped at $6000: writes are ignored
      return;
    }
    switch (address & 0xe000) {
      case 0x8000:
        this.command = value & 0x0f;
        break;
      case 0xa000:
        this.runCommand(this.command, value);
        break;
    }
  }

  runCommand(command, value) {
    if (command < 8) {
      this.load1kVromBank(value, command * 0x400);
      return;
    }
    switch (command) {
      case 0x8:
        if ((value & 0x40) !== 0) {
          // RAM selected ($6000 region acts as work RAM)
          this.ram6000 = true;
        } else {
          this.ram6000 = false;
          this.load8kRomBank(value & 0x3f, 0x6000);
        }
        break;
      case 0x9:
      case 0xa:
      case 0xb:
        this.load8kRomBank(value & 0x3f, 0x8000 + (command - 0x9) * 0x2000);
        break;
      case 0xc:
        this.setMirroring(value & 3);
        break;
      case 0xd:
        this.irqEnabled = (value & 0x01) !== 0;
        this.irqCounterEnabled = (value & 0x80) !== 0;
        this.irqPending = false;
        break;
      case 0xe:
        this.irqCounter = (this.irqCounter & 0xff00) | (value & 0xff);
        break;
      case 0xf:
        this.irqCounter = ((value & 0xff) << 8) | (this.irqCounter & 0x00ff);
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

  clockCpuCycles(cycles) {
    if (this.irqCounterEnabled) {
      for (let i = 0; i < cycles; i++) {
        this.irqCounter = (this.irqCounter - 1) & 0xffff;
        if (this.irqCounter === 0xffff && this.irqEnabled) {
          this.irqPending = true;
        }
      }
    }
    if (this.irqPending && !this.nes.cpu.irqRequested) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("FME-7: Invalid ROM! Unable to load.");
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

  toJSON() {
    const s = super.toJSON();
    s.command = this.command;
    s.ram6000 = this.ram6000;
    s.irqEnabled = this.irqEnabled;
    s.irqCounterEnabled = this.irqCounterEnabled;
    s.irqCounter = this.irqCounter;
    s.irqPending = this.irqPending;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.command = s.command;
    this.ram6000 = s.ram6000;
    this.irqEnabled = s.irqEnabled;
    this.irqCounterEnabled = s.irqCounterEnabled;
    this.irqCounter = s.irqCounter;
    this.irqPending = s.irqPending;
  }
}

export default Mapper69;
