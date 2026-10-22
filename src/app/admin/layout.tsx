import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getAdmin } from "@/lib/admin-auth";
import { AdminNav } from "./AdminNav";
import { signOutAction } from "./actions";
import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "Admin · Shuttle Map",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>
          <Link href="/admin" className={styles.brand}>
            <Image
              src="/brand/wb-studios-leavesden-logo-white.png"
              alt="Warner Bros. Studios Leavesden"
              width={1600}
              height={382}
              className={styles.logo}
              priority
            />
            <span>Shuttle Map Admin</span>
          </Link>
        </h1>
        {admin && <AdminNav />}
        <nav className={styles.siteNav}>
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
