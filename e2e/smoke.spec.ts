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
