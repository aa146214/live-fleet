import Link from "next/link";
import styles from "./BottomNav.module.css";

const ITEMS = [
  { href: "/", label: "Map", icon: "▧", page: "map" },
  { href: "/stops", label: "Stops", icon: "▥", page: "stops" },
] as const;

export function BottomNav({ page }: { page: "map" | "stops" }) {
  return (
    <nav className={styles.nav} aria-label="Main navigation">
      {ITEMS.map((item) => (
        <Link
          key={item.page}
          href={item.href}
          className={`${styles.item} ${item.page === page ? styles.active : ""}`}
          aria-current={item.page === page ? "page" : undefined}
        >
          <span className={styles.icon} aria-hidden="true">
            {item.icon}
          </span>
          <span className={styles.label}>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
