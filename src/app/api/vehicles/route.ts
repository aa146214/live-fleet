import { connection } from "next/server";
import { demoSnapshot } from "@/lib/demo-fleet";
import { getLiveSnapshot, hasFleetSmartCredentials } from "@/lib/fleetsmart";

export async function GET() {
  await connection();

  if (!hasFleetSmartCredentials()) {
    return Response.json(demoSnapshot(), { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const snapshot = await getLiveSnapshot();
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FleetSmart request failed";
    return Response.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
