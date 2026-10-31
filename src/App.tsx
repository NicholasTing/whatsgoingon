import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  Board,
  Change,
  DailyStatus,
  Health,
  History,
  Incident,
  Monitor,
  Provider,
  Snapshot,
} from "../shared/types.ts";
import { labels } from "../shared/types.ts";
import {
  changesBetween,
  incidentsForDay,
  readBoard,
  scoped,
  worst,
} from "../shared/board.ts";
import { HistoryBars } from "./HistoryBars.tsx";
import { SetupPanel } from "./SetupPanel.tsx";
import { Icon } from "./Icon.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import { appearanceStyle } from "../shared/appearance.ts";

const GITHUB = "https://github.com/NicholasTing/whatsgoingon";
type Catalogue = Omit<Provider, "feed">;
type IncidentRow = Incident & { providerId: string; providerName: string };
function apiUrl(kind: string, monitor: Monitor): string {
  return `/api/${kind}/${encodeURIComponent(monitor.id)}`;
}
async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const data = await response.json().catch((error: unknown) => {
    if (error instanceof SyntaxError)
      throw new Error("The status service is unavailable. Please try again later.");
    throw error;
  });
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}
function when(value: string | null): string {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Time not supplied";
}
function incidentHealth(incident: Incident): Health {
  return incident.active
    ? incident.state
    : incident.status === "scheduled"
      ? "maintenance"
      : "operational";
}
function incidentStatusText(status: string): string | undefined {
  return status && status !== "Checking"
    ? status.replaceAll("_", " ")
    : undefined;
}
function Badge({
  state,
  text,
  checking = false,
}: {
  state: Health;
  text?: string;
  checking?: boolean;
}) {
  return (
    <span className={`badge ${state}`}>
      {checking
        ? "Checking"
        : text
          ? `${labels[state]} · ${text}`
          : labels[state]}
    </span>
  );
}
const incidentFilters = [
  ["all", "All reports"],
  ["active", "Active incidents"],
  ["maintenance", "Maintenance"],
  ["resolved", "Past incidents"],
];
function IncidentFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = incidentFilters.find(([id]) => id === value)![1];
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <div
      className="incident-filter"
      ref={ref}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (
          open &&
          (event.key === "Escape" ||
            (event.key === "Enter" && event.target !== trigger.current))
        ) {
          event.preventDefault();
          close();
        }
      }}
    >
      <button
        type="button"
        className="incident-filter-trigger"
        ref={trigger}
        aria-label={`Filter incidents: ${label}`}
        aria-expanded={open}
        aria-controls="incident-filter-options"
        onClick={() => setOpen(!open)}
      >
        {label}
        <span className="filter-chevron" aria-hidden="true" />
      </button>
      <fieldset
        id="incident-filter-options"
        className="incident-filter-options"
        aria-label="Filter incidents"
        hidden={!open}
      >
        {incidentFilters.map(([id, text]) => (
          <label key={id}>
            <input
              className="sr-only"
              type="radio"
              name="incident-filter"
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
              onClick={(event) => {
                if (event.detail > 0) close();
              }}
            />
            <Icon name="check" />
            {text}
          </label>
        ))}
      </fieldset>
    </div>
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
  const [configuration, setConfiguration] = useState<{
    board: Board;
    catalog: Catalogue[];
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      get<Board>("/api/board", controller.signal),
      get<{ providers: Catalogue[] }>("/api/catalog", controller.signal),
    ])
      .then(([board, catalog]) => {
        if (!controller.signal.aborted)
          setConfiguration({
            board: readBoard(board),
            catalog: catalog.providers,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "The configured services could not be loaded. Check the server and reload this page.",
          );
      });
    return () => controller.abort();
  }, []);
  if (!configuration)
    return (
      <main className="app-shell">
        <h1>Service status</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Loading configured services…"}
        </p>
        {error && (
          <button className="secondary" onClick={() => location.reload()}>
            Reload page
          </button>
        )}
      </main>
    );
  return <Dashboard {...configuration} />;
}

function Dashboard({ board, catalog }: { board: Board; catalog: Catalogue[] }) {
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [histories, setHistories] = useState<Record<string, History>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(
    location.hash.startsWith("#board=")
      ? "This server uses its configured service list. Older shared boards cannot change it."
      : "",
  );
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
    "configuration" | "integrations" | "setup" | null
  >(null);
  const [selectedIncident, setSelectedIncident] = useState<IncidentRow | null>(
    null,
  );
  const [reportSelection, setReportSelection] = useState<{
    title: string;
    reports: IncidentRow[];
    state: Health;
  } | null>(null);
  const previous = useRef<Record<string, Snapshot>>({});
  const monitorsKey = JSON.stringify(board.monitors);
  const embed = new URLSearchParams(location.search).has("embed");

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function update() {
      if (busy) return;
      busy = true;
      setLoading(true);
      await Promise.all(
        board.monitors.map(async (monitor) => {
          const statusKey = apiUrl("status", monitor);
          try {
            const [statusResult, historyResult] = await Promise.allSettled([
              get<Snapshot>(statusKey, controller.signal),
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
            }
            setSnapshots((old) => ({ ...old, [statusKey]: snapshot }));
            if (historyResult.status === "fulfilled")
              setHistories((old) => ({
                ...old,
                [apiUrl("history", monitor)]: historyResult.value,
              }));
            setFailures((old) => {
              const copy = { ...old };
              delete copy[statusKey];
              return copy;
            });
          } catch (error) {
            if (!controller.signal.aborted)
              setFailures((old) => ({
                ...old,
                [statusKey]:
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
    const statusKey = apiUrl("status", monitor);
    const failure = failures[statusKey];
    const raw = snapshots[statusKey];
    const snapshot = raw ? scoped(raw, monitor, now) : undefined;
    if (snapshot && failure) {
      snapshot.state = "unknown";
      snapshot.stale = true;
    }
    return {
      monitor,
      provider,
      snapshot,
      failure,
      checking: !snapshot && !failure,
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
  function openReports(
    monitor: Monitor,
    name: string,
    snapshot?: Snapshot,
    day?: DailyStatus,
  ) {
    const reports = (
      day
        ? incidentsForDay(snapshot?.incidents ?? [], monitor, day.date)
        : (snapshot?.incidents.filter((incident) => incident.active) ?? [])
    ).map((incident) => ({
      ...incident,
      providerId: monitor.id,
      providerName: name,
    }));
    setReportSelection({
      title: `${name} · ${day ? `${day.date} (UTC)` : "Current status"}`,
      reports,
      state: day?.state ?? snapshot?.state ?? "unknown",
    });
    setSelectedIncident(reports[0] ?? null);
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(
        new URL(location.pathname, location.origin).href,
      );
      setMessage(
        "Board link copied. Everyone sees this server’s configured services.",
      );
    } catch {
      setMessage(
        "Copy the page address from your browser to share this board.",
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
                onClick={() => setModal("configuration")}
              >
                <Icon name="settings" /> Configured services
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
          <div className="summary-icon" aria-hidden="true" />
          <div>
            <h2>
              {!items.length
                ? "No services configured"
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
                ? "Add services to services.json on the server, then restart it."
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
            {board.name && board.name !== "My status board" && (
              <h2>{board.name}</h2>
            )}
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
                    .map(
                      ({
                        monitor,
                        provider,
                        snapshot,
                        name,
                        failure,
                        checking,
                      }) => (
                        <article className="service" key={monitor.id}>
                          <div className="service-heading">
                            <div className="service-identity">
                              <ProviderLogo
                                id={monitor.id}
                                custom={!!monitor.custom}
                              />
                              <div>
                                <a
                                  className="service-name"
                                  href={provider?.statusUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {name}
                                  <span
                                    className="edit-hint"
                                    aria-hidden="true"
                                  >
                                    <Icon name="external" size={13} />
                                  </span>
                                </a>
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
                            <button
                              className="status-button"
                              disabled={checking}
                              aria-label={`${name}: ${checking ? "Checking" : labels[snapshot?.state ?? "unknown"]}. View reports`}
                              onClick={() =>
                                openReports(monitor, name, snapshot)
                              }
                            >
                              <Badge
                                state={snapshot?.state ?? "unknown"}
                                checking={checking}
                              />
                            </button>
                          </div>
                          <HistoryBars
                            name={name}
                            history={histories[apiUrl("history", monitor)]}
                            onSelect={(day) =>
                              openReports(monitor, name, snapshot, day)
                            }
                          />
                          {(failure || snapshot?.stale) && (
                            <p className="feed-warning">
                              {failure ?? snapshot?.warning}{" "}
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
                      ),
                    )}
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
                      : "No services configured"}
                  </h3>
                  <p>
                    {items.length
                      ? "Try another search or turn off the attention filter."
                      : "Edit services.json on the server and restart it to update this list."}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => setModal("configuration")}
                  >
                    View configuration
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
              <span>
                Hatching indicates an unknown state or incomplete local
                coverage; incident colours can still have gaps.
              </span>
            </div>
          </>
        )}
        {view === "incidents" && (
          <>
            <div className="list-meta">
              <div className="incident-filter-field">
                <span>Show</span>
                <IncidentFilter
                  value={incidentFilter}
                  onChange={setIncidentFilter}
                />
              </div>
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
                    state={incidentHealth(i)}
                    text={incidentStatusText(i.status)}
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
      {modal === "configuration" && (
        <Dialog title="Configured services" close={() => setModal(null)} wide>
          <div className="dialog-body settings">
            <p>
              This dashboard is read-only. Everyone sees the services configured
              by its owner.
            </p>
            <p>
              To add or remove a service, edit the <code>services.json</code>{" "}
              array on the server and restart it. Reload this page after the
              restart.
            </p>
            <p>
              Service IDs map to status pages in <code>server/catalog.ts</code>.
              Select a service name on the board to open its status page.
            </p>
            <pre>
              <code>{JSON.stringify(board.monitors, null, 2)}</code>
            </pre>
            <p className="small muted">
              Live editing would require a database and an authenticated editing
              API that you set up and maintain yourself. This app does not
              provide them.
            </p>
            <a
              href={`${GITHUB}#configure-services`}
              target="_blank"
              rel="noreferrer"
            >
              Configuration instructions <Icon name="external" />
            </a>
          </div>
        </Dialog>
      )}
      {(selectedIncident || reportSelection) && (
        <Dialog
          title={reportSelection?.title ?? selectedIncident!.title}
          close={() => {
            setSelectedIncident(null);
            setReportSelection(null);
          }}
          wide
        >
          <div className="dialog-body">
            {reportSelection && (
              <>
                <Badge state={reportSelection.state} />
                <p className="small muted">
                  Provider reports for your selected components. History may be
                  incomplete.
                </p>
                {reportSelection.reports.length > 0 ? (
                  <label>
                    Report
                    <select
                      value={selectedIncident?.id}
                      onChange={(event) =>
                        setSelectedIncident(
                          reportSelection.reports.find(
                            (report) => report.id === event.target.value,
                          ) ?? null,
                        )
                      }
                    >
                      {reportSelection.reports.map((report) => (
                        <option key={report.id} value={report.id}>
                          {report.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p>
                    No provider report is available for this selection. Local
                    checks can record a status change without a published
                    incident. Missing reports do not establish healthy service.
                  </p>
                )}
              </>
            )}
            {selectedIncident && (
              <>
                {reportSelection && <h3>{selectedIncident.title}</h3>}
                <div className="flex">
                  <Badge
                    state={incidentHealth(selectedIncident)}
                    text={incidentStatusText(selectedIncident.status)}
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
              </>
            )}
          </div>
        </Dialog>
      )}
      {modal === "integrations" && (
        <Integrations board={board} close={() => setModal(null)} />
      )}
    </div>
  );
}

function Integrations({ board, close }: { board: Board; close: () => void }) {
  const first = board.monitors[0];
  const endpoint = first
    ? new URL(apiUrl("status", first), location.origin).href
    : "";
  const feed = new URL("/api/feed.xml", location.origin).href;
  const embed = new URL("/?embed=1", location.origin).href;
  return (
    <Dialog title="API & alerts" close={close} wide>
      <div className="dialog-body settings">
        <p>
          The API and embeds use this server’s configured services and component
          selections.
        </p>
        {first && (
          <label>
            Current status
            <input
              readOnly
              value={endpoint}
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}
        <label>
          Incident RSS feed
          <input readOnly value={feed} onFocus={(e) => e.target.select()} />
        </label>
        <label>
          Embed this board
          <textarea
            readOnly
            rows={3}
            value={`<iframe title="Service status" src="${embed}" width="100%" height="700" loading="lazy"></iframe>`}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <p>
          Links and embeds show the updated service list after the owner changes
          the configuration, restarts the server, and viewers reload the page.
        </p>
        <h3>Background alerts</h3>
        <p>
          The server owner can configure alerts in a private{" "}
          <code>watch.config.json</code> file and restart with{" "}
          <code>WATCH_CONFIG=./watch.config.json npm start</code>.
        </p>
        <a
          href={`${GITHUB}#background-alerts`}
          target="_blank"
          rel="noreferrer"
        >
          Alert configuration instructions <Icon name="external" />
        </a>
      </div>
    </Dialog>
  );
}
