import { DashboardClient } from "./dashboard-client";
import { PublicBuilderConsole } from "./public-builder-console";
import { publicCapabilities } from "@/lib/capabilities";

export default function DashboardPage() {
  return publicCapabilities.backendEnabled ? (
    <DashboardClient />
  ) : (
    <PublicBuilderConsole />
  );
}
