# Vendored jsnes (modified)

このディレクトリは [jsnes](https://github.com/bfirsh/jsnes) v2.1.0
(Copyright 2020 Ben Firshman, [Apache License 2.0](./LICENSE)) のソースを
取り込んだものです。

This directory contains a vendored copy of jsnes v2.1.0
(Copyright 2020 Ben Firshman), licensed under the Apache License 2.0
(see [LICENSE](./LICENSE) in this directory).

## Modifications (Apache License 2.0, Section 4b notice)

The following changes were made for the nesemu-lookingglass project (2026).
Emulation behaviour is unchanged; the additions are write-only side outputs
used to render NES layers at different depths on a Looking Glass display:

- `ppu/index.js` — added `sprFrontBuffer`, `sprBehindBuffer`,
  `layerBackdropColor` and the `LAYER_NONE` sentinel; sprite rendering now
  mirrors pixels into a per-priority layer buffer.
- `tile.js` — `render()` accepts an optional `layerBuffer` argument and
  mirrors composite writes into it.
- `index.js` — the `browser/` helper directory is not vendored; the entry
  point exports only the emulator core.
- `*.d.ts` files are not vendored.
- `mappers/` — the following mappers were ADDED for this project (not in
  upstream jsnes v2.1.0): 10 (MMC4), 16/153/159 (Bandai FCG),
  18 (Jaleco SS88006), 19/210 (Namco 163/175/340), 21/22/23/24/25/26/73/75/85
  (Konami VRC1-7), 32/65/78/97 (Irem), 33/48/80 (Taito), 67/68/69/89/93/184
  (Sunsoft), 70/152 (Bandai 74*161), 72/86/87/92 (Jaleco discrete),
  76/88/95/154/206 (Namco 108 family). Known limitations are noted in each
  file header (no expansion audio for VRC6/VRC7/N163/FME-7, EEPROM saves
  stubbed for Bandai boards, Sunsoft-4 ROM nametables approximated).

Each modified file carries a notice header at the top.
