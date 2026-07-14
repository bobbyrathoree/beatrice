import { test, expect } from "@playwright/test";

test("demo path: pipeline -> playback UI -> no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: /TRY DEMO/ }).click();

  await expect(page.getByRole("button", { name: /PLAY/ })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText(/SONG ARRANGEMENT/)).toBeVisible();

  expect(errors).toEqual([]);
});

test("explainability: input-vs-arrangement lanes + real score bars", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: /TRY DEMO/ }).click();
  await expect(page.getByRole("button", { name: /PLAY/ })).toBeVisible({
    timeout: 15000,
  });

  // Two-lane A/B timeline: input (YOU) on top, arrangement (output) below,
  // wired by connector lines — the "follows you" asset.
  const lanes = page.getByTestId("timeline-lanes");
  await lanes.scrollIntoViewIfNeeded();
  await expect(lanes).toBeVisible();
  await expect(page.getByTestId("timeline-connectors")).toBeVisible();
  expect(await page.getByTestId("timeline-output-marker").count()).toBeGreaterThan(0);

  // Open the DecisionCard for a detected input event. Pick a middle marker
  // (the first sits near t=0, half-clipped by the centering transform) and wait
  // for the staggered scale-in animation to settle before clicking.
  const inputMarkers = page.getByTestId("timeline-input-marker");
  const midIndex = Math.floor((await inputMarkers.count()) / 2);
  await page.waitForTimeout(600);
  // Markers are tiny (2-4px) framer-motion circles; dispatchEvent fires the
  // React onClick directly without viewport/size actionability checks.
  await inputMarkers.nth(midIndex).dispatchEvent("click");

  // Real per-class score bars (one per class, sorted winner-first).
  await expect(page.getByTestId("score-bars")).toBeVisible();
  expect(await page.getByTestId("score-bar").count()).toBe(4);

  expect(errors).toEqual([]);
});

test("fidelity slider triggers re-arrangement", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: /TRY DEMO/ }).click();
  await expect(page.getByRole("button", { name: /PLAY/ })).toBeVisible({
    timeout: 15000,
  });

  // Go up to the arrangement card (../.. = header div -> card) so the captured
  // markup includes the lane note grid whose positions shift with fidelity, not
  // just the static header row.
  const arrangement = page.getByText(/SONG ARRANGEMENT/).locator("../..");
  const before = await arrangement.innerHTML();

  // Drag from the default (80%) to 0% ("PRODUCE FOR ME"): off-template hits snap
  // to the nearest template beat, so the rendered lane note positions must change.
  await page.getByLabel(/FIDELITY/i).fill("0");
  await page.waitForTimeout(700); // debounced re-arrange (300ms) + render

  const after = await arrangement.innerHTML();
  expect(after).not.toBe(before);
  expect(errors).toEqual([]);
});
