"use client";

import { useEffect, useState, type ReactNode } from "react";
import styles from "./FadeThrough.module.css";

/** Matches the fade-out animation in FadeThrough.module.css. */
const FADE_OUT_MS = 90;

/**
 * Fade-through between pieces of content: when `contentKey` changes, the old
 * content fades out, then the new content fades in. Updates under the same key
 * (e.g. live data refreshes) render straight through without animating.
 */
export function FadeThrough({ contentKey, children }: { contentKey: string; children: ReactNode }) {
  const [current, setCurrent] = useState({ key: contentKey, children });
  const [phase, setPhase] = useState<"in" | "out" | "swap">("in");

  // Adjusting state during render (rather than in an effect) avoids a flash of the new content.
  if (contentKey === current.key) {
    if (children !== current.children) setCurrent({ key: contentKey, children });
    // Switched back mid-fade: fade the same content in again.
    if (phase !== "in") setPhase("in");
  } else if (phase === "in") {
    setPhase("out");
  } else if (phase === "swap") {
    setCurrent({ key: contentKey, children });
    setPhase("in");
  }

  useEffect(() => {
    if (phase !== "out") return;
    const timer = setTimeout(() => setPhase("swap"), FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <div key={current.key} className={phase === "in" ? styles.fadeIn : styles.fadeOut}>
      {current.children}
    </div>
  );
}
