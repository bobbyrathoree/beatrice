import { defineConfig } from "@playwright/test";
import path from "path";

// The jam e2e drives a real AudioWorklet + WASM detector, which only completes
// its handshake in a PRODUCTION build (the Vite dev server serves the worklet
// unbundled and never reaches "ready" — see docs/latency.md). So we serve the
// built app via `vite preview` for ALL specs. The smoke specs use the browser
// mock (aliased in non-Tauri builds) and run fine against the preview server.
//
// The jam spec needs a fake microphone: Chromium's fake device fed from a real
// PCM WAV file. These flags are harmless to the smoke specs (which never touch
// the mic). `--use-fake-ui-for-media-stream` auto-accepts the permission prompt.
// Playwright loads this config from the repo root, so cwd is the project dir.
const FAKE_AUDIO = path.resolve(process.cwd(), "test-audio/test-pattern.wav");

export default defineConfig({
  testDir: "e2e",
  // The production build can take a while on a cold cache; give specs headroom.
  timeout: 60_000,
  use: {
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${FAKE_AUDIO}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    permissions: ["microphone"],
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
