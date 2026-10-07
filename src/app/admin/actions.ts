"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, signIn, signOut } from "@/lib/admin-auth";
import { checkVehicle } from "@/lib/admin-validation";
import { adminDeleteAssignment, adminSaveAssignment } from "@/lib/config-store";
import { hasDatabase } from "@/lib/db";

/** Goes back to the vehicle list with a message (shown once, then gone on the next visit). */
function backToList(kind: "notice" | "error", message: string): never {
  revalidatePath("/admin");
  redirect(`/admin?${kind}=${encodeURIComponent(message)}`);
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

/** Saves a vehicle's code and stops. Problems are returned, so the editor keeps what was typed. */
export async function saveVehicleAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  await requireAdmin();
  const checked = checkVehicle(formData);
  if (checked.error !== undefined) return { error: checked.error };
  if (!hasDatabase()) return { error: "No database is set up. Set DATABASE_URL first." };

  try {
    await adminSaveAssignment(checked.value);
  } catch (error) {
    // 23505 is Postgres's "unique violation": the code belongs to another vehicle.
    if (typeof error === "object" && error && "code" in error && (error as { code: unknown }).code === "23505") {
      return { error: "That code is already used by another vehicle." };
    }
    console.error("[admin]", error instanceof Error ? error.message : error);
    return { error: "Could not save. Please try again." };
  }
  return backToList("notice", `Saved ${checked.value.code} (${checked.value.vrn}).`);
}

export async function deleteVehicleAction(formData: FormData) {
  await requireAdmin();
  if (!hasDatabase()) return backToList("error", "No database is set up. Set DATABASE_URL first.");
  try {
    await adminDeleteAssignment(String(formData.get("vrn") ?? ""));
  } catch (error) {
    console.error("[admin]", error instanceof Error ? error.message : error);
    return backToList("error", "Could not remove the vehicle. Please try again.");
  }
  return backToList("notice", "Vehicle removed.");
}
