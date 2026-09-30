import { defineConfig } from "@playwright/test";

// A dedicated port, so a run never adopts some other app already on 3000.
const baseURL = process.env.CUT_STUDIO_TEST_URL || "http://127.0.0.1:3310";
export default defineConfig({
  testDir: "./tests", fullyParallel: true, workers: 2,
  use: { baseURL, browserName: "chromium", ...(process.env.CI ? {} : { channel: "msedge" }), screenshot: "only-on-failure" },
  ...(process.env.CUT_STUDIO_TEST_URL ? {} : { webServer: { command: "npm run dev -- --port 3310", url: `${baseURL}/en/nesting`, reuseExistingServer: !process.env.CI, timeout: 180000 } }),
  reporter: [["list"], ["html", { open: "never" }]],
});
