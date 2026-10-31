import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { changesBetween, monitorSchema, scoped } from "../shared/board.ts";
import type { Change, Snapshot } from "../shared/types.ts";
import { fetchPublic, publicUrl } from "./http.ts";
import { Collector } from "./collector.ts";

const destinationSchema = z.object({
  type: z.enum(["webhook", "slack", "discord", "teams", "pagerduty"]),
  url: z.string().url(),
  routingKey: z.string().optional(),
});
export const watchSchema = z.object({
  monitors: z.array(monitorSchema).min(1).max(40),
  destinations: z.array(destinationSchema).min(1).max(10),
  alertLevel: z.enum(["all", "outage"]).default("all"),
});
type Destination = z.infer<typeof destinationSchema>;
export function notificationPayload(
  event: Change,
  destination: Destination,
): unknown {
  const text = `${event.title}\n${event.url}`;
  switch (destination.type) {
    case "slack":
      return { text };
    case "discord":
      return { content: text, allowed_mentions: { parse: [] } };
    case "teams":
      return {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              type: "AdaptiveCard",
              version: "1.4",
              body: [{ type: "TextBlock", text, wrap: true }],
            },
          },
        ],
      };
    case "pagerduty":
      return {
        routing_key: destination.routingKey,
        event_action: event.state === "operational" ? "resolve" : "trigger",
        dedup_key: `whatsgoingon:${event.providerId}`,
        payload: {
          summary: event.title,
          source: "whatsgoingon",
          severity: event.state === "outage" ? "critical" : "warning",
          timestamp: event.at,
        },
        links: [{ href: event.url, text: "Provider status" }],
      };
    default:
      return { type: "status.changed", event };
  }
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class Alerts {
  collector: Collector;
  config: z.infer<typeof watchSchema> | null;
  constructor(collector: Collector, file?: string) {
    this.collector = collector;
    this.config = file
      ? watchSchema.parse(JSON.parse(readFileSync(file, "utf8")))
      : null;
    for (const destination of this.config?.destinations ?? []) {
      publicUrl(destination.url);
      if (destination.type === "pagerduty" && !destination.routingKey)
        throw new Error("PagerDuty requires your own routingKey.");
    }
  }
  async collect(): Promise<void> {
    if (!this.config) return;
    const db = this.collector.store.db;
    for (const monitor of this.config.monitors) {
      const provider = this.collector.register(monitor);
      const current = scoped(await this.collector.read(provider), monitor);
      const key = hash(JSON.stringify(monitor));
      const row = db
        .prepare("SELECT data FROM baselines WHERE id=?")
        .get(key) as { data: string } | undefined;
      const previous: Snapshot | undefined = row
        ? JSON.parse(row.data)
        : undefined;
      const events = changesBetween(previous, current).filter(
        (event) =>
          this.config!.alertLevel === "all" ||
          event.state === "outage" ||
          (event.state === "operational" && previous?.state === "outage"),
      );
      db.exec("BEGIN");
      try {
        for (const event of events)
          for (const destination of this.config.destinations) {
            const id = hash(
              `${event.id}:${key}:${JSON.stringify(destination)}`,
            );
            db.prepare(
              "INSERT OR IGNORE INTO deliveries (id,destination,payload,next_at) VALUES (?,?,?,?)",
            ).run(
              id,
              JSON.stringify(destination),
              JSON.stringify(notificationPayload(event, destination)),
              Date.now(),
            );
          }
        if (!current.stale)
          db.prepare("INSERT OR REPLACE INTO baselines VALUES (?,?)").run(
            key,
            JSON.stringify(current),
          );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }
  async deliver(send = fetchPublic, now = Date.now()): Promise<void> {
    const db = this.collector.store.db;
    const rows = db
      .prepare(
        "SELECT id,destination,payload,attempts FROM deliveries WHERE next_at<=? AND attempts<6 ORDER BY next_at LIMIT 20",
      )
      .all(now) as {
      id: string;
      destination: string;
      payload: string;
      attempts: number;
    }[];
    for (const row of rows) {
      const destination: Destination = JSON.parse(row.destination);
      try {
        const response = await send(destination.url, {
          method: "POST",
          body: row.payload,
          headers: {
            "Content-Type": "application/json",
            "X-Whatsgoingon-Event-Id": row.id,
          },
        });
        if (response.status < 200 || response.status >= 300)
          throw new Error("Delivery rejected.");
        db.prepare("DELETE FROM deliveries WHERE id=?").run(row.id);
      } catch {
        db.prepare(
          "UPDATE deliveries SET attempts=attempts+1,next_at=?,last_error=? WHERE id=?",
        ).run(
          now + Math.min(3_600_000, 30_000 * 2 ** row.attempts),
          "Delivery failed. Check the destination on your instance.",
          row.id,
        );
      }
    }
  }
}
