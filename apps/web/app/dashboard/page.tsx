import { DashboardClient } from "./dashboard-client";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { PUBLIC_READ_ONLY_MODE } from "@/lib/api";

export default function DashboardPage() {
  if (PUBLIC_READ_ONLY_MODE)
    return <ReadOnlyNotice feature="The live merchant dashboard" />;
  return <DashboardClient />;
}
