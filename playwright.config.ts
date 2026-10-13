import { defineConfig } from "@playwright/test";

// End-to-end tests against the production build: `npm run build && npm run e2e`.
// Audio runs for real in headless Chromium with a silent output device.
export default defineConfig({
  testDir: "e2e",
  timeout: 5 * 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 1440, height: 1100 },
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--disable-audio-output"] },
    trace: "retain-on-failure",
    // Fail fast instead of waiting for the whole test timeout on a stuck click.
    actionTimeout: 30_000,
  },
  webServer: {
    command: "npx next start -p 3100",
    url: "http://localhost:3100/library",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
