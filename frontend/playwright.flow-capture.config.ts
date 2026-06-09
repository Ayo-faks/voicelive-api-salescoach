import { defineConfig } from '@playwright/test'

const capturePort = Number(process.env.FLOW_CAPTURE_PORT ?? 5174)
const baseURL = process.env.FLOW_CAPTURE_BASE_URL ?? `http://127.0.0.1:${capturePort}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 12_000,
  },
  fullyParallel: false,
  reporter: 'list',
  outputDir: 'test-results-flow-capture',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1920, height: 1080 },
  },
  webServer: {
    command: `VITE_PATHFINDER_LEARNER_ONBOARDING_ENABLED=true VITE_PATHFINDER_E2E_HOOKS=true npm run dev -- --host 127.0.0.1 --port ${capturePort}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})