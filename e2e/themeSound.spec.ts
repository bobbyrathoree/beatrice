import { test, expect, type Page } from "@playwright/test";
import type { TestInfo } from "@playwright/test";
import fs from "fs";
import { wavToMono, bandProportions, l1Sum } from "../src/audio/audioFeatures";

// Task 5 — prove that switching themes in the LIVE demo changes the audio that
// is actually EXPORTED (notes + template + timbre together), with a same-theme
// determinism control proving the pipeline is stable for a fixed theme selection.
//
// The demo runs the mock backend: the fabricated event generator is seeded
// (mulberry32, constant) and WAV synthesis is code-deterministic (OfflineAudioContext,
// no Date.now/Math.random in the render path), so the SAME theme-selection
// sequence yields the SAME arrangement. The control below asserts the two fixed-
// theme exports match within a ±1-LSB floor (Chromium's ConvolverNode is not
// bit-reproducible across renders — see the DIAGNOSIS comment). Timbre ISOLATION
// (same notes, different sound) is owned by the offline vitest suite; here we only
// assert the UI wiring produces materially different audio across themes.

const SAMPLE_RATE = 44100;

async function exportWav(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<Uint8Array> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    // Button text/enabled-state cycles (EXPORTING… → EXPORTED! → idle), so target
    // the stable testid; Playwright auto-waits for it to be enabled again.
    page.getByTestId("export-wav").click(),
  ]);
  const p = testInfo.outputPath(`${label}.wav`);
  await download.saveAs(p);
  return new Uint8Array(fs.readFileSync(p));
}

async function selectThemeAndSettle(page: Page, name: string) {
  await page.getByText(name, { exact: false }).first().click();
  // Deterministic settle signal: the arrangement card exposes the CANONICAL
  // resolved theme_name from the arrangement object (post-debounced-re-arrange),
  // so we wait for the re-arrange to actually land instead of sleeping.
  await expect(
    page.locator(`[data-arrangement-theme="${name}"]`),
  ).toBeVisible({ timeout: 10000 });
}

test("theme switch changes the exported audio (notes, template, and timbre together)", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: /TRY DEMO/ }).click();
  await expect(page.getByRole("button", { name: /PLAY/ })).toBeVisible({
    timeout: 15000,
  });

  // EXPLICIT selections only — the initial auto-selected arrangement may have
  // been arranged before ThemeSelector mounted (template fallback race), so A1
  // is captured after an explicit ST->BR round trip, guaranteeing both BR exports
  // come from identically-produced arrangements.
  await selectThemeAndSettle(page, "STRANGER THINGS");
  const wavB = await exportWav(page, testInfo, "stranger-things");

  await selectThemeAndSettle(page, "BLADE RUNNER");
  const wavA1 = await exportWav(page, testInfo, "blade-runner-1");

  await selectThemeAndSettle(page, "STRANGER THINGS");
  await selectThemeAndSettle(page, "BLADE RUNNER");
  const wavA2 = await exportWav(page, testInfo, "blade-runner-2");

  // ── Same-theme determinism control ───────────────────────────────────────
  // Intent: prove the demo PIPELINE is deterministic — the two BLADE RUNNER
  // exports (each captured after an identical ST->BR transition) must come from
  // the SAME arrangement (same seeded events, same notes, same bpm, same length),
  // so any pipeline non-determinism (double-arrange dropping/moving a note,
  // unseeded event path, bpm drift) is caught here and loudly.
  //
  // DIAGNOSIS (see task-5-report.md): strict `Buffer.compare === 0` is NOT
  // satisfiable in Chromium and is NOT a pipeline bug. Two exports of the byte-
  // identical arrangement object — captured with NO theme switch and NO
  // re-arrange between them — still differ by exactly ±1 LSB on a run-dependent
  // fraction of samples, clustered in the reverb-tail windows. Root cause: BLADE RUNNER's
  // GatedReverb uses a ConvolverNode, and Chromium renders convolution via
  // partitioned FFT on background threads that are not bit-reproducible across
  // OfflineAudioContext renders. The synthesis code itself IS byte-deterministic:
  // the offline `render_is_deterministic` vitest renders this exact GatedReverb
  // profile twice under node-web-audio-api and asserts full byte-equality (green).
  //
  // So this control asserts the tightest bound the platform permits without
  // masking a real bug: identical length + every sample within ±1 LSB. A genuine
  // pipeline non-determinism (moved/dropped note, bpm drift, unseeded events)
  // changes the length OR shifts whole synth voices, both of which blow past a
  // 1-LSB magnitude ceiling by orders of magnitude and still fail here. The COUNT
  // of jittered samples is NOT asserted — it is CPU-contention-dependent (observed
  // 0.002%-2.6% of samples across runs under parallel load) and adds no
  // discriminating power beyond the magnitude bound; it is logged for transparency.
  expect(wavA1.length).toBe(wavA2.length);
  let maxAbsDiff = 0;
  let diffCount = 0;
  const va1 = new DataView(wavA1.buffer, wavA1.byteOffset, wavA1.byteLength);
  const va2 = new DataView(wavA2.buffer, wavA2.byteOffset, wavA2.byteLength);
  for (let o = 44; o + 1 < wavA1.length; o += 2) {
    const d = Math.abs(va1.getInt16(o, true) - va2.getInt16(o, true));
    if (d > 0) {
      diffCount++;
      if (d > maxAbsDiff) maxAbsDiff = d;
    }
  }
  const totalSamples = (wavA1.length - 44) / 2;
  // eslint-disable-next-line no-console
  console.log(
    `[same-theme control] maxAbsDiff=${maxAbsDiff} LSB, diffSamples=${diffCount}/${totalSamples} (${((100 * diffCount) / totalSamples).toFixed(3)}%)`,
  );
  expect(maxAbsDiff).toBeLessThanOrEqual(1); // ConvolverNode float jitter floor

  // Both exports are real audio (>1s of stereo 16-bit PCM past the 44-byte header).
  expect(wavA1.length).toBeGreaterThan(44 + 44100);
  expect(wavB.length).toBeGreaterThan(44 + 44100);

  // Cross-theme: generous floor on 4-band spectral proportions. Asserts the UI
  // wiring produces materially different audio; timbre isolation is proven by the
  // offline fixed-arrangement vitest suite (notes + template differ here too).
  const delta = l1Sum(
    bandProportions(wavToMono(wavA1), SAMPLE_RATE),
    bandProportions(wavToMono(wavB), SAMPLE_RATE),
  );
  // eslint-disable-next-line no-console
  console.log(`[cross-theme] l1Sum(bandProportions BR, ST) = ${delta.toFixed(4)} (floor 0.04)`);
  expect(delta).toBeGreaterThan(0.04);

  expect(errors).toEqual([]);
});
