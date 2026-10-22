import { adminListMarkers, adminListRoutes } from "@/lib/config-store";
import { knownPlaces } from "@/lib/fleetsmart";
import { pinPlacesFor } from "@/lib/routes";
import { resetMarkerAction, saveMarkerAction } from "../actions";
import { Flash } from "../Flash";
import { gate } from "../gate";
import styles from "../admin.module.css";

type SearchParams = Promise<{ notice?: string; error?: string }>;

const round = (value: number) => Number(value.toFixed(6));

/** Where each pin is drawn on the map, for places whose pin isn't quite where it should be. */
export default async function MarkersPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await gate();
  if (blocked) return blocked;

  const { notice, error } = await searchParams;
  let routes, markers;
  try {
    [routes, markers] = await Promise.all([adminListRoutes(), adminListMarkers()]);
  } catch (error) {
    console.error("[admin]", error instanceof Error ? error.message : error);
    return <p className={styles.error}>Could not reach the database. Check DATABASE_URL and try again.</p>;
  }
  const pins = pinPlacesFor(routes, await knownPlaces());

  return (
    <>
      <Flash notice={notice} error={error} />
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Map markers</h2>
        <p className={styles.help}>
          The places the routes call at, as pinned on the map. To move a pin, enter its new position as latitude,
          longitude (e.g. 51.6630, -0.3958). Only the pin moves; the stop stays where the place is. Changes show on
          the map within a minute.
        </p>
        {pins.length === 0 && <p className={styles.help}>No route has stops yet.</p>}
        {pins.map((pin) => {
          const moved = markers.get(pin.id);
          const shown = moved ?? pin;
          return (
            <form key={pin.id} action={saveMarkerAction} className={styles.markerRow}>
              <input type="hidden" name="placeId" value={pin.id} />
              <div className={styles.itemText}>
                <strong>{pin.name}</strong>
                <p className={styles.help}>
                  {pin.what3words ? `${pin.what3words} · ` : ""}
                  {moved ? `Pin moved (the place is at ${round(pin.lat)}, ${round(pin.lng)})` : "Pin is at its place"}
                </p>
              </div>
              <input
                name="position"
                defaultValue={`${round(shown.lat)}, ${round(shown.lng)}`}
                aria-label={`Pin position for ${pin.name}`}
                inputMode="decimal"
                required
              />
              <div className={styles.actions}>
                <button type="submit" className={styles.primary}>
                  Move pin
                </button>
                {moved && (
                  <button type="submit" formAction={resetMarkerAction} formNoValidate className={styles.secondary}>
                    Put back
                  </button>
                )}
              </div>
            </form>
          );
        })}
      </section>
    </>
  );
}
