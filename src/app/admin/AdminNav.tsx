"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin.module.css";

const SECTIONS = [
  { href: "/admin", label: "Routes", owns: (path: string) => path === "/admin" || path.startsWith("/admin/route") },
  { href: "/admin/markers", label: "Map markers", owns: (path: string) => path.startsWith("/admin/markers") },
  { href: "/admin/banners", label: "News banners", owns: (path: string) => path.startsWith("/admin/banners") },
];

/** The admin's main menu: its sections, with the one being viewed marked. */
export function AdminNav() {
  const path = usePathname();
  return (
    <nav className={styles.mainNav} aria-label="Admin sections">
      {SECTIONS.map((section) => {
        const current = section.owns(path);
        return (
          <Link key={section.href} href={section.href} className={current ? styles.current : undefined} aria-current={current ? "page" : undefined}>
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
