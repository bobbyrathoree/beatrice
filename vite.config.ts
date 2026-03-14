import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// When running under Tauri (`tauri dev`), TAURI_ENV_PLATFORM is set.
// Only alias the Tauri API to the mock when running in browser-only mode.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: isTauri
      ? {}
      : {
          "@tauri-apps/api/core": path.resolve(
            __dirname,
            "./src/utils/tauri-mock.ts"
          ),
        },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
