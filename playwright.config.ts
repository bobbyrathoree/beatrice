import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:1420',
  },
  webServer: {
    command: 'npm run dev',
    port: 1420,
    reuseExistingServer: true,
  },
});
