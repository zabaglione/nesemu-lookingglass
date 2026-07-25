import Mapper33 from "./mapper33.js";

// Taito TC0690 (Don Doko Don 2, Flintstones, Jetsons).
// TC0190 plus an MMC3-style scanline IRQ (with inverted latch) and the
// mirroring bit moved to $E000.
// See https://www.nesdev.org/wiki/INES_Mapper_048
class Mapper48 extends Mapper33 {
  static mapperName = "Taito TC0690";

  constructor(nes) {
    super(nes);
    this.hasMirroringInPrgReg = false;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqEnabled = false;
  }

  writeUpperRegister(address, value) {
    switch (address & 0xe003) {
      case 0xc000:
        // The TC0690 latch is the complement of the written value.
        this.irqLatch = (value ^ 0xff) & 0xff;
        break;
      case 0xc001:
        this.irqCounter = this.irqLatch;
        break;
      case 0xc002:
        this.irqEnabled = true;
        break;
      case 0xc003:
        this.irqEnabled = false;
        break;
      case 0xe000:
        this.setMirroringBit((value >> 6) & 1);
        break;
    }
  }

  clockIrqCounter() {
    this.irqCounter--;
    if (this.irqCounter < 0) {
      if (this.irqEnabled) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
      this.irqCounter = this.irqLatch;
    }
  }

  toJSON() {
    const s = super.toJSON();
    s.irqLatch = this.irqLatch;
    s.irqCounter = this.irqCounter;
    s.irqEnabled = this.irqEnabled;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.irqLatch = s.irqLatch;
    this.irqCounter = s.irqCounter;
    this.irqEnabled = s.irqEnabled;
  }
}

export default Mapper48;
