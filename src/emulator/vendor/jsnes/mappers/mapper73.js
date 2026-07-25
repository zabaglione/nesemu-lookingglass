import Mapper0 from "./mapper0.js";

// Konami VRC3 (Salamander).
// 16 KB PRG switching plus a 16-bit (or 8-bit mode) CPU-cycle up-counter IRQ.
// See https://www.nesdev.org/wiki/VRC3
class Mapper73 extends Mapper0 {
  static mapperName = "VRC3";

  constructor(nes) {
    super(nes);
    this.cpuClockedIrq = true;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqEnabled = false;
    this.irqEnableAfterAck = false;
    this.irqMode8 = false;
    this.irqPending = false;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    const region = address & 0xf000;
    if (region >= 0x8000 && region <= 0xb000) {
      // Four nibble registers assemble the 16-bit IRQ latch.
      const shift = ((region >> 12) - 0x8) * 4;
      this.irqLatch =
        (this.irqLatch & ~(0x0f << shift)) | ((value & 0x0f) << shift);
      return;
    }
    switch (region) {
      case 0xc000:
        this.irqPending = false;
        this.irqEnableAfterAck = (value & 1) !== 0;
        this.irqEnabled = (value & 2) !== 0;
        this.irqMode8 = (value & 4) !== 0;
        if (this.irqEnabled) this.irqCounter = this.irqLatch;
        break;
      case 0xd000:
        this.irqPending = false;
        this.irqEnabled = this.irqEnableAfterAck;
        break;
      case 0xf000:
        this.loadRomBank(value & 0x07, 0x8000);
        break;
    }
  }

  clockCpuCycles(cycles) {
    if (this.irqEnabled) {
      for (let i = 0; i < cycles; i++) {
        if (this.irqMode8) {
          if ((this.irqCounter & 0xff) === 0xff) {
            this.irqCounter =
              (this.irqCounter & 0xff00) | (this.irqLatch & 0xff);
            this.irqPending = true;
          } else {
            this.irqCounter++;
          }
        } else if (this.irqCounter === 0xffff) {
          this.irqCounter = this.irqLatch;
          this.irqPending = true;
        } else {
          this.irqCounter++;
        }
      }
    }
    if (this.irqPending && !this.nes.cpu.irqRequested) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error("VRC3: Invalid ROM! Unable to load.");
    }
    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.irqLatch = this.irqLatch;
    s.irqCounter = this.irqCounter;
    s.irqEnabled = this.irqEnabled;
    s.irqEnableAfterAck = this.irqEnableAfterAck;
    s.irqMode8 = this.irqMode8;
    s.irqPending = this.irqPending;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.irqLatch = s.irqLatch;
    this.irqCounter = s.irqCounter;
    this.irqEnabled = s.irqEnabled;
    this.irqEnableAfterAck = s.irqEnableAfterAck;
    this.irqMode8 = s.irqMode8;
    this.irqPending = s.irqPending;
  }
}

export default Mapper73;
