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

Each modified file carries a notice header at the top.
