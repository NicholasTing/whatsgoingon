import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { z } from "zod";
import { providers } from "./catalog.ts";
import { Collector } from "./collector.ts";
import { Store } from "./store.ts";
import { Alerts } from "./alerts.ts";
import { monitorSchema, scoped } from "../shared/board.ts";
import { labels } from "../shared/types.ts";
import type { Monitor } from "../shared/types.ts";

const production = process.argv.includes("--production");
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const store = new Store(
  resolve(process.env.DATA_DIR ?? ".data", "status.sqlite"),
);
const collector = new Collector(store);
const alerts = new Alerts(collector, process.env.WATCH_CONFIG);
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({ server: { middlewareMode: true }, appType: "spa" });
const dist = resolve("dist");
const limits = new Map<string, { start: number; count: number }>();
let activeRequests = 0;
const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
function monitorFrom(url: URL, id: string): Monitor {
  const customUrl = url.searchParams.get("url");
  return monitorSchema.parse({
    id,
    componentIds: url.searchParams.getAll("component"),
    group: "",
    ...(customUrl
      ? {
          custom: {
            name: url.searchParams.get("name") ?? "Custom service",
            url: customUrl,
            kind: url.searchParams.get("kind") ?? "statuspage",
            ...(url.searchParams.has("keyword")
              ? { keyword: url.searchParams.get("keyword") }
              : {}),
          },
        }
      : {}),
  });
}
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (production)
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors *",
    );
  const json = (data: unknown, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  let counted = false;
  try {
    if (!req.url || req.url.length > 16_000)
      return json({ error: "Request too large." }, 414);
    if (!["GET", "HEAD"].includes(req.method ?? ""))
      return json(
        {
          error:
            "This API is read-only. Keep board configuration in your browser.",
        },
        405,
      );
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const ip = req.socket.remoteAddress ?? "unknown";
      const now = Date.now();
      for (const [key, value] of limits)
        if (now - value.start > 60_000) limits.delete(key);
      const limit = limits.get(ip) ?? { start: now, count: 0 };
      if (limit.count++ >= 180 || activeRequests >= 24 || limits.size >= 2000)
        return json(
          { error: "Too many requests. Try again in a minute." },
          429,
        );
      limits.set(ip, limit);
      activeRequests++;
      counted = true;
      if (url.pathname === "/api/health") return json({ ok: true });
      if (url.pathname === "/api/catalog") {
        const query = (url.searchParams.get("q") ?? "").toLowerCase();
        return json({
          providers: providers
            .filter((p) =>
              `${p.name} ${p.category}`.toLowerCase().includes(query),
            )
            .map(({ feed, ...provider }) => provider),
        });
      }
      const match = url.pathname.match(
        /^\/api\/(status|history|badge)\/([a-z0-9-]{1,80})(?:\.svg)?$/,
      );
      if (match) {
        const [, kind, id] = match;
        const monitor = monitorFrom(url, id);
        if (!monitor.custom && !providers.some((p) => p.id === id))
          return json({ error: "Unknown provider." }, 404);
        const provider = collector.register(monitor);
        const snapshot = scoped(await collector.read(provider), monitor);
        if (kind === "status") return json(snapshot);
        if (kind === "history")
          return json(store.history(provider.id, monitor));
        const color = {
          operational: "#16634c",
          degraded: "#925500",
          outage: "#b42335",
          maintenance: "#315da3",
          unknown: "#59636b",
        }[snapshot.state];
        res.writeHead(200, {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=30",
        });
        return res.end(
          `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="28" role="img" aria-label="${escapeXml(provider.name)}: ${labels[snapshot.state]}"><rect width="160" height="28" fill="#263b3a"/><rect x="160" width="120" height="28" fill="${color}"/><g fill="white" font-family="sans-serif" font-size="12" text-anchor="middle"><text x="80" y="18">${escapeXml(provider.name)}</text><text x="220" y="18">${labels[snapshot.state]}</text></g></svg>`,
        );
      }
      if (
        url.pathname === "/api/incidents" ||
        url.pathname === "/api/feed.xml"
      ) {
        const ids = z
          .array(z.string().max(80))
          .min(1)
          .max(40)
          .parse(
            (url.searchParams.get("providers") ?? "databricks").split(","),
          );
        const selected = ids.map((id) => providers.find((p) => p.id === id));
        if (selected.some((p) => !p))
          return json({ error: "Unknown provider." }, 400);
        const snapshots = await Promise.all(
          selected.map((p) => collector.read(p!)),
        );
        const incidents = snapshots
          .flatMap((s) =>
            s.incidents.map((i) => ({
              ...i,
              providerId: s.id,
              providerName: s.name,
            })),
          )
          .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
        if (url.pathname === "/api/incidents")
          return json({
            incidents,
            staleProviders: snapshots.filter((s) => s.stale).map((s) => s.id),
          });
        res.writeHead(200, {
          "Content-Type": "application/rss+xml; charset=utf-8",
          "Cache-Control": "no-store",
        });
        return res.end(
          `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>whatsgoingon incidents</title><link>https://github.com/NicholasTing/whatsgoingon</link><description>Provider-reported incidents and maintenance.</description>${incidents
            .slice(0, 100)
            .map(
              (i) =>
                `<item><guid isPermaLink="false">${escapeXml(`${i.providerId}:${i.id}`)}</guid><title>${escapeXml(`${i.providerName}: ${i.title} (${i.status})`)}</title><link>${escapeXml(i.url)}</link><description>${escapeXml(i.body)}</description>${i.updatedAt ? `<pubDate>${new Date(i.updatedAt).toUTCString()}</pubDate>` : ""}</item>`,
            )
            .join("")}</channel></rss>`,
        );
      }
      return json({ error: "Unknown endpoint." }, 404);
    }
    if (vite) return vite.middlewares(req, res);
    const pathname = decodeURIComponent(url.pathname);
    const path = resolve(dist, "." + pathname);
    if (!path.startsWith(dist + sep) && path !== dist)
      return json({ error: "Invalid path." }, 400);
    let file = path;
    try {
      if (!(await stat(file)).isFile()) file = resolve(dist, "index.html");
    } catch {
      file = resolve(dist, "index.html");
    }
    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".json": "application/json",
      ".png": "image/png",
    };
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Cache-Control": file.includes("/assets/")
        ? "public,max-age=31536000,immutable"
        : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : await readFile(file));
  } catch (error) {
    if (!res.headersSent)
      json(
        {
          error:
            error instanceof z.ZodError
              ? "Invalid configuration. Use public HTTPS URLs without credentials and a valid component selection."
              : "Request could not be completed. Check the URL and try again.",
        },
        400,
      );
    else res.end();
  } finally {
    if (counted) activeRequests--;
  }
});
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    await collector.poll();
    await alerts.collect();
    await alerts.deliver();
  } catch {
    console.error(
      "Background collection failed. It will retry on the next cycle.",
    );
  } finally {
    polling = false;
  }
}
const interval = setInterval(poll, 60_000);
server.listen(port, host, () => {
  console.log(`whatsgoingon is ready at http://${host}:${port}`);
  void poll();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    clearInterval(interval);
    server.close(() => {
      void vite?.close();
      store.close();
      process.exit(0);
    });
  });
