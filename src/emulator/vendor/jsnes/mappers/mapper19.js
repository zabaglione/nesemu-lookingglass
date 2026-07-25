import Mapper210 from "./mapper210.js";

// Namco 129/163 (Sangokushi II, Famista series, Rolling Thunder,
// Splatterhouse: Wanpaku Graffiti...).
// Adds a 15-bit CPU-cycle up-counter IRQ and flexible nametable selection on
// top of the 175/340 banking. Nametable selection is approximated by
// deriving a standard mirroring mode from the four page registers (CHR-ROM
// nametables are not supported). Expansion audio is not emulated.
// See https://www.nesdev.org/wiki/INES_Mapper_019
class Mapper19 extends Mapper210 {
  static mapperName = "Namco 163";

  constructor(nes) {
    super(nes);
    this.cpuClockedIrq = true;
    this.is340 = false;
    this.irqCounter = 0;
    this.irqEnabled = false;
    this.irqPending = false;
    this.ntPages = [0, 1, 0, 1];
  }

  load(address) {
    address &= 0xffff;
    if (address >= 0x4800 && address < 0x5000) {
      // Expansion audio data port (not emulated)
      return 0;
    }
    if (address >= 0x5000 && address < 0x5800) {
      return this.irqCounter & 0xff;
    }
    if (address >= 0x5800 && address < 0x6000) {
      return ((this.irqCounter >> 8) & 0x7f) | (this.irqEnabled ? 0x80 : 0);
    }
    return super.load(address);
  }

  write(address, value) {
    address &= 0xffff;
    if (address >= 0x4800 && address < 0x5000) {
      // Expansion audio data port (ignored)
      return;
    }
    if (address >= 0x5000 && address < 0x5800) {
      this.irqCounter = (this.irqCounter & 0x7f00) | (value & 0xff);
      this.irqPending = false;
      return;
    }
    if (address >= 0x5800 && address < 0x6000) {
      this.irqCounter = ((value & 0x7f) << 8) | (this.irqCounter & 0x00ff);
      this.irqEnabled = (value & 0x80) !== 0;
      this.irqPending = false;
      return;
    }
    super.write(address, value);
  }

  writeChrRegister(slot, value) {
    if (value >= 0xe0) {
      // CIRAM used as pattern data (not supported; keep previous bank)
      return;
    }
    this.load1kVromBank(value, slot * 0x400);
  }

  writeNametableRegister(slot, value) {
    this.ntPages[slot] = value & 1;
    const [a, b, c, d] = this.ntPages;
    let mirroring;
    if (a === b && b === c && c === d) {
      mirroring =
        a === 0
          ? this.nes.rom.SINGLESCREEN_MIRRORING
          : this.nes.rom.SINGLESCREEN_MIRRORING2;
    } else if (a === c && b === d) {
      mirroring = this.nes.rom.VERTICAL_MIRRORING;
    } else {
      mirroring = this.nes.rom.HORIZONTAL_MIRRORING;
    }
    this.nes.ppu.setMirroring(mirroring);
  }

  clockCpuCycles(cycles) {
    if (this.irqEnabled) {
      for (let i = 0; i < cycles; i++) {
        if (this.irqCounter < 0x7fff) {
          this.irqCounter++;
          if (this.irqCounter === 0x7fff) {
            this.irqPending = true;
            break;
          }
        }
      }
    }
    if (this.irqPending && !this.nes.cpu.irqRequested) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }
  }

  toJSON() {
    const s = super.toJSON();
    s.irqCounter = this.irqCounter;
    s.irqEnabled = this.irqEnabled;
    s.irqPending = this.irqPending;
    s.ntPages = this.ntPages.slice();
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.irqCounter = s.irqCounter;
    this.irqEnabled = s.irqEnabled;
    this.irqPending = s.irqPending;
    this.ntPages = s.ntPages.slice();
  }
}

export default Mapper19;
