import { defineConfig } from "vite";

// GitHub Pages (project pages) ではサブパス配下で配信されるため、
// 相対パスでアセットを解決させる。
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
  },
});
