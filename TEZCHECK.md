# TezCheck subscriptions

Before deploying, run `node scripts/tezcheck-indexes.cjs` with the hosting MONGODB_URL secret. It adds three partial unique indexes without changing payment documents. Database readiness refuses traffic until these exist.

The bot owns provider credentials and verifies raw webhook HMAC, 300-second timestamp window, organization/desk, and canonical bill/payment state. Backend endpoints under /api/bot/payments/tezcheck require the existing bot shared secret. Price is read from PRICING, never supplied by Telegram callbacks. Settlement is serialized by account and grants through the existing payment-keyed transactional subscription ledger.

New fields preserve provider bill/payment IDs, stable checkout request key, fee/net/refund amounts and processed body event IDs. A duplicate payment cannot grant twice. Refund/dispute states flag reconciliation instead of deleting unrelated grants. TezCheck is included in payment-history method filters. Manual-card and Click records remain supported.

Bot environment: TEZCHECK_API_KEY, TEZCHECK_CASH_DESK_CODE, TEZCHECK_WEBHOOK_SECRET, TEZCHECK_CASH_DESK_ID, TEZCHECK_ORGANIZATION_ID. Never commit their values. Dedicated webhook is https://hisvex-bot-encx.onrender.com/webhooks/tezcheck; the existing root merchant URL is an authenticated alias. Telegram WEBHOOK_URL remains separate.
