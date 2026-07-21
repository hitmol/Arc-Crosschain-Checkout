import { PaymentCheckout } from "./payment-checkout";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { PUBLIC_READ_ONLY_MODE } from "@/lib/api";

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ invoiceSlug: string }>;
}) {
  const { invoiceSlug } = await params;
  if (PUBLIC_READ_ONLY_MODE)
    return <ReadOnlyNotice feature={`Checkout ${invoiceSlug}`} />;
  return <PaymentCheckout invoiceSlug={invoiceSlug} />;
}
