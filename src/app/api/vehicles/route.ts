import { connection } from "next/server";
import { currentSnapshot } from "@/lib/fleet-snapshot";

export async function GET() {
  await connection();

  try {
    return Response.json(await currentSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FleetSmart request failed";
    return Response.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
