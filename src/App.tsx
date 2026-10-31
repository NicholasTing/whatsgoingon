import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  Board,
  Change,
  Health,
  History,
  Incident,
  Monitor,
  Provider,
  Snapshot,
} from "../shared/types.ts";
import { labels } from "../shared/types.ts";
import {
  boardFromHash,
  changesBetween,
  defaultBoard,
  readBoard,
  scoped,
  shareBoard,
  worst,
} from "../shared/board.ts";
import { HistoryBars } from "./HistoryBars.tsx";
import { AppearancePanel } from "./AppearancePanel.tsx";
import { SetupPanel } from "./SetupPanel.tsx";
import { Icon } from "./Icon.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import { appearanceStyle } from "../shared/appearance.ts";

const STORAGE = "whatsgoingon.board.v1";
const GITHUB = "https://github.com/NicholasTing/whatsgoingon";
type Catalogue = Omit<Provider, "feed">;
type IncidentRow = Incident & { providerId: string; providerName: string };
function initial(): { board: Board; message: string } {
  try {
    const shared = boardFromHash(location.hash);
    if (shared)
      return {
        board: shared,
        message: "Shared board opened. Changes are saved only in this browser.",
      };
    const saved = localStorage.getItem(STORAGE);
    return {
      board: saved ? readBoard(JSON.parse(saved)) : defaultBoard(),
      message: "",
    };
  } catch {
    return {
      board: defaultBoard(),
      message:
        "A saved or shared board could not be read. Your default Databricks board is ready.",
    };
  }
}
function apiUrl(kind: string, monitor: Monitor): string {
  const query = new URLSearchParams();
  monitor.componentIds.forEach((id) => query.append("component", id));
  if (monitor.custom) {
    query.set("url", monitor.custom.url);
    query.set("kind", monitor.custom.kind);
    if (monitor.custom.keyword) query.set("keyword", monitor.custom.keyword);
  }
  return `/api/${kind}/${encodeURIComponent(monitor.id)}?${query}`;
}
async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function when(value: string | null): string {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Time not supplied";
}
function Badge({ state, text }: { state: Health; text?: string }) {
  return (
    <span className={`badge ${state}`}>
      <Icon name={state} />
      {text ?? labels[state]}
    </span>
  );
}
function Dialog({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={close}
          aria-label="Close dialog"
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function App() {
  const [start] = useState(initial);
  const [board, setBoard] = useState<Board>(start.board);
  const [catalog, setCatalog] = useState<Catalogue[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [histories, setHistories] = useState<Record<string, History>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(start.message);
  const [events, setEvents] = useState<Change[]>([]);
  const [now, setNow] = useState(Date.now());
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"overview" | "incidents" | "activity">(
    "overview",
  );
  const [query, setQuery] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [incidentFilter, setIncidentFilter] = useState("all");
  const [modal, setModal] = useState<
    "add" | "settings" | "integrations" | "appearance" | "setup" | null
  >(null);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<IncidentRow | null>(
    null,
  );
  const previous = useRef<Record<string, Snapshot>>({});
  const notificationPrefs = useRef(board);
  notificationPrefs.current = board;
  const monitorsKey = JSON.stringify(board.monitors);
  const embed = new URLSearchParams(location.search).has("embed");

  useEffect(() => {
    get<{ providers: Catalogue[] }>("/api/catalog")
      .then((data) => setCatalog(data.providers))
      .catch(() =>
        setMessage(
          "The provider catalogue could not be loaded. Check the server and refresh.",
        ),
      );
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(board));
    } catch {
      setMessage(
        "Browser storage is unavailable. Export your board to keep your changes.",
      );
    }
  }, [board]);
  useEffect(() => {
    const handler = () => {
      try {
        const value = boardFromHash(location.hash);
        if (value) {
          setBoard(value);
          setMessage("Shared board opened. Your changes stay in this browser.");
        }
      } catch {
        setMessage(
          "This shared board is invalid. Your current board is unchanged.",
        );
      }
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function update() {
      if (busy) return;
      busy = true;
      setLoading(true);
      await Promise.all(
        board.monitors.map(async (monitor) => {
          try {
            const [statusResult, historyResult] = await Promise.allSettled([
              get<Snapshot>(apiUrl("status", monitor), controller.signal),
              get<History>(apiUrl("history", monitor), controller.signal),
            ]);
            if (statusResult.status === "rejected") throw statusResult.reason;
            const snapshot = statusResult.value;
            if (controller.signal.aborted) return;
            const current = scoped(snapshot, monitor);
            const key = JSON.stringify(monitor);
            const old = previous.current[key];
            const changes = changesBetween(old, current);
            previous.current[key] = current;
            if (changes.length) {
              setEvents((old) => [...changes, ...old].slice(0, 100));
              for (const event of changes)
                if (
                  notificationPrefs.current.notifications &&
                  "Notification" in window &&
                  Notification.permission === "granted" &&
                  (notificationPrefs.current.alertLevel === "all" ||
                    event.state === "outage" ||
                    (event.state === "operational" && old?.state === "outage"))
                ) {
                  try {
                    const notification = new Notification("whatsgoingon", {
                      body: event.title,
                      tag: event.providerId,
                    });
                    notification.onclick = () => {
                      window.focus();
                      notification.close();
                    };
                  } catch {
                    setMessage(
                      "This browser could not show a desktop alert. Changes are still available in Activity.",
                    );
                  }
                }
            }
            setSnapshots((old) => ({ ...old, [monitor.id]: snapshot }));
            if (historyResult.status === "fulfilled")
              setHistories((old) => ({
                ...old,
                [monitor.id]: historyResult.value,
              }));
            setFailures((old) => {
              const copy = { ...old };
              delete copy[monitor.id];
              return copy;
            });
          } catch (error) {
            if (!controller.signal.aborted)
              setFailures((old) => ({
                ...old,
                [monitor.id]:
                  error instanceof Error ? error.message : "Could not refresh.",
              }));
          }
        }),
      );
      if (!controller.signal.aborted) {
        setLoading(false);
        setNow(Date.now());
      }
      busy = false;
    }
    void update();
    const interval = setInterval(update, 60_000);
    const wake = () => {
      if (!document.hidden) void update();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [monitorsKey, refresh]);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);
  const items = board.monitors.map((monitor) => {
    const provider = catalog.find((p) => p.id === monitor.id);
    const raw = snapshots[monitor.id];
    const snapshot = raw ? scoped(raw, monitor, now) : undefined;
    if (snapshot && failures[monitor.id]) {
      snapshot.state = "unknown";
      snapshot.stale = true;
    }
    return {
      monitor,
      provider,
      snapshot,
      name: monitor.custom?.name ?? provider?.name ?? monitor.id,
    };
  });
  const incidents: IncidentRow[] = items
    .flatMap(
      (item) =>
        item.snapshot?.incidents.map((i) => ({
          ...i,
          providerId: item.monitor.id,
          providerName: item.name,
        })) ?? [],
    )
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
  const state = worst(items.map((item) => item.snapshot?.state ?? "unknown"));
  const affected = items.filter((item) =>
    ["degraded", "outage"].includes(item.snapshot?.state ?? ""),
  ).length;
  const unknown = items.filter(
    (item) => !item.snapshot || item.snapshot.state === "unknown",
  ).length;
  const activeIncidents = incidents.filter(
    (i) => i.active && !i.maintenance,
  ).length;
  const visible = items.filter(
    (item) =>
      `${item.name} ${item.monitor.group}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!attentionOnly || item.snapshot?.state !== "operational"),
  );
  const grouped = [...new Set(visible.map((item) => item.monitor.group))];
  const shownIncidents = incidents.filter(
    (i) =>
      (incidentFilter === "all" ||
        (incidentFilter === "active" && i.active && !i.maintenance) ||
        (incidentFilter === "maintenance" && i.maintenance) ||
        (incidentFilter === "resolved" &&
          !i.active &&
          i.status !== "scheduled")) &&
      `${i.title} ${i.providerName} ${i.body}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function add(id: string) {
    setBoard((old) =>
      old.monitors.some((m) => m.id === id)
        ? old
        : {
            ...old,
            monitors: [...old.monitors, { id, componentIds: [], group: "" }],
          },
    );
    setMessage("Service added to your board.");
  }
  async function share() {
    try {
      const url = new URL(location.href);
      url.search = "";
      url.hash = shareBoard(board);
      if (url.href.length > 60_000) {
        setMessage(
          "This board is too large for a share link. Export its configuration from Board settings instead.",
        );
        return;
      }
      await navigator.clipboard.writeText(url.href);
      setMessage(
        "Board link copied. It shares your service selection, not a live-editable workspace.",
      );
    } catch {
      setMessage(
        "Clipboard access is unavailable. Export your board from Settings to share it.",
      );
    }
  }
  async function notifications() {
    if (!("Notification" in window)) {
      setMessage(
        "Browser notifications are unavailable here. Use the Activity tab or connect your own collector.",
      );
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setBoard((old) => ({ ...old, notifications: permission === "granted" }));
      setMessage(
        permission === "granted"
          ? "Browser alerts enabled. Keep this page open; background tabs may be throttled."
          : "Notifications were not enabled. You can change this in your browser settings.",
      );
    } catch {
      setMessage(
        "This browser does not support desktop notifications. Activity is still recorded while the page is open.",
      );
    }
  }
  return (
    <div className="app-shell" style={appearanceStyle(board.appearance)}>
      <a className="skip" href="#main">
        Skip to status board
      </a>
      <header className="site-header">
        <a className="brand" href="/" aria-label="whatsgoingon home">
          <img src="/favicon.svg" width="34" height="34" alt="" />
          <span>
            whatsgoingon<span className="brand-dot">.</span>
          </span>
        </a>
      </header>
      <main id="main" className={embed ? "embedded" : ""}>
        {!embed && (
          <section className="masthead">
            <h1>Service status</h1>
            <div className="masthead-actions">
              <button
                className="secondary"
                onClick={() => setModal("appearance")}
              >
                <Icon name="appearance" />
                Appearance
              </button>
              <button
                className="secondary"
                onClick={() => setModal("settings")}
              >
                <Icon name="settings" /> Board settings
              </button>
              <button className="primary" onClick={() => setModal("add")}>
                <Icon name="plus" /> Add services
              </button>
            </div>
          </section>
        )}
        {message && (
          <div className="notice" role="status">
            <span>{message}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setMessage("")}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        <section className={`summary ${state}`} aria-label="Board summary">
          <div className="summary-icon" aria-hidden="true">
            <Icon name={state} size={24} />
          </div>
          <div>
            <h2>
              {!items.length
                ? "Make yourself a status board"
                : unknown === items.length
                  ? "Getting the full picture"
                  : affected
                    ? `${affected} ${affected === 1 ? "service needs" : "services need"} attention`
                    : unknown
                      ? "Some services could not be checked"
                      : state === "maintenance"
                        ? "Maintenance is in progress"
                        : "All tracked services operational"}
            </h2>
            <p>
              {!items.length
                ? "Choose a provider to start watching its public status."
                : `${items.length} ${items.length === 1 ? "service" : "services"} tracked · ${activeIncidents} active incidents${unknown ? ` · ${unknown} unknown` : ""}`}
            </p>
          </div>
          <div className="refresh-status">
            <span>
              <span
                className={`live-dot ${loading ? "loading" : ""}`}
                aria-hidden="true"
              />
              {loading ? "Checking providers…" : "Refreshes every minute"}
            </span>
            <button
              className="text-button"
              onClick={() => setRefresh((n) => n + 1)}
              disabled={loading}
            >
              <Icon name="refresh" size={13} /> Refresh now
            </button>
          </div>
        </section>
        <div className="board-heading">
          <div>
            <h2>{board.name}</h2>
            <span className="small muted">
              Public provider reports. Account-specific issues may differ.
            </span>
          </div>
          <div className="board-actions">
            <button className="text-button" onClick={share}>
              <Icon name="share" /> Share board
            </button>
            <button
              className="text-button"
              onClick={() => setModal("integrations")}
            >
              <Icon name="integrations" /> API & alerts
            </button>
          </div>
        </div>
        <div className="toolbar">
          <nav aria-label="Board views">
            {(["overview", "incidents", "activity"] as const).map((tab) => (
              <button
                key={tab}
                className={view === tab ? "tab active" : "tab"}
                aria-current={view === tab ? "page" : undefined}
                onClick={() => {
                  setView(tab);
                  setQuery("");
                }}
              >
                {tab === "overview"
                  ? "Services"
                  : tab === "incidents"
                    ? `Incidents${activeIncidents ? ` (${activeIncidents})` : ""}`
                    : "Activity"}
              </button>
            ))}
          </nav>
          <label className="search">
            <span className="sr-only">Search {view}</span>
            <Icon name="search" />
            <input
              placeholder={
                view === "overview" ? "Find a service…" : "Search incidents…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {view === "overview" && (
          <>
            <div className="list-meta">
              <span>STATUS OVER THE PAST 90 DAYS</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={attentionOnly}
                  onChange={(e) => setAttentionOnly(e.target.checked)}
                />
                Needs attention
              </label>
            </div>
            <div className="service-list">
              {grouped.map((group) => (
                <section key={group} aria-label={group || "Services"}>
                  {group && <h3 className="group-title">{group}</h3>}
                  {visible
                    .filter((item) => item.monitor.group === group)
                    .map(({ monitor, snapshot, name }) => (
                      <article className="service" key={monitor.id}>
                        <div className="service-heading">
                          <div className="service-identity">
                            <ProviderLogo id={monitor.id} custom={!!monitor.custom} />
                            <div>
                              <button
                                className="service-name"
                                onClick={() => setEditing(monitor)}
                              >
                                {name}
                                <span className="edit-hint" aria-hidden="true">
                                  <Icon name="external" size={13} />
                                </span>
                              </button>
                              <p className="service-scope">
                                {monitor.componentIds.length
                                  ? `${monitor.componentIds.length} selected components`
                                  : monitor.custom?.kind === "http"
                                    ? "HTTPS endpoint check"
                                    : "All products and regions"}
                                {snapshot?.latencyMs !== undefined
                                  ? ` · ${snapshot.latencyMs} ms`
                                  : ""}
                              </p>
                            </div>
                          </div>
                          <Badge
                            state={snapshot?.state ?? "unknown"}
                            text={
                              !snapshot && !failures[monitor.id]
                                ? "Checking"
                                : undefined
                            }
                          />
                        </div>
                        <HistoryBars
                          name={name}
                          history={histories[monitor.id]}
                        />
                        {(failures[monitor.id] || snapshot?.stale) && (
                          <p className="feed-warning">
                            {failures[monitor.id] ?? snapshot?.warning}{" "}
                            {snapshot?.fetchedAt &&
                              `Last success: ${when(snapshot.fetchedAt)}.`}
                          </p>
                        )}
                        {snapshot?.incidents
                          .filter((i) => i.active || i.status === "scheduled")
                          .slice(0, 2)
                          .map((i) => (
                            <button
                              className="incident-inline"
                              key={i.id}
                              onClick={() =>
                                setSelectedIncident({
                                  ...i,
                                  providerId: monitor.id,
                                  providerName: name,
                                })
                              }
                            >
                              <Icon
                                name={
                                  i.maintenance ? "maintenance" : "degraded"
                                }
                              />
                              <span>{i.title}</span>
                              <span className="small">
                                {i.status.replaceAll("_", " ")}{" "}
                                <Icon name="external" size={13} />
                              </span>
                            </button>
                          ))}
                      </article>
                    ))}
                </section>
              ))}
              {!visible.length && (
                <div className="empty">
                  <span className="empty-symbol" aria-hidden="true">
                    <Icon name="empty" size={32} />
                  </span>
                  <h3>
                    {items.length
                      ? "No services match"
                      : "Start with your first service"}
                  </h3>
                  <p>
                    {items.length
                      ? "Try another search or turn off the attention filter."
                      : "Databricks, Claude, Codex, and more are ready to add."}
                  </p>
                  <button className="secondary" onClick={() => setModal("add")}>
                    Add services
                  </button>
                </div>
              )}
            </div>
            <div className="legend">
              {(
                [
                  "operational",
                  "degraded",
                  "outage",
                  "maintenance",
                  "unknown",
                ] as Health[]
              ).map((s) => (
                <span key={s}>
                  <i className={`legend-swatch ${s}`} />
                  {labels[s]}
                </span>
              ))}
              <span>Hatching = incomplete history</span>
            </div>
          </>
        )}
        {view === "incidents" && (
          <>
            <div className="list-meta">
              <label>
                Show{" "}
                <select
                  aria-label="Filter incidents"
                  value={incidentFilter}
                  onChange={(e) => setIncidentFilter(e.target.value)}
                >
                  <option value="all">All reports</option>
                  <option value="active">Active incidents</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="resolved">Past incidents</option>
                </select>
              </label>
              <span>{shownIncidents.length} REPORTS</span>
            </div>
            <div className="report-list">
              {shownIncidents.map((i) => (
                <button
                  className="report"
                  key={`${i.providerId}:${i.id}`}
                  onClick={() => setSelectedIncident(i)}
                >
                  <div className="report-top">
                    <span className="small muted">{i.providerName}</span>
                    <span className="small muted">{when(i.updatedAt)}</span>
                  </div>
                  <h3>{i.title}</h3>
                  <p>{i.body || "No description supplied by the provider."}</p>
                  <Badge
                    state={
                      i.active
                        ? i.state
                        : i.status === "scheduled"
                          ? "maintenance"
                          : "operational"
                    }
                    text={i.status.replaceAll("_", " ")}
                  />
                </button>
              ))}
              {!shownIncidents.length && (
                <div className="empty">
                  <h3>No matching incidents</h3>
                  <p>
                    New reports appear here as providers publish them. Available
                    history varies by provider.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
        {view === "activity" && (
          <div className="report-list">
            {events
              .filter((e) =>
                e.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((event) => (
                <div className="activity-row" key={event.id}>
                  <Badge state={event.state} />
                  <div>
                    <strong>{event.title}</strong>
                    <p className="small muted">{when(event.at)}</p>
                  </div>
                </div>
              ))}
            {!events.length && (
              <div className="empty">
                <h3>Listening for changes</h3>
                <p>
                  Status changes and incident updates appear here while this
                  page is open.
                </p>
                <button className="secondary" onClick={notifications}>
                  Enable browser alerts
                </button>
              </div>
            )}
          </div>
        )}
        <footer>
          {!embed && (
            <nav className="footer-actions" aria-label="Setup and feedback">
              <button className="text-button" onClick={() => setModal("setup")}>
                Set up your own
              </button>
              <a
                href={`${GITHUB}/issues/new?template=feature-request.yml`}
                target="_blank"
                rel="noreferrer"
              >
                Request a feature <Icon name="external" size={12} />
              </a>
              <a
                href={`${GITHUB}/issues/new?template=bug-report.yml`}
                target="_blank"
                rel="noreferrer"
              >
                Report a bug <Icon name="external" size={12} />
              </a>
              <a href={`${GITHUB}/issues`} target="_blank" rel="noreferrer">
                Browse issues <Icon name="external" size={12} />
              </a>
              <a href={GITHUB} target="_blank" rel="noreferrer">
                Source <Icon name="external" size={12} />
              </a>
            </nav>
          )}
          <span>Times in your timezone · daily history in UTC</span>
        </footer>
      </main>
      {modal === "setup" && (
        <Dialog title="Set up your own" close={() => setModal(null)} wide>
          <SetupPanel board={board} />
        </Dialog>
      )}
      {modal === "appearance" && (
        <Dialog title="Appearance" close={() => setModal(null)} wide>
          <AppearancePanel
            appearance={board.appearance}
            save={(appearance) => {
              setBoard((old) => ({ ...old, appearance }));
              setModal(null);
              setMessage("Appearance saved to your board.");
            }}
          />
        </Dialog>
      )}
      {modal === "add" && (
        <AddServices
          catalog={catalog}
          monitors={board.monitors}
          close={() => setModal(null)}
          add={add}
          addCustom={(monitor) =>
            setBoard((old) => ({
              ...old,
              monitors: [...old.monitors, monitor],
            }))
          }
          report={setMessage}
        />
      )}
      {editing && (
        <EditMonitor
          monitor={editing}
          snapshot={snapshots[editing.id]}
          name={
            items.find((i) => i.monitor.id === editing.id)?.name ?? editing.id
          }
          close={() => setEditing(null)}
          save={(monitor) => {
            setBoard((old) => ({
              ...old,
              monitors: old.monitors.map((m) =>
                m.id === monitor.id ? monitor : m,
              ),
            }));
            setEditing(null);
          }}
          remove={() => {
            setBoard((old) => ({
              ...old,
              monitors: old.monitors.filter((m) => m.id !== editing.id),
            }));
            setEditing(null);
          }}
        />
      )}
      {selectedIncident && (
        <Dialog
          title={selectedIncident.title}
          close={() => setSelectedIncident(null)}
          wide
        >
          <div className="dialog-body">
            <div className="flex">
              <Badge
                state={
                  selectedIncident.active
                    ? selectedIncident.state
                    : "operational"
                }
                text={selectedIncident.status.replaceAll("_", " ")}
              />
              <span>{selectedIncident.providerName}</span>
            </div>
            <p className="small muted">
              Started {when(selectedIncident.startedAt)}
            </p>
            <a href={selectedIncident.url} target="_blank" rel="noreferrer">
              View the provider’s incident <Icon name="external" />
            </a>
            <div className="timeline">
              {selectedIncident.updates.length ? (
                selectedIncident.updates.map((u, index) => (
                  <article key={index}>
                    <time>{when(u.at)}</time>
                    <strong>{u.status.replaceAll("_", " ")}</strong>
                    <p>{u.body}</p>
                  </article>
                ))
              ) : (
                <p>
                  {selectedIncident.body || "No detailed updates supplied."}
                </p>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {modal === "settings" && (
        <Dialog title="Your board" close={() => setModal(null)}>
          <div className="dialog-body settings">
            <label>
              Board name
              <input
                value={board.name}
                maxLength={80}
                onChange={(e) =>
                  setBoard((old) => ({
                    ...old,
                    name: e.target.value || "My status board",
                  }))
                }
              />
            </label>
            <p className="muted small">
              Saved in this browser. No account, cookies, or shared workspace
              required.
            </p>
            <div className="divider" />
            <h3>Notifications</h3>
            <p className="small">
              Browser alerts need this page to remain open. Use your own
              collector for alerts after closing it.
            </p>
            <div className="flex">
              <button className="secondary" onClick={notifications}>
                {board.notifications
                  ? "Check notification permission"
                  : "Enable browser alerts"}
              </button>
              {board.notifications && (
                <button
                  className="text-button"
                  onClick={() =>
                    setBoard((old) => ({ ...old, notifications: false }))
                  }
                >
                  Turn off
                </button>
              )}
            </div>
            <label>
              Alert level
              <select
                value={board.alertLevel}
                onChange={(e) =>
                  setBoard((old) => ({
                    ...old,
                    alertLevel: e.target.value as Board["alertLevel"],
                  }))
                }
              >
                <option value="all">All status and incident changes</option>
                <option value="outage">Outages and recoveries</option>
              </select>
            </label>
            <div className="divider" />
            <h3>Keep or share your setup</h3>
            <div className="flex">
              <button
                className="secondary"
                onClick={() =>
                  download("whatsgoingon-board.json", {
                    ...board,
                    notifications: false,
                  })
                }
              >
                Export board
              </button>
              <label className="button secondary">
                Import board
                <input
                  className="sr-only"
                  type="file"
                  accept="application/json,.json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      if (file.size > 1_000_000) throw new Error();
                      setBoard(readBoard(JSON.parse(await file.text())));
                      setMessage("Board imported.");
                      setModal(null);
                    } catch {
                      setMessage(
                        "That file is not a valid board. Your existing board is unchanged.",
                      );
                    }
                  }}
                />
              </label>
              <button className="secondary" onClick={share}>
                Copy share link
              </button>
            </div>
            <p className="small muted">
              A shared link contains the board name, services, component
              selections, and any custom monitor URLs. Share only details you
              want recipients to see.
            </p>
          </div>
        </Dialog>
      )}
      {modal === "integrations" && (
        <Integrations
          board={board}
          close={() => setModal(null)}
          notifications={notifications}
        />
      )}
    </div>
  );
}

function AddServices({
  catalog,
  monitors,
  close,
  add,
  addCustom,
  report,
}: {
  catalog: Catalogue[];
  monitors: Monitor[];
  close: () => void;
  add: (id: string) => void;
  addCustom: (monitor: Monitor) => void;
  report: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"statuspage" | "http">("statuspage");
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const monitor: Monitor = {
        id: "custom",
        componentIds: [],
        group: "",
        custom: {
          name,
          url,
          kind,
          ...(keyword && kind === "http" ? { keyword } : {}),
        },
      };
      const validated = readBoard({ ...defaultBoard(), monitors: [monitor] })
        .monitors[0];
      const snapshot = await get<Snapshot>(apiUrl("status", validated));
      if (snapshot.stale)
        throw new Error(
          "Could not read this endpoint. For a status page, use its public homepage URL and check it supports the Statuspage JSON API.",
        );
      if (monitors.some((m) => m.id === snapshot.id))
        throw new Error("This monitor is already on your board.");
      addCustom({ ...validated, id: snapshot.id });
      report("Custom monitor added.");
      close();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not add monitor.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Add services" close={close}>
      <div className="dialog-body">
        <p className="muted">
          Pick the services you use. Fine-tune products and regions from your
          board.
        </p>
        <label className="search full">
          <span className="sr-only">Search provider catalogue</span>
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Databricks, Claude, GitHub…"
          />
        </label>
        <div className="catalogue">
          {catalog
            .filter((p) =>
              `${p.name} ${p.category}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((provider) => {
              const added = monitors.some((m) => m.id === provider.id);
              return (
                <div className="catalogue-row" key={provider.id}>
                  <div className="service-identity">
                    <ProviderLogo id={provider.id} />
                    <span>
                      <strong>{provider.name}</strong>
                      <small>{provider.category}</small>
                    </span>
                  </div>
                  <button
                    className={added ? "text-button" : "secondary"}
                    disabled={added || monitors.length >= 40}
                    onClick={() => add(provider.id)}
                  >
                    {added ? (
                      <>
                        <Icon name="check" /> Added
                      </>
                    ) : (
                      "Add"
                    )}
                  </button>
                </div>
              );
            })}
          {!catalog.length && (
            <p>
              The catalogue is loading. Close and reopen this dialog if the
              server was just started.
            </p>
          )}
        </div>
        <button
          className="text-button"
          onClick={() => setCustom((value) => !value)}
          aria-expanded={custom}
        >
          <Icon name="plus" /> Add a custom status page or endpoint
        </button>
        {custom && (
          <form onSubmit={submit} className="custom-form">
            <label>
              Name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My service"
              />
            </label>
            <label>
              Monitor type
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="statuspage">
                  Statuspage-compatible public feed
                </option>
                <option value="http">Public HTTPS endpoint</option>
              </select>
            </label>
            <label>
              Public URL
              <input
                required
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://status.example.com"
              />
            </label>
            {kind === "http" && (
              <label>
                Expected text (optional)
                <input
                  value={keyword}
                  maxLength={200}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </label>
            )}
            <p className="small muted">
              Public URLs only. Do not enter tokens, credentials, or private
              endpoints. Redirects are not followed.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button
              className="primary"
              disabled={busy || monitors.length >= 40}
            >
              {busy ? "Checking…" : "Check and add"}
            </button>
          </form>
        )}
      </div>
    </Dialog>
  );
}

function EditMonitor({
  monitor,
  snapshot,
  name,
  close,
  save,
  remove,
}: {
  monitor: Monitor;
  snapshot?: Snapshot;
  name: string;
  close: () => void;
  save: (monitor: Monitor) => void;
  remove: () => void;
}) {
  const [all, setAll] = useState<Snapshot | undefined>(
    monitor.componentIds.length ? undefined : snapshot,
  );
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Set<string> | null>(
    monitor.componentIds.length ? new Set(monitor.componentIds) : null,
  );
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [group, setGroup] = useState(monitor.group);
  useEffect(() => {
    const controller = new AbortController();
    get<Snapshot>(
      apiUrl("status", { ...monitor, componentIds: [] }),
      controller.signal,
    )
      .then(setAll)
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Could not load components. Try again after refreshing.");
      });
    return () => controller.abort();
  }, [monitor.id]);
  const components = all?.components ?? [];
  const groups = [
    ...new Set(components.map((c) => c.group).filter(Boolean)),
  ].sort();
  const shown = components.filter(
    (c) =>
      (!region || c.group === region) &&
      `${c.name} ${c.group}`.toLowerCase().includes(query.toLowerCase()),
  );
  const chosen = selection ?? new Set(components.map((c) => c.id));
  function toggle(id: string) {
    const next = new Set(chosen);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelection(next);
  }
  return (
    <Dialog title={name} close={close} wide>
      <div className="dialog-body">
        <div className="flex between">
          <Badge state={snapshot?.state ?? "unknown"} />
          {all?.statusUrl && (
            <a href={all.statusUrl} target="_blank" rel="noreferrer">
              Provider status <Icon name="external" />
            </a>
          )}
        </div>
        {all?.warning && <p className="small muted">{all.warning}</p>}
        {all?.certificateExpiresAt && (
          <p className="small">
            TLS certificate expires {when(all.certificateExpiresAt)}.
          </p>
        )}
        <label>
          Board group (optional)
          <input
            value={group}
            maxLength={60}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Data platform, AI tools, work…"
          />
        </label>
        <h3>Products & regions</h3>
        <div className="component-controls">
          <label className="search">
            <span className="sr-only">Search components</span>
            <input
              placeholder="Find a product or region…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {groups.length > 0 && (
            <select
              aria-label="Filter components by region or group"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              <option value="">All regions / groups</option>
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          )}
        </div>
        <div className="selection-actions">
          <span>
            {selection === null
              ? "All components"
              : `${selection.size} selected`}
          </span>
          <button className="text-button" onClick={() => setSelection(null)}>
            Select all
          </button>
          <button
            className="text-button"
            onClick={() => setSelection(new Set(shown.map((c) => c.id)))}
          >
            Only these results
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="component-list">
          {shown.map((c) => (
            <label className="component-row" key={c.id}>
              <input
                type="checkbox"
                checked={chosen.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span>
                <strong>{c.name}</strong>
                {c.group && <small>{c.group}</small>}
              </span>
              <Badge state={c.state} />
            </label>
          ))}
          {!all && !error && <p>Loading components…</p>}
          {all && !shown.length && <p>No matching components.</p>}
        </div>
      </div>
      <div className="dialog-footer">
        <button className="danger text-button" onClick={remove}>
          Remove service
        </button>
        <button
          className="primary"
          disabled={selection !== null && !selection.size}
          onClick={() =>
            save({
              ...monitor,
              group,
              componentIds: selection === null ? [] : [...selection],
            })
          }
        >
          Save selection
        </button>
      </div>
    </Dialog>
  );
}

function Integrations({
  board,
  close,
  notifications,
}: {
  board: Board;
  close: () => void;
  notifications: () => void;
}) {
  const [channel, setChannel] = useState("webhook");
  const [destination, setDestination] = useState("");
  const [routingKey, setRoutingKey] = useState("");
  const [error, setError] = useState("");
  const first = board.monitors[0] ?? defaultBoard().monitors[0];
  const endpoint = new URL(apiUrl("status", first), location.origin).href;
  const feed = new URL(
    "/api/feed.xml?providers=" +
      board.monitors
        .filter((m) => !m.custom)
        .map((m) => m.id)
        .join(","),
    location.origin,
  ).href;
  const embed = new URL(location.origin);
  embed.search = "?embed=1";
  embed.hash = shareBoard(board);
  function exportConfig() {
    try {
      const url = new URL(destination);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error();
      if (!board.monitors.length || (channel === "pagerduty" && !routingKey))
        throw new Error();
      download("watch.config.json", {
        monitors: board.monitors,
        alertLevel: board.alertLevel,
        destinations: [
          {
            type: channel,
            url: destination,
            ...(channel === "pagerduty" ? { routingKey } : {}),
          },
        ],
      });
      setDestination("");
      setRoutingKey("");
      setError("");
    } catch {
      setError(
        "Add a service and enter your own HTTPS destination. PagerDuty also needs a routing key.",
      );
    }
  }
  return (
    <Dialog title="API & alerts" close={close} wide>
      <div className="dialog-body settings">
        <h3>While you browse</h3>
        <p>
          Browser alerts report changes while this page is open. Your browser
          may pause background tabs.
        </p>
        <button className="secondary" onClick={notifications}>
          Enable browser alerts
        </button>
        <div className="divider" />
        <h3>Your own background alerts</h3>
        <p>
          Run this app on your own machine or server to keep watching after you
          close the browser. Connect your own destination below. These values
          stay in this dialog and the downloaded file; they are never sent to
          this server.
        </p>
        <label>
          Destination type
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="webhook">Generic JSON webhook</option>
            <option value="slack">Slack incoming webhook</option>
            <option value="discord">Discord webhook</option>
            <option value="teams">Microsoft Teams workflow webhook</option>
            <option value="pagerduty">PagerDuty Events API</option>
          </select>
        </label>
        <label>
          Your HTTPS webhook URL
          <input
            type="password"
            autoComplete="off"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="https://…"
          />
        </label>
        {channel === "pagerduty" && (
          <label>
            Your routing key
            <input
              type="password"
              autoComplete="off"
              value={routingKey}
              onChange={(e) => setRoutingKey(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="secondary" onClick={exportConfig}>
          Download collector configuration
        </button>
        <p className="small muted">
          Keep this file private. It contains your destination credentials. The
          repository ignores this filename.
        </p>
        <pre>
          <code>WATCH_CONFIG=./watch.config.json npm start</code>
        </pre>
        <p className="small">
          The collector establishes a baseline, then sends changes. Failed
          deliveries retry with backoff.
        </p>
        <div className="divider" />
        <h3>Use the data elsewhere</h3>
        <p>Read-only JSON endpoints need no API key.</p>
        <label>
          Current status
          <input readOnly value={endpoint} onFocus={(e) => e.target.select()} />
        </label>
        <label>
          Incident RSS feed (catalogue providers)
          <input readOnly value={feed} onFocus={(e) => e.target.select()} />
        </label>
        <label>
          Embed this board
          <textarea
            readOnly
            rows={3}
            value={`<iframe title="Service status" src="${embed.href}" width="100%" height="700" loading="lazy"></iframe>`}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <p className="small muted">
          A link or embed shares the configuration at the time you create it.
          Recipients see fresh public status data; edits to your board do not
          change existing links.
        </p>
      </div>
    </Dialog>
  );
}
