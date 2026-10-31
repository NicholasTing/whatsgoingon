import { defineConfig } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "whatsgoingon-e2e-"));
const services = join(directory, "services.json");
writeFileSync(services, JSON.stringify([{ id: "databricks" }]));

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4175",
    viewport: { width: 1280, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:4175/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "4175",
      HOST: "127.0.0.1",
      DATA_DIR: directory,
      SERVICES_CONFIG: services,
      WATCH_CONFIG: "",
    },
    timeout: 60_000,
  },
});
