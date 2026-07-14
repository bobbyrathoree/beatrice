// measure-latency.mjs — Phase 3 Task 1 loopback latency harness.
//
// Run: node scripts/measure-latency.mjs            (real acoustic loopback)
//      node scripts/measure-latency.mjs --synthetic (compute+messaging floor)
//
// The /jam-spike page runs the actual measurement in the browser (it must — the
// AudioWorklet + WASM + WebAudio clock all live there) and dumps results to
// window.__latencyResults. This script just launches Chromium against real
// devices, waits for the run to finish, and prints P50/P95.
//
// IMPORTANT: we do NOT pass --use-fake-device-for-media-stream — fake devices
// bypass real ADC/DAC latency and would make the acoustic number a lie. Real
// speakers + mic are required for loopback mode (documented in docs/latency.md).
// --use-fake-ui-for-media-stream only auto-ACCEPTS the permission prompt; it
// still uses the REAL default mic.
import { chromium } from "@playwright/test";

const synthetic = process.argv.includes("--synthetic");
const mode = synthetic ? "synthetic" : "loopback";
const url = `http://localhost:1420/jam-spike${synthetic ? "?mode=synthetic" : ""}`;

const browser = await chromium.launch({
  headless: false,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream", // auto-accept mic prompt; REAL device
  ],
});

const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
page.on("console", (m) => {
  if (m.text().includes("[jam-spike]")) console.log("  page:", m.text());
});

await page.goto(url);

let r;
try {
  await page.waitForFunction(() => window.__latencyResults?.done, {
    timeout: 120000,
  });
  r = await page.evaluate(() => window.__latencyResults);
} catch (e) {
  console.error(`\nHARNESS TIMEOUT (${mode}): the page never reported done.`);
  console.error("Likely mic permission blocked by macOS TCC, or no hits.");
  const partial = await page.evaluate(() => window.__latencyResults ?? null);
  console.error("partial:", JSON.stringify(partial));
  await browser.close();
  process.exit(2);
}

await browser.close();

const q = (a, p) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

const round = (x) => (Number.isNaN(x) ? "n/a" : x.toFixed(1));

console.log(`\n=== latency: ${mode} ===`);
console.log(`hits=${r.detectMs.length}/${r.reps}  misses=${r.misses}`);
console.log(`outputLatency=${round(r.outputLatencyMs)}ms baseLatency=${round(r.baseLatencyMs)}ms`);
if (r.error) console.log(`page error: ${r.error}`);
console.log(`detector:       P50=${round(q(r.detectMs, 0.5))}ms P95=${round(q(r.detectMs, 0.95))}ms`);
console.log(`mouth-to-sound: P50=${round(q(r.soundMs, 0.5))}ms P95=${round(q(r.soundMs, 0.95))}ms`);

// Machine-readable line for docs capture.
console.log(
  `JSON ${JSON.stringify({
    mode,
    hits: r.detectMs.length,
    misses: r.misses,
    detectP50: q(r.detectMs, 0.5),
    detectP95: q(r.detectMs, 0.95),
    soundP50: q(r.soundMs, 0.5),
    soundP95: q(r.soundMs, 0.95),
    outputLatencyMs: r.outputLatencyMs,
    baseLatencyMs: r.baseLatencyMs,
  })}`
);
