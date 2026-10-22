import styles from "./admin.module.css";

/** The message an admin action leaves in the address (a confirmation or an error), shown once. */
export function Flash({ notice, error }: { notice?: string; error?: string }) {
  return (
    <>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
