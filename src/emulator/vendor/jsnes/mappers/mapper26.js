import Mapper24 from "./mapper24.js";

// Konami VRC6b (Madara, Esper Dream 2). VRC6 with A0/A1 swapped.
// See https://www.nesdev.org/wiki/VRC6
class Mapper26 extends Mapper24 {
  static mapperName = "VRC6b";

  registerIndex(address) {
    return ((address & 1) << 1) | ((address >> 1) & 1);
  }
}

export default Mapper26;
