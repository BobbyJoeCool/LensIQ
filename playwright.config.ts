import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DEMO_PORT = Number(process.env.E2E_DEMO_PORT ?? 3200);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // one shared server with resettable state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /demo\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /demo\.spec\.ts/ },
    // The static public demo (Q22), served the way GitHub Pages serves it: under /LensIQ/.
    { name: 'demo', use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${DEMO_PORT}/LensIQ/` }, testMatch: /demo\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'npm run build -w web && npx tsx api/test/e2e-server.ts',
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { E2E_PORT: String(PORT) },
    },
    {
      command: `npm run build:demo && npm run preview:demo -w web -- --port ${DEMO_PORT}`,
      url: `http://127.0.0.1:${DEMO_PORT}/LensIQ/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
