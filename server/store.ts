import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Snapshot,
  Incident,
  History,
  Health,
  Monitor,
} from "../shared/types.ts";
import { scoped, worst } from "../shared/board.ts";

const DAY = 86_400_000;
type Span = { start: number; end: number; count: number; states: string };
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS incidents (provider TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, seen INTEGER NOT NULL, PRIMARY KEY(provider,id));
      CREATE TABLE IF NOT EXISTS spans (provider TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, count INTEGER NOT NULL, states TEXT NOT NULL, PRIMARY KEY(provider,start));
      CREATE INDEX IF NOT EXISTS spans_end ON spans(provider,end);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, destination TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, last_error TEXT);
      CREATE TABLE IF NOT EXISTS baselines (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  }
  snapshot(id: string): Snapshot | undefined {
    const row = this.db
      .prepare("SELECT data FROM snapshots WHERE id=?")
      .get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  save(snapshot: Snapshot): void {
    const now = Date.parse(snapshot.checkedAt);
    const states = JSON.stringify({
      stale: snapshot.stale,
      components: snapshot.components,
      state: snapshot.state,
    });
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("INSERT OR REPLACE INTO snapshots VALUES (?,?)")
        .run(snapshot.id, JSON.stringify(snapshot));
      if (!snapshot.stale && snapshot.fetchedAt) {
        const current = new Set(snapshot.incidents.map((i) => i.id));
        const old = this.incidents(snapshot.id);
        for (const incident of old) {
          if (incident.active && !current.has(incident.id)) {
            this.db
              .prepare(
                "UPDATE incidents SET data=?,seen=? WHERE provider=? AND id=?",
              )
              .run(
                JSON.stringify({
                  ...incident,
                  active: false,
                  status: "no_longer_reported",
                  endedAt: null,
                  body: `${incident.body}\nThis incident is no longer in the current feed. The provider did not supply its resolution time.`,
                }),
                now,
                snapshot.id,
                incident.id,
              );
          }
        }
        for (const incident of snapshot.incidents)
          this.db
            .prepare("INSERT OR REPLACE INTO incidents VALUES (?,?,?,?)")
            .run(snapshot.id, incident.id, JSON.stringify(incident), now);
      }
      const previous = this.db
        .prepare(
          "SELECT start,end,count,states FROM spans WHERE provider=? ORDER BY start DESC LIMIT 1",
        )
        .get(snapshot.id) as Span | undefined;
      if (
        previous &&
        previous.states === states &&
        Math.floor(previous.start / DAY) === Math.floor(now / DAY) &&
        now >= previous.end &&
        now - previous.end <= 90_000
      ) {
        if (now > previous.end)
          this.db
            .prepare(
              "UPDATE spans SET end=?,count=count+1 WHERE provider=? AND start=?",
            )
            .run(now, snapshot.id, previous.start);
      } else
        this.db
          .prepare("INSERT OR REPLACE INTO spans VALUES (?,?,?,?,?)")
          .run(snapshot.id, now, now, 1, states);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  incidents(id: string): Incident[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM incidents WHERE provider=? ORDER BY seen DESC LIMIT 500",
        )
        .all(id) as { data: string }[]
    ).map((row) => JSON.parse(row.data));
  }
  history(id: string, monitor: Monitor, now = Date.now()): History {
    const today = Date.parse(new Date(now).toISOString().slice(0, 10));
    const beginning = today - 89 * DAY;
    const spans = this.db
      .prepare(
        "SELECT start,end,count,states FROM spans WHERE provider=? AND end>=? ORDER BY start",
      )
      .all(id, beginning) as Span[];
    const incidents = this.incidents(id);
    const days = Array.from({ length: 90 }, (_, index) => {
      const start = beginning + index * DAY;
      const end = Math.min(start + DAY, now);
      const observations = spans.filter(
        (span) => span.start < start + DAY && span.end >= start,
      );
      let coverage = 0;
      let coveredUntil = start;
      const states: Health[] = observations.map((span) => {
        const data = JSON.parse(span.states);
        coverage += Math.max(
          0,
          Math.min(span.end + 60_000, end) -
            Math.max(span.start, start, coveredUntil),
        );
        coveredUntil = Math.max(coveredUntil, Math.min(span.end + 60_000, end));
        return scoped(
          {
            ...data,
            id,
            name: "",
            statusUrl: "",
            checkedAt: new Date(span.end).toISOString(),
            fetchedAt: data.stale ? null : new Date(span.end).toISOString(),
            incidents: [],
          },
          monitor,
          span.end,
        ).state;
      });
      const reports = incidents.filter(
        (i) =>
          (!monitor.componentIds.length ||
            !i.componentIds.length ||
            i.componentIds.some((c) => monitor.componentIds.includes(c))) &&
          i.startedAt &&
          Date.parse(i.startedAt) < end &&
          (i.active ? now : Date.parse(i.endedAt ?? i.startedAt)) >= start &&
          i.status !== "scheduled",
      );
      return {
        date: new Date(start).toISOString().slice(0, 10),
        state: worst([...states, ...reports.map((i) => i.state)]),
        samples: observations.reduce((sum, span) => sum + span.count, 0),
        reports: reports.length,
        complete: end > start && coverage >= (end - start) * 0.99,
      };
    });
    return {
      days,
      observedSince: spans[0] ? new Date(spans[0].start).toISOString() : null,
      source: "observations",
      warning:
        "Local checks and provider reports are separate evidence, not measured uptime. A report can colour a day with no local checks; days with neither local checks nor provider reports stay unknown.",
    };
  }
  prune(now = Date.now()): void {
    this.db.prepare("DELETE FROM spans WHERE end<?").run(now - 91 * DAY);
    this.db.prepare("DELETE FROM incidents WHERE seen<?").run(now - 365 * DAY);
  }
  close(): void {
    this.db.close();
  }
}
