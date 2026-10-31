import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { historyDescription } from "../shared/history.ts";
import type { Incident, Monitor, Snapshot } from "../shared/types.ts";

const now = "2026-10-31T12:00:00.000Z";
const monitor: Monitor = { id: "example", componentIds: [], group: "" };
function report(id: string, changes: Partial<Incident> = {}): Incident {
  return {
    id,
    title: id,
    status: "resolved",
    state: "outage",
    active: false,
    maintenance: false,
    startedAt: "2026-10-29T11:00:00.000Z",
    updatedAt: "2026-10-29T12:00:00.000Z",
    endedAt: "2026-10-29T12:00:00.000Z",
    componentIds: [],
    body: "Service was unavailable.",
    url: `https://status.example.com/incidents/${id}`,
    updates: [],
    ...changes,
  };
}
function snapshot(incidents: Incident[]): Snapshot {
  return {
    id: monitor.id,
    name: "Example",
    statusUrl: "https://status.example.com",
    state: "operational",
    checkedAt: now,
    fetchedAt: now,
    stale: false,
    components: [
      { id: "au", name: "Australia", group: "", state: "operational" },
      { id: "us", name: "United States", group: "", state: "operational" },
    ],
    incidents,
  };
}

test("history distinguishes provider reports, observations, and missing evidence", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const incident = report("reported-outage");
  store.save(snapshot([incident]));
  const history = store.history(monitor.id, monitor, Date.parse(now));
  const outage = history.days.find((day) => day.date === "2026-10-29")!;
  assert.equal(outage.state, "outage");
  assert.equal(outage.samples, 0);
  assert.equal(outage.complete, false);
  assert.deepEqual(outage.incidentIds, [incident.id]);
  assert.deepEqual(history.incidents, [incident]);
  assert.match(historyDescription(outage), /No checks recorded/);
  assert.match(
    historyDescription(outage),
    /Status is based on provider reports/,
  );
  assert.match(historyDescription(outage), /1 related provider report\./);

  const unknown = history.days.find((day) => day.date === "2026-10-28")!;
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.samples, 0);
  assert.deepEqual(unknown.incidentIds, []);
  assert.match(historyDescription(unknown), /Availability is unknown/);

  const observed = history.days.at(-1)!;
  assert.equal(observed.state, "operational");
  assert.equal(observed.samples, 1);
  assert.deepEqual(observed.incidentIds, []);
  assert.match(historyDescription(observed), /1 recorded check\./);
});

test("history relates only selected component reports and provider-wide reports", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const reports = [
    report("au-issue", { componentIds: ["au"], state: "degraded" }),
    report("us-issue", { componentIds: ["us"] }),
    report("shared-maintenance", { maintenance: true, state: "maintenance" }),
  ];
  store.save(snapshot(reports));
  const history = store.history(
    monitor.id,
    { ...monitor, componentIds: ["au"] },
    Date.parse(now),
  );
  const affected = history.days.find((day) => day.date === "2026-10-29")!;
  assert.equal(affected.state, "degraded");
  assert.deepEqual(affected.incidentIds?.sort(), [
    "au-issue",
    "shared-maintenance",
  ]);
  assert.deepEqual(history.incidents?.map((incident) => incident.id).sort(), [
    "au-issue",
    "shared-maintenance",
  ]);
  assert.match(historyDescription(affected), /2 related provider reports\./);

  const unfiltered = store.history(monitor.id, monitor, Date.parse(now));
  assert.equal(unfiltered.incidents?.length, 3);
  assert.equal(
    unfiltered.days.find((day) => day.date === "2026-10-29")?.state,
    "outage",
  );
});

test("incident day boundaries are UTC and resolution at midnight excludes the next day", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  store.save(
    snapshot([
      report("ends-at-midnight", {
        startedAt: "2026-10-29T22:00:00.000Z",
        endedAt: "2026-10-30T00:00:00.000Z",
      }),
      report("starts-at-midnight", {
        startedAt: "2026-10-30T11:00:00.000+11:00",
        endedAt: "2026-10-30T02:00:00.000Z",
      }),
      report("crosses-midnight", {
        startedAt: "2026-10-29T23:00:00.000Z",
        endedAt: "2026-10-30T01:00:00.000Z",
      }),
      report("started-now", {
        startedAt: now,
        endedAt: null,
        active: true,
        status: "investigating",
      }),
    ]),
  );
  const history = store.history(monitor.id, monitor, Date.parse(now));
  assert.deepEqual(
    history.days.find((day) => day.date === "2026-10-29")?.incidentIds?.sort(),
    ["crosses-midnight", "ends-at-midnight"],
  );
  assert.deepEqual(
    history.days.find((day) => day.date === "2026-10-30")?.incidentIds?.sort(),
    ["crosses-midnight", "starts-at-midnight"],
  );
  assert.deepEqual(history.days.at(-1)?.incidentIds, ["started-now"]);
});

test("history includes active maintenance but not scheduled or future reports", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  store.save(
    snapshot([
      report("active-maintenance", {
        maintenance: true,
        state: "maintenance",
        status: "in_progress",
        active: true,
        startedAt: "2026-10-30T11:00:00.000Z",
        // The planned end is not a resolution while maintenance is active.
        endedAt: "2026-10-30T12:00:00.000Z",
      }),
      report("scheduled-maintenance", {
        maintenance: true,
        state: "maintenance",
        status: "scheduled",
      }),
      report("future", {
        startedAt: "2026-11-01T11:00:00.000Z",
        endedAt: null,
        active: true,
      }),
    ]),
  );
  const history = store.history(monitor.id, monitor, Date.parse(now));
  assert.deepEqual(
    history.incidents?.map((incident) => incident.id),
    ["active-maintenance"],
  );
  for (const day of history.days.slice(-2)) {
    assert.equal(day.state, "maintenance");
    assert.deepEqual(day.incidentIds, ["active-maintenance"]);
  }
});

test("missing resolution times do not invent incident duration or associations", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  store.save(
    snapshot([
      report("missing-resolution", {
        endedAt: null,
        status: "no_longer_reported",
      }),
      report("missing-start", { startedAt: null }),
      report("outside-window", {
        startedAt: "2026-01-01T11:00:00.000Z",
        endedAt: "2026-01-01T12:00:00.000Z",
      }),
    ]),
  );
  const history = store.history(monitor.id, monitor, Date.parse(now));
  assert.deepEqual(
    history.incidents?.map((incident) => incident.id),
    ["missing-resolution"],
  );
  assert.deepEqual(
    history.days
      .filter((day) => day.incidentIds?.length)
      .map((day) => day.date),
    ["2026-10-29"],
  );
});

test("history descriptions tolerate responses without incident metadata", () => {
  const description = historyDescription({
    date: "2026-10-29",
    state: "degraded",
    samples: 0,
    complete: false,
  });
  assert.match(description, /\(UTC\): Degraded/);
  assert.match(description, /Availability was not measured/);
  assert.doesNotMatch(description, /Availability is unknown|related provider/);
});
