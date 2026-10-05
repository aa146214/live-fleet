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
