import { redirect } from "next/navigation";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/receipts/${encodeURIComponent(id)}`);
}
