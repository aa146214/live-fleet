# Leavesden Shuttle

Live map of the Warner Bros. Studios Leavesden shuttle minibuses, built from the
"Warner Bros_Leavesden Shuttle" Figma file (mobile and desktop) and fed by the
[FleetSmart API](https://apiguide.fleetsmartlive.com/).

## Run it

```bash
npm install
cp .env.example .env.local   # then add FLEETSMART_API_KEY
npm run dev
```

Without an API key the app shows six illustrative minibuses that keep driving their routes. To force them
while a key is set (e.g. for a design review), run with `FLEET_DEMO=1`.

## How it works

- `src/app/api/vehicles/route.ts` calls FleetSmart `GET /live_views?include=vehicle,vehicle_location`
  on the server, so the API key never reaches the browser. Responses are cached for 10 seconds
  and concurrent requests are shared, keeping within FleetSmart's one-request-per-second limit.
- The browser polls `/api/vehicles` every 15 seconds while the tab is visible.
- The map uses Leaflet with OpenStreetMap tiles. Bus markers, pins, rows, details cards and
  route filters follow the updated Figma design. Moving buses point their direction of travel;
  parked ones sit upright without the arrow.
- Tapping the studio or a station pin shows its details (what3words, route, entrances).
- Selections live in the URL (`/?vehicle=W1`, `/?place=station-1`), so they can be linked.

## Smooth movement between reports

Trackers report to FleetSmart about once a minute. Instead of jumping to each report, the map
drives each minibus along the road it took (`src/lib/road-paths.ts`, `src/lib/motion.ts`):

- When a new report arrives, the server looks up the road from the previous report with
  Valhalla's **bus** routing, which allows bus-only roads that car routers detour around.
  Routes longer than the minibus could have driven at its reported speeds are rejected.
- The marker then drives from where it is to the new report along that road, taking as long as
  the minibus did, and turns to follow it. It moves continuously and stays on the road, about
  one report (roughly a minute) behind the minibus.
- A moving minibus within 60 m of a road is drawn on it (the road the router found, or the
  route, or the nearest road); parked ones stay where they are reported.
- A minibus assigned to a route is also followed between reports: the server sends the route's
  road ahead of it, and the map predicts its position along that road from the report's speed and
  age (for up to 90 seconds), gliding onto each new report instead of jumping, and waiting if it
  was ahead rather than going backwards. Minibuses with no route assigned aren't predicted: a
  guess would leave the road at the first bend, so they stay about one report behind.
- If no road is found (router down, odd data), that stretch is a straight line; gaps over
  5 minutes or 1.5 km (500 m when following) snap.
- A moving minibus that hasn't reported for 2.5 minutes is faded.
- Report times are the tracker's own (`date_time`). The server sends FleetSmart's current time
  with each response so a viewer's clock being off doesn't skew the timing.
- Demo buses are generated on the server from the clock: each drives back and forth along the Valhalla
  bus route (same router as live mode) between its station and the studio, reporting every 15 seconds, and the map treats those
  reports like live ones.
- Viewers who prefer reduced motion get the plain positions.

## Admin

`/admin` lists the shuttles and the other vehicles in your FleetSmart account. **Add route** (or
**Edit route**) opens one screen where you give the vehicle a code and add its stops one by one
(stations and the studio's North and South entrances), reorder them and save. The shuttle drives
the stops in that order and then returns to the first. Changes show on the map within about 30
seconds.

- A shuttle's route (its colour and group on the map) is chosen in a dropdown, which starts from the first
  station among its stops.
- The stops drive the map: the route information on the vehicle card, the next destination (the
  next stop along the road), and the road the shuttle follows between reports.
- Sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` from the environment. `SESSION_SECRET`
  (32+ random characters) signs the session cookie, which lasts 8 hours. Use a long password:
  failed attempts are counted per server instance (5 failures lock that client out for 15 minutes),
  which slows guessing but isn't a hard limit on serverless hosting.
- The data lives in Neon Postgres (`DATABASE_URL`). The tables are created (and an older database
  upgraded) the first time the admin or map reads them. Without `DATABASE_URL` the app falls back to
  `src/config/vehicle-assignments.ts` (each vehicle gets its route's usual stops) and the admin page
  says nothing can be saved.
- Minibuses near the studio that aren't shuttles yet are shown on the map too, labelled by
  registration and without a route, so you can spot the ones to add.
- The three routes' names and stations are in `src/lib/routes.ts` (and the `routes` table, which
  the admin doesn't edit).

## Configure the shuttles

The FleetSmart account contains the whole fleet, so the shuttles have to be listed. With a
database, do it in the admin (above). Without one, list the shuttle registrations in
`src/config/vehicle-assignments.ts`:

```ts
export const VEHICLE_ASSIGNMENTS = {
  "AB12 CDE": { code: "W1", routeId: 1 }, // 1 Watford, 2 St Albans, 3 Rickmansworth
};
```

Minibuses within 20 km of the studio that aren't listed are shown too, labelled by registration
and without a route.

FleetSmart has no timetable data, so "Next destination" is estimated from the direction of
travel (towards the studio or towards the route's station).

## Before going live

- The North/South Entrance locations still need confirming (`src/lib/routes.ts`).
- The public OpenStreetMap tile server is for light use only; switch to a tile provider for
  production traffic.
- The public Valhalla server (FOSSGIS) is for light, non-commercial use; point `VALHALLA_URL`
  at a hosted or self-run Valhalla for production.
