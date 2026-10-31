import { labels } from "./types.ts";
import type { DailyStatus } from "./types.ts";

export function historyDescription(day: DailyStatus): string {
  const reports = day.incidentIds?.length ?? 0;
  const evidence = day.samples
    ? `${day.samples} recorded ${day.samples === 1 ? "check" : "checks"}.`
    : reports
      ? "No checks recorded. Status is based on provider reports."
      : day.state === "unknown"
        ? "No checks recorded. Availability is unknown."
        : "No checks recorded. Availability was not measured.";
  const related = reports
    ? ` ${reports} related provider ${reports === 1 ? "report" : "reports"}.`
    : "";
  return `${day.date} (UTC): ${labels[day.state]}. ${evidence}${related} ${day.complete ? "Continuous check coverage." : "Incomplete check coverage."}`;
}
