# Third-Party Notices

このプロジェクトは以下のサードパーティ製ソフトウェアを利用しています。
ビルド成果物(GitHub Pagesで配信されるバンドル)にはこれらが含まれます。

## jsnes (vendored, modified)

- Source: https://github.com/bfirsh/jsnes (v2.1.0)
- Copyright 2020 Ben Firshman
- License: Apache License 2.0
- 本リポジトリの `src/emulator/vendor/jsnes/` に取り込み、レイヤー分離出力の
  ための改変を加えています。改変内容は
  [`src/emulator/vendor/jsnes/README.md`](src/emulator/vendor/jsnes/README.md)
  および各改変ファイル先頭の告知を参照してください。
  ライセンス全文は
  [`src/emulator/vendor/jsnes/LICENSE`](src/emulator/vendor/jsnes/LICENSE)。

## three.js

- Source: https://github.com/mrdoob/three.js
- Copyright 2010-2026 three.js authors
- License: MIT

## @lookingglass/webxr (Looking Glass WebXR Library)

- Source: https://github.com/Looking-Glass/looking-glass-webxr
- Copyright 2021 Google LLC / Looking Glass Factory
- License: Apache License 2.0
- 依存パッケージ `@lookingglass/webxr-polyfill`(Apache-2.0ベースの
  WebXR Polyfillフォーク)を含みます。

## @huggingface/transformers (Transformers.js)

- Source: https://github.com/huggingface/transformers.js
- Copyright Hugging Face
- License: Apache License 2.0
- AI深度モードの推論ランタイムとして使用(onnxruntime-webを含む)。

## Depth Anything V2 (small) — 学習済みモデル

- Source: https://huggingface.co/onnx-community/depth-anything-v2-small
  (original: https://github.com/DepthAnything/Depth-Anything-V2)
- License: Apache License 2.0(smallモデル)
- AI深度モード選択時にHugging Face Hubから実行時ダウンロードされます
  (リポジトリには含まれません)。

各ライセンスの全文は `node_modules` 内の各パッケージ、または上記の
ソースリポジトリを参照してください。
