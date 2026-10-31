import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Board, Incident } from "../../shared/types.ts";
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

async function mockBoard(page: Page, board: Board) {
  await page.route("**/api/board", (route) => route.fulfill({ json: board }));
  await page.route("**/api/catalog", (route) =>
    route.fulfill({
      json: {
        providers: board.monitors.map((monitor) => ({
          ...(providers.find((provider) => provider.id === monitor.id) ??
            providers[0]),
          id: monitor.id,
          ...(monitor.custom
            ? { name: monitor.custom.name, statusUrl: monitor.custom.url }
            : {}),
        })),
      },
    }),
  );
}

test("configured logos and status links remain accessible on desktop and mobile", async ({
  page,
}, testInfo) => {
  const board = {
    ...defaultBoard(),
    monitors: [
      ...providers.map((provider) => ({
        id: provider.id,
        componentIds: [],
        group: "",
      })),
      {
        id: "custom-api",
        componentIds: [],
        group: "",
        custom: {
          name: "Custom API",
          url: "https://example.com",
          kind: "http" as const,
        },
      },
    ],
  };
  await mockFeeds(page);
  for (const preset of [presets[0], presets[2]]) {
    await mockBoard(page, { ...board, appearance: preset.appearance });
    await page.goto("/");
    await expect(page.locator(".service")).toHaveCount(providers.length + 1);
    for (const provider of providers) {
      await expect(
        page.getByRole("link", { name: provider.name, exact: true }),
      ).toHaveAttribute("href", provider.statusUrl);
    }
    await expect(page.locator(".service .provider-logo img")).toHaveCount(
      providers.length,
    );
    await expect(
      page
        .locator(".service")
        .filter({ hasText: "Custom API" })
        .locator(".provider-logo svg"),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator("img")
          .evaluateAll((images) =>
            images.every(
              (img) =>
                img instanceof HTMLImageElement &&
                img.complete &&
                img.naturalWidth > 0,
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
      path: testInfo.outputPath(`configured-${preset.name}-desktop.png`),
      fullPage: true,
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: testInfo.outputPath(`configured-${preset.name}-mobile.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});

test("saved boards and old share links cannot change configured services or scope", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const board = {
    ...defaultBoard(),
    monitors: [{ id: "databricks", componentIds: ["sql:au"], group: "Data" }],
  };
  const oldBoard = {
    ...defaultBoard(),
    monitors: [{ id: "claude", componentIds: [], group: "" }],
  };
  await page.addInitScript(
    (value) =>
      localStorage.setItem("whatsgoingon.board.v1", JSON.stringify(value)),
    oldBoard,
  );
  await mockBoard(page, board);
  await mockFeeds(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
  });
  await page.goto(`/${shareBoard(oldBoard)}`);
  await expect(page.locator(".service")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Databricks (AWS)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "All tracked services operational" }),
  ).toBeVisible();
  for (const name of [
    "Add services",
    "Board settings",
    "Appearance",
    "Remove service",
    "Import board",
  ]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  }
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    shareBoard({ ...oldBoard, name: "Changed" }),
  );
  await page.reload();
  await expect(page.locator(".service")).toHaveCount(1);
  await page.getByRole("button", { name: "Share board", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    new URL("/", page.url()).href,
  );
  expect(
    requests.every(
      (url) => !url.includes("component=") && !url.includes("/claude"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("whatsgoingon.board.v1")!),
    ),
  ).toEqual(oldBoard);
});

test("configuration instructions require a server restart and are keyboard accessible", async ({
  page,
}, testInfo) => {
  await mockFeeds(page);
  await page.goto("/");
  const button = page.getByRole("button", {
    name: "Configured services",
    exact: true,
  });
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("services.json");
  await expect(dialog).toContainText("restart it");
  await expect(dialog).toContainText("set up and maintain yourself");
  await expect(dialog.locator("pre")).toContainText('"databricks"');
  await expect(dialog.locator("input, textarea, select")).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("configuration-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
});

test("empty and unavailable server configuration never falls back to a browser board", async ({
  page,
}) => {
  await mockFeeds(page);
  await mockBoard(page, { ...defaultBoard(), monitors: [] });
  await page.goto("/");
  await expect(page.locator(".service")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No services configured", level: 2 }),
  ).toBeVisible();
  await page.route("**/api/board", (route) =>
    route.fulfill({ status: 500, json: { error: "Unavailable" } }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "configured services could not be loaded",
  );
  await expect(page.locator(".service")).toHaveCount(0);
});

test("configured services can still be searched and API links contain no client configuration", async ({
  page,
}, testInfo) => {
  await mockBoard(page, {
    ...defaultBoard(),
    monitors: [
      { id: "databricks", componentIds: [], group: "Data" },
      { id: "claude", componentIds: [], group: "AI" },
      { id: "codex", componentIds: [], group: "AI" },
    ],
  });
  await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".service")).toHaveCount(3);
  await expect(
    page.getByRole("button", {
      name: "Databricks (AWS): Outage. View reports",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("configured-board.png"),
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "Search overview" }).fill("AI");
  await expect(page.locator(".service")).toHaveCount(2);
  await page.getByRole("button", { name: "API & alerts", exact: true }).click();
  await expect(page.getByLabel("Current status")).toHaveValue(
    /\/api\/status\/databricks$/,
  );
  await expect(page.getByLabel("Incident RSS feed")).toHaveValue(
    /\/api\/feed.xml$/,
  );
  await expect(page.getByLabel("Embed this board")).not.toHaveValue(/#board=/);
  await expect(
    page
      .getByRole("dialog")
      .locator("input:not([readonly]), textarea:not([readonly])"),
  ).toHaveCount(0);
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
  await mockBoard(page, board);
  await page.addInitScript(() =>
    localStorage.setItem(
      "whatsgoingon.board.v1",
      JSON.stringify({ webhook: "never-copy-this-test-secret" }),
    ),
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
  ).toEqual({ webhook: "never-copy-this-test-secret" });
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

test("incident filter supports pointer, keyboard, themes and narrow screens", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-31T12:00:00Z"));
  await mockFeeds(page, [
    report({
      id: "active",
      title: "Active interruption",
      active: true,
      status: "investigating",
      endedAt: null,
    }),
    report({
      id: "maintenance",
      title: "Scheduled maintenance",
      maintenance: true,
      status: "scheduled",
    }),
    report({ id: "resolved", title: "Resolved interruption" }),
  ]);
  for (const preset of [presets[0], presets[2]]) {
    await mockBoard(page, { ...defaultBoard(), appearance: preset.appearance });
    await page.goto("/");
    await page.getByRole("button", { name: /Incidents/ }).click();
    const filter = page.getByRole("button", { name: /^Filter incidents:/ });
    const options = page.getByRole("group", {
      name: "Filter incidents",
      exact: true,
    });
    const reports = page.locator(".report h3");
    await expect(reports).toHaveCount(3);
    await filter.click();
    await expect(filter).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("radio", { name: "All reports", exact: true }),
    ).toBeChecked();
    await options.getByText("Active incidents", { exact: true }).click();
    await expect(reports).toHaveText(["Active interruption"]);
    await expect(options).toBeHidden();
    await expect(filter).toBeFocused();
    await filter.press("Enter");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("radio", { name: "Active incidents", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`filter-${preset.name}-keyboard.png`),
    });
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("radio", { name: "Maintenance", exact: true }),
    ).toBeChecked();
    await expect(reports).toHaveText(["Scheduled maintenance"]);
    await page.keyboard.press("ArrowDown");
    await expect(reports).toHaveText(["Resolved interruption"]);
    await page.keyboard.press("Enter");
    await expect(options).toBeHidden();
    await expect(filter).toBeFocused();
    await filter.press("Space");
    await page.keyboard.press("Escape");
    await expect(options).toBeHidden();
    await expect(filter).toBeFocused();
    await filter.click();
    await page
      .getByRole("heading", { name: "Service status", exact: true })
      .click();
    await expect(options).toBeHidden();
    await filter.focus();
    await filter.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(options).toBeHidden();
    await expect(page.locator(".report")).toBeFocused();
    await filter.click();
    await options.getByText("All reports", { exact: true }).click();
    await expect(reports).toHaveCount(3);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await filter.click();
      await expect(options).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const bounds = (await options.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`filter-${preset.name}-${width}.png`),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});

test.describe("incident filter on touch screens", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("selects a filter and dismisses it when reselecting the same option", async ({ page }) => {
    await mockFeeds(page, [report({})]);
    await page.goto("/");
    await page.getByRole("button", { name: /Incidents/ }).tap();
    const filter = page.getByRole("button", { name: /^Filter incidents:/ });
    const options = page.getByRole("group", { name: "Filter incidents", exact: true });
    await filter.tap();
    await options.getByText("Past incidents", { exact: true }).tap();
    await expect(filter).toHaveAccessibleName("Filter incidents: Past incidents");
    await expect(filter).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".report h3")).toHaveText(["SQL interruption"]);
    await filter.tap();
    await options.getByText("Past incidents", { exact: true }).tap();
    await expect(options).toBeHidden();
  });
});

test("history opens scoped UTC reports by pointer and keyboard, with an honest empty state", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-31T12:00:00Z"));
  await mockBoard(page, {
    ...defaultBoard(),
    monitors: [{ id: "databricks", componentIds: ["sql:au"], group: "" }],
  });
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

test("unavailable history is distinct from a returned history with no records", async ({
  page,
}) => {
  await mockFeeds(page);
  let unavailable = true;
  await page.route("**/api/history/**", (route) =>
    unavailable ? route.abort() : route.fallback(),
  );
  await page.goto("/");
  await expect(page.locator(".history-description")).toHaveText(
    "Recorded history is unavailable",
  );
  await page.getByRole("slider").focus();
  await expect(page.getByRole("slider")).toHaveAttribute(
    "aria-valuetext",
    "Recorded history is unavailable",
  );
  unavailable = false;
  await page.reload();
  await expect(page.locator(".history-description")).toHaveText(
    "No local checks or provider reports recorded yet",
  );
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
  await expect(bars).toHaveAttribute(
    "aria-valuetext",
    /Unknown.*Near-complete local coverage/,
  );
  await expect(bars.locator("rect.bar").nth(86)).toHaveAttribute("fill", /url/);
  await expect(
    page.getByText(
      /Hatching indicates an unknown state or incomplete local coverage/,
    ),
  ).toBeVisible();
  const box = (await bars.boundingBox())!;
  await bars.hover({ position: { x: (box.width * 88.5) / 90, y: 16 } });
  await expect(page.locator(".history-description")).toContainText(
    "2 provider reports",
  );
  await page.mouse.move(0, 0);
  await expect(page.locator(".history-description")).toContainText(
    "2 provider reports",
  );
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

test("compact navigation keeps setup and feedback accessible on desktop and mobile", async ({
  page,
}, testInfo) => {
  await mockFeeds(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Service status", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No account. Your board.")).toHaveCount(0);
  await expect(page.getByText("Every service. One view.")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("header-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("header-mobile.png"),
    fullPage: true,
  });
  const setup = page.getByRole("button", {
    name: "Set up your own",
    exact: true,
  });
  await setup.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(setup).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Request a feature" }),
  ).toBeFocused();
});

test("a failed refresh keeps recorded reports but marks the service unknown", async ({
  page,
}) => {
  await mockFeeds(page, [
    report({ active: true, status: "investigating", endedAt: null }),
  ]);
  await page.goto("/");
  await expect(
    page.getByRole("button", {
      name: "Databricks (AWS): Outage. View reports",
    }),
  ).toBeVisible();
  await page.route("**/api/status/**", (route) => route.abort());
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(
    page.getByRole("button", {
      name: "Databricks (AWS): Unknown. View reports",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /SQL interruption/ }).click();
  await expect(page.getByRole("dialog")).toContainText("SQL interruption");
});

test("status reports wait for a snapshot and keep Checking as their accessible name", async ({
  page,
}) => {
  await mockFeeds(page);
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/status/**", async (route) => {
    await ready;
    await route.fallback();
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Checking\. View reports/ }),
  ).toContainText("Checking");
  await expect(
    page.getByRole("button", { name: /Checking\. View reports/ }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByRole("button", {
      name: "Databricks (AWS): Outage. View reports",
    }),
  ).toBeEnabled();
  await page.route("**/api/status/**", (route) => route.abort());
  await page.reload();
  const failedStatus = page.getByRole("button", {
    name: "Databricks (AWS): Unknown. View reports",
  });
  await expect(failedStatus).toBeEnabled();
  await failedStatus.click();
  await expect(page.getByRole("dialog")).toContainText(
    "No provider report is available",
  );
});

test("incident lifecycle badges identify impact without colour", async ({
  page,
}, testInfo) => {
  const at = new Date().toISOString();
  const reports: Incident[] = (["outage", "degraded"] as const).flatMap(
    (state) =>
      ["investigating", "", "Checking"].map((status) => ({
        id: `${state}-${status}`,
        title: `${state} ${status || "empty"} incident`,
        status,
        state,
        active: true,
        maintenance: false,
        startedAt: at,
        updatedAt: at,
        endedAt: null,
        componentIds: [],
        body: "Investigating service impact.",
        url: "https://status.example.com/incident",
        updates: [],
      })),
  );
  reports.push(
    {
      ...reports[0],
      id: "scheduled",
      title: "Scheduled maintenance",
      status: "scheduled",
      state: "maintenance",
      maintenance: true,
      active: false,
    },
    {
      ...reports[0],
      id: "completed",
      title: "Completed maintenance",
      status: "completed",
      state: "maintenance",
      maintenance: true,
      active: false,
      endedAt: at,
    },
  );
  await mockFeeds(page, reports);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Incidents (6)", exact: true })
    .click();
  await expect(page.locator(".report .badge")).toHaveText([
    "Outage · investigating",
    "Outage",
    "Outage",
    "Degraded · investigating",
    "Degraded",
    "Degraded",
    "Maintenance · scheduled",
    "Operational · completed",
  ]);
  await page.screenshot({
    path: testInfo.outputPath("incident-badges.png"),
    fullPage: true,
  });
  for (const [title, label] of [
    ["outage investigating incident", "Outage · investigating"],
    ["outage empty incident", "Outage"],
    ["outage Checking incident", "Outage"],
    ["Scheduled maintenance", "Maintenance · scheduled"],
    ["Completed maintenance", "Operational · completed"],
  ]) {
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.getByRole("dialog").locator(".badge")).toHaveText(label);
    await page.keyboard.press("Escape");
  }
});


test("non-JSON API errors explain unavailable status data without leaking parser errors", async ({ page }, testInfo) => {
  await mockFeeds(page);
  for (const response of [
    { status: 404, contentType: "text/plain", body: "The page could not be found" },
    { status: 200, contentType: "text/html", body: "<!DOCTYPE html><title>Dashboard</title>" },
  ]) {
    await page.route("**/api/status/**", route => route.fulfill(response));
    await page.goto("/");
    await expect(page.getByText("The status service is unavailable. Please try again later.")).toBeVisible();
    await expect(page.getByText("Unexpected token", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Databricks (AWS): Unknown. View reports" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`api-unavailable-${response.status}.png`), fullPage: true });
    await page.unroute("**/api/status/**");
  }
});
