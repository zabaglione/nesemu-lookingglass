import { defineConfig } from "vite";

// GitHub Pages (project pages) ではサブパス配下で配信されるため、
// 相対パスでアセットを解決させる。
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@lookingglass")) {
            return "lookingglass";
          }
          if (id.includes("node_modules/three")) {
            return "three";
          }
        },
      },
    },
  },
});
