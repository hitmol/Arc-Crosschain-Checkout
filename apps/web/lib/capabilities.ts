import { API_URL } from "./api";

export type PublicCapabilities = {
  publicOnchainMode: true;
  backendEnabled: boolean;
  merchantAuthenticationEnabled: boolean;
  onchainInvoiceCreationEnabled: true;
  localInvoiceHistoryEnabled: true;
  cctpPublicPaymentEnabled: false;
};

export function resolvePublicCapabilities(apiUrl: string | null): PublicCapabilities {
  const backendEnabled = Boolean(apiUrl);
  return {
    publicOnchainMode: true,
    backendEnabled,
    merchantAuthenticationEnabled: backendEnabled,
    onchainInvoiceCreationEnabled: true,
    localInvoiceHistoryEnabled: true,
    cctpPublicPaymentEnabled: false,
  };
}

export const publicCapabilities = resolvePublicCapabilities(API_URL);
