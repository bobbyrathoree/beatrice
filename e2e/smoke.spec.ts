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
