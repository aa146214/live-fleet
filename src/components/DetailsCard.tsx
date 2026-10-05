import type { ReactNode } from "react";
import styles from "./DetailsCard.module.css";

interface DetailsCardProps {
  id: string;
  title: string;
  subtitle: string;
  /** Route colour for the subtitle. */
  color: string;
  icons: ReactNode;
  rows: Array<[label: string, value: ReactNode]>;
  onClose: () => void;
  closeLabel: string;
}

/** Shared card layout for minibus and place details (Figma "Vehicle details"). */
export function DetailsCard({ id, title, subtitle, color, icons, rows, onClose, closeLabel }: DetailsCardProps) {
  const headingId = `${id}-title`;
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.heading}>
        {icons}
        <div className={styles.name}>
          <h2 id={headingId} className={styles.title}>
            {title}
          </h2>
          <p className={styles.subtitle} style={{ color }}>
            {subtitle}
          </p>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label={closeLabel}>
          ×
        </button>
      </div>

      <dl className={styles.rows}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.row}>
            <dt className={styles.label}>{label}</dt>
            <dd className={styles.value}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
