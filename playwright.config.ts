import base from "/Users/nicholasting/orca/workspaces/whatsgoingon/rockling/playwright.config.ts";

export default {
  ...base,
  testDir: "/Users/nicholasting/orca/workspaces/whatsgoingon/rockling/tests/browser",
  outputDir: "/Users/nicholasting/orca/workspaces/whatsgoingon/rockling/test-results",
  use: { ...base.use, baseURL: "http://127.0.0.1:4196" },
  webServer: {
    ...base.webServer,
    cwd: "/Users/nicholasting/orca/workspaces/whatsgoingon/rockling",
    url: "http://127.0.0.1:4196/api/health",
    env: { ...base.webServer.env, PORT: "4196" },
  },
};
