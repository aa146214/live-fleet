"use client";

import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import {
  firstClear,
  placeLabel,
  placementsAround,
  type Box,
  type Placement,
  type Size,
} from "@/lib/label-placement";
import { drawnPosition, firstMotion, isStale, updateMotion, type Fix, type Motion } from "@/lib/motion";
import {
  getRoute,
  NORTH_ENTRANCE_LOCATION,
  routeColor,
  SOUTH_ENTRANCE_LOCATION,
  type Place,
  type PlaceId,
} from "@/lib/routes";
import { usePlaces, useRoutes } from "@/lib/routes-context";
import type { FleetSnapshot, RouteId, Vehicle } from "@/lib/types";
import styles from "./FleetMap.module.css";

const DEFAULT_CENTER: L.LatLngTuple = [51.695, -0.405];
const DEFAULT_ZOOM = 12;
const FIT_PADDING: L.PointExpression = [48, 48];

/** Bus marker artwork size (Figma "Vehicle Marker", pointing north at 0°). */
const BUS_WIDTH = 33.35;
const BUS_HEIGHT = 76;
/** Drawn smaller than the Figma frames (100% desktop, ~56% mobile) to keep the map readable. */
const DESKTOP_BUS_SCALE = 0.6;
const MOBILE_BUS_SCALE = 0.42;

/** Gap between a bus and its label. */
const LABEL_GAP = 4;
/** Label tag size: 11px bold code beside a 16px bus icon. */
const LABEL_HEIGHT = 26;
const labelWidth = (code: string) => Math.round(38 + code.length * 7.5);

/** How often the label layout and stale fading catch up with the moving markers. */
const LAYOUT_INTERVAL_MS = 1000;

/** Pin artwork: the tip (the real location) is near the bottom centre. */
const PIN_GEOMETRY = {
  station: { width: 43, height: 43, tipX: 21.5, tipY: 40.4 },
  studio: { width: 52, height: 63.3, tipX: 26, tipY: 62.8 },
};

export interface FleetMapProps {
  vehicles: Vehicle[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
  selectedPlaceId: PlaceId | null;
  onSelectPlace: (id: PlaceId) => void;
  mode: FleetSnapshot["mode"] | null;
  /** Counts each time a minibus is picked, even the one already selected, to follow it again. */
  vehiclePicks: number;
  /** Asks the map to show a route's area; a new `request` number is a new ask. */
  routeFocus: { routeId: RouteId; request: number } | null;
  /** How far this browser's clock is ahead of FleetSmart's, so report times can be compared with it. */
  clockAheadMs: number;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * The Figma "Vehicle Marker" bus (body, windows and a direction arrow at its nose),
 * filled with the route colour. Drawn from code rather than the exported SVGs so
 * every route — not just the blue one exported — gets the selected glow.
 */
function busSvg(color: string, showArrow: boolean): string {
  return `<svg width="${BUS_WIDTH}" height="${BUS_HEIGHT}" viewBox="0 0 33.3506 75.9848" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M24.2114 13.8645H9.13928C8.54572 13.8645 7.98283 14.1281 7.60284 14.5841L0.963557 22.5513C0.664032 22.9107 0.5 23.3638 0.5 23.8316L0.5 73.4848C0.5 74.5893 1.39543 75.4848 2.5 75.4848H30.8506C31.9552 75.4848 32.8506 74.5893 32.8506 73.4848V23.8316C32.8506 23.3638 32.6866 22.9107 32.3871 22.5513L25.7478 14.5841C25.3678 14.1281 24.8049 13.8645 24.2114 13.8645Z" fill="${color}" stroke="white"/>
    <path d="M29.7697 25.4184H3.58112V28.4994L6.66213 33.1209H26.6887L29.7697 28.4994V25.4184Z" fill="white" fill-opacity="0.2"/>
    <path d="M5.12156 35.4315L2.8108 32.3505L2.8108 70.8632H5.12156L5.12156 35.4315Z" fill="white" fill-opacity="0.2"/>
    <path d="M28.2292 35.4317L30.5399 32.3507L30.5399 70.8634H28.2292L28.2292 35.4317Z" fill="white" fill-opacity="0.2"/>
    ${
      showArrow
        ? `<path d="M16.2669 1.44623C16.4661 1.16398 16.8841 1.16406 17.0833 1.44623L22.4915 9.11029C22.7253 9.44151 22.4887 9.89838 22.0833 9.89838H11.2669C10.8617 9.8982 10.6252 9.44143 10.8587 9.11029L16.2669 1.44623Z" fill="${color}" stroke="white"/>`
        : ""
    }
  </svg>`;
}

/** Screen-space bounding box of a bus rotated to `heading` (null = parked, upright). */
function busBox(heading: number | null, scale: number): Size {
  const radians = ((heading ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: scale * (BUS_WIDTH * cos + BUS_HEIGHT * sin),
    height: scale * (BUS_WIDTH * sin + BUS_HEIGHT * cos),
  };
}

const placementStyle = ({ x, y }: Placement) => `--lx:${x}px;--ly:${y}px`;

/**
 * A bus pointing its heading: the direction of travel, or the way a parked bus last
 * faced (upright with no arrow when that's unknown). Its label tag shows on
 * hover/focus, or always when `labelled`.
 */
function busIcon(
  { code, routeId, heading }: Pick<Vehicle, "code" | "routeId" | "heading">,
  scale: number,
  selected: boolean,
  labelled: boolean,
  stale: boolean,
  animateLabel: boolean,
  placement: Placement,
): L.DivIcon {
  const color = routeColor(routeId);
  const size = Math.ceil(BUS_HEIGHT * scale);
  const classes = [
    styles.vehicleIcon,
    selected ? styles.selected : "",
    labelled ? styles.labelled : "",
    stale ? styles.stale : "",
  ];
  return L.divIcon({
    className: classes.join(" "),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `
      <span class="${styles.marker}" style="--route:${color}">
        <span class="${styles.bus}" style="transform:translate(-50%, -50%) rotate(${heading ?? 0}deg) scale(${scale})">
          ${busSvg(color, heading !== null)}
        </span>
        <span class="${styles.label} ${animateLabel ? styles.labelIn : ""}" style="${placementStyle(placement)}">
          <img src="/icons/bus-card.svg" width="16" height="16" alt="">
          <span>${escapeHtml(code)}</span>
        </span>
      </span>`,
  });
}

function pinIcon(place: Place, selected: boolean): L.DivIcon {
  const geometry = place.routeId === null ? PIN_GEOMETRY.studio : PIN_GEOMETRY.station;
  const src = place.routeId === null ? "/icons/pin-studio.svg" : `/icons/pin-route${place.routeId}.svg`;
  return L.divIcon({
    className: `${styles.pinIcon} ${selected ? styles.pinSelected : ""}`,
    iconSize: [geometry.width, geometry.height],
    iconAnchor: [geometry.tipX, geometry.tipY],
    html: `<img src="${src}" width="${geometry.width}" height="${geometry.height}" alt="">`,
  });
}

function VehicleMarker({
  vehicle,
  scale,
  selected,
  labelled,
  stale,
  placement,
  animated,
  onSelect,
  onMarker,
  shownHeading,
}: {
  vehicle: Vehicle;
  scale: number;
  selected: boolean;
  labelled: boolean;
  stale: boolean;
  placement: Placement;
  /** The layer moves this marker itself; React only sets where it starts. */
  animated: boolean;
  onSelect: (code: string) => void;
  onMarker: (id: string, marker: L.Marker | null) => void;
  /** The angle the layer last drew this bus at, if it animates it. */
  shownHeading: (id: string) => number | undefined;
}) {
  const { code, routeId, heading } = vehicle;
  const { x, y } = placement;

  // Fade the label in only when it first appears; later icon rebuilds (new heading) stay still.
  const [wasLabelled, setWasLabelled] = useState(labelled);
  const [animateLabel, setAnimateLabel] = useState(false);
  if (labelled !== wasLabelled) {
    setWasLabelled(labelled);
    setAnimateLabel(labelled);
  }
  useEffect(() => {
    if (!animateLabel) return;
    const timer = setTimeout(() => setAnimateLabel(false), 300);
    return () => clearTimeout(timer);
  }, [animateLabel]);

  // An animated bus is turned by the layer, so a new report's heading must not rebuild the icon
  // (which would snap the bus to that heading); only whether it has an arrow matters.
  const hasHeading = heading !== null;
  const iconHeading = animated ? (hasHeading ? 0 : null) : heading;
  const icon = useMemo(
    () => {
      const drawnHeading = animated ? (shownHeading(vehicle.id) ?? heading) : heading;
      return busIcon({ code, routeId, heading: hasHeading ? drawnHeading : null }, scale, selected, labelled, stale, animateLabel, { x, y });
    },
    // `iconHeading` stands in for `heading`: new report headings must not rebuild an animated icon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code, routeId, iconHeading, scale, selected, labelled, stale, animateLabel, x, y],
  );
  const [startPosition] = useState<L.LatLngTuple>(() => [vehicle.lat, vehicle.lng]);
  const reportedPosition = useMemo<L.LatLngTuple>(() => [vehicle.lat, vehicle.lng], [vehicle.lat, vehicle.lng]);
  const ref = useCallback((marker: L.Marker | null) => onMarker(vehicle.id, marker), [onMarker, vehicle.id]);
  const route = getRoute(useRoutes(), routeId);
  const label = `Minibus ${code}${route ? `, Route ${route.id} ${route.name}` : ""}`;

  return (
    <Marker
      ref={ref}
      position={animated ? startPosition : reportedPosition}
      icon={icon}
      title={label}
      alt={label}
      zIndexOffset={selected ? 1000 : 0}
      riseOnHover
      eventHandlers={{ click: () => onSelect(code) }}
    />
  );
}

const roundPlacement = ({ x, y }: Placement): Placement => ({ x: Math.round(x), y: Math.round(y) });
const relativeTo = (origin: { x: number; y: number }) => (box: Box): Box => ({
  ...box,
  x: box.x - origin.x,
  y: box.y - origin.y,
});

type DrawnPositions = ReadonlyMap<string, { lat: number; lng: number; heading: number | null; stale: boolean }>;
const NOT_DRAWN: DrawnPositions = new Map();

/** A vehicle's report, with its time moved onto this browser's clock. */
const toFix = (v: Vehicle, clockAheadMs: number): Fix => ({
  lat: v.lat,
  lng: v.lng,
  heading: v.heading,
  status: v.status,
  report: v.updatedAt ?? "",
  at: v.updatedAt ? Date.parse(v.updatedAt) + clockAheadMs : Date.now(),
  road: v.road,
  ahead: v.ahead,
  // FleetSmart reports speed in mph.
  speed: v.speedMph === null ? null : v.speedMph * 0.44704,
});

/** Turns a bus marker to `heading` the short way round, from whatever angle it shows now. */
function pointBus(marker: L.Marker | undefined, heading: number | null): number | undefined {
  const bus = marker?.getElement()?.querySelector<HTMLElement>(`.${styles.bus}`);
  if (!bus || heading === null) return undefined;
  const current = Number(/rotate\(([-\d.]+)deg\)/.exec(bus.style.transform)?.[1] ?? 0);
  const turn = ((((heading - current) % 360) + 540) % 360) - 180;
  if (Math.abs(turn) < 0.5) return current;
  const next = current + turn;
  bus.style.transform = bus.style.transform.replace(/rotate\([^)]*\)/, `rotate(${next.toFixed(1)}deg)`);
  return next;
}

/**
 * Moves the markers between FleetSmart reports (see lib/motion.ts). Positions are
 * set on the Leaflet markers every frame, outside React; the drawn positions are
 * shared with the label layout once a second.
 */
function useLiveMotion(vehicles: Vehicle[], enabled: boolean, clockAheadMs: number) {
  const motions = useRef(new Map<string, Motion>());
  const markers = useRef(new Map<string, L.Marker>());
  // The angle each bus is drawn at, so a rebuilt icon starts there instead of snapping elsewhere.
  const shown = useRef(new Map<string, number>());
  const shownHeading = useCallback((id: string) => shown.current.get(id), []);
  const [drawn, setDrawn] = useState<DrawnPositions>(NOT_DRAWN);

  const registerMarker = useCallback((id: string, marker: L.Marker | null) => {
    if (marker) markers.current.set(id, marker);
    else markers.current.delete(id);
  }, []);

  useEffect(() => {
    const now = Date.now();
    const next = new Map<string, Motion>();
    for (const vehicle of vehicles) {
      const current = motions.current.get(vehicle.id);
      const fix = toFix(vehicle, clockAheadMs);
      next.set(vehicle.id, current ? updateMotion(current, fix, now) : firstMotion(fix, now));
    }
    motions.current = next;
  }, [vehicles, clockAheadMs]);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let lastShared = 0;
    const step = () => {
      const now = Date.now();
      for (const [id, motion] of motions.current) {
        const { lat, lng, heading } = drawnPosition(motion, now);
        const marker = markers.current.get(id);
        marker?.setLatLng([lat, lng]);
        const angle = pointBus(marker, heading);
        if (angle !== undefined) shown.current.set(id, angle);
      }
      if (now - lastShared >= LAYOUT_INTERVAL_MS) {
        lastShared = now;
        setDrawn(
          new Map(
            [...motions.current].map(([id, motion]) => [
              id,
              { ...drawnPosition(motion, now), stale: isStale(motion.fix, now) },
            ]),
          ),
        );
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  return { drawn: enabled ? drawn : NOT_DRAWN, registerMarker, markers, shownHeading };
}

/** Zoom a selected minibus is flown to, if the map is further out than this. */
const FOLLOW_ZOOM = 15;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * Draws the buses and lays out their labels. When every bus in view can show its
 * label without touching another bus, label or pin, all labels show; otherwise
 * only the selected one does, and hover labels are placed clear of other buses.
 */
function VehicleLayer({
  vehicles,
  selectedCode,
  onSelect,
  animate,
  vehiclePicks,
  clockAheadMs,
}: Pick<FleetMapProps, "vehicles" | "selectedCode" | "onSelect" | "vehiclePicks" | "clockAheadMs"> & {
  animate: boolean;
}) {
  const map = useMap();
  const { drawn, registerMarker, markers, shownHeading } = useLiveMotion(vehicles, animate, clockAheadMs);
  const positionOf = useCallback((v: Vehicle) => drawn.get(v.id) ?? v, [drawn]);

  // Bumped whenever the view changes so the label layout re-runs.
  const [viewVersion, setViewVersion] = useState(0);
  // Following a selected minibus lasts until the user moves the map themselves. `ownMove` marks
  // the moves made by following, so they aren't mistaken for the user's.
  const following = useRef(false);
  const ownMove = useRef(false);
  const handlers = useMemo(() => {
    const bump = () => setViewVersion((version) => version + 1);
    return {
      moveend: () => {
        ownMove.current = false;
        bump();
      },
      zoomend: bump,
      resize: bump,
      dragstart: () => {
        following.current = false;
      },
      zoomstart: () => {
        if (!ownMove.current) following.current = false;
      },
    };
  }, []);
  useMapEvents(handlers);

  // Fly to a minibus where it is drawn now when it's picked, then keep it in view as it drives,
  // until the user moves the map (picking it again follows it again).
  const selectedId = vehicles.find((v) => v.code === selectedCode)?.id;
  const flownTo = useRef<{ id: string; at: number }>(undefined);
  const handledPicks = useRef(vehiclePicks);
  useEffect(() => {
    const marker = selectedId ? markers.current.get(selectedId) : undefined;
    if (!selectedId || !marker) {
      flownTo.current = undefined;
      return;
    }
    const position = marker.getLatLng();
    const picked = vehiclePicks !== handledPicks.current;
    if (flownTo.current?.id !== selectedId || picked) {
      handledPicks.current = vehiclePicks;
      flownTo.current = { id: selectedId, at: Date.now() };
      following.current = true;
      ownMove.current = true;
      const zoom = Math.max(map.getZoom(), FOLLOW_ZOOM);
      if (animate) map.flyTo(position, zoom, { duration: 1 });
      else map.setView(position, zoom, { animate: false });
    } else if (
      following.current &&
      Date.now() - flownTo.current.at > 1500 &&
      !map.getBounds().pad(-0.15).contains(position)
    ) {
      ownMove.current = true;
      map.panTo(position);
    }
  }, [map, selectedId, drawn, animate, vehiclePicks]); // eslint-disable-line react-hooks/exhaustive-deps

  const places = usePlaces();
  const layout = useMemo(() => {
    void viewVersion;
    const scale = map.getSize().x >= 600 ? DESKTOP_BUS_SCALE : MOBILE_BUS_SCALE;
    const bounds = map.getBounds();
    const nearby = vehicles.filter((v) => bounds.pad(0.2).contains(positionOf(v)));
    const inView = new Set(nearby.filter((v) => bounds.contains(positionOf(v))).map((v) => v.id));

    const busBoxes = new Map(
      nearby.map((v) => {
        const { x, y } = map.latLngToContainerPoint(positionOf(v));
        return [v.id, { x, y, ...busBox(drawn.get(v.id)?.heading ?? v.heading, scale) }];
      }),
    );
    const pinBoxes: Box[] = places.map((place) => {
      const g = place.routeId === null ? PIN_GEOMETRY.studio : PIN_GEOMETRY.station;
      const { x, y } = map.latLngToContainerPoint([place.lat, place.lng]);
      return { x: x - g.tipX + g.width / 2, y: y - g.tipY + g.height / 2, width: g.width, height: g.height };
    });

    const candidatesFor = (v: Vehicle) => {
      const box = busBoxes.get(v.id)!;
      return placementsAround(
        { halfWidth: box.width / 2, halfHeight: box.height / 2 },
        { width: labelWidth(v.code), height: LABEL_HEIGHT },
        LABEL_GAP,
      );
    };
    const otherBuses = (v: Vehicle) => [...busBoxes].filter(([id]) => id !== v.id).map(([, box]) => box);
    const labelBox = (v: Vehicle, p: Placement): Box => {
      const { x, y } = busBoxes.get(v.id)!;
      return { x: x + p.x, y: y + p.y, width: labelWidth(v.code), height: LABEL_HEIGHT };
    };

    const result = new Map<string, { labelled: boolean; placement: Placement }>();
    const fallback = (v: Vehicle) => placementsAround(12, { width: labelWidth(v.code), height: LABEL_HEIGHT }, LABEL_GAP)[0];

    // Can every bus in view show its label at once? Place them one by one, each
    // avoiding buses, pins and the labels already placed.
    const placedLabels: Box[] = [];
    const allLabels = new Map<string, Placement>();
    let allFit = true;
    for (const v of nearby.filter((v) => inView.has(v.id))) {
      const origin = busBoxes.get(v.id)!;
      const clear = firstClear(
        { width: labelWidth(v.code), height: LABEL_HEIGHT },
        candidatesFor(v),
        [...otherBuses(v), ...pinBoxes, ...placedLabels].map(relativeTo(origin)),
        LABEL_GAP,
      );
      if (!clear) {
        allFit = false;
        break;
      }
      allLabels.set(v.id, clear);
      placedLabels.push(labelBox(v, clear));
    }

    const selected = vehicles.find((v) => v.code === selectedCode);
    let selectedLabel: Box | null = null;
    // Hover/selected labels avoid other buses first, then pins; selected is placed first.
    const ordered = selected ? [selected, ...vehicles.filter((v) => v !== selected)] : vehicles;
    for (const v of ordered) {
      if (allFit && allLabels.has(v.id)) {
        result.set(v.id, { labelled: true, placement: roundPlacement(allLabels.get(v.id)!) });
        continue;
      }
      const origin = busBoxes.get(v.id);
      if (!origin) {
        result.set(v.id, { labelled: v === selected, placement: roundPlacement(fallback(v)) });
        continue;
      }
      const hard = [...otherBuses(v), ...(selectedLabel && v !== selected ? [selectedLabel] : [])];
      const placement = placeLabel(
        { width: labelWidth(v.code), height: LABEL_HEIGHT },
        candidatesFor(v),
        hard.map(relativeTo(origin)),
        LABEL_GAP,
        pinBoxes.map(relativeTo(origin)),
      );
      if (v === selected) selectedLabel = labelBox(v, placement);
      result.set(v.id, { labelled: v === selected, placement: roundPlacement(placement) });
    }
    return { result, scale };
  }, [map, vehicles, places, selectedCode, viewVersion, positionOf, drawn]);

  return vehicles.map((vehicle) => {
    const { labelled, placement } = layout.result.get(vehicle.id) ?? { labelled: false, placement: { x: 0, y: 0 } };
    return (
      <VehicleMarker
        key={vehicle.id}
        vehicle={vehicle}
        scale={layout.scale}
        selected={vehicle.code === selectedCode}
        labelled={labelled}
        stale={drawn.get(vehicle.id)?.stale ?? false}
        placement={placement}
        animated={animate}
        onSelect={onSelect}
        onMarker={registerMarker}
        shownHeading={shownHeading}
      />
    );
  });
}

function PlacePin({ place, selected, onSelect }: { place: Place; selected: boolean; onSelect: (id: PlaceId) => void }) {
  const icon = useMemo(() => pinIcon(place, selected), [place, selected]);
  return (
    <Marker
      position={[place.lat, place.lng]}
      icon={icon}
      title={place.name}
      alt={place.name}
      zIndexOffset={selected ? 900 : -500}
      eventHandlers={{ click: () => onSelect(place.id) }}
    />
  );
}

function boundsFor(vehicles: Vehicle[], places: Place[]): L.LatLngBounds {
  const points: L.LatLngTuple[] = vehicles.length
    ? vehicles.map((v) => [v.lat, v.lng])
    : places.map((p) => [p.lat, p.lng]);
  return L.latLngBounds(points);
}

/** Fits the fleet once, pans to the selected place, and reacts to container resizes. */
function MapBehaviour({
  vehicles,
  selectedCode,
  selectedPlaceId,
  routeFocus,
}: Pick<FleetMapProps, "vehicles" | "selectedCode" | "selectedPlaceId" | "routeFocus">) {
  const map = useMap();
  const routes = useRoutes();
  const places = usePlaces();
  const hasFitted = useRef(false);

  // Shows a route's area: its station, the studio and its minibuses as they are now.
  const latestVehicles = useRef(vehicles);
  useEffect(() => {
    latestVehicles.current = vehicles;
  }, [vehicles]);
  const focusRequest = routeFocus?.request;
  useEffect(() => {
    if (!routeFocus) return;
    const route = getRoute(routes, routeFocus.routeId);
    if (!route) return;
    const points: L.LatLngTuple[] = [
      [route.stationLocation.lat, route.stationLocation.lng],
      [NORTH_ENTRANCE_LOCATION.lat, NORTH_ENTRANCE_LOCATION.lng],
      [SOUTH_ENTRANCE_LOCATION.lat, SOUTH_ENTRANCE_LOCATION.lng],
    ];
    for (const v of latestVehicles.current) if (v.routeId === route.id) points.push([v.lat, v.lng]);
    map.flyToBounds(L.latLngBounds(points), { padding: FIT_PADDING, duration: 1 });
  }, [map, focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (hasFitted.current || vehicles.length === 0) return;
    hasFitted.current = true;
    const placeBounds = L.latLngBounds(places.map((p) => [p.lat, p.lng]));
    map.fitBounds(boundsFor(vehicles, places).extend(placeBounds), { padding: FIT_PADDING });
  }, [map, vehicles, places]);

  // Minibuses are followed by the vehicle layer, which knows where they are drawn.
  const selected = selectedCode ? undefined : places.find((p) => p.id === selectedPlaceId);
  useEffect(() => {
    if (!selected) return;
    const position = L.latLng(selected.lat, selected.lng);
    if (!map.getBounds().pad(-0.15).contains(position)) map.panTo(position);
  }, [map, selected]);

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

export default function FleetMap({
  vehicles,
  selectedCode,
  onSelect,
  selectedPlaceId,
  onSelectPlace,
  mode,
  routeFocus,
  vehiclePicks,
  clockAheadMs,
}: FleetMapProps) {
  const [map, setMap] = useState<L.Map | null>(null);
  const places = usePlaces();
  const reducedMotion = usePrefersReducedMotion();
  const animate = mode !== null && !reducedMotion;

  return (
    <div className={styles.wrapper}>
      <MapContainer
        ref={setMap}
        className={styles.map}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
        {places.map((place) => (
          <PlacePin
            key={place.id}
            place={place}
            selected={place.id === selectedPlaceId}
            onSelect={onSelectPlace}
          />
        ))}
        <VehicleLayer
          vehicles={vehicles}
          selectedCode={selectedCode}
          onSelect={onSelect}
          animate={animate}
          vehiclePicks={vehiclePicks}
          clockAheadMs={clockAheadMs}
        />
        <MapBehaviour
          vehicles={vehicles}
          selectedCode={selectedCode}
          selectedPlaceId={selectedPlaceId}
          routeFocus={routeFocus}
        />
      </MapContainer>

      <div className={styles.north} aria-hidden="true">
        <span>▲</span>
        <span>N</span>
      </div>

      <div className={styles.controls}>
        <button type="button" className={styles.control} aria-label="Zoom in" onClick={() => map?.zoomIn()}>
          +
        </button>
        <button type="button" className={styles.control} aria-label="Zoom out" onClick={() => map?.zoomOut()}>
          −
        </button>
        <button
          type="button"
          className={styles.control}
          aria-label="Show all minibuses"
          onClick={() => map?.fitBounds(boundsFor(vehicles, places), { padding: FIT_PADDING })}
        >
          ⌖
        </button>
      </div>

      <p className={styles.attribution}>
        ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>{" "}
        contributors
        {mode === "demo" ? " · illustrative bus positions" : mode === "live" ? " · positions from FleetSmart" : ""}
      </p>
    </div>
  );
}
