"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { deleteVehicleAction, saveVehicleAction } from "./actions";
import styles from "./admin.module.css";

interface PlaceOption {
  id: string;
  name: string;
}

interface VehicleEditorProps {
  vrn: string;
  /** Registration as FleetSmart shows it, if the vehicle is in the account. */
  registration: string;
  initialCode: string;
  initialStops: string[];
  /** Whether the vehicle is already a shuttle (editing) rather than being added. */
  existing: boolean;
  /** The places that can be added as stops. */
  places: PlaceOption[];
  /** Every place's name, including ones already used but no longer offered. */
  names: Record<string, string>;
  /** The route each place belongs to, for the places that are a route's station. */
  stopRoutes: Record<string, number>;
  pickerNote: string;
  /** The routes to choose from. */
  routes: { id: number; label: string }[];
  /** The route the vehicle is on now (editing), or null when adding. */
  initialRouteId: number | null;
  /** The route the vehicle's recent visits point to, if any. */
  suggestedRouteId: number | null;
  /** What the recent visits say, for the admin to read. */
  visitHint: string;
  maxStops: number;
}

/** One screen to add or edit a shuttle's route: stops added one by one, reordered, then saved. */
export function VehicleEditor({
  vrn,
  registration,
  initialCode,
  initialStops,
  existing,
  places,
  names,
  stopRoutes,
  pickerNote,
  routes,
  initialRouteId,
  suggestedRouteId,
  visitHint,
  maxStops,
}: VehicleEditorProps) {
  const [state, action, pending] = useActionState(saveVehicleAction, undefined);
  const [code, setCode] = useState(initialCode);
  const [stops, setStops] = useState(initialStops);
  // Until a route is chosen by hand it follows the visits, then the first station among the stops.
  const [chosenRoute, setChosenRoute] = useState<number | null>(initialRouteId);
  const [next, setNext] = useState(places[0]?.id ?? "");

  const nameOf = (id: string) => names[id] ?? places.find((place) => place.id === id)?.name ?? id;
  const move = (from: number, to: number) =>
    setStops((list) => {
      const copy = [...list];
      copy.splice(to, 0, copy.splice(from, 1)[0]);
      return copy;
    });
  const suggested = suggestedRouteId ?? stops.map((stop) => stopRoutes[stop]).find(Boolean) ?? routes[0]?.id ?? 1;
  const routeId = chosenRoute ?? suggested;

  return (
    <form action={action} className={styles.card}>
      <input type="hidden" name="vrn" value={vrn} />
      {stops.map((stop, i) => (
        <input key={`${stop}-${i}`} type="hidden" name="stop" value={stop} />
      ))}

      <p className={styles.help}>{registration}</p>

      <label className={styles.field}>
        <span>Code shown on the map</span>
        <input
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="e.g. W1"
          required
          maxLength={8}
          autoFocus={!existing}
        />
      </label>

      <label className={styles.field}>
        <span>Route (sets the colour and group on the map)</span>
        <select name="routeId" value={routeId} onChange={(event) => setChosenRoute(Number(event.target.value))}>
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.label}
            </option>
          ))}
        </select>
        {visitHint && <small className={suggestedRouteId ? styles.suggestion : styles.help}>{visitHint}</small>}
      </label>

      <div>
        <h3 className={styles.subTitle}>Stops, in order</h3>
        {stops.length === 0 ? (
          <p className={styles.help}>No stops yet. Add the places the shuttle calls at, in the order it drives them.</p>
        ) : (
          <ol className={styles.stops}>
            {stops.map((stop, i) => (
              <li key={`${stop}-${i}`} className={styles.stop}>
                <span className={styles.stopNumber}>{i + 1}</span>
                <span className={styles.stopName}>{nameOf(stop)}</span>
                <button
                  type="button"
                  className={styles.icon}
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move ${nameOf(stop)} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.icon}
                  onClick={() => move(i, i + 1)}
                  disabled={i === stops.length - 1}
                  aria-label={`Move ${nameOf(stop)} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={styles.icon}
                  onClick={() => setStops((list) => list.filter((_, index) => index !== i))}
                  aria-label={`Remove ${nameOf(stop)}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
        <p className={styles.help}>The shuttle returns to the first stop after the last one.</p>

        <p className={styles.help}>{pickerNote}</p>

        <div className={styles.addStop}>
          <select value={next} onChange={(event) => setNext(event.target.value)} aria-label="Place to add">
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setStops((list) => [...list, next])}
            disabled={stops.length >= maxStops}
          >
            Add stop
          </button>
        </div>
      </div>

      {state?.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}

      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending || stops.length < 2 || !code.trim()}>
          {pending ? "Saving…" : "Save"}
        </button>
        <Link href="/admin" className={styles.secondary}>
          Cancel
        </Link>
        {existing && (
          <button
            type="submit"
            formAction={deleteVehicleAction}
            formNoValidate
            className={styles.danger}
            onClick={(event) => {
              if (!window.confirm(`Remove ${code || vrn} from the shuttles?`)) event.preventDefault();
            }}
          >
            Remove shuttle
          </button>
        )}
      </div>
    </form>
  );
}
