import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultBoard,
  readBoard,
  shareBoard,
  boardFromHash,
  scoped,
  changesBetween,
} from "../shared/board.ts";
import type { Snapshot, Incident } from "../shared/types.ts";
import { parseStatusio, parseStatuspage } from "../server/feeds.ts";
import { publicAddress, publicUrl } from "../server/http.ts";
import { providers } from "../server/catalog.ts";
import { collect } from "../server/collector.ts";
import { Store } from "../server/store.ts";
import { Alerts, notificationPayload } from "../server/alerts.ts";
import { Collector } from "../server/collector.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const at = "2026-10-31T12:00:00.000Z";
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: "databricks",
    name: "Databricks",
    statusUrl: "https://status.databricks.com",
    checkedAt: at,
    fetchedAt: at,
    stale: false,
    state: "operational",
    components: [
      { id: "sql:au", name: "SQL", group: "Sydney", state: "operational" },
      { id: "sql:us", name: "SQL", group: "US", state: "outage" },
    ],
    incidents: [],
    ...overrides,
  };
}
const incident: Incident = {
  id: "one",
  title: "SQL unavailable",
  status: "investigating",
  state: "outage",
  active: true,
  maintenance: false,
  startedAt: at,
  updatedAt: at,
  endedAt: null,
  componentIds: ["sql:us"],
  body: "Investigating.",
  url: "https://status.example.com/incidents/one",
  updates: [],
};

test("Databricks product and region intersections exclude unrelated incidents", () => {
  const feed = {
    result: {
      status: [
        {
          id: "sql",
          name: "SQL",
          containers: [
            { id: "au", name: "Sydney", status_code: 100 },
            { id: "us", name: "US", status_code: 500 },
          ],
        },
        {
          id: "jobs",
          name: "Jobs",
          containers: [{ id: "au", name: "Sydney", status_code: 100 }],
        },
      ],
      incidents: [
        {
          _id: "one",
          name: "SQL issue",
          components_affected: [{ _id: "sql", name: "SQL" }],
          containers_affected: [{ _id: "us", name: "US" }],
          messages: [
            { details: "Investigating", datetime: at, state: 100, status: 500 },
          ],
        },
      ],
      maintenance: { active: [], upcoming: [] },
    },
  };
  const parsed = parseStatusio(feed, providers[0]);
  assert.deepEqual(parsed.incidents[0].componentIds, ["sql:us"]);
  const current = snapshot(parsed);
  const selected = scoped(
    current,
    { id: "databricks", componentIds: ["sql:au"], group: "" },
    Date.parse(at),
  );
  assert.equal(selected.state, "operational");
  assert.equal(selected.incidents.length, 0);
  assert.equal(
    scoped(
      current,
      { id: "databricks", componentIds: ["missing"], group: "" },
      Date.parse(at),
    ).state,
    "unknown",
  );
});

test("Codex uses full components, filters unrelated incidents, and rejects script links", () => {
  const provider = providers.find((p) => p.id === "codex")!;
  const data = {
    components: [{ id: "chat", name: "ChatGPT", status: "major_outage" }],
    incidents: [
      {
        id: "chat-incident",
        name: "ChatGPT issue",
        status: "investigating",
        components: [{ id: "chat" }],
      },
      {
        id: "codex-incident",
        name: "Codex issue",
        status: "investigating",
        components: [{ id: "code" }],
        shortlink: "javascript:alert(1)",
      },
    ],
  };
  const parsed = parseStatuspage(data, provider, {
    components: [
      { id: "chat", name: "ChatGPT", status: "major_outage" },
      { id: "code", name: "Codex API", status: "degraded_performance" },
    ],
  });
  assert.deepEqual(
    parsed.components.map((c) => c.id),
    ["code"],
  );
  assert.deepEqual(
    parsed.incidents.map((i) => i.id),
    ["codex-incident"],
  );
  assert.ok(parsed.incidents[0].url.startsWith("https://status.openai.com/"));
});

test("current feed stays useful when optional incident history fails", async () => {
  const provider = providers.find((p) => p.id === "claude")!;
  const current = await collect(provider, undefined, async (url) => {
    if (url.endsWith("incidents.json")) throw new Error("unavailable");
    return {
      components: [{ id: "claude", name: "Claude", status: "operational" }],
      incidents: [],
    };
  });
  assert.equal(current.state, "operational");
  assert.equal(current.stale, false);
  assert.match(current.warning!, /history is unavailable/);
});

test("failed feeds and old observations become unknown without losing the last observation", async () => {
  const old = snapshot();
  const failed = await collect(providers[0], old, async () => {
    throw new Error("failed");
  });
  assert.equal(failed.state, "unknown");
  assert.equal(failed.stale, true);
  assert.equal(failed.fetchedAt, old.fetchedAt);
  assert.equal(
    scoped(old, defaultBoard().monitors[0], Date.parse(at) + 181_000).state,
    "unknown",
  );
});

test("share/import round trip excludes unexpected keys and disables recipient notifications", () => {
  const board = readBoard({
    ...defaultBoard(),
    name: "Data & AI 👀",
    notifications: true,
    webhook: "secret",
    monitors: [{ ...defaultBoard().monitors[0], token: "secret" }],
  });
  const hash = shareBoard(board);
  assert.equal(hash.includes("secret"), false);
  assert.equal(boardFromHash(hash)?.name, "Data & AI 👀");
  assert.equal(boardFromHash(hash)?.notifications, false);
  assert.throws(() =>
    readBoard({ ...board, monitors: [...board.monitors, ...board.monitors] }),
  );
  assert.throws(() => boardFromHash("#board=%not-json"));
  assert.throws(() =>
    readBoard({
      ...board,
      monitors: [
        {
          id: "custom",
          group: "",
          componentIds: [],
          custom: {
            name: "Unsafe",
            kind: "http",
            url: "https://user:password@example.com",
          },
        },
      ],
    }),
  );
});

test("outbound URL validation rejects private, mapped, encoded, and non-HTTPS targets", () => {
  for (const value of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.1",
    "172.16.0.1",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(value), false, value);
  assert.equal(publicAddress("1.1.1.1"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  for (const value of [
    "http://example.com",
    "https://127.1",
    "https://2130706433",
    "https://localhost",
    "https://example.local",
    "https://example.com:444",
    "https://u:p@example.com",
  ])
    assert.throws(() => publicUrl(value), value);
});

test("history never invents healthy days and persists across collection failures", () => {
  const store = new Store(":memory:");
  try {
    store.save(snapshot({ components: [snapshot().components[0]] }));
    const history = store.history(
      "databricks",
      defaultBoard().monitors[0],
      Date.parse(at) + 60_000,
    );
    assert.equal(history.days.length, 90);
    assert.ok(
      history.days
        .slice(0, -1)
        .every((day) => day.state === "unknown" && !day.complete),
    );
    assert.equal(history.days.at(-1)?.complete, false);
    store.save(
      snapshot({
        checkedAt: "2026-10-31T12:01:00.000Z",
        incidents: [incident],
      }),
    );
    assert.equal(store.incidents("databricks").length, 1);
    store.save(
      snapshot({
        checkedAt: "2026-10-31T12:02:00.000Z",
        stale: true,
        fetchedAt: at,
        incidents: [],
      }),
    );
    assert.equal(store.incidents("databricks")[0].active, true);
    store.save(
      snapshot({ checkedAt: "2026-10-31T12:03:00.000Z", incidents: [] }),
    );
    assert.equal(store.incidents("databricks")[0].status, "no_longer_reported");
    assert.equal(store.incidents("databricks")[0].endedAt, null);
  } finally {
    store.close();
  }
});

test("stable observations compact into spans but downtime gaps remain separate", () => {
  const store = new Store(":memory:");
  try {
    store.save(snapshot());
    store.save(
      snapshot({
        checkedAt: "2026-10-31T12:01:00.000Z",
        fetchedAt: "2026-10-31T12:01:00.000Z",
      }),
    );
    assert.equal(
      (
        store.db.prepare("SELECT count(*) AS n FROM spans").get() as {
          n: number;
        }
      ).n,
      1,
    );
    store.save(
      snapshot({
        checkedAt: "2026-10-31T14:00:00.000Z",
        fetchedAt: "2026-10-31T14:00:00.000Z",
      }),
    );
    assert.equal(
      (
        store.db.prepare("SELECT count(*) AS n FROM spans").get() as {
          n: number;
        }
      ).n,
      2,
    );
  } finally {
    store.close();
  }
});

test("change detection establishes a baseline and catches updates and recovery", () => {
  assert.deepEqual(changesBetween(undefined, snapshot()), []);
  const before = snapshot({ incidents: [incident], state: "outage" });
  const after = snapshot({
    incidents: [
      {
        ...incident,
        status: "resolved",
        active: false,
        updatedAt: "2026-10-31T12:03:00.000Z",
      },
    ],
    state: "operational",
  });
  const changes = changesBetween(before, after);
  assert.equal(changes.length, 2);
  assert.ok(changes.every((c) => c.state === "operational"));
  assert.deepEqual(changesBetween(before, { ...after, stale: true }), []);
});

test("webhook outbox retries failures and removes delivered events without logging secrets", async () => {
  const store = new Store(":memory:");
  try {
    const alerts = new Alerts(new Collector(store));
    store.db
      .prepare(
        "INSERT INTO deliveries (id,destination,payload,next_at) VALUES (?,?,?,?)",
      )
      .run(
        "event-one",
        JSON.stringify({
          type: "webhook",
          url: "https://example.com/my-secret",
        }),
        '{"hello":"world"}',
        0,
      );
    await alerts.deliver(async () => {
      throw new Error("secret upstream response");
    }, 1000);
    const failed = store.db
      .prepare("SELECT attempts,next_at,last_error FROM deliveries")
      .get() as { attempts: number; next_at: number; last_error: string };
    assert.equal(failed.attempts, 1);
    assert.ok(failed.next_at > 1000);
    assert.equal(failed.last_error.includes("secret"), false);
    let delivered = false;
    await alerts.deliver(async (_url, options) => {
      delivered = true;
      assert.equal(options?.headers?.["X-Whatsgoingon-Event-Id"], "event-one");
      return { status: 204, body: "", latencyMs: 1 };
    }, failed.next_at);
    assert.equal(delivered, true);
    assert.equal(store.db.prepare("SELECT * FROM deliveries").all().length, 0);
  } finally {
    store.close();
  }
});

test("notification destinations receive their required payload format", () => {
  const event = changesBetween(snapshot(), snapshot({ state: "outage" }))[0];
  assert.deepEqual(
    (
      notificationPayload(event, {
        type: "slack",
        url: "https://example.com",
      }) as { text: string }
    ).text,
    event.title + "\n" + event.url,
  );
  const discord = notificationPayload(event, {
    type: "discord",
    url: "https://example.com",
  }) as { allowed_mentions: { parse: string[] } };
  assert.deepEqual(discord.allowed_mentions.parse, []);
  const pd = notificationPayload(event, {
    type: "pagerduty",
    url: "https://example.com",
    routingKey: "user-supplied",
  }) as { event_action: string; routing_key: string };
  assert.equal(pd.event_action, "trigger");
  assert.equal(pd.routing_key, "user-supplied");
});

test("daily sample counts stay exact across UTC midnight", () => {
  const store = new Store(":memory:");
  try {
    for (const checkedAt of [
      "2026-10-30T23:59:00.000Z",
      "2026-10-31T00:00:00.000Z",
      "2026-10-31T00:01:00.000Z",
    ])
      store.save(snapshot({ checkedAt, fetchedAt: checkedAt }));
    const days = store.history(
      "databricks",
      defaultBoard().monitors[0],
      Date.parse("2026-10-31T00:02:00.000Z"),
    ).days;
    assert.equal(days.at(-2)?.samples, 1);
    assert.equal(days.at(-1)?.samples, 2);
  } finally {
    store.close();
  }
});

test("a user-configured collector filters scope, enqueues changes and retains its baseline on restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whatsgoingon-alerts-test-"));
  const file = join(directory, "watch.config.json");
  const store = new Store(":memory:");
  try {
    writeFileSync(
      file,
      JSON.stringify({
        monitors: [{ id: "databricks", componentIds: ["sql:au"], group: "" }],
        destinations: [
          { type: "webhook", url: "https://example.com/user-owned-webhook" },
        ],
      }),
    );
    const collector = new Collector(store);
    const now = new Date().toISOString();
    let current = snapshot({ checkedAt: now, fetchedAt: now });
    collector.read = async () => current;
    const alerts = new Alerts(collector, file);
    await alerts.collect();
    assert.equal(store.db.prepare("SELECT * FROM deliveries").all().length, 0);
    current = {
      ...current,
      components: current.components.map((c) => ({ ...c, state: "outage" })),
    };
    await alerts.collect();
    assert.equal(store.db.prepare("SELECT * FROM deliveries").all().length, 1);
    await new Alerts(collector, file).collect();
    assert.equal(store.db.prepare("SELECT * FROM deliveries").all().length, 1);
    let sent = false;
    await alerts.deliver(async (url, options) => {
      assert.equal(url, "https://example.com/user-owned-webhook");
      assert.match(options?.body ?? "", /outage/);
      sent = true;
      return { status: 200, body: "ok", latencyMs: 1 };
    });
    assert.equal(sent, true);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
