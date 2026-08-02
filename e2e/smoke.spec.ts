import { test, expect } from "@playwright/test";

test("compact input keeps history clear and renders processing in frame", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto("http://localhost:1420");

  await expect(page.locator(".session-sidebar")).toHaveClass(/collapsed/);
  await page.getByRole("button", { name: /TRY DEMO/ }).click();
  await expect(page.locator(".processing-container")).toBeVisible();

  const [mainBox, visualizationBox] = await Promise.all([
    page.locator(".main").boundingBox(),
    page.locator(".viz-container").boundingBox(),
  ]);
  expect(mainBox).not.toBeNull();
  expect(visualizationBox).not.toBeNull();
  expect(visualizationBox!.x).toBeGreaterThanOrEqual(mainBox!.x);
  expect(visualizationBox!.x + visualizationBox!.width).toBeLessThanOrEqual(
    mainBox!.x + mainBox!.width,
  );
  expect(visualizationBox!.y).toBeGreaterThanOrEqual(mainBox!.y);
  expect(visualizationBox!.y + visualizationBox!.height).toBeLessThanOrEqual(
    mainBox!.y + mainBox!.height,
  );

  await expect(page.getByRole("button", { name: /PLAY/ })).toBeVisible({
    timeout: 15000,
  });
});

test("results keep every section reachable without crossing the transport", async ({ page }) => {
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: /TRY DEMO/ }).click();
  await expect(page.getByRole("button", { name: /PLAY/ })).toBeVisible({
    timeout: 15000,
  });

  const scrollResultsTo = async (edge: "top" | "bottom") => {
    await page.evaluate((targetEdge) => {
      const scroller =
        document.querySelector<HTMLElement>(".results-scroll") ??
        document.querySelector<HTMLElement>(".main");
      if (!scroller) throw new Error("Results scroller is missing");
      scroller.scrollTop = targetEdge === "top" ? 0 : scroller.scrollHeight;
    }, edge);
    await page.waitForTimeout(100);
  };

  const expectInsideResultsViewport = async (locator: ReturnType<typeof page.locator>) => {
    await locator.scrollIntoViewIfNeeded();
    const [elementBox, transportBox, viewportBox] = await Promise.all([
      locator.boundingBox(),
      page.locator(".playback-controls").boundingBox(),
      page.locator(".results-scroll, .main").last().boundingBox(),
    ]);
    expect(elementBox).not.toBeNull();
    expect(transportBox).not.toBeNull();
    expect(viewportBox).not.toBeNull();
    expect(elementBox!.y).toBeGreaterThanOrEqual(viewportBox!.y - 1);
    expect(elementBox!.y + elementBox!.height).toBeLessThanOrEqual(
      viewportBox!.y + viewportBox!.height + 1,
    );
    expect(elementBox!.y).toBeGreaterThanOrEqual(
      transportBox!.y + transportBox!.height - 1,
    );
  };

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await scrollResultsTo("top");

    const [waveformBox, transportBox, viewportBox] = await Promise.all([
      page.getByText(/B-SOUNDS DETECTED/).locator("../..").boundingBox(),
      page.locator(".playback-controls").boundingBox(),
      page.locator(".results-scroll, .main").last().boundingBox(),
    ]);
    expect(waveformBox).not.toBeNull();
    expect(transportBox).not.toBeNull();
    expect(viewportBox).not.toBeNull();
    expect(waveformBox!.y).toBeGreaterThanOrEqual(viewportBox!.y - 1);
    expect(waveformBox!.height).toBeGreaterThan(120);
    expect(transportBox!.y + transportBox!.height).toBeLessThanOrEqual(
      viewportBox!.y + 1,
    );

    await expectInsideResultsViewport(page.getByText(/SONG ARRANGEMENT/));
    await expectInsideResultsViewport(
      page.getByText("BLADE RUNNER", { exact: true }).locator(".."),
    );

    await scrollResultsTo("bottom");
    await expectInsideResultsViewport(page.getByRole("button", { name: /NEW RECORDING/ }));
  }
});

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

  // Open the DecisionCard for a detected input event. Pick a middle marker and
  // wait for the staggered scale-in animation to settle before clicking.
  const inputMarkers = page.getByTestId("timeline-input-marker");
  const midIndex = Math.floor((await inputMarkers.count()) / 2);
  await page.waitForTimeout(600);
  // Markers are tiny (2-4px) framer-motion circles; dispatchEvent fires the
  // React onClick directly without viewport/size actionability checks.
  await inputMarkers.nth(midIndex).dispatchEvent("click");

  // Real per-class score bars (one per class, sorted winner-first).
  const dialog = page.getByRole("dialog", { name: /EVENT DECISION/ });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Close event decision" })).toBeFocused();
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
