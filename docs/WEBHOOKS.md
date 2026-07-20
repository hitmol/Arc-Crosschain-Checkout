# Webhooks

Events: `payment.intent.created`, `payment.source_confirmed`, `payment.arc_minted`, `payment.settled`, `payment.expired`, and `payment.refunded`.

```mermaid
sequenceDiagram
  participant W as Worker queue
  participant M as Merchant endpoint
  W->>W: build event + timestamp
  W->>W: HMAC-SHA256(secret, timestamp.rawBody)
  W->>M: POST with x-arc-timestamp and x-arc-signature
  alt 2xx
    M-->>W: delivered
  else transient failure
    M-->>W: non-2xx/timeout
    W->>W: exponential backoff, max 8 attempts
  end
```

Verification must use the raw request body, reject timestamps older than five minutes, parse the `v1=` signature, calculate HMAC-SHA256 over `timestamp.rawBody`, and compare in constant time. Use `verifyWebhookSignature` from `@arc-checkout/sdk`.

Secrets are displayed once and stored encrypted with AES-256-GCM. Production endpoints require HTTPS. Registration and delivery reject private/reserved destinations and can enforce `ALLOWED_WEBHOOK_HOSTS`.
