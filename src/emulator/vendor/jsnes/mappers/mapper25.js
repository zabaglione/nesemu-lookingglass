import Mapper0 from "./mapper0.js";

// Konami VRC2c / VRC4b / VRC4d.
// Mapper 25 combines two VRC4 address-line layouts. NES 2.0 identifies the
// layout with a submapper; legacy iNES ROMs are detected from register writes.
// See https://www.nesdev.org/wiki/INES_Mapper_023
class Mapper25 extends Mapper0 {
  static mapperNumber = 25;
  static mapperName = "VRC2c/VRC4b/VRC4d";

  constructor(nes) {
    super(nes);

    this.cpuClockedIrq = true;
    const submapper = nes.rom.subMapper || 0;
    this.addressVariant =
      submapper === 1 || submapper === 3
        ? "b"
        : submapper === 2
          ? "d"
          : null;
    this.isVrc2 = submapper === 3;

    this.prgBank0 = 0;
    this.prgBank1 = 1;
    this.prgSwapMode = 0;
    // Legacy iNES files do not describe the board RAM accurately. Keeping it
    // enabled matches established mapper-25 compatibility behavior.
    this.wramEnabled = submapper === 0 || this.isVrc2;

    this.chrBanks = new Uint16Array(8);

    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqPrescaler = 341;
    this.irqEnabled = false;
    this.irqEnableAfterAck = false;
    this.irqCycleMode = false;
    this.irqPending = false;
  }

  load(address) {
    if (
      address >= 0x6000 &&
      address < 0x8000 &&
      !this.isVrc2 &&
      !this.wramEnabled
    ) {
      return this.nes.cpu.dataBus;
    }
    return super.load(address);
  }

  write(address, value) {
    if (address < 0x8000) {
      if (
        address >= 0x6000 &&
        !this.isVrc2 &&
        !this.wramEnabled
      ) {
        return;
      }
      super.write(address, value);
      return;
    }

    const region = address >> 12;
    const register = this.decodeRegister(address);

    switch (region) {
      case 0x8:
        this.prgBank0 = value & 0x1f;
        this.applyPrgBanks();
        break;

      case 0x9:
        if (register === 0) {
          this.setMirroring(value);
        } else if (register === 2 && !this.isVrc2) {
          this.prgSwapMode = (value >> 1) & 1;
          this.wramEnabled = (value & 1) !== 0;
          this.applyPrgBanks();
        }
        break;

      case 0xa:
        this.prgBank1 = value & 0x1f;
        this.load8kRomBank(this.prgBank1, 0xa000);
        break;

      case 0xb:
      case 0xc:
      case 0xd:
      case 0xe:
        this.writeChrRegister(region, register, value);
        break;

      case 0xf:
        if (!this.isVrc2) this.writeIrqRegister(register, value);
        break;
    }
  }

  decodeRegister(address) {
    if (this.addressVariant === null) {
      if ((address & 0x03) !== 0) {
        this.addressVariant = "b";
      } else if ((address & 0x0c) !== 0) {
        this.addressVariant = "d";
      }
    }

    if (this.addressVariant === "d") {
      return ((address >> 3) & 1) | (((address >> 2) & 1) << 1);
    }
    return ((address >> 1) & 1) | ((address & 1) << 1);
  }

  setMirroring(value) {
    const mode = this.isVrc2 ? value & 1 : value & 3;
    const mirroring = [
      this.nes.rom.VERTICAL_MIRRORING,
      this.nes.rom.HORIZONTAL_MIRRORING,
      this.nes.rom.SINGLESCREEN_MIRRORING,
      this.nes.rom.SINGLESCREEN_MIRRORING2,
    ][mode];
    this.nes.ppu.setMirroring(mirroring);
  }

  applyPrgBanks() {
    const lastBank = this.nes.rom.romCount * 2 - 1;
    const fixedBank = lastBank - 1;
    if (this.isVrc2 || this.prgSwapMode === 0) {
      this.load8kRomBank(this.prgBank0, 0x8000);
      this.load8kRomBank(fixedBank, 0xc000);
    } else {
      this.load8kRomBank(fixedBank, 0x8000);
      this.load8kRomBank(this.prgBank0, 0xc000);
    }
  }

  writeChrRegister(region, register, value) {
    const bankIndex = (region - 0xb) * 2 + (register >> 1);
    if ((register & 1) === 0) {
      this.chrBanks[bankIndex] =
        (this.chrBanks[bankIndex] & 0x1f0) | (value & 0x0f);
    } else {
      const highMask = this.isVrc2 ? 0x0f : 0x1f;
      this.chrBanks[bankIndex] =
        ((value & highMask) << 4) | (this.chrBanks[bankIndex] & 0x0f);
    }
    this.load1kVromBank(this.chrBanks[bankIndex], bankIndex * 0x400);
  }

  writeIrqRegister(register, value) {
    switch (register) {
      case 0:
        this.irqLatch = (this.irqLatch & 0xf0) | (value & 0x0f);
        break;

      case 1:
        this.irqLatch = ((value & 0x0f) << 4) | (this.irqLatch & 0x0f);
        break;

      case 2:
        this.irqPending = false;
        this.irqEnableAfterAck = (value & 1) !== 0;
        this.irqEnabled = (value & 2) !== 0;
        this.irqCycleMode = (value & 4) !== 0;
        this.irqPrescaler = 341;
        if (this.irqEnabled) this.irqCounter = this.irqLatch;
        break;

      case 3:
        this.irqPending = false;
        this.irqEnabled = this.irqEnableAfterAck;
        break;
    }
  }

  clockCpuCycles(cycles) {
    if (this.isVrc2 || !this.irqEnabled) return;

    for (let i = 0; i < cycles; i++) {
      if (this.irqCycleMode) {
        this.clockVrcIrqCounter();
      } else {
        this.irqPrescaler -= 3;
        if (this.irqPrescaler <= 0) {
          this.irqPrescaler += 341;
          this.clockVrcIrqCounter();
        }
      }
    }

    // The VRC IRQ output remains asserted until acknowledged. Reasserting the
    // request preserves that level behavior if the CPU temporarily masks IRQs.
    if (this.irqPending && !this.nes.cpu.irqRequested) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }
  }

  clockVrcIrqCounter() {
    if (this.irqCounter === 0xff) {
      this.irqCounter = this.irqLatch;
      this.irqPending = true;
    } else {
      this.irqCounter = (this.irqCounter + 1) & 0xff;
    }
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 2) {
      throw new Error(`Mapper ${this.constructor.mapperNumber}: Invalid ROM.`);
    }

    const lastBank = this.nes.rom.romCount * 2 - 1;
    this.applyPrgBanks();
    this.load8kRomBank(this.prgBank1, 0xa000);
    this.load8kRomBank(lastBank, 0xe000);
    this.loadCHRROM();
    this.loadBatteryRam();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const s = super.toJSON();
    s.addressVariant = this.addressVariant;
    s.isVrc2 = this.isVrc2;
    s.prgBank0 = this.prgBank0;
    s.prgBank1 = this.prgBank1;
    s.prgSwapMode = this.prgSwapMode;
    s.wramEnabled = this.wramEnabled;
    s.chrBanks = Array.from(this.chrBanks);
    s.irqLatch = this.irqLatch;
    s.irqCounter = this.irqCounter;
    s.irqPrescaler = this.irqPrescaler;
    s.irqEnabled = this.irqEnabled;
    s.irqEnableAfterAck = this.irqEnableAfterAck;
    s.irqCycleMode = this.irqCycleMode;
    s.irqPending = this.irqPending;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.addressVariant = s.addressVariant;
    this.isVrc2 = s.isVrc2;
    this.prgBank0 = s.prgBank0;
    this.prgBank1 = s.prgBank1;
    this.prgSwapMode = s.prgSwapMode;
    this.wramEnabled = s.wramEnabled;
    this.chrBanks.set(s.chrBanks);
    this.irqLatch = s.irqLatch;
    this.irqCounter = s.irqCounter;
    this.irqPrescaler = s.irqPrescaler;
    this.irqEnabled = s.irqEnabled;
    this.irqEnableAfterAck = s.irqEnableAfterAck;
    this.irqCycleMode = s.irqCycleMode;
    this.irqPending = s.irqPending;
  }
}

export default Mapper25;
