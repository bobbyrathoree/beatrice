import { test, expect } from '@playwright/test';

test.describe('Beatrice App - Input Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the React app to mount and render
    await page.waitForSelector('.app', { timeout: 10000 });
  });

  test('app loads correctly with all main elements', async ({ page }) => {
    // Verify BEATRICE heading is visible
    const heading = page.locator('h1', { hasText: 'BEATRICE' });
    await expect(heading).toBeVisible();

    // Verify RECORD card is visible
    const recordCard = page.locator('h2', { hasText: 'RECORD' });
    await expect(recordCard).toBeVisible();

    // Verify UPLOAD card is visible
    const uploadCard = page.locator('h2', { hasText: 'UPLOAD' });
    await expect(uploadCard).toBeVisible();

    // Verify TRY DEMO button is visible
    const demoButton = page.getByRole('button', { name: /TRY DEMO/i });
    await expect(demoButton).toBeVisible();
  });

  test('sidebar is visible and functional', async ({ page }) => {
    // Verify History heading is visible in the sidebar
    const historyTitle = page.locator('.sidebar-title', { hasText: 'History' });
    await expect(historyTitle).toBeVisible();

    // Verify "No sessions yet" empty state shows (no backend = no sessions)
    const emptyState = page.locator('.empty-state');
    await expect(emptyState).toBeVisible();
    await expect(emptyState.locator('p')).toHaveText('No sessions yet');

    // Click collapse button, verify sidebar collapses
    const collapseButton = page.getByLabel('Collapse sidebar');
    await expect(collapseButton).toBeVisible();
    await collapseButton.click();

    // After collapse, the sidebar should have the "collapsed" class
    const sidebar = page.locator('.session-sidebar');
    await expect(sidebar).toHaveClass(/collapsed/);

    // The History title should no longer be visible when collapsed
    await expect(historyTitle).not.toBeVisible();

    // Click expand button, verify sidebar expands
    const expandButton = page.getByLabel('Expand sidebar');
    await expect(expandButton).toBeVisible();
    await expandButton.click();

    // Wait for the expand animation to complete
    await page.waitForTimeout(400);

    // History title should be visible again
    await expect(page.locator('.sidebar-title', { hasText: 'History' })).toBeVisible();
  });

  test('BEATRICE heading acts as home button', async ({ page }) => {
    // Starts on input screen - verify input content is visible
    const recordCard = page.locator('h2', { hasText: 'RECORD' });
    await expect(recordCard).toBeVisible();

    const uploadCard = page.locator('h2', { hasText: 'UPLOAD' });
    await expect(uploadCard).toBeVisible();

    // Click BEATRICE heading (home button)
    const heading = page.locator('h1', { hasText: 'BEATRICE' });
    await heading.click();

    // Verify still on input screen (no navigation error)
    await expect(recordCard).toBeVisible();
    await expect(uploadCard).toBeVisible();

    // Verify no error notification appeared
    const notification = page.locator('.notification');
    await expect(notification).not.toBeVisible();
  });

  test('upload card has drop zone', async ({ page }) => {
    // Verify drop zone text "DROP WAV FILE HERE" is visible
    const dropZoneText = page.getByText('DROP WAV FILE HERE');
    await expect(dropZoneText).toBeVisible();

    // Verify "or click to browse" text is visible
    const browseText = page.getByText('or click to browse');
    await expect(browseText).toBeVisible();
  });

  test('record card has start button', async ({ page }) => {
    // Verify "START RECORDING" button is visible and enabled
    const startButton = page.getByRole('button', { name: /START RECORDING/i });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();
  });

  test('demo button is present and enabled', async ({ page }) => {
    // Check that the TRY DEMO button exists and is clickable
    const demoButton = page.getByRole('button', { name: /TRY DEMO/i });
    await expect(demoButton).toBeVisible();
    await expect(demoButton).toBeEnabled();
  });
});
