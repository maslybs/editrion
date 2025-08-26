import { defineConfig } from "vite";

export default defineConfig(() => ({
  // Use relative base so built assets work with Tauri's file/asset protocol
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
