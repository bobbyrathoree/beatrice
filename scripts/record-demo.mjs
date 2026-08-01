// record-demo.mjs — record the demo flow as a video, for the README GIF.
//
// Drives the SAME browser-mock demo the hosted site runs (TRY DEMO → results →
// theme switch → play), captures video via Playwright, and prints the .webm path.
// Convert to GIF with scripts/make-demo-gif.sh.
//
// Usage:
//   npm run build && npm run preview &        # serve at :1420
//   node scripts/record-demo.mjs
//
// The pacing below is deliberate: this is a piece of documentation, so each step
// pauses long enough for a viewer to register what happened before the next one.
import { chromium } from "@playwright/test";
import { mkdirSync, rmSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const URL = process.env.DEMO_URL ?? "http://localhost:1420";
const OUT_DIR = "docs/demo-recording";

// Deliberately TALL viewport. The results screen centres its content in a fixed
// flex column, so at laptop heights the waveform and arrangement lanes render
// ABOVE the visible area and no amount of scrolling reaches them (scrollIntoView
// and container scrollTop both no-op — measured). Recording tall puts the whole
// story on screen at once, which also means the GIF needs no scrolling: a still
// camera reads far better than a panning one at 12fps. make-demo-gif.sh crops to
// the interesting band.
const WIDTH = 1000; // app column occupies ~100..900 at this width
const HEIGHT = 3000;

// Beat pauses (ms). Tuned so the GIF reads as a story, not a seizure.
const BEAT = { settle: 900, read: 1600, play: 5200 };

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  recordVideo: { dir: OUT_DIR, size: { width: WIDTH, height: HEIGHT } },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const step = async (label, fn, pause = BEAT.settle) => {
  process.stdout.write(`· ${label}\n`);
  await fn();
  await page.waitForTimeout(pause);
};

/** Assert an element is actually visible in frame — a silently-clipped GIF is
 *  worse than no GIF, so fail loudly rather than ship an empty recording. */
const assertInFrame = async (label) => {
  const top = await page.evaluate((l) => {
    const n = document.evaluate(
      `//*[contains(text(),'${l}')]`,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    return n ? n.getBoundingClientRect().top : null;
  }, label);
  if (top === null || top < 0 || top > HEIGHT) {
    throw new Error(
      `"${label}" is not in frame (top=${top}); the layout changed — adjust WIDTH/HEIGHT.`,
    );
  }
  process.stdout.write(`  ✓ ${label} in frame at y=${Math.round(top)}\n`);
};

await step("open", async () => {
  await page.goto(URL);
  await page.waitForLoadState("networkidle");
}, 700); // brief: the empty landing screen is the least interesting frame

await step("try demo → pipeline runs", async () => {
  await page.getByRole("button", { name: /TRY DEMO/ }).click();
  await page.getByRole("button", { name: /PLAY/ }).waitFor({ timeout: 20000 });
}, BEAT.read);

// Everything below must be on screen simultaneously — verify, don't assume.
await assertInFrame("EVENT TIMELINE");
await assertInFrame("SONG ARRANGEMENT");
await assertInFrame("TWIN PEAKS");

// Theme switches, with the arrangement lanes in shot the whole time so the
// viewer sees the notes re-voice — that's the claim the theme system makes.
for (const theme of ["STRANGER THINGS", "TWIN PEAKS", "BLADE RUNNER"]) {
  await step(`theme → ${theme}`, async () => {
    await page.getByText(theme, { exact: false }).first().click();
    await page
      .locator(`[data-arrangement-theme="${theme}"]`)
      .waitFor({ timeout: 15000 });
  }, BEAT.read);
}

// Play: the playhead sweeps the transport and the Song Mode HUD steps through
// INTRO → BUILD → DROP.
await step("play", async () => {
  await page.getByRole("button", { name: /PLAY/ }).click();
}, BEAT.play);

// Close the context so Playwright finalizes the video file, then give it a
// stable name (Playwright names videos by an internal hash).
await context.close();
await browser.close();

const video = readdirSync(OUT_DIR).find((f) => f.endsWith(".webm"));
if (!video) {
  console.error("no video produced");
  process.exit(1);
}
const finalPath = join(OUT_DIR, "demo.webm");
renameSync(join(OUT_DIR, video), finalPath);
console.log(`\nrecorded ${finalPath}`);
