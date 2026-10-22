"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, signIn, signOut } from "@/lib/admin-auth";
import { checkAssignment, checkRoute } from "@/lib/admin-validation";
import { adminDeleteAssignment, adminDeleteRoute, adminSaveAssignment, adminSaveRoute } from "@/lib/config-store";
import { hasDatabase } from "@/lib/db";

/** Where to go back to after a change: a page of the admin, so a form can't send people elsewhere. */
function returnPath(formData: FormData): string {
  const to = String(formData.get("returnTo") ?? "");
  return to.startsWith("/admin") && !to.startsWith("//") ? to : "/admin";
}

/** Goes to an admin page with a message (shown once, then gone on the next visit). */
function backTo(path: string, kind: "notice" | "error", message: string): never {
  revalidatePath("/admin", "layout");
  const [base, query] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("notice");
  params.delete("error");
  params.set(kind, message);
  redirect(`${base}?${params}`);
}

const NO_DATABASE = "No database is set up. Set DATABASE_URL first.";

/** Turns a database error into something to say; a unique code that is taken, or a route that has gone. */
function describe(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "23505") return "That code is already used by another minibus.";
  if (code === "23503") return "That route no longer exists.";
  console.error("[admin]", error instanceof Error ? error.message : error);
  return "Could not save. Please try again.";
}

export async function signInAction(_previous: { error?: string } | undefined, formData: FormData) {
  const result = await signIn(String(formData.get("username") ?? ""), String(formData.get("password") ?? ""));
  if (!result.ok) return { error: result.error };
  redirect("/admin");
}

export async function signOutAction() {
  await signOut();
  redirect("/admin");
}

export type SaveState = { error?: string } | undefined;

/** Saves a route (making it if it's new). Problems are returned, so the editor keeps what was typed. */
export async function saveRouteAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  await requireAdmin();
  const checked = checkRoute(formData);
  if (checked.error !== undefined) return { error: checked.error };
  if (!hasDatabase()) return { error: NO_DATABASE };
  let id;
  try {
    id = await adminSaveRoute(checked.value);
  } catch (error) {
    return { error: describe(error) };
  }
  return backTo(`/admin/route?id=${id}`, "notice", `Saved ${checked.value.name}.`);
}

export async function deleteRouteAction(formData: FormData) {
  await requireAdmin();
  if (!hasDatabase()) return backTo("/admin", "error", NO_DATABASE);
  try {
    await adminDeleteRoute(Number(formData.get("id")));
  } catch (error) {
    return backTo(returnPath(formData), "error", describe(error));
  }
  return backTo("/admin", "notice", "Route deleted. Its minibuses are no longer on the map.");
}

/** Puts a minibus on a route (or moves it, or changes its code). */
export async function assignVehicleAction(formData: FormData) {
  await requireAdmin();
  const back = returnPath(formData);
  const checked = checkAssignment(formData);
  if (checked.error !== undefined) return backTo(back, "error", checked.error);
  if (!hasDatabase()) return backTo(back, "error", NO_DATABASE);
  try {
    await adminSaveAssignment(checked.value);
  } catch (error) {
    return backTo(back, "error", describe(error));
  }
  return backTo(back, "notice", `${checked.value.code} is on the route.`);
}

/** Takes a minibus off its route, so it is no longer on the map. */
export async function unassignVehicleAction(formData: FormData) {
  await requireAdmin();
  const back = returnPath(formData);
  if (!hasDatabase()) return backTo(back, "error", NO_DATABASE);
  try {
    await adminDeleteAssignment(String(formData.get("vrn") ?? ""));
  } catch (error) {
    return backTo(back, "error", describe(error));
  }
  return backTo(back, "notice", "Minibus taken off the route.");
}
