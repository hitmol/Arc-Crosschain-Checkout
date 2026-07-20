# Smart contracts

## MerchantRegistry

Merchants self-register, control payout and metadata for future invoices, and may deactivate themselves. The protocol owner can emergency-deactivate a merchant for future invoices only.

## FeeManager

Two-step ownership protects treasury and fee changes. The fee is capped at 500 basis points and snapshotted into each vault.

## CheckoutFactory

Uses OpenZeppelin `Clones.cloneDeterministic` with `keccak256(abi.encode(merchant, orderId))`. Order IDs are unique per merchant, so two merchants may use the same external order reference without sharing a vault. It rejects duplicate merchant/order pairs, invalid amounts, zero refund addresses, inactive merchants, and expiry outside five minutes to 30 days. Pause applies only to creation.

## PaymentVault

The implementation disables initialization in its constructor; clone storage starts uninitialized. State is derived from terminal state plus live USDC balance. Anyone may settle a sufficiently funded, unexpired vault. Effects precede SafeERC20 transfers. Timeout refunds are permissionless and pay only the locked Arc refund address.

Overpayment is returned during settlement. USDC sent after settlement can be swept only to that same refund address. Unsupported-token recovery cannot select USDC.

Application accounting always uses the Arc USDC ERC-20 interface at `0x3600000000000000000000000000000000000000` with six decimals. Native gas uses 18 decimals only in RPC gas contexts.
