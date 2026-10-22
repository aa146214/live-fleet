"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ROUTE_COLOURS, type RouteColour } from "@/lib/routes";
import { deleteRouteAction, saveRouteAction } from "./actions";
import styles from "./admin.module.css";

interface PlaceOption {
  id: string;
  name: string;
}

interface RouteEditorProps {
  /** Absent when making a new route. */
  id?: number;
  initial: { name: string; shortName: string; colour: RouteColour; stops: string[] };
  /** The places that can be added as stops. */
  places: PlaceOption[];
  /** Every place's name, including ones already used but no longer offered. */
  names: Record<string, string>;
  pickerNote: string;
  maxStops: number;
  /** How many minibuses are on the route (shown when deleting). */
  vehicleCount: number;
}

/** One screen to make or change a route: its name, colour and stops (added one by one, reordered). */
export function RouteEditor({ id, initial, places, names, pickerNote, maxStops, vehicleCount }: RouteEditorProps) {
  const [state, action, pending] = useActionState(saveRouteAction, undefined);
  const [name, setName] = useState(initial.name);
  const [shortName, setShortName] = useState(initial.shortName);
  const [colour, setColour] = useState<RouteColour>(initial.colour);
  const [stops, setStops] = useState(initial.stops);
  const [next, setNext] = useState(places[0]?.id ?? "");

  const nameOf = (stop: string) => names[stop] ?? places.find((place) => place.id === stop)?.name ?? stop;
  const move = (from: number, to: number) =>
    setStops((list) => {
      const copy = [...list];
      copy.splice(to, 0, copy.splice(from, 1)[0]);
      return copy;
    });

  return (
    <form action={action} className={styles.card}>
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      {stops.map((stop, i) => (
        <input key={`${stop}-${i}`} type="hidden" name="stop" value={stop} />
      ))}

      <label className={styles.field}>
        <span>Route name</span>
        <input
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Watford Junction Train Station"
          required
          maxLength={60}
          autoFocus={id === undefined}
        />
      </label>

      <label className={styles.field}>
        <span>Short name (for the buttons at the top of the map)</span>
        <input
          name="shortName"
          value={shortName}
          onChange={(event) => setShortName(event.target.value)}
          placeholder="e.g. Watford"
          required
          maxLength={20}
        />
      </label>

      <fieldset className={styles.colours}>
        <legend>Colour</legend>
        {ROUTE_COLOURS.map((option) => (
          <label key={option.key} className={styles.swatch} title={option.label}>
            <input
              type="radio"
              name="colour"
              value={option.key}
              checked={colour === option.key}
              onChange={() => setColour(option.key)}
            />
            <span style={{ background: option.value }}>
              <span className={styles.visuallyHidden}>{option.label}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div>
        <h3 className={styles.subTitle}>Stops, in order</h3>
        {stops.length === 0 ? (
          <p className={styles.help}>No stops yet. Add the places the route calls at, in the order it drives them.</p>
        ) : (
          <ol className={styles.stops}>
            {stops.map((stop, i) => (
              <li key={`${stop}-${i}`} className={styles.stop}>
                <span className={styles.stopNumber}>{i + 1}</span>
                <span className={styles.stopName}>{nameOf(stop)}</span>
                <button type="button" className={styles.icon} onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${nameOf(stop)} up`}>
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
        <p className={styles.help}>The minibuses return to the first stop after the last one.</p>
        <p className={styles.help}>{pickerNote}</p>

        <div className={styles.addStop}>
          <select value={next} onChange={(event) => setNext(event.target.value)} aria-label="Place to add">
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
          <button type="button" className={styles.secondary} onClick={() => setStops((list) => [...list, next])} disabled={stops.length >= maxStops}>
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
        <button type="submit" className={styles.primary} disabled={pending || stops.length < 2 || !name.trim() || !shortName.trim()}>
          {pending ? "Saving…" : id === undefined ? "Create route" : "Save route"}
        </button>
        <Link href="/admin" className={styles.secondary}>
          Back
        </Link>
        {id !== undefined && (
          <button
            type="submit"
            formAction={deleteRouteAction}
            formNoValidate
            className={styles.danger}
            onClick={(event) => {
              const warning =
                vehicleCount > 0
                  ? `Delete ${name || "this route"}? Its ${vehicleCount} minibus${vehicleCount === 1 ? "" : "es"} will no longer be on the map.`
                  : `Delete ${name || "this route"}?`;
              if (!window.confirm(warning)) event.preventDefault();
            }}
          >
            Delete route
          </button>
        )}
      </div>
    </form>
  );
}
