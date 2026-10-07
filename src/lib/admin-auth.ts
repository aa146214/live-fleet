import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";

/**
 * Sign-in for the one admin account, whose username and password are in the
 * environment (ADMIN_USERNAME, ADMIN_PASSWORD). A successful sign-in sets a signed,
 * expiring cookie (signed with SESSION_SECRET); every admin page and action checks it.
 * Server only.
 */

const COOKIE = "admin_session";
const SESSION_SECONDS = 8 * 60 * 60;

const MIN_SECRET_LENGTH = 32;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;
const FAILURE_DELAY_MS = 500;

/** What is missing from the environment, or null when sign-in is set up. */
export function adminSetupProblem(): string | null {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    return "Set ADMIN_USERNAME and ADMIN_PASSWORD to enable the admin.";
  }
  if ((process.env.SESSION_SECRET ?? "").length < MIN_SECRET_LENGTH) {
    return `Set SESSION_SECRET to a random string of at least ${MIN_SECRET_LENGTH} characters (e.g. openssl rand -base64 32).`;
  }
  return null;
}

const digest = (value: string) => createHash("sha256").update(value).digest();
/** Compares without leaking, through timing, how much of a secret was right. */
const sameText = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const sign = (payload: string) => createHmac("sha256", process.env.SESSION_SECRET ?? "").update(payload).digest("base64url");

function makeToken(username: string): string {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + SESSION_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string | undefined): string | null {
  if (!token || adminSetupProblem()) return null;
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length > 0) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof u === "string" && typeof exp === "number" && exp > Date.now() && sameText(u, process.env.ADMIN_USERNAME ?? "")
      ? u
      : null;
  } catch {
    return null;
  }
}

/** The signed-in admin's username, or null. Call this in every admin page and action. */
export async function getAdmin(): Promise<string | null> {
  return readToken((await cookies()).get(COOKIE)?.value);
}

/** Like `getAdmin`, but throws when nobody is signed in (for actions). */
export async function requireAdmin(): Promise<string> {
  const admin = await getAdmin();
  if (!admin) throw new Error("Not signed in");
  return admin;
}

// Failed attempts per client. In memory, so each server instance counts for itself: this
// slows guessing down but isn't a hard limit, so use a long password.
const failures = new Map<string, { count: number; lockedUntil: number }>();

async function clientKey(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export type SignInResult = { ok: true } | { ok: false; error: string };

/** Checks the credentials and, if right, starts a session. */
export async function signIn(username: string, password: string): Promise<SignInResult> {
  const problem = adminSetupProblem();
  if (problem) return { ok: false, error: problem };

  const key = await clientKey();
  const record = failures.get(key);
  if (record && record.lockedUntil > Date.now()) {
    return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  }

  // Both are always compared, so a wrong username takes as long as a wrong password.
  const userOk = sameText(username, process.env.ADMIN_USERNAME ?? "");
  const passwordOk = sameText(password, process.env.ADMIN_PASSWORD ?? "");
  if (!(userOk && passwordOk)) {
    const count = (record && record.lockedUntil <= Date.now() ? record.count : 0) + 1;
    failures.set(key, { count, lockedUntil: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0 });
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return { ok: false, error: "Wrong username or password." };
  }

  failures.delete(key);
  (await cookies()).set(COOKIE, makeToken(username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return { ok: true };
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
