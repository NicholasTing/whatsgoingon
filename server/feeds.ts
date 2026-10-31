import { z } from "zod";
import type { Provider, Component, Incident, Health } from "../shared/types.ts";
import { worst } from "../shared/board.ts";

export type Feed = {
  components: Component[];
  incidents: Incident[];
  warning?: string;
};
const text = z.string();
const maybeText = text.nullish();
export function health(value: string | number): Health {
  const status = String(value).toLowerCase();
  if (["operational", "ok", "none", "resolved", "100"].includes(status))
    return "operational";
  if (["maintenance", "under_maintenance", "200"].includes(status))
    return "maintenance";
  if (
    [
      "degraded",
      "degraded_performance",
      "partial_outage",
      "minor",
      "300",
      "400",
    ].includes(status)
  )
    return "degraded";
  if (
    [
      "downtime",
      "down",
      "major_outage",
      "full_outage",
      "major",
      "critical",
      "500",
      "600",
    ].includes(status)
  )
    return "outage";
  return "unknown";
}
export function iso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function plain(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}
export function safeLink(value: unknown, fallback: string): string {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : fallback;
  } catch {
    return fallback;
  }
}
export function stateOf(feed: Feed): Health {
  if (!feed.components.length)
    throw new Error("Provider returned no matching components.");
  return worst([
    ...feed.components.map((c) => c.state),
    ...feed.incidents.filter((i) => i.active).map((i) => i.state),
  ]);
}
const spComponent = z.object({
  id: text,
  name: text,
  status: text,
  group_id: maybeText,
  group: z.boolean().optional(),
});
const spIncident = z.object({
  id: text,
  name: text,
  status: text,
  impact: maybeText,
  created_at: maybeText,
  started_at: maybeText,
  updated_at: maybeText,
  resolved_at: maybeText,
  scheduled_for: maybeText,
  scheduled_until: maybeText,
  shortlink: maybeText,
  components: z.array(z.object({ id: text })).optional(),
  incident_updates: z
    .array(
      z.object({
        body: text,
        created_at: maybeText,
        display_at: maybeText,
        status: maybeText,
      }),
    )
    .optional(),
});
export function parseStatuspage(
  data: unknown,
  provider: Provider,
  fullComponents?: unknown,
  history?: unknown,
): Feed {
  const d = z
    .object({
      components: z.array(spComponent),
      incidents: z.array(spIncident).default([]),
      scheduled_maintenances: z.array(spIncident).default([]),
    })
    .parse(data);
  const all =
    fullComponents === undefined
      ? d.components
      : z.object({ components: z.array(spComponent) }).parse(fullComponents)
          .components;
  const pattern = provider.componentPattern
    ? new RegExp(provider.componentPattern, "i")
    : null;
  const selected = all.filter(
    (c) => !c.group && (!pattern || pattern.test(c.name)),
  );
  const ids = new Set(selected.map((c) => c.id));
  const previous =
    history === undefined
      ? []
      : z.object({ incidents: z.array(spIncident) }).parse(history).incidents;
  const incidents = [...previous, ...d.incidents, ...d.scheduled_maintenances]
    .filter(
      (i) =>
        !pattern ||
        !i.components?.length ||
        i.components.some((c) => ids.has(c.id)),
    )
    .map((i): Incident => {
      const maintenance =
        Boolean(i.scheduled_for) ||
        ["scheduled", "in_progress", "verifying", "completed"].includes(
          i.status,
        );
      const active = maintenance
        ? ["in_progress", "verifying"].includes(i.status)
        : !["resolved", "postmortem", "completed"].includes(i.status);
      return {
        id: i.id,
        title: i.name,
        status: i.status,
        active,
        maintenance,
        state: maintenance
          ? "maintenance"
          : ["major", "critical"].includes(i.impact ?? "")
            ? "outage"
            : "degraded",
        startedAt: iso(i.scheduled_for ?? i.started_at ?? i.created_at),
        updatedAt: iso(i.updated_at ?? i.created_at),
        endedAt: iso(i.resolved_at ?? i.scheduled_until),
        componentIds: i.components?.map((c) => c.id) ?? [],
        body: plain(i.incident_updates?.[0]?.body ?? ""),
        url: safeLink(
          i.shortlink,
          `${provider.statusUrl}/incidents/${encodeURIComponent(i.id)}`,
        ),
        updates: (i.incident_updates ?? []).map((u) => ({
          at: iso(u.display_at ?? u.created_at) ?? "",
          status: u.status ?? "",
          body: plain(u.body),
        })),
      };
    });
  return {
    components: selected.map((c) => ({
      id: c.id,
      name: c.name,
      group: all.find((g) => g.id === c.group_id)?.name ?? "",
      state: health(c.status),
    })),
    incidents: [...new Map(incidents.map((i) => [i.id, i])).values()],
  };
}
const named = z.object({ _id: text, name: text });
const sioIncident = z.object({
  _id: text,
  name: text,
  datetime_open: maybeText,
  datetime_planned_start: maybeText,
  datetime_planned_end: maybeText,
  containers_affected: z.array(named).optional(),
  components_affected: z.array(named).optional(),
  messages: z
    .array(
      z.object({
        details: text,
        state: z.number().optional(),
        status: z.number().optional(),
        datetime: text,
      }),
    )
    .default([]),
});
export function parseStatusio(data: unknown, provider: Provider): Feed {
  const d = z
    .object({
      result: z.object({
        status: z
          .array(
            z.object({
              id: text,
              name: text,
              containers: z.array(
                z.object({ id: text, name: text, status_code: z.number() }),
              ),
            }),
          )
          .min(1),
        incidents: z.array(sioIncident),
        maintenance: z.object({
          active: z.array(sioIncident),
          upcoming: z.array(sioIncident),
        }),
      }),
    })
    .parse(data).result;
  const components = d.status.flatMap((product) =>
    product.containers.map((region) => ({
      id: `${product.id}:${region.id}`,
      name: product.name,
      group: region.name,
      state: health(region.status_code),
    })),
  );
  const incidents = [
    ...d.incidents.map((i) => ({ i, maintenance: false, upcoming: false })),
    ...d.maintenance.active.map((i) => ({
      i,
      maintenance: true,
      upcoming: false,
    })),
    ...d.maintenance.upcoming.map((i) => ({
      i,
      maintenance: true,
      upcoming: true,
    })),
  ].map(({ i, maintenance, upcoming }): Incident => {
    const updates = [...i.messages].sort((a, b) =>
      b.datetime.localeCompare(a.datetime),
    );
    const status = upcoming
      ? "scheduled"
      : maintenance
        ? "in_progress"
        : ({
            100: "investigating",
            200: "identified",
            300: "monitoring",
            400: "resolved",
          }[updates[0]?.state ?? 0] ?? "investigating");
    const affected = components
      .filter((c) => {
        const [product, region] = c.id.split(":");
        return (
          (!i.components_affected?.length ||
            i.components_affected.some((p) => p._id === product)) &&
          (!i.containers_affected?.length ||
            i.containers_affected.some((r) => r._id === region))
        );
      })
      .map((c) => c.id);
    return {
      id: i._id,
      title: i.name,
      status,
      active: !upcoming && status !== "resolved",
      maintenance,
      state: maintenance
        ? "maintenance"
        : updates[0]?.status && updates[0].status >= 500
          ? "outage"
          : "degraded",
      startedAt: iso(i.datetime_planned_start ?? i.datetime_open),
      updatedAt: iso(updates[0]?.datetime ?? i.datetime_open),
      endedAt: iso(i.datetime_planned_end),
      componentIds: affected,
      body: plain(updates[0]?.details ?? ""),
      url: `${provider.statusUrl}/pages/${maintenance ? "maintenance" : "incident"}/${provider.feed.split("/").at(-1)}/${encodeURIComponent(i._id)}`,
      updates: updates.map((u) => ({
        at: iso(u.datetime) ?? "",
        status: String(u.state ?? ""),
        body: plain(u.details),
      })),
    };
  });
  return {
    components,
    incidents,
    warning:
      "This feed supplies current incidents and maintenance. Historical observations begin when this instance starts tracking.",
  };
}
export function parseBetterstack(
  data: unknown,
  provider: Provider,
  now = Date.now(),
): Feed {
  const item = z.object({
    id: text,
    type: text,
    attributes: z.record(z.string(), z.unknown()),
    relationships: z
      .object({
        status_updates: z.object({ data: z.array(z.object({ id: text })) }),
      })
      .optional(),
  });
  const included = z
    .object({ included: z.array(item).min(1) })
    .parse(data).included;
  const components = included
    .filter((i) => i.type === "status_page_resource")
    .map((i) => {
      const a = z
        .object({ public_name: text, status: text })
        .parse(i.attributes);
      return {
        id: i.id,
        name: a.public_name,
        group: "",
        state: health(a.status),
      };
    });
  const incidents = included
    .filter((i) => i.type === "status_report")
    .map((i): Incident => {
      const a = z
        .object({
          title: text,
          aggregate_state: text,
          report_type: text,
          starts_at: maybeText,
          ends_at: maybeText,
          affected_resources: z.array(
            z.object({ status_page_resource_id: text }),
          ),
        })
        .parse(i.attributes);
      const updateIds = new Set(
        i.relationships?.status_updates.data.map((u) => u.id),
      );
      const updates = included
        .filter((u) => u.type === "status_update" && updateIds.has(u.id))
        .map((u) =>
          z.object({ message: text, published_at: text }).parse(u.attributes),
        )
        .sort((a, b) => b.published_at.localeCompare(a.published_at));
      const maintenance = a.report_type === "maintenance";
      const scheduled = maintenance && Date.parse(a.starts_at ?? "") > now;
      const completed =
        a.aggregate_state === "resolved" ||
        Boolean(maintenance && a.ends_at && Date.parse(a.ends_at) <= now);
      return {
        id: i.id,
        title: a.title,
        status: scheduled
          ? "scheduled"
          : completed
            ? "resolved"
            : maintenance
              ? "in_progress"
              : a.aggregate_state,
        active: !scheduled && !completed,
        maintenance,
        state: maintenance ? "maintenance" : "degraded",
        startedAt: iso(a.starts_at),
        updatedAt: iso(updates[0]?.published_at ?? a.starts_at),
        endedAt: iso(
          a.ends_at ?? (completed ? updates[0]?.published_at : null),
        ),
        componentIds: a.affected_resources.map(
          (c) => c.status_page_resource_id,
        ),
        body: plain(updates[0]?.message ?? ""),
        url: `${provider.statusUrl}/incident/${encodeURIComponent(i.id)}`,
        updates: updates.map((u) => ({
          at: u.published_at,
          status: "",
          body: plain(u.message),
        })),
      };
    });
  return { components, incidents };
}
