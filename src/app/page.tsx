import { connection } from "next/server";
import { Suspense } from "react";
import { FleetSeed } from "@/components/FleetSeed";
import { LiveMapScreen } from "@/components/LiveMapScreen";
import { currentSnapshot } from "@/lib/fleet-snapshot";

export default function Home() {
  return (
    <>
      <Suspense>
        <LiveMapScreen />
      </Suspense>
      <Suspense fallback={null}>
        <FirstSnapshot />
      </Suspense>
    </>
  );
}

/**
 * Starts loading the vehicles as soon as the page is requested, instead of once the
 * browser has downloaded and run the page's scripts, and streams them in with the page.
 */
async function FirstSnapshot() {
  await connection();
  const snapshot = await currentSnapshot({ allowStale: true }).catch(() => null);
  return <FleetSeed snapshot={snapshot} />;
}
