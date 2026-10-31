import { createHash } from "node:crypto";
import type { Provider, Snapshot, Monitor } from "../shared/types.ts";
import { providers } from "./catalog.ts";
import {
  parseStatuspage,
  parseStatusio,
  parseBetterstack,
  stateOf,
} from "./feeds.ts";
import { fetchPublic, getJson, publicUrl } from "./http.ts";
import { Store } from "./store.ts";

export function customProvider(monitor: Monitor): Provider {
  if (!monitor.custom) throw new Error("Missing custom monitor.");
  const { url, kind } = monitor.custom;
  const parsed = publicUrl(url);
  if (parsed.search || parsed.hash)
    throw new Error("Monitor URLs cannot contain queries or fragments.");
  const base = parsed.href.replace(/\/$/, "");
  const id =
    "custom-" +
    createHash("sha256")
      .update(`${kind}:${base}:${monitor.custom.keyword ?? ""}`)
      .digest("hex")
      .slice(0, 20);
  return {
    id,
    name: parsed.hostname,
    statusUrl: base,
    category: "Custom",
    adapter: kind === "http" ? "http" : "statuspage",
    feed: kind === "http" ? base : `${base}/api/v2/summary.json`,
  };
}
export async function collect(
  provider: Provider,
  previous?: Snapshot,
  json = getJson,
  keyword?: string,
): Promise<Snapshot> {
  const checkedAt = new Date().toISOString();
  try {
    if (provider.adapter === "http") {
      const response = await fetchPublic(provider.feed);
      const up =
        response.status >= 200 &&
        response.status < 300 &&
        (!keyword || response.body.includes(keyword));
      return {
        id: provider.id,
        name: provider.name,
        statusUrl: provider.statusUrl,
        checkedAt,
        fetchedAt: checkedAt,
        stale: false,
        state: up ? "operational" : "outage",
        components: [
          {
            id: "endpoint",
            name: "HTTPS response",
            group: "",
            state: up ? "operational" : "outage",
          },
        ],
        incidents: [],
        latencyMs: response.latencyMs,
        certificateExpiresAt: response.certificateExpiresAt,
        warning: !up
          ? `Endpoint returned HTTP ${response.status}${keyword && !response.body.includes(keyword) ? "; expected text was not found" : ""}. Redirects are not followed.`
          : "A check from this server. This is separate from a provider-reported status.",
      };
    }
    const source = await json(provider.feed);
    let parsed;
    if (provider.adapter === "statuspage") {
      const extras = await Promise.allSettled([
        json(`${provider.statusUrl}/api/v2/components.json`),
        json(`${provider.statusUrl}/api/v2/incidents.json`),
      ]);
      // The summary can omit components; never silently use it for component-scoped monitors.
      if (extras[0].status === "rejected")
        throw new Error("The full component list is unavailable.");
      try {
        parsed = parseStatuspage(
          source,
          provider,
          extras[0].value,
          extras[1].status === "fulfilled" ? extras[1].value : undefined,
        );
      } catch {
        parsed = parseStatuspage(source, provider, extras[0].value);
        parsed.warning =
          "Incident history could not be interpreted. Current status is available.";
      }
      if (extras[1].status === "rejected")
        parsed.warning =
          "Provider incident history is unavailable. Current status is available.";
    } else if (provider.adapter === "statusio")
      parsed = parseStatusio(source, provider);
    else if (provider.adapter === "betterstack")
      parsed = parseBetterstack(source, provider);
    else throw new Error("Unsupported feed format.");
    return {
      ...parsed,
      id: provider.id,
      name: provider.name,
      statusUrl: provider.statusUrl,
      checkedAt,
      fetchedAt: new Date().toISOString(),
      stale: false,
      state: stateOf(parsed),
    };
  } catch {
    return {
      id: provider.id,
      name: provider.name,
      statusUrl: provider.statusUrl,
      checkedAt,
      fetchedAt: previous?.fetchedAt ?? null,
      stale: true,
      state: "unknown",
      components: previous?.components ?? [],
      incidents: previous?.incidents ?? [],
      warning:
        "The feed could not be reached or validated. Open the provider status page. Any previous data is marked stale.",
    };
  }
}
export class Collector {
  store: Store;
  pending = new Map<string, Promise<Snapshot>>();
  dynamic = new Map<
    string,
    { provider: Provider; keyword?: string; lastUsed: number }
  >();
  constructor(store: Store) {
    this.store = store;
  }
  register(monitor: Monitor): Provider {
    const known = providers.find((p) => p.id === monitor.id);
    if (known && !monitor.custom) return known;
    const provider = customProvider(monitor);
    if (!this.dynamic.has(provider.id) && this.dynamic.size >= 100)
      throw new Error(
        "Custom monitor capacity reached on this instance. Try again later.",
      );
    this.dynamic.set(provider.id, {
      provider,
      keyword: monitor.custom?.keyword,
      lastUsed: Date.now(),
    });
    return provider;
  }
  async read(provider: Provider): Promise<Snapshot> {
    const old = this.store.snapshot(provider.id);
    if (old && Date.now() - Date.parse(old.checkedAt) < 55_000)
      return this.withHistory(old);
    const running = this.pending.get(provider.id);
    if (running) return running;
    const operation = collect(
      provider,
      old,
      getJson,
      this.dynamic.get(provider.id)?.keyword,
    )
      .then((snapshot) => {
        this.store.save(snapshot);
        return this.withHistory(snapshot);
      })
      .finally(() => this.pending.delete(provider.id));
    this.pending.set(provider.id, operation);
    return operation;
  }
  withHistory(snapshot: Snapshot): Snapshot {
    const merged = new Map(
      this.store.incidents(snapshot.id).map((i) => [i.id, i]),
    );
    snapshot.incidents.forEach((i) => merged.set(i.id, i));
    return {
      ...snapshot,
      incidents: [...merged.values()].sort((a, b) =>
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
      ),
    };
  }
  async poll(): Promise<void> {
    for (const [id, item] of this.dynamic)
      if (Date.now() - item.lastUsed > 24 * 60 * 60_000)
        this.dynamic.delete(id);
    const all = [
      ...providers,
      ...[...this.dynamic.values()].map((item) => item.provider),
    ];
    for (let index = 0; index < all.length; index += 4)
      await Promise.allSettled(
        all.slice(index, index + 4).map((provider) => this.read(provider)),
      );
    this.store.prune();
  }
}
