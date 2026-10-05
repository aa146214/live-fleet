import { Suspense } from "react";
import { LiveMapScreen } from "@/components/LiveMapScreen";

export default function Home() {
  return (
    <Suspense>
      <LiveMapScreen />
    </Suspense>
  );
}
