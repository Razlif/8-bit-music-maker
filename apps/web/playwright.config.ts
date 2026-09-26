import { defineConfig } from "@playwright/test";
const apiPort = process.env.TEST_SERVER_PORT || "3101";
const webPort = process.env.TEST_WEB_PORT || "5174";
const origin = `http://127.0.0.1:${webPort}`;
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node --import tsx ../server/src/test-server.ts",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: { TEST_SERVER_PORT: apiPort, TEST_WEB_ORIGIN: origin },
      timeout: 60000,
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -- --port ${webPort} --strictPort`,
      url: origin,
      env: { TEST_API_ORIGIN: `http://127.0.0.1:${apiPort}` },
      timeout: 60000,
      reuseExistingServer: false,
    },
  ],
});
