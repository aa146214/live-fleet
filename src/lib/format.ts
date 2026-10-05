import type { FleetSnapshot } from "./types";

const UPDATED_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

/** e.g. "1 Oct 2026, 15:30:08 BST" */
export function formatUpdated(iso: string | null): string {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Unknown" : UPDATED_FORMAT.format(date);
}

export function liveStatusText(snapshot: FleetSnapshot | null): string {
  if (!snapshot) return "● Connecting…";
  const count = snapshot.vehicles.length;
  return `● ${count} vehicle${count === 1 ? "" : "s"} · ${snapshot.mode}`;
}
