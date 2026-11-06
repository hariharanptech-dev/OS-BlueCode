import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: '../../reports/e2e-results.json' }]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node src/reference/main.ts',
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      NODE_ENV: 'development', PORT: String(PORT), APP_BASE_URL: `http://127.0.0.1:${PORT}`,
      PAYU_KEY: 'E2EKEY001', PAYU_SALT: 'fake-e2e-salt-not-a-real-credential', PAYU_BASE_URL: '/__mock-payu/pay',
      MOCK_PAYU_UI: 'true', COOKIE_SECURE: 'false', RELAX_RATE_LIMITS: 'true', // production limits are covered by tests/security/rate-limit.test.ts
    },
  },
});
