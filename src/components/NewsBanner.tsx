import { useEffect, useRef, useState } from "react";
import { bannerColour, isShowing, type MapBanner } from "@/lib/banners";
import styles from "./NewsBanner.module.css";

/** How long each banner shows before the next one fades in. */
const ROTATE_MS = 6000;
/** How often the dates are checked again, so a banner appears and goes at its time without a reload. */
const CLOCK_MS = 15_000;
/** A swipe at least this far sideways (px) changes the banner. */
const SWIPE_PX = 40;

/**
 * The strip above the map with the news banners that are showing. One shows as a plain line; several
 * take turns (fading), with dots to pick one and a swipe on a touch screen. Nothing shows
 * when there are none, and the banners can't be dismissed.
 */
export function NewsBanner({ banners }: { banners: MapBanner[] | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const showing = (banners ?? []).filter((banner) => isShowing({ active: true, ...banner }, now));
  const count = showing.length;
  const current = count > 0 ? index % count : 0;

  useEffect(() => {
    if (count < 2 || paused) return;
    const timer = setTimeout(() => setIndex((value) => (value + 1) % count), ROTATE_MS);
    return () => clearTimeout(timer);
  }, [count, current, paused]);

  if (count === 0) return null;

  const step = (by: number) => setIndex((current + by + count) % count);

  return (
    <section
      className={styles.strip}
      aria-label="News"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(event) => {
        touchStart.current = event.touches[0].clientX;
      }}
      onTouchEnd={(event) => {
        if (touchStart.current === null) return;
        const moved = event.changedTouches[0].clientX - touchStart.current;
        touchStart.current = null;
        if (count > 1 && Math.abs(moved) >= SWIPE_PX) step(moved < 0 ? 1 : -1);
      }}
    >
      {showing.map((banner, i) => {
        const colour = bannerColour(banner.colour);
        const active = i === current;
        return (
          <div
            key={banner.id}
            className={`${styles.slide} ${active ? styles.active : ""}`}
            style={{ background: colour.background, color: colour.text }}
            aria-hidden={!active}
            inert={!active}
          >
            <p className={styles.message}>
              {banner.link ? (
                <a href={banner.link} target="_blank" rel="noopener noreferrer">
                  {banner.message}
                </a>
              ) : (
                banner.message
              )}
            </p>
            {count > 1 && (
              <div className={styles.dots}>
                {showing.map((other, dot) => (
                  <button
                    key={other.id}
                    type="button"
                    className={dot === current ? `${styles.dot} ${styles.dotActive}` : styles.dot}
                    aria-label={`Show news ${dot + 1} of ${count}`}
                    aria-current={dot === current}
                    onClick={() => setIndex(dot)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
