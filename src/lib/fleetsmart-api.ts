import { getSql, hasDatabase } from "./db";

/**
 * Every request to FleetSmart goes through `fleetSmartGet`, which
 *  - answers from the saved response when it is under `ttlMs` old (10 seconds unless said otherwise),
 *  - sends one request when it isn't, however many callers (or servers) ask at once, and
 *  - spaces requests a second apart for the API key, as FleetSmart allows one a second.
 * The saved responses, the lock and the turn-taking are kept in the database, so every server
 * instance (and the page and the API route, which are separate bundles) shares them. Without a
 * database, or if it can't be reached, the same is done within this server. A request that fails or
 * takes longer than `timeoutMs` is an error carrying FleetSmart's message, and that failure is kept
 * for a few seconds too, so a refused request isn't sent again at once. Server only.
 */

const BASE_URL = process.env.FLEETSMART_BASE_URL ?? "https://www.fleetsmartlive.com/api";

/** FleetSmart allows one request per second per client. */
const RATE_LIMIT_GAP_MS = 1100;
const DEFAULT_TTL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 10_000;
/** How long a failure is remembered (longer if FleetSmart says when to try again). */
const FAILURE_MS = 5000;
/** How often a server waiting on another server's request looks for its answer. */
const POLL_MS = 250;

export interface ResourceIdentifier {
  type: string;
  id: string;
}

export interface Resource extends ResourceIdentifier {
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data?: ResourceIdentifier | null }>;
}

export interface JsonApiDocument {
  data: Resource[];
  included?: Resource[];
}

export interface FleetSmartOptions {
  /** How long a saved response is used (ms). */
  ttlMs?: number;
  /** How long the request to FleetSmart may take (ms). */
  timeoutMs?: number;
}

/** A request FleetSmart refused or didn't answer; its message is shown on the map. */
export class FleetSmartError extends Error {
  constructor(
    message: string,
    /** When FleetSmart said to try again (ms), if it did. */
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

interface Saved {
  at: number;
  body: JsonApiDocument;
  clockAheadMs: number;
}

interface State {
  inFlight: Map<string, Promise<JsonApiDocument>>;
  /** Used without a database. */
  memory: Map<string, Saved>;
  failures: Map<string, { at: number; message: string; waitMs: number }>;
  slot: Promise<void>;
  clockAheadMs: number;
}

// The page and the API route are bundled separately, so this lives on globalThis to be one.
const state = (): State => {
  const g = globalThis as unknown as { __fleetSmart?: State };
  return (g.__fleetSmart ??= {
    inFlight: new Map(),
    memory: new Map(),
    failures: new Map(),
    slot: Promise.resolve(),
    clockAheadMs: 0,
  });
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The current time by FleetSmart's clock. Sent with each response so browsers can
 * line report times up with their own clocks, which may be off by many seconds.
 */
export function fleetSmartNow(): string {
  return new Date(Date.now() - state().clockAheadMs).toISOString();
}

const cacheKey = (path: string, params: URLSearchParams) => {
  const sorted = new URLSearchParams([...params.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return `${path}?${sorted}`;
};

/** One request to the FleetSmart API (answered from the saved response when it is recent enough). */
export function fleetSmartGet(
  path: string,
  params: URLSearchParams,
  options: FleetSmartOptions = {},
): Promise<JsonApiDocument> {
  const key = cacheKey(path, params);
  const { inFlight } = state();
  let work = inFlight.get(key);
  if (!work) {
    work = load(key, path, params, options.ttlMs ?? DEFAULT_TTL_MS, options.timeoutMs ?? DEFAULT_TIMEOUT_MS).finally(
      () => inFlight.delete(key),
    );
    inFlight.set(key, work);
  }
  return work;
}

async function load(
  key: string,
  path: string,
  params: URLSearchParams,
  ttlMs: number,
  timeoutMs: number,
): Promise<JsonApiDocument> {
  if (hasDatabase()) {
    try {
      return await loadShared(key, path, params, ttlMs, timeoutMs);
    } catch (error) {
      // A problem with FleetSmart is the answer; a problem with the database isn't, so go on without it.
      if (error instanceof FleetSmartError) throw error;
      console.error("[fleetsmart] shared cache unavailable:", error instanceof Error ? error.message : error);
    }
  }
  return loadLocal(key, path, params, ttlMs, timeoutMs);
}

/** Within this server only: the saved responses, failures and turns are in memory. */
async function loadLocal(
  key: string,
  path: string,
  params: URLSearchParams,
  ttlMs: number,
  timeoutMs: number,
): Promise<JsonApiDocument> {
  const s = state();
  const saved = s.memory.get(key);
  if (saved && Date.now() - saved.at < ttlMs) {
    s.clockAheadMs = saved.clockAheadMs;
    return saved.body;
  }
  const failure = s.failures.get(key);
  if (failure && Date.now() - failure.at < failure.waitMs) throw new FleetSmartError(failure.message, failure.waitMs);
  try {
    await localTurn();
    const { body, clockAheadMs } = await request(path, params, timeoutMs);
    s.memory.set(key, { at: Date.now(), body, clockAheadMs });
    s.failures.delete(key);
    return body;
  } catch (error) {
    if (error instanceof FleetSmartError) {
      s.failures.set(key, { at: Date.now(), message: error.message, waitMs: Math.max(FAILURE_MS, error.retryAfterMs) });
    }
    throw error;
  }
}

function localTurn(): Promise<void> {
  const s = state();
  const mine = s.slot;
  s.slot = mine.then(() => sleep(RATE_LIMIT_GAP_MS));
  return mine;
}

/** Across servers: the saved response, the lock and the turns are rows in the database. */
async function loadShared(
  key: string,
  path: string,
  params: URLSearchParams,
  ttlMs: number,
  timeoutMs: number,
): Promise<JsonApiDocument> {
  const sql = await getSql();
  const started = Date.now();
  await sql`insert into fleetsmart_cache (key) values (${key}) on conflict (key) do nothing`;
  for (;;) {
    const [row] = await sql`
      select body, clock_ahead_ms, error_message, retry_after_ms,
        extract(epoch from (now() - fetched_at)) * 1000 as age_ms,
        extract(epoch from (now() - error_at)) * 1000 as error_age_ms
      from fleetsmart_cache where key = ${key}`;
    if (row?.body && Number(row.age_ms) < ttlMs) {
      state().clockAheadMs = Number(row.clock_ahead_ms);
      return parseBody(row.body);
    }
    if (row?.error_message && Number(row.error_age_ms) < Math.max(FAILURE_MS, Number(row.retry_after_ms))) {
      throw new FleetSmartError(String(row.error_message), Number(row.retry_after_ms));
    }
    // Take the lock, if no one else has it and the response is still out of date.
    const lockMs = timeoutMs + 5000;
    const won = await sql`
      update fleetsmart_cache set lock_until = now() + ${lockMs} * interval '1 millisecond'
      where key = ${key} and (lock_until is null or lock_until <= now())
        and (fetched_at is null or fetched_at <= now() - ${ttlMs} * interval '1 millisecond')
        and (error_at is null or error_at <= now() - ${FAILURE_MS} * interval '1 millisecond')
      returning key`;
    if (won.length > 0) return fetchAndSave(sql, key, path, params, timeoutMs);
    // Someone else is fetching it: wait for their answer.
    if (Date.now() - started >= timeoutMs) {
      throw new FleetSmartError(`FleetSmart did not respond within ${Math.round(timeoutMs / 1000)} seconds`);
    }
    await sleep(POLL_MS);
  }
}

const parseBody = (value: unknown): JsonApiDocument =>
  (typeof value === "string" ? JSON.parse(value) : value) as JsonApiDocument;

async function fetchAndSave(
  sql: Awaited<ReturnType<typeof getSql>>,
  key: string,
  path: string,
  params: URLSearchParams,
  timeoutMs: number,
): Promise<JsonApiDocument> {
  try {
    await databaseTurn(sql);
    const { body, clockAheadMs } = await request(path, params, timeoutMs);
    await sql`
      update fleetsmart_cache set body = ${JSON.stringify(body)}::jsonb, fetched_at = now(),
        clock_ahead_ms = ${clockAheadMs}, error_message = null, error_at = null, retry_after_ms = 0, lock_until = null
      where key = ${key}`.catch((error) => console.error("[fleetsmart] could not save the response:", error));
    return body;
  } catch (error) {
    const message = error instanceof Error ? error.message : "FleetSmart request failed";
    const retryAfterMs = error instanceof FleetSmartError ? error.retryAfterMs : 0;
    await sql`
      update fleetsmart_cache set error_message = ${message}, error_at = now(), retry_after_ms = ${retryAfterMs},
        lock_until = null
      where key = ${key}`.catch(() => undefined);
    throw error instanceof FleetSmartError ? error : new FleetSmartError(message);
  }
}

/** Waits for this request's turn among every server's, by the database's clock. */
async function databaseTurn(sql: Awaited<ReturnType<typeof getSql>>): Promise<void> {
  const claim = () => sql`
    update fleetsmart_gate set next_at = greatest(next_at, now()) + ${RATE_LIMIT_GAP_MS} * interval '1 millisecond'
    where id = 1
    returning extract(epoch from (next_at - now())) * 1000 - ${RATE_LIMIT_GAP_MS} as wait_ms`;
  let rows = await claim();
  if (rows.length === 0) {
    await sql`insert into fleetsmart_gate (id) values (1) on conflict (id) do nothing`;
    rows = await claim();
  }
  const wait = Number(rows[0]?.wait_ms ?? 0);
  if (wait > 0) await sleep(wait);
}

/** What FleetSmart said, to show: its status, and its message if the body has one. */
async function describe(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = JSON.parse(await response.text());
    const first = body?.errors?.[0];
    detail = String(first?.detail ?? first?.title ?? body?.message ?? body?.error ?? "");
  } catch {
    // not JSON; the status says enough
  }
  const base = `FleetSmart responded ${response.status} ${response.statusText}`.trim();
  return detail ? `${base}: ${detail.slice(0, 200)}` : base;
}

async function request(
  path: string,
  params: URLSearchParams,
  timeoutMs: number,
): Promise<{ body: JsonApiDocument; clockAheadMs: number }> {
  const headers: Record<string, string> = {
    "X-API-KEY": process.env.FLEETSMART_API_KEY ?? "",
    "Content-Type": "application/vnd.api+json",
    Accept: "application/vnd.api+json",
  };
  // The API accepts the key on its own; the client ID header is sent only when configured.
  if (process.env.FLEETSMART_CLIENT_ID) headers["X-CLIENT-ID"] = process.env.FLEETSMART_CLIENT_ID;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}?${params}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new FleetSmartError(
      timedOut
        ? `FleetSmart did not respond within ${Math.round(timeoutMs / 1000)} seconds`
        : `Could not reach FleetSmart (${error instanceof Error ? error.message : "network error"})`,
    );
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new FleetSmartError(await describe(response), Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
  }
  // The Date header is truncated to whole seconds, so assume the middle of that second.
  const serverDate = Date.parse(response.headers.get("date") ?? "");
  const clockAheadMs = Number.isFinite(serverDate) ? Date.now() - (serverDate + 500) : state().clockAheadMs;
  state().clockAheadMs = clockAheadMs;
  try {
    return { body: await response.json(), clockAheadMs };
  } catch {
    throw new FleetSmartError("FleetSmart sent a response that could not be read");
  }
}
