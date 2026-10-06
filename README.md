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

Without an API key the app shows the six illustrative minibuses from the design. To force them
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
- Nothing is guessed beyond the latest report. If no road is found (router down, odd data), that
  stretch is a straight line; gaps over 5 minutes or 1.5 km snap.
- A moving minibus that hasn't reported for 2.5 minutes is faded.
- Report times are the tracker's own (`date_time`). The server sends FleetSmart's current time
  with each response so a viewer's clock being off doesn't skew the timing.
- Demo buses and viewers who prefer reduced motion get the plain positions.

## Configure the shuttles

The FleetSmart account contains the whole fleet, so list the shuttle registrations in
`src/config/vehicle-assignments.ts`:

```ts
export const VEHICLE_ASSIGNMENTS = {
  "AB12 CDE": { code: "W1", routeId: 1 }, // 1 Watford, 2 St Albans, 3 Rickmansworth
};
```

Until that list has entries, every minibus within 20 km of the studio is shown, labelled by
registration.

FleetSmart has no timetable data, so "Next destination" is estimated from the direction of
travel (towards the studio or towards the route's station).

## Before going live

- The North/South Entrance locations still need confirming (`src/lib/routes.ts`).
- The public OpenStreetMap tile server is for light use only; switch to a tile provider for
  production traffic.
- The public Valhalla server (FOSSGIS) is for light, non-commercial use; point `VALHALLA_URL`
  at a hosted or self-run Valhalla for production.
