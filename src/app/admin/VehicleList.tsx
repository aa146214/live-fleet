"use client";

import { useState, type ReactNode } from "react";
import styles from "./admin.module.css";

export interface VehicleListRow {
  key: string;
  /** What the search looks in: registration, code, address and so on. */
  search: string;
  content: ReactNode;
}

/** Search only helps once a list is long enough to scroll. */
const SEARCH_FROM = 6;

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, "");

/** A list of vehicles with a search box (for lists long enough to need one). */
export function VehicleList({ rows, label }: { rows: VehicleListRow[]; label: string }) {
  const [query, setQuery] = useState("");
  const wanted = normalise(query);
  const shown = wanted ? rows.filter((row) => normalise(row.search).includes(wanted)) : rows;

  return (
    <div className={styles.listBlock}>
      {rows.length >= SEARCH_FROM && (
        <input
          type="search"
          className={styles.search}
          placeholder={`Search ${label} by registration or place`}
          aria-label={`Search ${label}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {shown.length === 0 ? (
        <p className={styles.help}>No vehicles match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className={styles.list}>
          {shown.map((row) => (
            <li key={row.key} className={styles.item}>
              {row.content}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
