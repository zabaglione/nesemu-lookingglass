# NES × Looking Glass — 立体視ファミコンエミュレーター

Looking Glass(ライトフィールドディスプレイ)向けのNES/ファミコンエミュレーターWebアプリです。
NES PPUのレイヤー構造を奥行き方向に分離し、ゲーム画面が立体的に浮き出て見えます。

- **レイヤー立体視(3DSen風ジオラマ近似)** — 奥から「背景色 → 背面スプライト →
  背景タイル → 前面スプライト」をZ方向に配置(NES PPUの合成順そのまま)。
  前面スプライトはさらに画面Y座標で8段の深度に分かれ、画面の下にいるキャラほど
  手前に浮き出る。各レイヤーはボクセル風の「厚み」を持つ。
  層間距離・スプライト奥行き・厚みはスライダーで調整可能
- **自由視点** — マウスでシーン全体を回転・拡大縮小・移動
- **Looking Glass対応** — [Looking Glass WebXR Library](https://github.com/Looking-Glass/looking-glass-webxr)
  によるquilt描画。Portrait / Go / 16" / 27" / 32" など(キャリブレーションはBridge経由で自動)
- **完全クライアントサイド** — ROMイメージはブラウザ内でのみ読み込まれ、
  サーバーには一切送信・保存されません
- **内蔵デモROM** — 動作確認用のデモROM(オリジナル、6502コードをブラウザ内で生成)を同梱

## 必要環境

| 項目 | 要件 |
|---|---|
| ブラウザ | Chromium系(Chrome / Edge)推奨。Safariは非対応 |
| Looking Glass表示 | [Looking Glass Bridge](https://lookingglassfactory.com/software/looking-glass-bridge) がインストール・起動済みであること |
| 通常表示 | Looking Glassがなくても普通のモニターで3D表示できます |

## 使い方

1. ページを開き、**「ROMを開く…」** で手元のiNES形式(.nes)ファイルを選択
   (ウィンドウへのドラッグ&ドロップも可)。まずは **「内蔵デモ」** でも動作確認できます
2. **「Looking Glassで表示」** を押すと表示用ウィンドウが開くので、
   Looking Glass側のディスプレイへ移動してダブルクリックで全画面化
3. **層間距離**(レイヤー間の奥行き)、**SPR奥行き**(スプライトのジオラマ効果)、
   **厚み**(各レイヤーの押し出し)の各スライダーで立体感を調整

### 操作

| 入力 | 動作 |
|---|---|
| ゲームパッド | 十字キー/左スティック=移動、右側ボタン=A、左側ボタン=B、Start/Select |
| キーボード | 矢印キー、`X`=A、`Z`=B、`Enter`=Start、`Shift`=Select |
| 左ドラッグ | シーン回転 |
| ホイール | 拡大縮小 |
| 右ドラッグ / Shift+ドラッグ | 移動 |
| ダブルクリック | 視点リセット |

対応マッパーはjsnes準拠(NROM / MMC1 / UNROM / CNROM / MMC3 / MMC5 ほか)。

## 開発

```bash
npm install
npm run dev     # 開発サーバー
npm run build   # 型チェック + 本番ビルド (dist/)
```

`main` ブランチへのpushでGitHub Actionsがビルドし、GitHub Pagesへデプロイします
(リポジトリ設定でPagesのソースを「GitHub Actions」にしてください)。

## 仕組み

エミュレーションコアには [jsnes](https://github.com/bfirsh/jsnes) v2.1.0を
`src/emulator/vendor/jsnes/` に取り込み、PPUの合成処理に「背景タイル/
背面スプライト/前面スプライト」を別バッファへ複製出力する改造を加えています
(エミュレーション動作自体は無改変)。各レイヤーは毎フレーム
`THREE.DataTexture` としてthree.jsのプレーンに転送され、WebXR経由で
Looking Glassのquiltレンダリングに乗ります。

## 注意事項

- ROMイメージは**ご自身が権利を有するもの**のみお使いください
- 本プロジェクトは任天堂およびLooking Glass Factoryとは無関係の
  非公式ソフトウェアです

## ライセンス

本プロジェクトのコードは [MIT License](LICENSE) です。
取り込んでいるjsnes(Apache-2.0、改変あり)ほかサードパーティの表記は
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を参照してください。
