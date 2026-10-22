import { getSql, hasDatabase } from "./db";
import type { LatLng } from "./routes";

/**
 * Each shuttle's last two position reports and the road driven between them. The map draws a
 * minibus driving that road, one report behind, so it needs the report before the latest. Kept
 * in the database so that a server that has only just started (or another server, on hosting
 * that runs several) still has it, instead of showing the minibus still until a second report
 * arrives and then jumping. Server only.
 */

/** A position report as FleetSmart sent it. */
export interface Report extends LatLng {
  /** The tracker's time for the report, as FleetSmart writes it; identifies the report. */
  at: string;
  heading: number | null;
  speedMph: number | null;
}

export interface Transition {
  /** The report before `to`, if known. */
  from: Report | null;
  to: Report;
  /** The road from `from` to `to`; null if there is none, undefined while it is being looked up. */
  path?: LatLng[] | null;
}

/** A sleeping database can take a moment to answer; a map refresh won't wait longer than this for it. */
const DATABASE_WAIT_MS = 3000;

const parse = <T>(value: unknown): T | null => {
  if (value === null || value === undefined) return null;
  try {
    return (typeof value === "string" ? JSON.parse(value) : value) as T;
  } catch {
    return null;
  }
};

const within = <T>(work: Promise<T>, fallback: T): Promise<T> =>
  Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), DATABASE_WAIT_MS))]);

/** What is stored for the given vehicles (by FleetSmart vehicle id); nothing if there is no database. */
export async function loadTransitions(ids: string[]): Promise<Map<string, Transition>> {
  const found = new Map<string, Transition>();
  if (!hasDatabase() || ids.length === 0) return found;
  const wanted = new Set(ids);
  try {
    const rows = await within(
      (async () => {
        const sql = await getSql();
        // The table only holds the shuttles, so read it whole rather than passing a list.
        return sql`select vehicle_id, from_report, to_report, road from vehicle_transitions`;
      })(),
      [],
    );
    for (const row of rows) {
      const id = String(row.vehicle_id);
      const to = parse<Report>(row.to_report);
      if (!wanted.has(id) || !to) continue;
      found.set(id, { from: parse<Report>(row.from_report), to, path: parse<LatLng[]>(row.road) });
    }
  } catch (error) {
    console.error("[reports] could not read:", error instanceof Error ? error.message : error);
  }
  return found;
}

/** Keeps a vehicle's latest report, the one before and the road between them. Failures are only logged. */
export async function saveTransition(id: string, transition: Transition): Promise<void> {
  if (!hasDatabase()) return;
  const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value));
  try {
    await within(
      (async () => {
        const sql = await getSql();
        await sql`
          insert into vehicle_transitions (vehicle_id, from_report, to_report, road)
          values (${id}, ${json(transition.from)}::jsonb, ${json(transition.to)}::jsonb, ${json(transition.path)}::jsonb)
          on conflict (vehicle_id) do update set
            from_report = excluded.from_report,
            to_report = excluded.to_report,
            road = excluded.road,
            updated_at = now()
          where vehicle_transitions.to_report->>'at' <= excluded.to_report->>'at'`;
      })(),
      undefined,
    );
  } catch (error) {
    console.error("[reports] could not save:", error instanceof Error ? error.message : error);
  }
}
