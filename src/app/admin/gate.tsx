import { adminSetupProblem, getAdmin } from "@/lib/admin-auth";
import { hasDatabase } from "@/lib/db";
import { LoginForm } from "./LoginForm";
import styles from "./admin.module.css";

/**
 * What an admin page shows instead of its content when it can't be used: sign-in isn't
 * set up, nobody is signed in, or there's no database. Null when the page can go ahead.
 */
export async function gate(): Promise<React.ReactNode | null> {
  const problem = adminSetupProblem();
  if (problem) return <p className={styles.error}>{problem}</p>;
  if (!(await getAdmin())) return <LoginForm />;
  if (!hasDatabase()) {
    return (
      <p className={styles.error}>
        No database is set up, so nothing can be saved. Set <code>DATABASE_URL</code> to a Neon Postgres connection
        string (see the README), then reload.
      </p>
    );
  }
  return null;
}
