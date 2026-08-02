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

// A normal laptop viewport. (This used to be 1000x3000 to work around a layout
// bug where results content above the scroll origin was unreachable; that bug is
// fixed — see the .results-scroll region in brutalist.css — so the recording now
// uses a realistic window and scrolls like a user would.)
const WIDTH = 1280;
const HEIGHT = 800;

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

/** Scroll the results region so `label` sits near the top of the frame. Works on
 *  `.results-scroll` (the dedicated scroll region) and reads as a camera move. */
const frame = async (label) => {
  await page.evaluate((l) => {
    const scroller = document.querySelector(".results-scroll") ?? document.querySelector("main");
    const node = document.evaluate(
      `//*[contains(text(),'${l}')]`,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    if (!scroller || !node) return;
    const delta =
      node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
    scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
  }, label);
  await page.waitForTimeout(800); // let the smooth scroll settle
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

// The waveform is the first thing on the results screen now, so it's already in
// frame — verify rather than assume.
await assertInFrame("B-SOUNDS");

// Pan down through the story: detected events → the generated arrangement.
await step("frame the event timeline", () => frame("EVENT TIMELINE"), BEAT.read);
await step("frame the arrangement", () => frame("SONG ARRANGEMENT"), BEAT.read);
await assertInFrame("SONG ARRANGEMENT");

// Theme switches. Re-frame the arrangement after each click so the lanes stay in
// shot and the viewer sees the notes re-voice — the claim the theme system makes.
for (const theme of ["STRANGER THINGS", "TWIN PEAKS", "BLADE RUNNER"]) {
  await step(`theme → ${theme}`, async () => {
    await page.getByText(theme, { exact: false }).first().click();
    await page
      .locator(`[data-arrangement-theme="${theme}"]`)
      .waitFor({ timeout: 15000 });
    await frame("SONG ARRANGEMENT");
  }, BEAT.read);
}

// Play: the transport is pinned above the scroll region, so the playhead sweep
// and the Song Mode HUD stepping INTRO → BUILD → DROP stay visible wherever the
// scroll happens to be.
await step("play", async () => {
  await frame("EVENT TIMELINE");
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
