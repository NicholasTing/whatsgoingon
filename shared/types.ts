import type { Appearance } from "./appearance.ts";

export type Health =
  "operational" | "degraded" | "outage" | "maintenance" | "unknown";
export type Component = {
  id: string;
  name: string;
  group: string;
  state: Health;
};
export type IncidentUpdate = { at: string; status: string; body: string };
export type Incident = {
  id: string;
  title: string;
  status: string;
  state: Health;
  active: boolean;
  maintenance: boolean;
  startedAt: string | null;
  updatedAt: string | null;
  endedAt: string | null;
  componentIds: string[];
  body: string;
  url: string;
  updates: IncidentUpdate[];
};
export type Provider = {
  id: string;
  name: string;
  category: string;
  statusUrl: string;
  adapter: "statuspage" | "statusio" | "betterstack" | "incidentio" | "http";
  feed: string;
  componentPattern?: string;
};
export type Snapshot = {
  id: string;
  name: string;
  statusUrl: string;
  state: Health;
  checkedAt: string;
  fetchedAt: string | null;
  stale: boolean;
  components: Component[];
  incidents: Incident[];
  warning?: string;
  latencyMs?: number;
  certificateExpiresAt?: string;
};
export type DailyStatus = {
  date: string;
  state: Health;
  samples: number;
  complete: boolean;
};
export type History = {
  days: DailyStatus[];
  observedSince: string | null;
  source: "observations";
  warning: string;
};
export type Monitor = {
  id: string;
  componentIds: string[];
  group: string;
  custom?: {
    name: string;
    url: string;
    kind: "statuspage" | "http";
    keyword?: string;
  };
};
export type Board = {
  version: 1;
  name: string;
  monitors: Monitor[];
  notifications: boolean;
  alertLevel: "all" | "outage";
  appearance: Appearance;
};
export type Change = {
  id: string;
  providerId: string;
  providerName: string;
  title: string;
  state: Health;
  at: string;
  url: string;
  kind: "status" | "incident";
};
export const labels: Record<Health, string> = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  maintenance: "Maintenance",
  unknown: "Unknown",
};
