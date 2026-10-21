import { neon } from "@neondatabase/serverless";
import { DEFAULT_ROUTES } from "./routes";

export type Row = Record<string, unknown>;
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

/** Neon Postgres, from the DATABASE_URL connection string. Without it the app uses its built-in defaults. */
export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

let client: Sql | undefined;
let schema: Promise<void> | undefined;

/** Swaps the database client (used to test queries without a Neon database). */
export function setSqlForTesting(sql: Sql | undefined): void {
  client = sql;
  schema = undefined;
}

async function createSchema(sql: Sql): Promise<void> {
  await sql`
    create table if not exists routes (
      id smallint primary key check (id between 1 and 3),
      name text not null,
      station text not null,
      terminus text not null,
      what3words text not null,
      station_lat double precision not null,
      station_lng double precision not null,
      updated_at timestamptz not null default now()
    )`;
  await sql`
    create table if not exists vehicle_assignments (
      vrn text primary key,
      code text not null unique,
      route_id smallint not null references routes (id),
      updated_at timestamptz not null default now()
    )`;
  // The places a vehicle calls at, in order (place ids, comma separated). Added after the first release.
  await sql`alter table vehicle_assignments add column if not exists stops text not null default ''`;
  // The three routes always exist; the admin edits them rather than adding or removing any.
  for (const route of DEFAULT_ROUTES) {
    await sql`
      insert into routes (id, name, station, terminus, what3words, station_lat, station_lng)
      values (${route.id}, ${route.name}, ${route.station}, ${route.terminus}, ${route.what3words},
              ${route.stationLocation.lat}, ${route.stationLocation.lng})
      on conflict (id) do nothing`;
  }
}

/** The Postgres error code (SQLSTATE), if the database answered with an error. */
const errorCode = (error: unknown) => String((error as { code?: unknown } | null)?.code ?? "");
/** Postgres error codes for a missing table or column: the schema needs creating or upgrading. */
const MISSING_SCHEMA = new Set(["42P01", "42703"]);

/** A database that has been idle can fail its first request while it wakes up. */
const WAKE_RETRY_MS = 1500;

/** Creates (or upgrades) the tables once per server, however many queries hit a missing one. */
function ensureSchema(sql: Sql): Promise<void> {
  schema ??= createSchema(sql).catch((error) => {
    schema = undefined;
    throw error;
  });
  return schema;
}

/**
 * The database client. Queries run straight away; the tables are only created (or an
 * older database upgraded) when a query finds one missing, so a server's first page
 * load doesn't wait on six setup queries every time it starts.
 */
export async function getSql(): Promise<Sql> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const raw = neon(url) as unknown as Sql;
    client = async (strings, ...values) => {
      try {
        return await raw(strings, ...values);
      } catch (error) {
        const code = errorCode(error);
        if (MISSING_SCHEMA.has(code)) await ensureSchema(raw);
        // Other errors from Postgres itself (a duplicate code, say) won't go away by retrying.
        else if (/^[0-9A-Z]{5}$/.test(code)) throw error;
        else await new Promise((resolve) => setTimeout(resolve, WAKE_RETRY_MS));
        return raw(strings, ...values);
      }
    };
  }
  return client;
}
