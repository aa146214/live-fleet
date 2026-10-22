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

/** Creates the tables, or brings older ones up to date (safe to repeat). Exported so tests can run it. */
export async function createSchema(sql: Sql): Promise<void> {
  // The routes the admin makes. (Databases from before routes could be made had three fixed ones with
  // other columns; the statements after the table bring those up to this shape, once.)
  await sql`
    create table if not exists routes (
      id integer primary key,
      name text not null,
      short_name text not null default '',
      colour text not null default 'blue',
      stops text not null default '',
      position integer not null default 0,
      updated_at timestamptz not null default now()
    )`;
  await sql`alter table routes drop constraint if exists routes_id_check`;
  await sql`alter table vehicle_assignments drop constraint if exists vehicle_assignments_route_id_fkey`.catch(() => undefined);
  await sql`alter table routes alter column id type integer`;
  await sql`alter table routes add column if not exists short_name text not null default ''`;
  await sql`alter table routes add column if not exists colour text not null default 'blue'`;
  await sql`alter table routes add column if not exists stops text not null default ''`;
  await sql`alter table routes add column if not exists position integer not null default 0`;
  await sql`alter table routes drop column if exists station`;
  await sql`alter table routes drop column if exists terminus`;
  await sql`alter table routes drop column if exists what3words`;
  await sql`alter table routes drop column if exists station_lat`;
  await sql`alter table routes drop column if exists station_lng`;
  await sql`
    create table if not exists vehicle_assignments (
      vrn text primary key,
      code text not null unique,
      route_id integer not null,
      updated_at timestamptz not null default now()
    )`;
  await sql`alter table vehicle_assignments alter column route_id type integer`;
  // (vehicle_assignments.stops, from when each vehicle had its own stops, is no longer used.)
  await sql`alter table vehicle_assignments add column if not exists stops text not null default ''`;
  await sql`alter table vehicle_assignments add constraint vehicle_assignments_route_id_fkey foreign key (route_id) references routes (id)`.catch(
    () => undefined,
  );
  // Each shuttle's last two reports and the road between them (see report-store.ts), so a server
  // that has just started, or another one, still knows where a minibus came from.
  await sql`
    create table if not exists vehicle_transitions (
      vehicle_id text primary key,
      from_report jsonb,
      to_report jsonb not null,
      road jsonb,
      updated_at timestamptz not null default now()
    )`;
  await seedRoutes(sql);
}

/**
 * Starts the routes off: the three in routes.ts when there are none, or, for a database from
 * before routes could be made, those three given their new names, colours and stops (those of
 * the vehicles on each, as the stops used to be set per vehicle).
 */
async function seedRoutes(sql: Sql): Promise<void> {
  const [{ n }] = await sql`select count(*)::int as n from routes`;
  if (Number(n) === 0) {
    for (const [position, route] of DEFAULT_ROUTES.entries()) {
      await sql`
        insert into routes (id, name, short_name, colour, stops, position)
        values (${route.id}, ${route.name}, ${route.shortName}, ${route.colour}, ${route.stops.join(",")}, ${position + 1})
        on conflict (id) do nothing`;
    }
    return;
  }
  for (const [position, route] of DEFAULT_ROUTES.entries()) {
    const own = await sql`
      select stops, count(*) as vehicles from vehicle_assignments
      where route_id = ${route.id} and stops <> '' group by stops order by vehicles desc limit 1`;
    const stops = own.length > 0 ? String(own[0].stops) : route.stops.join(",");
    await sql`
      update routes set name = ${route.name}, short_name = ${route.shortName}, colour = ${route.colour},
        position = ${position + 1}, stops = ${stops}
      where id = ${route.id} and short_name = ''`;
    await sql`update routes set stops = ${stops} where id = ${route.id} and stops = ''`;
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
