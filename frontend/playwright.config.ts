import { defineConfig } from '@playwright/test'

const appPort = Number(process.env.PLAYWRIGHT_APP_PORT ?? 8001)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${appPort}`
const webServerCommand =
  `npm run build && ` +
  `PUBLIC_APP_URL=${baseURL} ` +
  `PORT=${appPort} ` +
  `LOCAL_DEV_AUTH=true ` +
  `LOCAL_DEV_USER_ROLE=admin ` +
  `LOCAL_DEV_USER_ID=dev-admin-001 ` +
  `LOCAL_DEV_USER_NAME=DevAdmin ` +
  `LOCAL_DEV_USER_EMAIL=dev-admin@localhost ` +
  `INSIGHTS_RAIL_ENABLED=true ` +
  `INSIGHTS_VOICE_MODE=push_to_talk ` +
  `../scripts/start-local.sh`

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: {
    timeout: 12_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? 'dot' : 'list',
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 1080 },
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER === 'true'
    ? undefined
    : {
        command: webServerCommand,
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 180_000,
      },
})