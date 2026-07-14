// demo-walk.mjs — end-to-end demo walk of the jam flow against the production
// preview (vite preview on :1420). Not a committed test; a Task 6 walk harness.
// Fake mic feeds test-audio/test-pattern.wav so the WASM detector fires.
import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--use-file-for-fake-audio-capture=test-audio/test-pattern.wav",
  ],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

const log = (s) => console.log("WALK:", s);

try {
  await page.goto("http://localhost:1420");
  log("loaded input screen");

  // --- Enter jam mode ---
  await page.getByTestId("jam-mode-button").click();
  await page.getByTestId("jam-screen").waitFor({ state: "visible" });
  log("entered jam screen; visual-note present: " +
    (await page.getByTestId("jam-visual-note").isVisible()));

  // --- START ---
  await page.getByTestId("jam-start").click();
  log("started jam session (mic -> worklet)");

  // --- Wait for live events (proves real WASM detector fires) ---
  const t0 = Date.now();
  let count = 0;
  while (Date.now() - t0 < 30000) {
    const txt = await page.getByTestId("jam-event-count").textContent();
    count = Number(txt ?? "0");
    if (count >= 3) break;
    await page.waitForTimeout(400);
  }
  const flashes = await page.getByTestId("jam-flash").count();
  log(`live events: count=${count} flash-tiles=${flashes}`);

  // --- TEACH panel opens (calibration reachable) ---
  await page.getByTestId("jam-teach").click();
  const teachVisible = await page
    .getByTestId("calibration-panel")
    .isVisible()
    .catch(() => false);
  log("TEACH panel toggled; calibration-panel visible=" + teachVisible);
  // close it again so it doesn't cover CAPTURE
  await page.getByTestId("jam-teach").click().catch(() => {});

  // --- CAPTURE -> offline pipeline -> results ---
  await page.getByTestId("jam-capture").click();
  await page
    .getByRole("button", { name: /PLAY/ })
    .waitFor({ state: "visible", timeout: 20000 });
  log("CAPTURE succeeded -> reached results screen (PLAY visible)");

  // --- EXPORT MIDI: browser demo now uses a Blob download fallback ---
  const midiBtn = page.getByRole("button", { name: /EXPORT MIDI/ });
  const midiExists = await midiBtn.count();
  log("EXPORT MIDI button present: " + (midiExists > 0));
  if (midiExists > 0) {
    const errsBefore = consoleErrors.length;
    const dlPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    await midiBtn.click().catch((e) => log("midi click threw: " + e.message));
    const download = await dlPromise;
    if (download) {
      const path = await download.path();
      const { readFileSync } = await import("fs");
      const buf = readFileSync(path);
      const magic = buf.toString("ascii", 0, 4);
      log(`MIDI downloaded: name="${download.suggestedFilename()}" bytes=${buf.length} magic=${magic}`);
    } else {
      log("NO MIDI download event fired");
    }
    await page.waitForTimeout(500);
    const btnText = await midiBtn.textContent().catch(() => "?");
    log(`after EXPORT MIDI click: button text="${btnText?.trim()}" newConsoleErrors=${consoleErrors.length - errsBefore}`);
  }

  log("console errors total: " + consoleErrors.length);
  if (consoleErrors.length) {
    consoleErrors.slice(0, 10).forEach((e) => console.log("  ERR:", e.slice(0, 200)));
  }
  log("DONE");
} catch (e) {
  console.error("WALK FAILED:", e.message);
  console.error("console errors:", consoleErrors.slice(0, 10));
  process.exitCode = 1;
} finally {
  await browser.close();
}
