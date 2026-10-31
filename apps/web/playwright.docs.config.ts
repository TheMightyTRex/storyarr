import { defineConfig } from "@playwright/test";
import shared from "./playwright.shared";

// Documentation screenshots from mocked data. Not part of the regression suites.
const baseURL = "http://127.0.0.1:4174";

export default defineConfig({
  ...shared,
  testDir: "./tests/docs",
  reporter: [["list"]],
  outputDir: "test-results/docs",
  use: { ...shared.use, baseURL },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --config vite.ui.config.ts --host 127.0.0.1 --port 4174 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
