import { test, expect } from "@playwright/test";

// Phase 3 Task 4 — VISUAL JAM ([GATE-FAIL]) e2e.
//
// Drives the real AudioWorklet + WASM StreamingDetector against Chromium's fake
// microphone (fed test-audio/test-pattern.wav via the launch flags in
// playwright.config.ts). Asserts:
//   1. live events flash (cumulative jam-event-count >= 3), proving mouth ->
//      worklet -> UI works end-to-end, and
//   2. CAPTURE records the mic, runs createProject -> the EXISTING offline
//      pipeline, and lands on the results screen (PLAY button visible).
//
// The worklet only completes its WASM handshake in a production build, so this
// spec runs against `vite preview` (see playwright.config.ts). If the fake-audio
// loop ever stops triggering the detector under headless Chromium, run this spec
// headed locally (`npx playwright test e2e/jam.spec.ts --headed`) and record the
// evidence in the report rather than shipping a flaky green — see the report.
test("jam mode: live event flashes + CAPTURE lands on results", async ({ page }) => {
  await page.goto("http://localhost:1420");

  // Enter jam mode from the input screen.
  await page.getByTestId("jam-mode-button").click();
  await expect(page.getByTestId("jam-screen")).toBeVisible();

  // Start the session (mic -> worklet). The worklet must reach "ready" and the
  // fake audio must produce detected onsets.
  await page.getByTestId("jam-start").click();

  // Cumulative event count climbs as the fake audio loops. Generous timeout:
  // WASM compile at session start + acoustic buffering + loop period.
  await expect
    .poll(
      async () => {
        const txt = await page.getByTestId("jam-event-count").textContent();
        return Number(txt ?? "0");
      },
      { timeout: 30_000, intervals: [500] }
    )
    .toBeGreaterThanOrEqual(3);

  // CAPTURE: encode last-N-seconds WAV -> createProject -> offline pipeline.
  await page.getByTestId("jam-capture").click();

  // Lands on the results screen exactly like an upload would.
  await expect(page.getByRole("button", { name: /PLAY/ })).toBeVisible({
    timeout: 20_000,
  });
});
