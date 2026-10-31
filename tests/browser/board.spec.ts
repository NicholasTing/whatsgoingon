import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Incident } from "../../shared/types.ts";
import type { Page } from "@playwright/test";
import { defaultBoard, shareBoard } from "../../shared/board.ts";
import { presets } from "../../shared/appearance.ts";
import { providers } from "../../server/catalog.ts";

async function mockFeeds(page: Page, incidents: Incident[] = []) {
  await page.route("**/api/status/**", async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/").at(-1)!;
    const components = [
      {
        id: "sql:au",
        name: "SQL",
        group: "AP Southeast 2",
        state: "operational",
      },
      { id: "sql:us", name: "SQL", group: "US West 2", state: "outage" },
    ];
    const selected = url.searchParams.getAll("component");
    const now = await page.evaluate(() => new Date().toISOString());
    return route.fulfill({
      json: {
        id,
        name: id === "databricks" ? "Databricks (AWS)" : id,
        statusUrl: "https://status.databricks.com",
        checkedAt: now,
        fetchedAt: now,
        stale: false,
        state: "outage",
        components: selected.length
          ? components.filter((c) => selected.includes(c.id))
          : components,
        incidents,
      },
    });
  });
  await page.route("**/api/history/**", (route) =>
    route.fulfill({
      json: {
        days: Array.from({ length: 90 }, (_, i) => ({
          date: new Date(Date.now() - (89 - i) * 86400000)
            .toISOString()
            .slice(0, 10),
          state: "unknown",
          samples: 0,
          reports: 0,
          complete: false,
        })),
        observedSince: null,
        source: "observations",
        warning: "Incomplete history",
      },
    }),
  );
}

test("local logos render throughout the catalogue and themed boards with an accessible custom fallback", async ({
  page,
}, testInfo) => {
  const board = {
    ...defaultBoard(),
    monitors: [
      { id: "databricks", componentIds: ["sql:au"], group: "" },
      { id: "claude", componentIds: [], group: "" },
      { id: "codex", componentIds: ["sql:au"], group: "" },
      {
        id: "github",
        componentIds: ["sql:au"],
        group: "",
        custom: {
          name: "Custom API",
          url: "https://example.com",
          kind: "http",
        },
      },
    ],
  };
  await page.addInitScript(
    (value) =>
      localStorage.setItem("whatsgoingon.board.v1", JSON.stringify(value)),
    board,
  );
  await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".service")).toHaveCount(4);
  await expect(page.locator(".brand img")).toHaveAttribute(
    "src",
    "/favicon.svg",
  );
  await expect(page.locator(".service .provider-logo img")).toHaveCount(3);
  await expect(
    page
      .locator(".service")
      .filter({ hasText: "Custom API" })
      .locator(".provider-logo svg"),
  ).toBeVisible();

  for (const preset of ["Slate", "Midnight"]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("button", { name: preset }).click();
    await page.getByRole("button", { name: "Apply appearance" }).click();
    await page.getByRole("button", { name: "Dismiss message" }).click();
    await expect(
      page.getByRole("button", { name: "Databricks (AWS)", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator("img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement &&
                image.complete &&
                image.naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`logos-${preset.toLowerCase()}-desktop.png`),
      fullPage: true,
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`logos-${preset.toLowerCase()}-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  await page.getByRole("button", { name: "Add services", exact: true }).click();
  await expect(page.locator(".catalogue-row .provider-logo img")).toHaveCount(
    providers.length,
  );
  await expect
    .poll(() =>
      page
        .locator(".catalogue-row img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0 &&
              new URL(image.src).origin === location.origin,
          ),
        ),
    )
    .toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("logos-catalogue-desktop.png"),
  });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("logos-catalogue-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add services", exact: true }),
  ).toBeFocused();
});

test("Databricks component scope saves, reloads, and shares without affecting another browser", async ({
  page,
  browser,
}) => {
  await mockFeeds(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "1 service needs attention" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Databricks (AWS)", exact: true })
    .click();
  await page
    .getByLabel("Filter components by region or group")
    .selectOption("AP Southeast 2");
  await page.getByRole("button", { name: "Only these results" }).click();
  await page.getByRole("button", { name: "Save selection" }).click();
  await expect(page.getByText("1 selected components")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "All tracked services operational" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("1 selected components")).toBeVisible();
  const board = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("whatsgoingon.board.v1")!),
  );
  const recipient = await browser.newPage();
  await mockFeeds(recipient);
  await recipient.goto(
    "/#board=" +
      encodeURIComponent(
        JSON.stringify({
          ...board,
          name: "My team board",
          notifications: false,
        }),
      ),
  );
  await expect(
    recipient.getByRole("heading", { name: "My team board" }),
  ).toBeVisible();
  await recipient.getByRole("button", { name: "Databricks (AWS)", exact: true }).click();
  await recipient.getByRole("button", { name: "Remove service" }).click();
  await expect(recipient.locator(".service")).toHaveCount(0);
  await expect(page.locator(".service")).toHaveCount(1);
  await expect(page.getByText("1 selected components")).toBeVisible();
  await recipient.close();
});

test("users can add Claude and Codex, search the board, and navigate daily bars by keyboard", async ({
  page,
}) => {
  await mockFeeds(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add services" }).first().click();
  for (const name of ["Claude", "Codex"])
    await page
      .locator(".catalogue-row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Add", exact: true })
      .click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".service")).toHaveCount(3);
  await page.getByLabel("Search overview").fill("Codex");
  await expect(page.locator(".service")).toHaveCount(1);
  const bar = page.getByRole("slider");
  await bar.focus();
  await page.keyboard.press("Home");
  await expect(bar).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.press("ArrowRight");
  await expect(bar).toHaveAttribute("aria-valuenow", "2");
});

test("webhook credentials only enter the user download, never requests, browser storage, or shared state", async ({
  page,
}) => {
  await mockFeeds(page);
  await page.goto("/");
  const marker = "user-owned-test-destination";
  const transmitted: string[] = [];
  page.on("request", (request) =>
    transmitted.push(request.url() + (request.postData() ?? "")),
  );
  await page.getByRole("button", { name: "API & alerts" }).click();
  await page
    .getByLabel("Your HTTPS webhook URL")
    .fill(`https://example.com/${marker}`);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download collector configuration" })
    .click();
  const download = await downloadPromise;
  const contents = await readFile((await download.path())!, "utf8");
  expect(contents).toContain(marker);
  expect(
    await page.evaluate(() => JSON.stringify(localStorage) + location.href),
  ).not.toContain(marker);
  expect(transmitted.join("\n")).not.toContain(marker);
  await expect(page.getByLabel("Your HTTPS webhook URL")).toHaveValue("");
});

test("overview and component selection pass automated accessibility checks and fit mobile", async ({
  page,
}) => {
  await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".service")).toHaveCount(1);
  const overview = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(overview.violations).toEqual([]);
  await page
    .getByRole("button", { name: "Databricks (AWS)", exact: true })
    .click();
  await expect(
    page.getByText("AP Southeast 2", { exact: true }).last(),
  ).toBeVisible();
  const dialog = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(dialog.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Databricks (AWS)", exact: true }),
  ).toBeFocused();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Databricks (AWS)", exact: true }).click();
    await expect(page.locator(".component-row .badge").first()).toBeVisible();
    await expect(page.locator(".component-row .badge .icon")).toHaveCount(0);
    expect(await page.locator(".component-row .badge").first().evaluate(
      (badge) => getComputedStyle(badge, "::before").width,
    )).toBe("6px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
  }
});

test("API blocks private targets, unknown providers and mutations without needing sign-in", async ({
  request,
}) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  expect(
    (await request.post("/api/status/databricks", { data: {} })).status(),
  ).toBe(405);
  expect((await request.get("/api/status/not-a-provider")).status()).toBe(404);
  const blocked = await request.get(
    "/api/status/custom?url=https%3A%2F%2F127.0.0.1&kind=http&name=Private",
  );
  expect(blocked.status()).toBe(400);
});

test("appearance validates colours, persists, exports, imports, and shares", async ({
  page,
  browser,
}) => {
  await mockFeeds(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Midnight" }).click();
  await page.getByLabel("Accent hex colour").fill("#19212e");
  await expect(
    page.getByText("Accent needs more contrast.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply appearance" }),
  ).toBeDisabled();
  await page.getByLabel("Accent hex colour").fill("#b8d2ff");
  await page.getByRole("button", { name: "Apply appearance" }).click();
  await expect(page.locator(".app-shell")).toHaveCSS(
    "background-color",
    "rgb(16, 21, 30)",
  );
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveCSS("--accent", "#b8d2ff");
  await page.getByRole("button", { name: "Board settings" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export board" }).click();
  const download = await downloadPromise;
  const contents = await readFile((await download.path())!, "utf8");
  expect(JSON.parse(contents).appearance.accent).toBe("#b8d2ff");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Reset to default" }).click();
  await page.getByRole("button", { name: "Apply appearance" }).click();
  await expect(page.locator(".app-shell")).toHaveCSS(
    "background-color",
    "rgb(16, 21, 30)",
  );
  await page.getByRole("button", { name: "Board settings" }).click();
  await page.getByLabel("Import board").setInputFiles({
    name: "board.json",
    mimeType: "application/json",
    buffer: Buffer.from(contents),
  });
  await expect(page.locator(".app-shell")).toHaveCSS("--accent", "#b8d2ff");
  const recipient = await browser.newPage();
  await mockFeeds(recipient);
  await recipient.goto("/#board=" + encodeURIComponent(contents));
  await expect(recipient.locator(".app-shell")).toHaveCSS(
    "--accent",
    "#b8d2ff",
  );
  await recipient.close();
});

test("appearance and feedback are accessible in both themes and on mobile", async ({
  page,
}) => {
  await mockFeeds(page);
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Request a feature" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/NicholasTing/whatsgoingon/issues/new?template=feature-request.yml",
  );
  await expect(
    page.getByRole("link", { name: "Report a bug" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/NicholasTing/whatsgoingon/issues/new?template=bug-report.yml",
  );
  for (const preset of ["Slate", "Midnight"]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("button", { name: preset }).click();
    await page.getByRole("button", { name: "Apply appearance" }).click();
    await expect(page.locator(".service")).toHaveCount(1);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .getByRole("dialog")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
    await page.getByRole("button", { name: "Forest" }).click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Appearance", exact: true }),
    ).toBeFocused();
    await expect(page.locator(".app-shell")).toHaveCSS(
      "background-color",
      preset === "Midnight" ? "rgb(16, 21, 30)" : "rgb(245, 246, 248)",
    );
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});

test("setup prompt copies the audit instructions and seed board without changing it or including unexpected credentials", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const board = {
    ...defaultBoard(),
    notifications: true,
    appearance: presets[1].appearance,
    monitors: [
      { id: "databricks", componentIds: ["sql:au"], group: "Data" },
      { id: "claude", componentIds: [], group: "AI" },
    ],
  };
  await page.addInitScript(
    (value) =>
      localStorage.setItem("whatsgoingon.board.v1", JSON.stringify(value)),
    { ...board, webhook: "never-copy-this-test-secret" },
  );
  await mockFeeds(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Set up your own", exact: true })
    .click();
  await page
    .getByLabel("Organisation or page name")
    .fill("Example team status");
  await page.getByLabel("Setup target").selectOption("docker");
  const prompt = await page
    .getByLabel("Setup prompt", { exact: true })
    .inputValue();
  const configuration = JSON.parse(
    prompt.split("```json\n")[1].split("\n```")[0],
  );
  expect(configuration).toEqual({
    ...board,
    name: "Example team status",
    notifications: false,
  });
  expect(prompt).toContain(
    "Docker setup. Start locally unless I supply a hosting destination.",
  );
  expect(prompt).toContain(
    (await readFile("docs/setup-prompt.md", "utf8")).trim(),
  );
  expect(prompt).not.toContain("never-copy-this-test-secret");
  await page
    .getByRole("button", { name: "Copy setup prompt", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Prompt copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    prompt,
  );
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("whatsgoingon.board.v1")!),
    ),
  ).toEqual(board);
});

test("setup prompt has a manual-copy fallback and fits an accessible mobile dialog", async ({
  page,
}) => {
  await mockFeeds(page);
  await page.goto("/");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Clipboard denied");
        },
      },
    }),
  );
  await page
    .getByRole("button", { name: "Set up your own", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy setup prompt", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("copy it manually");
  const prompt = page.getByLabel("Setup prompt", { exact: true });
  await expect(prompt).toBeFocused();
  expect(
    await prompt.evaluate(
      (element: HTMLTextAreaElement) =>
        element.selectionEnd - element.selectionStart,
    ),
  ).toBe((await prompt.inputValue()).length);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Set up your own", exact: true }),
  ).toBeFocused();
});

function report(overrides: Partial<Incident>): Incident {
  return {
    id: "historical",
    title: "SQL interruption",
    status: "resolved",
    state: "outage",
    active: false,
    maintenance: false,
    startedAt: "2026-10-30T10:00:00Z",
    updatedAt: "2026-10-30T11:00:00Z",
    endedAt: "2026-10-30T11:00:00Z",
    componentIds: ["sql:au"],
    body: "Service restored.",
    url: "https://status.example.com/incidents/historical",
    updates: [],
    ...overrides,
  };
}

test("history opens scoped UTC reports by pointer and keyboard, with an honest empty state", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-31T12:00:00Z"));
  await page.addInitScript(
    (board) =>
      localStorage.setItem("whatsgoingon.board.v1", JSON.stringify(board)),
    {
      ...defaultBoard(),
      monitors: [{ id: "databricks", componentIds: ["sql:au"], group: "" }],
    },
  );
  await mockFeeds(page, [
    report({}),
    report({
      id: "second",
      title: "Second report",
      url: "https://status.example.com/incidents/second",
    }),
    report({ id: "unrelated", title: "US incident", componentIds: ["sql:us"] }),
    report({
      id: "other-day",
      title: "Older incident",
      startedAt: "2026-10-29T10:00:00Z",
      endedAt: "2026-10-29T11:00:00Z",
    }),
  ]);
  await page.route("**/api/history/**", (route) =>
    route.fulfill({
      json: {
        days: Array.from({ length: 90 }, (_, i) => ({
          date: new Date(
            Date.parse("2026-10-31T12:00:00Z") - (89 - i) * 86400000,
          )
            .toISOString()
            .slice(0, 10),
          state: i === 88 ? "outage" : "unknown",
          samples: 0,
          complete: false,
        })),
        observedSince: null,
        source: "observations",
        warning: "Incomplete history",
      },
    }),
  );
  await page.goto("/");
  const bars = page.getByRole("slider");
  await expect(bars).toHaveAttribute("aria-valuetext", /2026-10-31/);
  const box = (await bars.boundingBox())!;
  await bars.click({ position: { x: (box.width * 88.5) / 90, y: 16 } });
  await expect(page.getByRole("dialog")).toContainText("2026-10-30 (UTC)");
  await expect(
    page
      .getByRole("combobox", { name: "Report", exact: true })
      .locator("option"),
  ).toHaveText(["SQL interruption", "Second report"]);
  await page
    .getByRole("combobox", { name: "Report", exact: true })
    .selectOption("second");
  await expect(
    page.getByRole("link", { name: "View the provider’s incident" }),
  ).toHaveAttribute("href", "https://status.example.com/incidents/second");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("history-reports.png") });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("history-reports-mobile.png"),
  });
  await page.keyboard.press("Escape");
  await expect(bars).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText(
    "No provider report is available",
  );
  await expect(page.getByRole("dialog").locator(".badge")).toContainText(
    "Unknown",
  );
  await page.screenshot({ path: testInfo.outputPath("no-report.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  await expect(
    page
      .getByRole("combobox", { name: "Report", exact: true })
      .locator("option"),
  ).toHaveCount(2);
});

test("current status and inline maintenance open reports; local-only outages explain missing reports", async ({
  page,
}) => {
  await mockFeeds(page);
  await page.goto("/");
  const status = page.getByRole("button", {
    name: "Databricks (AWS): Outage. View reports",
  });
  await status.click();
  await expect(page.getByRole("dialog")).toContainText(
    "Local checks can record a status change without a published incident.",
  );
  await page.keyboard.press("Escape");
  await expect(status).toBeFocused();
  await mockFeeds(page, [
    report({ active: true, status: "investigating", endedAt: null }),
    report({
      id: "maintenance",
      title: "Planned maintenance",
      maintenance: true,
      state: "maintenance",
      status: "scheduled",
      startedAt: "2026-11-01T10:00:00Z",
    }),
  ]);
  await page.reload();
  await status.click();
  await expect(
    page
      .getByRole("combobox", { name: "Report", exact: true })
      .locator("option"),
  ).toHaveText(["SQL interruption"]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Planned maintenance/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Planned maintenance");
  await expect(page.getByRole("dialog").locator(".badge")).toHaveClass(
    /maintenance/,
  );
});


test("new boards start dark with readable status labels and matching previews", async ({ page }, testInfo) => {
  await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".app-shell")).toHaveCSS("background-color", "rgb(16, 21, 30)");
  await page.getByRole("button", { name: "Add services" }).first().click();
  for (const name of ["Claude", "Codex"]) {
    await page.locator(".catalogue-row").filter({ hasText: name })
      .getByRole("button", { name: "Add", exact: true }).click();
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".service-heading .badge")).toHaveText(["Outage", "Outage", "Outage"]);
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await page.screenshot({ path: testInfo.outputPath("dark-dashboard.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dark-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.locator(".preview-statuses .badge")).toHaveText(["Operational", "Degraded", "Outage", "Maintenance"]);
  expect(await page.locator(".preview-statuses .badge").first().evaluate(el => getComputedStyle(el, "::before").width)).toBe("6px");
  await page.screenshot({ path: testInfo.outputPath("dark-preview.png") });
});

test("board names are optional in fresh boards, settings, imports and setup", async ({ page }, testInfo) => {
  await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".service")).toHaveCount(1);
  await expect(page.locator(".board-heading h2")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("unnamed-board.png"), fullPage: true });
  await page.getByRole("button", { name: "Board settings" }).click();
  await expect(page.getByLabel("Board name", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Saved in this browser.", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("board-settings.png") });
  for (const name of ["My status board", "Team dashboard"]) {
    await page.getByLabel("Import board").setInputFiles({
      name: "board.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...defaultBoard(), name })),
    });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("whatsgoingon.board.v1")!).name)).toBe(name);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator(".board-heading h2")).toHaveCount(name === "My status board" ? 0 : 1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("whatsgoingon.board.v1")!).name)).toBe(name);
    await page.getByRole("button", { name: "Board settings" }).click();
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Set up your own", exact: true }).click();
  await page.getByLabel("Organisation or page name (optional)").fill("");
  const prompt = await page.getByLabel("Setup prompt", { exact: true }).inputValue();
  expect(JSON.parse(prompt.split("```json\n")[1].split("\n```")[0]).name).toBe("");
  await expect(page.getByRole("button", { name: "Copy setup prompt", exact: true })).toBeEnabled();
});


test("unavailable history is distinct from a returned history with no records", async ({ page }) => {
  await mockFeeds(page);
  let unavailable = true;
  await page.route("**/api/history/**", (route) =>
    unavailable ? route.abort() : route.fallback(),
  );
  await page.goto("/");
  await expect(page.locator(".history-description")).toHaveText("Recorded history is unavailable");
  await page.getByRole("slider").focus();
  await expect(page.getByRole("slider")).toHaveAttribute("aria-valuetext", "Recorded history is unavailable");
  unavailable = false;
  await page.reload();
  await expect(page.locator(".history-description")).toHaveText("No local checks or provider reports recorded yet");
});

test("history explains missing local checks separately from provider reports on hover and focus", async ({
  page,
}, testInfo) => {
  await mockFeeds(page);
  await page.route("**/api/history/**", (route) =>
    route.fulfill({
      json: {
        days: Array.from({ length: 90 }, (_, i) => ({
          date: new Date(Date.now() - (89 - i) * 86400000)
            .toISOString()
            .slice(0, 10),
          state: i === 88 ? "outage" : i === 87 ? "operational" : "unknown",
          samples: i === 87 ? 1 : i === 86 ? 250 : 0,
          reports: i === 88 ? 2 : 0,
          complete: i === 86,
        })),
        observedSince: null,
        source: "observations",
        warning: "Incomplete history",
      },
    }),
  );
  await page.goto("/");
  const bars = page.getByRole("slider");
  await bars.focus();
  await page.keyboard.press("Home");
  await expect(bars).toHaveAttribute(
    "aria-valuetext",
    /Unknown.*No local checks recorded.*No provider reports recorded.*Incomplete local coverage/,
  );
  await expect(page.locator(".history-description")).toContainText(
    "health between checks is unknown",
  );
  await page.screenshot({
    path: testInfo.outputPath("missing-history.png"),
    fullPage: true,
  });
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await expect(bars).toHaveAttribute(
    "aria-valuetext",
    /Outage.*No local checks recorded.*2 provider reports/,
  );
  await expect(page.locator(".history-description")).not.toContainText(
    "0 recorded checks",
  );
  await page.screenshot({
    path: testInfo.outputPath("incident-only-history.png"),
    fullPage: true,
  });
  await page.keyboard.press("ArrowLeft");
  await expect(bars).toHaveAttribute(
    "aria-valuetext",
    /1 local check recorded.*No provider reports recorded.*Incomplete local coverage/,
  );
  await expect(bars.locator("rect.bar").nth(87)).toHaveAttribute("fill", /url/);
  await page.keyboard.press("ArrowLeft");
  await expect(bars).toHaveAttribute("aria-valuetext", /Unknown.*Near-complete local coverage/);
  await expect(bars.locator("rect.bar").nth(86)).toHaveAttribute("fill", /url/);
  await expect(page.getByText(/Hatching indicates an unknown state or incomplete local coverage/)).toBeVisible();
  const box = (await bars.boundingBox())!;
  await bars.hover({ position: { x: (box.width * 88.5) / 90, y: 16 } });
  await expect(page.locator(".history-description")).toContainText(
    "2 provider reports",
  );
  await page.mouse.move(0, 0);
  await expect(page.locator(".history-description")).toContainText("2 provider reports");
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("history-mobile.png"),
    fullPage: true,
  });
});


test("compact navigation keeps setup and feedback accessible on desktop and mobile", async ({ page }, testInfo) => {
  await mockFeeds(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Service status", exact: true })).toBeVisible();
  await expect(page.getByText("No account. Your board.")).toHaveCount(0);
  await expect(page.getByText("Every service. One view.")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("header-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("header-mobile.png"), fullPage: true });
  const setup = page.getByRole("button", { name: "Set up your own", exact: true });
  await setup.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(setup).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Request a feature" })).toBeFocused();
});


test("changing component scope does not reuse history when the new request fails", async ({ page }) => {
  await mockFeeds(page);
  await page.route("**/api/history/**", route => {
    if (new URL(route.request().url()).searchParams.has("component")) return route.abort();
    return route.fulfill({ json: {
      days: Array.from({ length: 90 }, (_, i) => ({
        date: new Date(Date.now() - (89 - i) * 86400000).toISOString().slice(0, 10),
        state: "outage", samples: 1, complete: false,
      })),
      observedSince: null, source: "observations", warning: "Incomplete history",
    } });
  });
  await page.goto("/");
  await expect(page.locator(".bar.outage")).toHaveCount(90);
  await page.getByRole("button", { name: "Databricks (AWS)", exact: true }).click();
  await page.getByLabel("Filter components by region or group").selectOption("AP Southeast 2");
  await page.getByRole("button", { name: "Only these results" }).click();
  await page.getByRole("button", { name: "Save selection" }).click();
  await expect(page.getByRole("heading", { name: "All tracked services operational" })).toBeVisible();
  await expect(page.locator(".bar.outage")).toHaveCount(0);
  await page.getByRole("slider").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("returning to a cached scope keeps its reports when the status refresh fails", async ({ page }) => {
  const board = (component: string) => ({
    ...defaultBoard(), monitors: [{ id: "databricks", componentIds: [component], group: "" }],
  });
  const incident = report({ active: true, status: "investigating", endedAt: null });
  await mockFeeds(page);
  let fail = false;
  await page.route("**/api/status/**", route => {
    const component = new URL(route.request().url()).searchParams.get("component");
    if (fail && component === "sql:au") return route.abort();
    const state = component === "sql:au" ? "outage" : "operational";
    return route.fulfill({ json: {
      id: "databricks", name: "Databricks (AWS)", statusUrl: "https://status.databricks.com",
      checkedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), stale: false, state,
      components: [{ id: component, name: "SQL", group: "", state }],
      incidents: component === "sql:au" ? [incident] : [],
    } });
  });
  await page.route("**/api/history/**", route => route.fulfill({ json: {
    days: Array.from({ length: 90 }, (_, i) => ({
      date: new Date(Date.now() - (89 - i) * 86400000).toISOString().slice(0, 10),
      state: "outage", samples: 1, complete: false,
    })), observedSince: null, source: "observations", warning: "Incomplete history",
  } }));
  await page.goto(`/${shareBoard(board("sql:au"))}`);
  await expect(page.getByRole("button", { name: "Databricks (AWS): Outage. View reports" })).toBeVisible();
  await page.evaluate(hash => { location.hash = hash; }, shareBoard(board("sql:us")));
  await expect(page.getByRole("button", { name: "Databricks (AWS): Operational. View reports" })).toBeVisible();
  fail = true;
  await page.evaluate(hash => { location.hash = hash; }, shareBoard(board("sql:au")));
  await expect(page.getByRole("button", { name: "Databricks (AWS): Unknown. View reports" })).toBeVisible();
  await page.getByRole("slider").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText(incident.title);
  await expect(page.getByRole("link", { name: "View the provider’s incident" })).toHaveAttribute("href", incident.url);
});

test("status reports wait for a snapshot and keep Checking as their accessible name", async ({ page }) => {
  await mockFeeds(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/status/**", async route => {
    await ready;
    await route.fallback();
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Checking\. View reports/ })).toContainText("Checking");
  await expect(page.getByRole("button", { name: /Checking\. View reports/ })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "Databricks (AWS): Outage. View reports" })).toBeEnabled();
  await page.route("**/api/status/**", route => route.abort());
  await page.reload();
  const failedStatus = page.getByRole("button", { name: "Databricks (AWS): Unknown. View reports" });
  await expect(failedStatus).toBeEnabled();
  await failedStatus.click();
  await expect(page.getByRole("dialog")).toContainText("No provider report is available");
});

test("incident lifecycle badges identify impact without colour", async ({ page }, testInfo) => {
  const at = new Date().toISOString();
  const reports: Incident[] = (["outage", "degraded"] as const).flatMap(state => ["investigating", "", "Checking"].map(status => ({
    id: `${state}-${status}`, title: `${state} ${status || "empty"} incident`, status, state,
    active: true, maintenance: false, startedAt: at,
    updatedAt: at, endedAt: null, componentIds: [],
    body: "Investigating service impact.", url: "https://status.example.com/incident", updates: [],
  })));
  reports.push({
    ...reports[0], id: "scheduled", title: "Scheduled maintenance", status: "scheduled",
    state: "maintenance", maintenance: true, active: false,
  }, {
    ...reports[0], id: "completed", title: "Completed maintenance", status: "completed",
    state: "maintenance", maintenance: true, active: false, endedAt: at,
  });
  await mockFeeds(page, reports);
  await page.goto("/");
  await page.getByRole("button", { name: "Incidents (6)", exact: true }).click();
  await expect(page.locator(".report .badge")).toHaveText(["Outage · investigating", "Outage", "Outage", "Degraded · investigating", "Degraded", "Degraded", "Maintenance · scheduled", "Operational · completed"]);
  await page.screenshot({ path: testInfo.outputPath("incident-badges.png"), fullPage: true });
  for (const [title, label] of [["outage investigating incident", "Outage · investigating"], ["outage empty incident", "Outage"], ["outage Checking incident", "Outage"], ["Scheduled maintenance", "Maintenance · scheduled"], ["Completed maintenance", "Operational · completed"]]) {
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.getByRole("dialog").locator(".badge")).toHaveText(label);
    await page.keyboard.press("Escape");
  }
});
