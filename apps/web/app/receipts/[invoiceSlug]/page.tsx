import { notFound } from "next/navigation";
import { API_URL } from "@/lib/api";
import type { VerifiedReceipt } from "./receipt-types";
import { ReceiptView } from "./receipt-view";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ invoiceSlug: string }>;
}) {
  const { invoiceSlug } = await params;
  const response = await fetch(
    `${API_URL}/api/receipts/${encodeURIComponent(invoiceSlug)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Verified receipt could not be loaded");
  const receipt = (await response.json()) as VerifiedReceipt;
  return <ReceiptView receipt={receipt} />;
}
