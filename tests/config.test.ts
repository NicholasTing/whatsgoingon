import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBoard } from "../server/config.ts";
import { Collector } from "../server/collector.ts";
import { Store } from "../server/store.ts";

test("service arrays validate IDs, duplicates, scopes and custom URLs at startup", () => {
  const directory = mkdtempSync(join(tmpdir(), "whatsgoingon-config-"));
  const file = join(directory, "services.json");
  const load = (value: unknown) => {
    writeFileSync(file, JSON.stringify(value));
    return loadBoard(file);
  };
  try {
    assert.deepEqual(load([{ id: "claude" }]).monitors, [
      { id: "claude", componentIds: [], group: "" },
    ]);
    assert.deepEqual(load([]).monitors, []);
    assert.deepEqual(
      load([{ id: "databricks", componentIds: ["sql:au"], group: "Data" }])
        .monitors[0].componentIds,
      ["sql:au"],
    );
    for (const value of [
      {},
      [{ id: "unknown" }],
      [{ id: "claude" }, { id: "claude" }],
      [{ id: "claude", componentIds: "bad" }],
      [
        {
          id: "custom",
          custom: { name: "Unsafe", kind: "http", url: "https://127.0.0.1" },
        },
      ],
      [
        {
          id: "custom",
          custom: {
            name: "Unsafe",
            kind: "http",
            url: "https://user:password@example.com",
          },
        },
      ],
    ])
      assert.throws(() => load(value));
    writeFileSync(file, "[");
    assert.throws(() => loadBoard(file));
    assert.throws(() => loadBoard(join(directory, "missing.json")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("collection polls only registered services, including custom monitors without visitors", async () => {
  const store = new Store(":memory:");
  try {
    const collector = new Collector(store);
    const seen: string[] = [];
    collector.read = async (provider) => {
      seen.push(provider.id);
      return {
        id: provider.id,
        name: provider.name,
        statusUrl: provider.statusUrl,
        state: "unknown",
        stale: true,
        checkedAt: new Date().toISOString(),
        fetchedAt: null,
        components: [],
        incidents: [],
      };
    };
    await collector.poll();
    assert.deepEqual(seen, []);
    collector.register({ id: "claude", componentIds: [], group: "" });
    const custom = collector.register({
      id: "own-api",
      componentIds: [],
      group: "",
      custom: {
        name: "Own API",
        url: "https://example.com/health",
        kind: "http",
      },
    });
    await collector.poll();
    await collector.poll();
    assert.deepEqual(seen, ["claude", custom.id, "claude", custom.id]);
  } finally {
    store.close();
  }
});

test(
  "HTTP configuration is fixed until restart and cannot register or rescope monitors",
  { timeout: 20_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "whatsgoingon-api-"));
    const file = join(directory, "services.json");
    writeFileSync(
      file,
      JSON.stringify([{ id: "databricks", componentIds: ["sql:au"] }]),
    );
    const store = new Store(join(directory, "status.sqlite"));
    const at = new Date().toISOString();
    for (const id of ["databricks", "claude"])
      store.save({
        id,
        name: id,
        statusUrl: "https://status.example.com",
        state: "outage",
        checkedAt: at,
        fetchedAt: at,
        stale: false,
        components: [
          { id: "sql:au", name: "SQL", group: "AU", state: "operational" },
          { id: "sql:us", name: "SQL", group: "US", state: "outage" },
        ],
        incidents: [
          {
            id: "us-outage",
            title: "US outage",
            status: "investigating",
            state: "outage",
            active: true,
            maintenance: false,
            startedAt: at,
            updatedAt: at,
            endedAt: null,
            componentIds: ["sql:us"],
            body: "US impact",
            url: "https://status.example.com/incident",
            updates: [],
          },
        ],
      });
    store.close();
    let child: ReturnType<typeof spawn> | undefined;
    async function start() {
      child = spawn(process.execPath, ["server/index.ts", "--production"], {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "0",
          DATA_DIR: directory,
          SERVICES_CONFIG: file,
          WATCH_CONFIG: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const running = child;
      let output = "";
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Server startup timed out: ${output}`)),
          5000,
        );
        running.once("error", reject);
        running.once("exit", () => {
          clearTimeout(timer);
          reject(new Error(`Server exited: ${output}`));
        });
        running.stderr!.on("data", (chunk) => {
          output += chunk.toString();
        });
        running.stdout!.on("data", (chunk) => {
          output += chunk.toString();
          const match = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
      });
    }
    async function stop() {
      if (!child || child.exitCode !== null || child.signalCode !== null)
        return;
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child?.kill("SIGKILL"), 2000);
      await exited;
      clearTimeout(timer);
    }
    try {
      let base = await start();
      assert.equal(
        (await (await fetch(`${base}/api/board`)).json()).monitors[0].id,
        "databricks",
      );
      const status = await (
        await fetch(`${base}/api/status/databricks`)
      ).json();
      assert.equal(status.state, "operational");
      assert.deepEqual(
        status.components.map((component: { id: string }) => component.id),
        ["sql:au"],
      );
      assert.deepEqual(
        (await (await fetch(`${base}/api/incidents`)).json()).incidents,
        [],
      );
      assert.equal(
        (await (await fetch(`${base}/api/feed.xml`)).text()).includes(
          "US outage",
        ),
        false,
      );
      assert.deepEqual(
        (await (await fetch(`${base}/api/catalog`)).json()).providers.map(
          (p: { id: string }) => p.id,
        ),
        ["databricks"],
      );
      for (const kind of ["status", "history", "badge"]) {
        assert.equal((await fetch(`${base}/api/${kind}/claude`)).status, 404);
        assert.equal(
          (
            await fetch(
              `${base}/api/${kind}/custom?url=https://example.com&kind=http`,
            )
          ).status,
          400,
        );
        assert.equal(
          (await fetch(`${base}/api/${kind}/databricks?component=sql:us`))
            .status,
          400,
        );
      }
      for (const path of ["incidents", "feed.xml"]) {
        assert.equal(
          (await fetch(`${base}/api/${path}?providers=claude`)).status,
          400,
        );
      }
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.equal(
          (await fetch(`${base}/api/board`, { method, body: "[]" })).status,
          405,
        );
      }
      writeFileSync(file, JSON.stringify([{ id: "claude" }]));
      assert.equal(
        (await (await fetch(`${base}/api/board`)).json()).monitors[0].id,
        "databricks",
      );
      await stop();
      base = await start();
      assert.equal(
        (await (await fetch(`${base}/api/board`)).json()).monitors[0].id,
        "claude",
      );
      assert.equal((await fetch(`${base}/api/status/databricks`)).status, 404);
    } finally {
      await stop();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
