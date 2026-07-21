import { OnchainInvoiceView } from "./onchain-invoice-view";

export default async function OnchainInvoicePage({
  params,
}: {
  params: Promise<{ merchant: string; orderReference: string }>;
}) {
  const resolved = await params;
  return (
    <OnchainInvoiceView
      merchant={resolved.merchant}
      orderReference={decodeURIComponent(resolved.orderReference)}
    />
  );
}
