import { z } from "zod";
import type { Board, Monitor, Snapshot, Health, Change } from "./types.ts";

const httpsUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      !url.search &&
      !url.hash
    );
  }, "Use an HTTPS URL without credentials, a query string, or a fragment.");
export const monitorSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,80}$/),
  componentIds: z.array(z.string().max(200)).max(500).default([]),
  group: z.string().max(60).default(""),
  custom: z
    .object({
      name: z.string().trim().min(1).max(80),
      url: httpsUrl,
      kind: z.enum(["statuspage", "http"]),
      keyword: z.string().max(200).optional(),
    })
    .optional(),
});
export const boardSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(80),
  monitors: z
    .array(monitorSchema)
    .max(40)
    .refine(
      (items) => new Set(items.map((i) => i.id)).size === items.length,
      "Duplicate provider.",
    ),
  notifications: z.boolean().default(false),
  alertLevel: z.enum(["all", "outage"]).default("all"),
});
export function defaultBoard(): Board {
  return {
    version: 1,
    name: "My status board",
    monitors: [{ id: "databricks", componentIds: [], group: "" }],
    notifications: false,
    alertLevel: "all",
  };
}
export function readBoard(value: unknown): Board {
  return boardSchema.parse(value);
}
export function shareBoard(board: Board): string {
  const safe = readBoard({ ...board, notifications: false });
  return "#board=" + encodeURIComponent(JSON.stringify(safe));
}
export function boardFromHash(hash: string): Board | null {
  if (!hash.startsWith("#board=")) return null;
  if (hash.length > 60_000) throw new Error("This shared board is too large.");
  return readBoard(JSON.parse(decodeURIComponent(hash.slice(7))));
}
export const rank: Record<Health, number> = {
  operational: 0,
  maintenance: 1,
  unknown: 2,
  degraded: 3,
  outage: 4,
};
export function worst(states: Health[]): Health {
  return states.length
    ? states.reduce((a, b) => (rank[a] >= rank[b] ? a : b))
    : "unknown";
}
export function scoped(
  snapshot: Snapshot,
  monitor: Monitor,
  now = Date.now(),
): Snapshot {
  const stale =
    snapshot.stale ||
    !snapshot.fetchedAt ||
    now - Date.parse(snapshot.fetchedAt) > 180_000;
  const ids = new Set(monitor.componentIds);
  const components = ids.size
    ? snapshot.components.filter((c) => ids.has(c.id))
    : snapshot.components;
  const incidents = ids.size
    ? snapshot.incidents.filter(
        (i) =>
          !i.componentIds.length || i.componentIds.some((id) => ids.has(id)),
      )
    : snapshot.incidents;
  const missing =
    ids.size > 0 &&
    monitor.componentIds.some((id) => !components.some((c) => c.id === id));
  const state =
    stale || missing
      ? "unknown"
      : worst([
          ...components.map((c) => c.state),
          ...incidents.filter((i) => i.active).map((i) => i.state),
        ]);
  return {
    ...snapshot,
    components,
    incidents,
    state,
    stale,
    ...(missing
      ? {
          warning:
            "A selected component is no longer present in this feed. Review your selection.",
        }
      : {}),
  };
}
export function changesBetween(
  previous: Snapshot | undefined,
  current: Snapshot,
): Change[] {
  if (!previous || current.stale || !current.fetchedAt) return [];
  const changes: Change[] = [];
  if (!previous.stale && previous.state !== current.state)
    changes.push({
      id: `${current.id}:status:${current.checkedAt}`,
      providerId: current.id,
      providerName: current.name,
      title: `${current.name}: ${current.state}`,
      state: current.state,
      at: current.checkedAt,
      url: current.statusUrl,
      kind: "status",
    });
  for (const incident of current.incidents) {
    const old = previous.incidents.find((i) => i.id === incident.id);
    if (
      (!old && (incident.active || incident.status === "scheduled")) ||
      (old &&
        (old.updatedAt !== incident.updatedAt ||
          old.status !== incident.status))
    ) {
      changes.push({
        id: `${current.id}:incident:${incident.id}:${incident.updatedAt ?? incident.status}`,
        providerId: current.id,
        providerName: current.name,
        title: `${current.name}: ${incident.title} (${incident.status})`,
        state: incident.active ? incident.state : "operational",
        at: current.checkedAt,
        url: incident.url,
        kind: "incident",
      });
    }
  }
  return changes;
}
