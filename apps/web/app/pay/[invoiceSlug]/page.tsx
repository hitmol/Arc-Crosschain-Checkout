import { PaymentCheckout } from "./payment-checkout";

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ invoiceSlug: string }>;
}) {
  const { invoiceSlug } = await params;
  return <PaymentCheckout invoiceSlug={invoiceSlug} />;
}
