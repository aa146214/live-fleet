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
  and concurrent requests are shared. Every FleetSmart request waits its turn in one queue,
  keeping within its one-request-per-second limit.
- The first vehicles are streamed in with the page (`src/app/page.tsx`), so loading them starts
  when the page is requested rather than once the browser has run its scripts. After that the
  browser polls `/api/vehicles` every 15 seconds while the tab is visible.
- A server's first request fetches the whole fleet, at the same time as reading the routes and
  shuttles from the database, and learns the shuttles' FleetSmart vehicle ids. After that it asks
  for just the shuttles (`filter[vehicle_id]`), about three times faster than the whole fleet.
  FleetSmart can't filter by registration, hence the first full fetch.
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
  The heading is only passed to the router for a report where the minibus was moving (a stopped
  tracker keeps an old heading, which sent the road round the block), and a road much longer than
  the same hop without the headings is replaced by the shorter one.
- The marker then drives from where it is to the new report along that road, taking as long as
  the minibus did, and turns to follow it. It moves continuously and stays on the road, about
  one report (roughly a minute) behind the minibus.
- A moving minibus within 60 m of a road is drawn on it (the road the router found, or the
  route, or the nearest road); parked ones stay where they are reported.
- Between reports the marker is not predicted forward: a driver often takes a different road from
  the router's route, and a predicted marker then sits on the wrong road until the next report
  (replaying one shuttle's day, it was up to 400 m off). So it follows the road actually driven,
  about one report behind. The prediction code is kept behind `PREDICT_BETWEEN_REPORTS` in
  `src/lib/route-loops.ts`.
- Each shuttle's last two reports and the road between them are kept in the database
  (`vehicle_transitions`), so a server that has just started, or another one on hosting that runs
  several, still knows where a minibus came from. Where they aren't the report just before (the
  server is new, or nobody had the map open for a while), the report before is fetched from
  FleetSmart's history for that vehicle (about two seconds each, one vehicle at a time, because a
  request covering several vehicles never came back).
- A map opened part-way through a drive joins it part-way: it starts where a map that had been open
  all along would be, instead of waiting at the report until the next one arrives and then jumping.
- If the router finds no road (it is asked twice, the second time with a looser search), a hop of
  under 60 m is drawn as a straight line and a longer one jumps, rather than cutting across blocks
  and buildings. Gaps over 5 minutes also jump.
- A stopped minibus within 15 m of a road is drawn on that road, so it isn't left inside a building.
- A moving minibus that hasn't reported for 2.5 minutes is faded.
- Report times are the tracker's own (`date_time`). The server sends FleetSmart's current time
  with each response so a viewer's clock being off doesn't skew the timing.
- Demo buses are generated on the server from the clock: each drives back and forth along the Valhalla
  bus route (same router as live mode) between its station and the studio, reporting every 15 seconds, and the map treats those
  reports like live ones.
- Viewers who prefer reduced motion get the plain positions.

## Admin

`/admin` is where routes are made and minibuses are put on them.

- **Routes.** **Create route** (or **Edit** on a route) opens one screen for the route's name, a short
  name (used on the buttons at the top of the map), a colour from the palette, and its stops: add
  places one by one, reorder them and save. The minibuses drive the stops in that order and return to
  the first. A route can be deleted; its minibuses are then no longer on the map.
- **Minibuses.** On a route's screen, **Add minibuses** lists the vehicles in your FleetSmart account
  (nearest the studio first, with a search box); **Add** puts one on the route, **Move here** takes
  it off its other route. Each minibus has a code shown on the map, its number plate unless you change
  it. The home page also lists the minibuses that are on no route, with a route to pick for each.
  Only minibuses on a route are shown on the map.
- **Suggestions.** FleetSmart's place events (`poi_events`) for the last 14 days show which places a
  vehicle keeps visiting; a minibus that visited one of a route's stops (other than the studio) 3 or
  more times is suggested that route. The lookup takes about a minute the first time (FleetSmart
  allows one request a second), then is reused for 30 minutes.
- **Stops** are the places (Points of Interest) in the FleetSmart account, so to offer another stop,
  add it as a place in FleetSmart; it shows up in the picker within ten minutes. If the account has no
  places (or FleetSmart can't be reached) the built-in stations and studio entrances are offered.
  Places named Pinewood are never offered (`HIDDEN_PLACE_NAMES` in `src/lib/fleetsmart.ts`).
- **On the map** the stops drive the route information on the vehicle card, the next destination (the
  next stop along the road), and the road the shuttle follows between reports. Each route's stops are
  pinned (in the route's colour, or navy where several routes call); the studio keeps the Warner Bros.
  shield. Changes show within about 40 seconds.
- Sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` from the environment. `SESSION_SECRET`
  (32+ random characters) signs the session cookie, which lasts 8 hours. Use a long password:
  failed attempts are counted per server instance (5 failures lock that client out for 15 minutes),
  which slows guessing but isn't a hard limit on serverless hosting.
- The data lives in Neon Postgres (`DATABASE_URL`): the routes (`routes`) and which vehicle is on
  which (`vehicle_assignments`). The tables are created, and an older database upgraded, when a query
  finds one missing; an older database's three routes keep their ids and vehicles, and take the
  stops its vehicles had. Without `DATABASE_URL` the app uses the three routes in `src/lib/routes.ts`
  and the vehicles in `src/config/vehicle-assignments.ts`, and the admin says nothing can be saved.
  The demo always uses the routes in `src/lib/routes.ts`.
- The vehicle lists in the admin have a search box (registration or place) once they are long enough.

## Configure the shuttles

The FleetSmart account contains the whole fleet, so the shuttles have to be listed. With a
database, do it in the admin (above). Without one, list the shuttle registrations in
`src/config/vehicle-assignments.ts`:

```ts
export const VEHICLE_ASSIGNMENTS = {
  "AB12 CDE": { code: "W1", routeId: 1 }, // 1 Watford, 2 St Albans, 3 Rickmansworth
};
```

Only the vehicles listed there are shown on the map.

FleetSmart has no timetable data, so "Next destination" is estimated from the direction of
travel (towards the studio or towards the route's station).

## Before going live

- The North/South Entrance locations still need confirming (`src/lib/routes.ts`).
- The public OpenStreetMap tile server is for light use only; switch to a tile provider for
  production traffic.
- The public Valhalla server (FOSSGIS) is for light, non-commercial use; point `VALHALLA_URL`
  at a hosted or self-run Valhalla for production.
