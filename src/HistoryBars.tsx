import { useId, useState } from "react";
import type { History } from "../shared/types.ts";
import { labels } from "../shared/types.ts";

export function HistoryBars({
  name,
  history,
}: {
  name: string;
  history?: History;
}) {
  const [index, setIndex] = useState(89);
  const [active, setActive] = useState(false);
  const pattern = useId().replace(/:/g, "");
  const day = history?.days[index];
  const checks = day?.samples
    ? `${day.samples} local check${day.samples === 1 ? "" : "s"} recorded`
    : "No local checks recorded";
  const reports = day?.reports
    ? `${day.reports} provider report${day.reports === 1 ? "" : "s"}`
    : "No provider reports recorded";
  const coverage = day?.complete
    ? "Near-complete local coverage"
    : "Incomplete local coverage; health between checks is unknown";
  const description = day
    ? `${day.date} (UTC): ${labels[day.state]}. ${checks}. ${reports}. ${coverage}.`
    : "Recorded history is unavailable";
  const select = (element: HTMLElement, x: number) => {
    const rect = element.getBoundingClientRect();
    setIndex(
      Math.max(
        0,
        Math.min(89, Math.floor(((x - rect.left) / rect.width) * 90)),
      ),
    );
  };
  return (
    <div className="history">
      <div
        className="bars"
        role="slider"
        tabIndex={0}
        aria-label={`${name} daily observations. Use arrow keys to choose a day.`}
        aria-valuemin={1}
        aria-valuemax={90}
        aria-valuenow={index + 1}
        aria-valuetext={description}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        onPointerLeave={(event) =>
          setActive(event.currentTarget === document.activeElement)
        }
        onPointerMove={(e) => {
          select(e.currentTarget, e.clientX);
          setActive(true);
        }}
        onPointerDown={(e) => {
          select(e.currentTarget, e.clientX);
          e.currentTarget.focus();
        }}
        onKeyDown={(e) => {
          const next =
            e.key === "ArrowLeft" || e.key === "ArrowDown"
              ? index - 1
              : e.key === "ArrowRight" || e.key === "ArrowUp"
                ? index + 1
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 89
                    : null;
          if (next !== null) {
            e.preventDefault();
            setIndex(Math.max(0, Math.min(89, next)));
          }
        }}
      >
        <svg viewBox="0 0 900 32" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern
              id={pattern}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
            >
              <rect width="5" height="5" fill="var(--soft)" />
              <path
                d="M-1 1L1 -1M0 5L5 0M4 6L6 4"
                stroke="var(--muted)"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          {Array.from({ length: 90 }, (_, i) => {
            const item = history?.days[i];
            return (
              <rect
                key={i}
                x={i * 10 + 1}
                y="1"
                width="7"
                height="30"
                className={`bar ${item?.state ?? "unknown"} ${active && index === i ? "selected" : ""}`}
                fill={
                  !item ||
                  item.state === "unknown" ||
                  (!item.complete && item.state === "operational")
                    ? `url(#${pattern})`
                    : undefined
                }
              />
            );
          })}
        </svg>
      </div>
      <div className="history-labels">
        <span>90 days ago</span>
        <span className="history-description">
          {!history
            ? "Recorded history is unavailable"
            : active
            ? description
            : history?.days.some((d) => d.samples || d.reports)
              ? "Local checks and provider reports · coverage may be incomplete"
              : "No local checks or provider reports recorded yet"}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}
