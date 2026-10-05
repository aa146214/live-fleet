import type { Metadata } from "next";
import { StopsScreen } from "@/components/StopsScreen";

export const metadata: Metadata = {
  title: "Leavesden Shuttle · Stops",
};

export default function StopsPage() {
  return <StopsScreen />;
}
