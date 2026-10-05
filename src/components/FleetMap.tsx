"use client";

import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { labelsFit } from "@/lib/label-fit";
import { placeLabel, placementsAround, type Box, type Placement } from "@/lib/label-placement";
import { getRoute, POINTS_OF_INTEREST, routeColor } from "@/lib/routes";
import type { FleetSnapshot, Vehicle } from "@/lib/types";
import styles from "./FleetMap.module.css";

const DEFAULT_CENTER: L.LatLngTuple = [51.695, -0.405];
const DEFAULT_ZOOM = 12;
const FIT_PADDING: L.PointExpression = [48, 48];
const MARKER_HEIGHT = 44;
/** Compact arrow/dot markers are this many pixels square. */
const COMPACT_SIZE = 24;
/** Clear space labels need between them before they are all shown. */
const LABEL_SPACING = 8;
/** Moving minibuses need extra room for the direction arrow orbiting the label. */
const ARROW_CLEARANCE = 24;
/** Gap between a marker and its hover label / selected callout pill. */
const LABEL_GAP = 4;
const PILL_GAP = 6;
/** Hover label size: 11px bold code beside a 14px bus icon. */
const HOVER_LABEL_HEIGHT = 26;
const hoverLabelWidth = (code: string) => Math.round(36 + code.length * 7.5);
/** Place-name label geometry (see .poi in the stylesheet): starts 11px left of its point. */
const POI_LABEL_HEIGHT = 26;
const POI_LABEL_OFFSET_X = -11;
const poiLabelWidth = (name: string) => Math.round(14 + name.length * 6.2);

// Shuttle codes fit the 60px Figma marker; registrations (unassigned vehicles) need more room.
const markerWidth = (code: string) => Math.max(60, Math.round(36 + code.length * 8));

export interface FleetMapProps {
  vehicles: Vehicle[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
  mode: FleetSnapshot["mode"] | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Distance from the marker centre to just outside its edge along the heading. */
function arrowOrbit(width: number, heading: number): number {
  const radians = (heading * Math.PI) / 180;
  const toSide = Math.abs(Math.sin(radians)) > 1e-6 ? width / 2 / Math.abs(Math.sin(radians)) : Infinity;
  const toTopOrBottom =
    Math.abs(Math.cos(radians)) > 1e-6 ? MARKER_HEIGHT / 2 / Math.abs(Math.cos(radians)) : Infinity;
  return Math.round(Math.min(toSide, toTopOrBottom) + 12);
}

/** Route-coloured arrow for a moving minibus (pointing its heading), or a dot when stopped. */
function glyphHtml({ routeId, heading }: Pick<Vehicle, "routeId" | "heading">): string {
  // Unassigned vehicles borrow the dark route-2 arrow to match their navy colour.
  return heading === null
    ? `<span class="${styles.dot}" style="--route:${routeColor(routeId)}"></span>`
    : `<img class="${styles.heading}" src="/icons/arrow-route${routeId ?? 2}.svg" width="18" height="22" alt="" style="transform:rotate(${heading}deg)">`;
}

const placementStyle = ({ x, y }: Placement) => `--lx:${x}px;--ly:${y}px`;

/**
 * Overview marker: an arrow or dot. Its label appears on hover or focus at
 * `hoverPlacement`, chosen so it doesn't cover neighbouring minibuses.
 */
function compactIcon(
  { code, routeId, heading }: Pick<Vehicle, "code" | "routeId" | "heading">,
  hoverPlacement: Placement,
): L.DivIcon {
  return L.divIcon({
    className: `${styles.vehicleIcon} ${styles.compact}`,
    iconSize: [COMPACT_SIZE, COMPACT_SIZE],
    iconAnchor: [COMPACT_SIZE / 2, COMPACT_SIZE / 2],
    html: `
      <span class="${styles.marker}">
        ${glyphHtml({ routeId, heading })}
        <span class="${styles.hoverLabel}" style="--route:${routeColor(routeId)};${placementStyle(hoverPlacement)}">
          <img src="/icons/bus-marker.svg" width="14" height="17" alt="">
          <span>${escapeHtml(code)}</span>
        </span>
      </span>`,
  });
}

function pillHtml(code: string, routeId: Vehicle["routeId"], selected: boolean): string {
  return `
    ${selected ? `<span class="${styles.halo}"></span>` : ""}
    <span class="${styles.vehicle}" style="--route:${routeColor(routeId)};width:${markerWidth(code)}px">
      <img src="/icons/bus-marker.svg" width="18" height="22" alt="">
      <span>${escapeHtml(code)}</span>
    </span>`;
}

/**
 * The Figma marker: a pill with the bus icon and code. Centred on the minibus
 * (with an orbiting direction arrow) when that covers nothing; otherwise drawn
 * as a callout beside the minibus's arrow or dot at `placement`.
 */
function labelledIcon(
  { code, routeId, heading }: Pick<Vehicle, "code" | "routeId" | "heading">,
  selected: boolean,
  animateIn: boolean,
  placement: Placement,
): L.DivIcon {
  const pop = animateIn ? styles.popIn : "";

  if (placement.x !== 0 || placement.y !== 0) {
    return L.divIcon({
      className: `${styles.vehicleIcon} ${styles.calloutIcon}`,
      iconSize: [COMPACT_SIZE, COMPACT_SIZE],
      iconAnchor: [COMPACT_SIZE / 2, COMPACT_SIZE / 2],
      html: `
        <span class="${styles.marker}">
          ${glyphHtml({ routeId, heading })}
          <span class="${styles.callout}" style="${placementStyle(placement)}">
            <span class="${styles.calloutPill} ${pop}" style="width:${markerWidth(code)}px">${pillHtml(code, routeId, selected)}</span>
          </span>
        </span>`,
    });
  }

  const width = markerWidth(code);
  const arrow =
    heading === null
      ? ""
      : `<img class="${styles.arrow}" src="/icons/arrow-route${routeId ?? 2}.svg" width="16" height="20" alt="" style="--heading:${heading}deg;--orbit:${arrowOrbit(width, heading)}px">`;
  return L.divIcon({
    className: styles.vehicleIcon,
    iconSize: [width, MARKER_HEIGHT],
    iconAnchor: [width / 2, MARKER_HEIGHT / 2],
    html: `
      <span class="${styles.marker} ${pop}">
        ${pillHtml(code, routeId, selected)}
        ${arrow}
      </span>`,
  });
}

function poiIcon(name: string): L.DivIcon {
  return L.divIcon({
    className: styles.poiIcon,
    iconSize: undefined,
    html: `<span class="${styles.poi}"><span aria-hidden="true">●</span><b>${escapeHtml(name)}</b></span>`,
  });
}

/**
 * A minibus on the map: a compact arrow or dot, expanded to the labelled Figma
 * marker when `labelled` (selected, or there is room for every label).
 * Hovering or focusing a compact marker shows its label.
 */
function VehicleMarker({
  vehicle,
  selected,
  labelled,
  placement,
  onSelect,
}: {
  vehicle: Vehicle;
  selected: boolean;
  labelled: boolean;
  /** Label position: the pill when labelled, otherwise the hover label. */
  placement: Placement;
  onSelect: (code: string) => void;
}) {
  const { code, routeId, heading } = vehicle;
  const { x, y } = placement;

  // Animate only the moment the label appears; later icon rebuilds (new heading) stay still.
  const [wasLabelled, setWasLabelled] = useState(labelled);
  const [animateIn, setAnimateIn] = useState(false);
  if (labelled !== wasLabelled) {
    setWasLabelled(labelled);
    setAnimateIn(labelled);
  }
  useEffect(() => {
    if (!animateIn) return;
    const timer = setTimeout(() => setAnimateIn(false), 300);
    return () => clearTimeout(timer);
  }, [animateIn]);

  const icon = useMemo(
    () =>
      labelled
        ? labelledIcon({ code, routeId, heading }, selected, animateIn, { x, y })
        : compactIcon({ code, routeId, heading }, { x, y }),
    [code, routeId, heading, selected, labelled, animateIn, x, y],
  );
  const route = getRoute(routeId);
  const label = `Minibus ${code}${route ? `, Route ${route.id} ${route.name}` : ""}`;

  return (
    <Marker
      position={[vehicle.lat, vehicle.lng]}
      icon={icon}
      title={label}
      alt={label}
      zIndexOffset={selected ? 1000 : 0}
      riseOnHover
      eventHandlers={{ click: () => onSelect(code) }}
    />
  );
}

const CENTRED: Placement = { x: 0, y: 0 };
const compactBox = (x: number, y: number): Box => ({ x, y, width: COMPACT_SIZE, height: COMPACT_SIZE });
const roundPlacement = ({ x, y }: Placement): Placement => ({ x: Math.round(x), y: Math.round(y) });

/**
 * Draws the minibuses. When every minibus in view could show its full label
 * without touching another, all of them do; otherwise they stay compact, and
 * the selected pill and hover labels are placed where they cover no other minibus.
 */
function VehicleLayer({ vehicles, selectedCode, onSelect }: Omit<FleetMapProps, "mode">) {
  const map = useMap();
  // Bumped whenever the view changes so the label layout re-runs.
  const [viewVersion, setViewVersion] = useState(0);
  const handlers = useMemo(() => {
    const bump = () => setViewVersion((version) => version + 1);
    return { moveend: bump, zoomend: bump, resize: bump };
  }, []);
  useMapEvents(handlers);

  const layout = useMemo(() => {
    void viewVersion;
    const bounds = map.getBounds();
    const point = (vehicle: Vehicle) => map.latLngToContainerPoint([vehicle.lat, vehicle.lng]);

    const showAllLabels = labelsFit(
      vehicles
        .filter((vehicle) => bounds.contains([vehicle.lat, vehicle.lng]))
        .map((vehicle) => {
          const { x, y } = point(vehicle);
          return {
            x,
            y,
            width: markerWidth(vehicle.code),
            height: MARKER_HEIGHT,
            margin: vehicle.heading === null ? LABEL_SPACING : ARROW_CLEARANCE,
          };
        }),
    );
    const result = new Map<string, { labelled: boolean; placement: Placement }>();
    if (showAllLabels) {
      for (const vehicle of vehicles) result.set(vehicle.id, { labelled: true, placement: CENTRED });
      return result;
    }

    // Every minibus near the view, in screen pixels, so labels can avoid them.
    const screen = new Map(
      vehicles
        .filter((vehicle) => bounds.pad(0.2).contains([vehicle.lat, vehicle.lng]))
        .map((vehicle) => [vehicle.id, point(vehicle)]),
    );
    const obstaclesAround = (vehicle: Vehicle, extra: Box[] = []): Box[] => {
      const origin = screen.get(vehicle.id);
      if (!origin) return [];
      return [
        ...[...screen]
          .filter(([id]) => id !== vehicle.id)
          .map(([, other]) => compactBox(other.x, other.y)),
        ...extra,
      ].map((box) => ({ ...box, x: box.x - origin.x, y: box.y - origin.y }));
    };

    // Place-name labels are avoided too, but covering one beats covering a minibus.
    const poiBoxes: Box[] = POINTS_OF_INTEREST.map((poi) => {
      const { x, y } = map.latLngToContainerPoint([poi.lat, poi.lng]);
      const width = poiLabelWidth(poi.name);
      return { x: x + POI_LABEL_OFFSET_X + width / 2, y, width, height: POI_LABEL_HEIGHT };
    });
    const poiObstaclesAround = (vehicle: Vehicle): Box[] => {
      const origin = screen.get(vehicle.id);
      if (!origin) return [];
      return poiBoxes.map((box) => ({ ...box, x: box.x - origin.x, y: box.y - origin.y }));
    };

    // The selected pill: centred if that covers nothing, else a callout beside its dot.
    const selected = vehicles.find((vehicle) => vehicle.code === selectedCode);
    let selectedBox: Box | null = null;
    if (selected) {
      const size = { width: markerWidth(selected.code), height: MARKER_HEIGHT };
      const candidates = [CENTRED, ...placementsAround(COMPACT_SIZE / 2, size, PILL_GAP)];
      const placement = roundPlacement(
        placeLabel(size, candidates, obstaclesAround(selected), PILL_GAP, poiObstaclesAround(selected)),
      );
      result.set(selected.id, { labelled: true, placement });
      const origin = screen.get(selected.id);
      if (origin) selectedBox = { ...size, x: origin.x + placement.x, y: origin.y + placement.y };
    }

    // Hover labels for everything else, avoiding other minibuses and the selected pill.
    for (const vehicle of vehicles) {
      if (vehicle.id === selected?.id) continue;
      const size = { width: hoverLabelWidth(vehicle.code), height: HOVER_LABEL_HEIGHT };
      const candidates = placementsAround(COMPACT_SIZE / 2, size, LABEL_GAP);
      const obstacles = obstaclesAround(vehicle, selectedBox ? [selectedBox] : []);
      result.set(vehicle.id, {
        labelled: false,
        placement: roundPlacement(
          placeLabel(size, candidates, obstacles, LABEL_GAP, poiObstaclesAround(vehicle)),
        ),
      });
    }
    return result;
  }, [map, vehicles, selectedCode, viewVersion]);

  return vehicles.map((vehicle) => {
    const { labelled, placement } = layout.get(vehicle.id) ?? { labelled: false, placement: CENTRED };
    return (
      <VehicleMarker
        key={vehicle.id}
        vehicle={vehicle}
        selected={vehicle.code === selectedCode}
        labelled={labelled}
        placement={placement}
        onSelect={onSelect}
      />
    );
  });
}

function boundsFor(vehicles: Vehicle[]): L.LatLngBounds {
  const points: L.LatLngTuple[] = vehicles.length
    ? vehicles.map((v) => [v.lat, v.lng])
    : POINTS_OF_INTEREST.map((p) => [p.lat, p.lng]);
  return L.latLngBounds(points);
}

/** Fits the fleet once, follows the selected minibus, and reacts to container resizes. */
function MapBehaviour({ vehicles, selectedCode }: Pick<FleetMapProps, "vehicles" | "selectedCode">) {
  const map = useMap();
  const hasFitted = useRef(false);

  useEffect(() => {
    if (hasFitted.current || vehicles.length === 0) return;
    hasFitted.current = true;
    const poiBounds = L.latLngBounds(POINTS_OF_INTEREST.map((p) => [p.lat, p.lng]));
    map.fitBounds(boundsFor(vehicles).extend(poiBounds), { padding: FIT_PADDING });
  }, [map, vehicles]);

  const selected = vehicles.find((v) => v.code === selectedCode);
  useEffect(() => {
    if (!selected) return;
    const position = L.latLng(selected.lat, selected.lng);
    if (!map.getBounds().pad(-0.15).contains(position)) map.panTo(position);
    // Pan when the selection changes or the selected minibus moves.
  }, [map, selected?.code, selected?.lat, selected?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

export default function FleetMap({ vehicles, selectedCode, onSelect, mode }: FleetMapProps) {
  const [map, setMap] = useState<L.Map | null>(null);
  const poiIcons = useMemo(() => POINTS_OF_INTEREST.map((poi) => ({ ...poi, icon: poiIcon(poi.name) })), []);

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
        {poiIcons.map((poi) => (
          <Marker
            key={poi.name}
            position={[poi.lat, poi.lng]}
            icon={poi.icon}
            interactive={false}
            keyboard={false}
            zIndexOffset={-1000}
          />
        ))}
        <VehicleLayer vehicles={vehicles} selectedCode={selectedCode} onSelect={onSelect} />
        <MapBehaviour vehicles={vehicles} selectedCode={selectedCode} />
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
          onClick={() => map?.fitBounds(boundsFor(vehicles), { padding: FIT_PADDING })}
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
