import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { defaultBoard } from "../../shared/board.ts";
import { presets } from "../../shared/appearance.ts";
import type { DailyStatus, Incident } from "../../shared/types.ts";

async function mockFeeds(
  page: Page,
  incidents: Incident[] = [],
  days?: DailyStatus[],
) {
  await page.route("**/api/status/**", (route) => {
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
    return route.fulfill({
      json: {
        id,
        name: id === "databricks" ? "Databricks (AWS)" : id,
        statusUrl: "https://status.databricks.com",
        checkedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
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
        incidents,
        days:
          days ??
          Array.from({ length: 90 }, (_, i) => ({
            date: new Date(Date.now() - (89 - i) * 86400000)
              .toISOString()
              .slice(0, 10),
            state: "unknown",
            samples: 0,
            complete: false,
          })),
        observedSince: null,
        source: "observations",
        warning: "Incomplete history",
      },
    }),
  );
}

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
  await recipient.getByRole("button", { name: "Board settings" }).click();
  await expect(recipient.getByLabel("Board name", { exact: true })).toHaveCount(
    0,
  );
  await recipient.keyboard.press("Escape");
  await recipient
    .getByRole("button", { name: "Databricks (AWS)", exact: true })
    .click();
  await recipient
    .getByRole("button", { name: "Select all", exact: true })
    .click();
  await recipient.getByRole("button", { name: "Save selection" }).click();
  await expect(recipient.getByText("All products and regions")).toBeVisible();
  await expect(page.getByText("1 selected components")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Service status", exact: true }),
  ).toBeVisible();
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

test("status and daily history open related reports, with keyboard and pointer access", async ({
  page,
}) => {
  const incident: Incident = {
    id: "sql-outage",
    title: "SQL query failures",
    status: "investigating",
    state: "outage",
    active: true,
    maintenance: false,
    startedAt: "2026-10-29T11:00:00Z",
    updatedAt: "2026-10-29T12:00:00Z",
    endedAt: null,
    componentIds: ["sql:us"],
    body: "Investigating failed queries.",
    url: "https://status.databricks.com/incidents/sql-outage",
    updates: [
      {
        at: "2026-10-29T12:00:00Z",
        status: "investigating",
        body: "Investigating failed queries.",
      },
    ],
  };
  const maintenance: Incident = {
    ...incident,
    id: "sql-maintenance",
    title: "SQL maintenance",
    status: "completed",
    state: "maintenance",
    maintenance: true,
    active: false,
    endedAt: "2026-10-29T12:00:00Z",
    url: "https://status.databricks.com/incidents/sql-maintenance",
  };
  const days: DailyStatus[] = Array.from({ length: 90 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 7, 3 + i)).toISOString().slice(0, 10),
    state: i > 86 ? "outage" : "unknown",
    samples: 0,
    complete: false,
    incidentIds:
      i === 87 ? [incident.id, maintenance.id] : i > 87 ? [incident.id] : [],
  }));
  await mockFeeds(page, [incident, maintenance], days);
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Databricks (AWS): Outage. View status details",
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: incident.title }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View the provider’s incident" }),
  ).toHaveAttribute("href", incident.url);
  await expect(page.getByText(incident.body, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const bars = page.getByRole("slider");
  await bars.focus();
  await page.keyboard.press("End");
  await expect(bars).toHaveAttribute(
    "aria-valuetext",
    /No checks recorded. Status is based on provider reports/,
  );
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: incident.title }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bars).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  const related = page.getByRole("dialog", { name: /2026-10-29/ });
  await expect(
    related.getByRole("button", { name: incident.title }),
  ).toBeVisible();
  await related.getByRole("button", { name: maintenance.title }).click();
  await expect(
    page.getByRole("dialog", { name: maintenance.title }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(
    related.getByRole("button", { name: maintenance.title }),
  ).toBeFocused();
  await page.keyboard.press("Escape");

  await page.locator(".bar.outage").last().click();
  await expect(
    page.getByRole("dialog", { name: incident.title }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".bar.unknown").first().hover();
  await expect(bars).toHaveAttribute(
    "aria-valuetext",
    /Availability is unknown/,
  );
  await expect(page.locator(".bar.unknown").first()).toHaveAttribute(
    "fill",
    /url/,
  );
  await page.locator(".bar.unknown").first().click();
  await expect(page.getByRole("dialog")).toContainText(
    "Availability is unknown",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "No related incident report is available",
  );
  await expect(
    page.getByRole("link", { name: "View provider status page" }),
  ).toHaveAttribute("href", "https://status.databricks.com");
  await page.keyboard.press("Escape");

  await page.route("**/api/history/**", (route) =>
    route.fulfill({ status: 503, json: { error: "History unavailable" } }),
  );
  await page
    .getByRole("button", { name: "Databricks (AWS)", exact: true })
    .click();
  await page
    .getByLabel("Filter components by region or group")
    .selectOption("AP Southeast 2");
  await page.getByRole("button", { name: "Only these results" }).click();
  await page.getByRole("button", { name: "Save selection" }).click();
  await expect(
    page.getByRole("heading", { name: "All tracked services operational" }),
  ).toBeVisible();
  await expect(page.locator(".bar.outage")).toHaveCount(0);
  await bars.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(bars).not.toHaveAttribute("aria-valuetext", /provider reports/);
});

test("fresh boards use dark mode and status without a report explains the gap", async ({
  page,
}) => {
  await mockFeeds(page);
  await page.goto("/");
  await expect(page.locator(".app-shell")).toHaveCSS(
    "background-color",
    "rgb(16, 21, 30)",
  );
  await expect(
    page.getByRole("heading", { name: "Service status", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Databricks (AWS): Outage. View status details",
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "No related incident report is available",
  );
  await expect(
    page.getByRole("dialog").getByText("Outage", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.route("**/api/status/**", (route) =>
    route.fulfill({
      json: {
        id: "databricks",
        name: "Databricks (AWS)",
        statusUrl: "https://status.databricks.com",
        checkedAt: new Date().toISOString(),
        fetchedAt: new Date(Date.now() - 600_000).toISOString(),
        stale: false,
        state: "operational",
        components: [],
        incidents: [],
      },
    }),
  );
  await page.getByRole("button", { name: "Refresh now", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Databricks (AWS): Unknown. View status details",
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Fresh status is unavailable. Last successful check:",
  );
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
