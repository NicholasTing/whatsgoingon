import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";

async function mockFeeds(page: Page) {
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
        incidents: [],
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
  await page.getByRole("button", { name: "Databricks (AWS)" }).click();
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
  await recipient.getByLabel("Board name").fill("Recipient copy");
  await expect(
    page.getByRole("heading", { name: "My status board" }),
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
  await page.getByRole("button", { name: "Databricks (AWS)" }).click();
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
    page.getByRole("button", { name: "Databricks (AWS)" }),
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
