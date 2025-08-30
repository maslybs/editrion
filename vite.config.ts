import { defineConfig } from "vite";

export default defineConfig(() => ({
  // Use relative base so built assets work with Tauri's file/asset protocol
  base: "./",
  clearScreen: false,
  build: {
    // Silence non-fatal chunk size warnings from Monaco and language packs
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor')) return 'monaco';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
