import type { Metadata } from "next";
import Link from "next/link";
import { getAdmin } from "@/lib/admin-auth";
import { signOutAction } from "./actions";
import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "Admin · Leavesden Shuttle",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>
          <Link href="/admin">Leavesden Shuttle · Admin</Link>
        </h1>
        <nav>
          <Link href="/">View map</Link>
          {admin && (
            <form action={signOutAction}>
              <button type="submit" className={styles.link}>
                Sign out
              </button>
            </form>
          )}
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
