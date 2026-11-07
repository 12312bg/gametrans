import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT ?? '3100';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // 各用例共享同一个测试数据库，串行执行最稳定
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '.tmp/report' }]],
  outputDir: '.tmp/results',
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'zh-CN',
    trace: 'off',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'node scripts/start-server.mjs',
    url: `http://localhost:${port}/api/auth/config`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
