"use client";

import { useActionState } from "react";
import { signInAction } from "./actions";
import styles from "./admin.module.css";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, undefined);
  return (
    <form action={action} className={styles.card}>
      <h2 className={styles.cardTitle}>Sign in</h2>
      <label className={styles.field}>
        <span>Username</span>
        <input name="username" autoComplete="username" required autoFocus />
      </label>
      <label className={styles.field}>
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state?.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
