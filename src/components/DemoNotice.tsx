import type { FleetSnapshot } from "@/lib/types";
import styles from "./DemoNotice.module.css";

export function DemoNotice({ mode }: { mode: FleetSnapshot["mode"] | null }) {
  return (
    <footer className={styles.notice}>
      {mode === "live"
        ? "Live GPS via FleetSmart · refreshes every 15 seconds"
        : "Interactive concept · no live GPS connection"}
    </footer>
  );
}
