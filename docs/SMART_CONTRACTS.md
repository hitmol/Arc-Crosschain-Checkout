# Smart contracts

## MerchantRegistry

Merchants self-register, control payout and metadata for future invoices, and may deactivate themselves. The protocol owner can emergency-deactivate a merchant for future invoices only.

## FeeManager

Two-step ownership protects treasury and fee changes. The fee is capped at 500 basis points and snapshotted into each vault.

## CheckoutFactory

Uses OpenZeppelin `Clones.cloneDeterministic` with `keccak256(abi.encode(merchant, orderId))`. Order IDs are unique per merchant, so two merchants may use the same external order reference without sharing a vault. Invoice creation does not accept a refund address. It rejects duplicate merchant/order pairs, invalid amounts, inactive merchants, and expiry outside five minutes to 30 days. Pause applies only to creation.

## PaymentVault

The implementation disables initialization in its constructor; clone storage starts uninitialized. OpenZeppelin EIP-712 and ECDSA verify customer payment attempts. The authorization binds both chains, the vault, order, payer, refund address, amounts, quote expiry, nonce and attempt expiry. The first authorization permanently locks the payer/refund pair; replacement attempts require the same pair and fresh replay-protected identifiers.

State is derived from terminal state plus live USDC balance. Anyone may settle a sufficiently funded, unexpired vault after customer authorization. Effects precede SafeERC20 transfers. Timeout and cancellation refunds are permissionless and pay only the customer-authorized Arc address.

Overpayment is returned during settlement. USDC sent after settlement can be swept only to that same refund address. Unsupported-token recovery cannot select USDC.

Application accounting always uses the Arc USDC ERC-20 interface at `0x3600000000000000000000000000000000000000` with six decimals. Native gas uses 18 decimals only in RPC gas contexts.
