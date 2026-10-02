## 2026-10-02 yakuniy lokal verification yangilanishi

Olti repo Prompt 19 auditidan o‘tdi. Backend 34 unit + 65 integration, Web 41, Desktop 49, Mobile 46, Bot 5 test yashil; barcha typecheck va tegishli build/exportlar o‘tdi. Procurement batch/UI/limited role, manual mutation retry ID, migration barcode preflight/readiness va Desktop auth persistence ishlari tugatildi. Current tracking secret scan: 0 candidate. Npm audit besh repoda 0, Mobile’da forge advisory zanjiri 5 high: narrow backport va regressions bilan MITIGATED, upstream patch release hali kerak. F36 pending listing tekshiruvi `auth-payments.integration.test.ts`dagi provisional receipt testida mavjud va yashil.

To‘liq joriy hisobot va release shartlari: [PRODUCTION_READINESS_2026-10-02.md](../../audit/PRODUCTION_READINESS_2026-10-02.md). Quyidagi 2026-10-01 bo‘limlari tarixiy snapshot; undagi test sonlari va ochiq manual-retry/migration ishlari joriy holatni aks ettirmaydi. Production deploy, credential rotation yoki production DB migration bajarilmadi. Git push/commit yo‘q.

---

# Reliability remediation — status report

Updated: 2026-10-01, by Claude continuing Codex's work per `CLAUDE_CODE_HANDOFF.md`. The
2026-10-01 update adds Task 1 (sync checkpoint reset recovery, Desktop + Mobile) and
re-verifies Task 2 (session-hijacking OTP defense) end to end — see the two dedicated
sections below the finding tracker. Everything from the 2026-09-30 pass is unchanged except
where noted.
This is not a final security sign-off. No production deploy, production database change,
git push/commit, or third-party notification was performed while producing this report.
Every status below is backed by a test run executed on this machine on this date — see
"Evidence" per finding and the full command list at the end of this file. Re-run after any
further code change; a status here is a snapshot, not a permanent guarantee.

**Statuses:** `FIXED` (concrete, direct test coverage exists and passes) · `MITIGATED` (the
dangerous behavior is materially reduced but a stated gap remains) · `NEEDS_PRODUCTION_VERIFICATION`
(the local fix is real but only a live deploy/provider/native runtime can confirm it) ·
`NOT_FIXED` (still open).

## What was actually re-run for this report (2026-10-01)

| Command | Result |
|---|---|
| `comp-bar-server`: `npm run check` | pass |
| `comp-bar-server`: `npm run build` | pass |
| `comp-bar-server`: `npm test` (business-rules) | 34 passed |
| `comp-bar-server`: `npm run test:integration` | **42 passed**, disposable local replica set, ~89s — includes "parallel OTP completion issues only one session; device, expiry and attempt limit are enforced" (Task 2 evidence) |
| `comp-bar-server`: `node scripts/test-integration.cjs scripts/capacity.integration.test.cjs` | **1 passed** — 1,000 stores × 1,000 products, 2 API processes, sale wave 321 req/s / p99 3083ms, cross-instance replay 1,000×200 no double-count, product-read 3,436 req/s |
| `desktop`: `npm test` | **16 passed** (13 pre-existing + 3 new: `tests/sync-recovery.test.cjs`, Task 1 evidence) |
| `desktop`: `npm run check` | pass |
| `desktop`: `npm run build` | pass (766 KB main bundle warning, unchanged) |
| `media-project-mobile`: `node scripts/patch-dependencies.cjs && npm test` | **21 passed** (16 pre-existing + 5 new: `tests/sync-recovery.test.cjs`, Task 1 evidence) |
| `media-project-mobile`: `npm run check` | pass |
| `media-project-mobile`: `npm run lint` | 0 errors, 22 warnings (unused vars / hook deps — pre-existing, not addressed in this pass) |
| `hisvex-web`: `npm test` | 17 passed |
| `hisvex-web`: `npx tsc --noEmit` / `npm run build` | pass (12 static pages + 1 dynamic `/api/[...path]` route); build's built-in ESLint pass: 0 errors, 3 pre-existing warnings (`next/image` suggestions, 1 hook-deps) |
| `hisvex-bot`: `npm test` / `npm run build` | 2 passed / pass |
| `hisvex-landing`: `npm run typecheck` / `npm run build` | pass |

Not re-run in this pass (unchanged from the handoff, still real gaps — see "Not verified" at
the end): native Windows/macOS packaged-app runtime, real device iOS/Android install, real
Click.uz sandbox/production callback, real Telegram delivery, WAN/TLS and production Atlas
tier behavior, sustained soak, regional outage/failover.

## Finding tracker

| Finding | Status | Evidence / remaining work |
|---|---|---|
| F01: Bot Telegram-link takeover via typed phone | **FIXED** | `hisvex-bot` requires `contact.user_id === from.id` (test: "bot accepts only the sender's own Telegram contact in a private conversation"). Backend requires a matching verified contact and refuses to replace an existing link (test: "Telegram linkage requires matching verified contact and cannot replace an existing link"), backed by a partial-unique `telegramId` index. |
| F02: OTP bypass via legacy verify-phone | **FIXED** | Legacy phone-retype path now obeys the same OTP policy; a failed OTP delivery cannot be used to silently downgrade to the weaker check (test: "legacy phone endpoint obeys OTP policy; failed OTP delivery cannot downgrade verification"). |
| F03: Arbitrary/shared R2 image delete | **MITIGATED** | Client-driven delete-by-URL cleanup removed from `product.service.ts` — an admin can no longer point at another tenant's `imageUrl` and trigger its deletion. Gap: no server-owned asset ID / reference-counted ownership model yet, so there is still no garbage collection for orphaned R2 objects. Handoff explicitly says not to add GC without a safe ownership model — not attempted here. |
| F04: Stale JWT keeps paid tier after cancellation | **FIXED** | `authenticate()` now resolves role/tier/`securityVersion` from the DB on every request, not the JWT payload (test: "current role and expiry override a stale paid/superadmin JWT"). |
| F05: Password reset doesn't revoke old sessions | **FIXED** | Password change now bumps `securityVersion` and clears devices/OTP state (test: "password reset invalidates access, refresh, trusted devices and old OTP challenges"). |
| F06: PIN is UI-only / was leaking into the JWT | **MITIGATED — explicitly not closed** | The JWT leak is fixed (`signAccessToken` strips `blockCode` before signing; test: "local lock PIN is never included in a signed access-token payload") and Mobile cold-start hydration was improved. **The core issue remains**: PIN is still a client-side UI lock, not a server-side authorization boundary — no backend endpoint requires it. Do not present this as F06 fully closed; a policy decision (is PIN meant to be a real server permission or purely a local screen-lock?) is still needed before this can move past MITIGATED. |
| F07: Statistics paywall bypassable via other endpoints | **NEEDS_PRODUCTION_VERIFICATION** | Sync v2's keyset pull is scoped so a free-tier pull cannot leak paid-tier history (test: "same revision across many records pages correctly; paid scope never leaks to a free pull"). The audit's own clarification: the *product* policy always intended one free explicit historical day; only bulk/multi-day was ever meant to be paid. Not independently re-audited in this pass whether every remaining single-record read path (e.g. `getDaily`) is consistent with that policy — flagging rather than claiming FIXED. |
| F08: Workspace credentials / admin backup exposure | **MITIGATED** | Credential-bearing commands removed from `.claude/settings.local.json`; `admin-backup.json` kept at mode 600 and repo-ignored. **Not done**: rotating the credentials that were pasted into chat during this project — the account owner must do this before any release, and it has not happened. |
| F09: Idempotency didn't stop parallel duplicate execution | **FIXED** | Claim happens *before* the business callback, inside the same MongoDB transaction as the write and the receipt, with a payload fingerprint that rejects a changed request reusing an old key. Tests: "same key parallel requests are atomic, including first ever tenant writes", "key reuse with changed payload is rejected without mutation", "same key in different accounts stays isolated under concurrency". |
| F10: Failover blindly replayed writes | **FIXED for the audited clients** | Web's server-side proxy, Desktop, Mobile and the bot only replay reads on failover; writes without a durable operation ID are refused before mutation (test: "legacy financial writes without a stable operation ID are refused before mutation"; bot test: "receipt uploads are never replayed"). Sales/restock/adjustment now always carry a stable ID end-to-end. |
| F11: Post-commit report failure caused duplicate re-run | **FIXED** | Sale, stock projection, snapshot/report and audit now commit in one transaction with the idempotency receipt (test: "failure after snapshot write rolls back stock, report, audit and claim; retry succeeds"). |
| F12: Sync overwrote Product.quantity from a rejected stale inventory write | **FIXED** | v2 rejects stale state and legacy inventory writes without touching stock (test: "v2 rejects stale state and legacy inventory without changing stock"). |
| F13: Two offline devices' sales clobbered each other | **FIXED** | Sync v2 carries immutable, append-only sale/restock/adjustment operations instead of absolute-quantity LWW (test: "immutable offline sales from two devices both apply, duplicate retries do not"). |
| F14: Sync pagination advanced the checkpoint before all pages were read | **FIXED** | Keyset pagination with `hasMore`/`nextCursor`, verified over >1,000 records with retry (test: "v2 keyset pagination returns >1,000 products and inventory with stable retry"; Mobile test: "mobile sync applies all 1,205 records with checkpoint only after the final page"). |
| F15: `serverTime` checkpoint left a gap for concurrent writers | **FIXED** | Server revision window replaces wall-clock checkpointing (test: "write between pages is returned in the next revision window; foreign/tampered cursors fail"). |
| F16: Deleted product resurrected via Mobile sync | **FIXED** | Permanent, tenant-scoped tombstone written in the same transaction as the delete (test: "tombstone survives deletion and prevents stale create from resurrecting the product"). |
| F17: Deleting a product erased its historical sales from reports | **FIXED** | Snapshot projection now derives from inventory/sale records, not the live product list, so a later recompute still counts a deleted product's day (test: "deleted product revenue remains after a later snapshot projection"). |
| F18: Desktop offline restock didn't update InventoryEntry | **FIXED** | Restock is now a single business operation with the correct Inventory/Product pairing; a legacy/inconsistent local projection is refused rather than silently applied (test: "restock refuses inconsistent legacy projections instead of preserving silent corruption"). |
| F19: Mobile price edit retroactively re-valued old sales | **FIXED** | Offline/edit paths now lock in the entry's price at time of sale instead of substituting the current product price (test: "price edits preserve earlier revenue/profit, including zero-price products"). |
| F20: Mobile product create omitted `unit`, silently rounding kg | **FIXED** | Test: "mobile producer sends kg and immutable financial intent; explicit ACK alone removes it". |
| F21: Mobile sync ACK could delete a newer queued edit | **FIXED** | ACK now checks the exact version sent, not just the record id (test: "same account stale acknowledgement cannot delete a newer queued product edit"; Desktop equivalent: "acknowledging older product version cannot delete a newer queued edit"). |
| F22: Late offline sale rejected after a day rollover | **FIXED for the trustworthy-baseline case** | A late sale with a verifiable historical baseline is applied to the correct day and subsequent balances adjust without moving revenue into today (test: "late offline sale updates historical and current balances without moving revenue to today"). An ambiguous baseline is deliberately left unacknowledged rather than guessed (test: "late operation without a trustworthy baseline remains unacknowledged and retryable") — this is correct-by-design, not a remaining bug, but it does mean such an operation stays pending until a human/reconciliation step resolves it. |
| F23: Logout/session-replace deleted unsynced sales | **FIXED** | Desktop: "normal persistence survives restart; logout never clears pending writes". Mobile: "logout preserves operations; account B sees none of account A data". |
| F24: Transient backend error triggered a destructive Mobile logout/wipe | **FIXED** | Backend: DB outage returns 503 and is never reinterpreted as session-expired (test: "auth DB outage returns 503 and never claims the session expired"). Mobile bootstrap: "cached session recovery requires matching account and an unexpired credential; PIN and CSV survive utility boundaries" — an unproven/transient failure no longer wipes auth or business data. |
| F25: Web offline queue not bound to an account | **FIXED** | IndexedDB queue is owner-scoped; account switch mid-flush cannot send a record under the new account (test: "account switch during a flush cannot send the next record under the new account"; "account isolation, logout retention and acknowledgement affect only their owner"). |
| F26: Mobile stale cache leaked across account switch | **FIXED** | Test: "account switch during a transaction cannot commit its data under the new owner"; Desktop equivalent: "logout during encryption completes under original account and never leaks to next account". |
| F27: Sync checkpoint not scoped per account | **FIXED** | Checkpoints are now owner + sync-schema-version scoped (covered by the same v2 pagination/cursor tests as F14/F15, plus the account-switch tests above). |
| F28: Web encryption key race on first parallel writes | **FIXED** | Atomic key creation; every record decrypts after restart even when two tabs raced the very first write (test: "parallel first writes across two tabs use one durable key; every record decrypts after restart"). |
| F29: One poisoned Web queue entry blocked the whole queue | **FIXED** | A rejected/conflicting operation no longer blocks unrelated ones (test: "a rejected product does not block unrelated operations and no rejection is deleted") — parked for explicit review instead of silently dropped or blocking. |
| F30: `receiptHash` sparse-unique index collided on `null` defaults | **FIXED in code; NEEDS_PRODUCTION_VERIFICATION for existing data** | Receipts now live in a dedicated private collection without the `null`-colliding sparse index pattern. The migration script's dry-run/apply path checks for and blocks on duplicates before any index change (test: "migration dry-run is read-only; TTL removal and null cleanup are explicit, restartable, and duplicates block apply") — **but this migration has not been run against production**, so an existing production index/duplicate-data problem (if any) is still open until it is. |
| F31: OCR match alone granted a subscription | **FIXED** | OCR is now advisory only; matching text does not grant an entitlement, and a private receipt retry is immutable (test: "OCR matching is advisory, private receipt retry is immutable, and no subscription is granted"). |
| F32: Rejecting a stale provisional payment revoked unrelated paid time | **FIXED** | Test: "rejecting an old provisional receipt never revokes unrelated paid time and remains in admin review". |
| F33: Payment-completed and subscription-activation were non-atomic | **FIXED** | Payment, subscription and a new permanent `subscription_grants` record commit together; a failure between them rolls back the whole thing and a retry applies exactly once (tests: "16 parallel approvals and unknown-response retry grant exactly once"; "failure after subscription/grant write rolls back payment, entitlement and audit; retry applies once"). |
| F34: Concurrent renewals lost purchased months | **FIXED** | Test: "parallel distinct payments retain all purchased months; other accounts remain isolated". |
| F35: Renewal didn't reset the expiry-reminder state | **FIXED** | Test: "a reminder for an old period cannot mark the renewed period as already reminded". |
| F36: Provisioned-but-unconfirmed payments were missing from the admin pending list | **Not independently re-verified this pass** — handoff states the admin listing/bot contract was updated together; no dedicated test name maps to this specific listing behavior. Recommend a direct check of `hisvex-bot/src/bot/handlers/admin.ts`'s pending query before marking FIXED. |
| F37: `"false"` env strings parsed as boolean `true` | **FIXED** | Test: "literal false migration/public-register env flags stay false and malformed booleans fail closed". |
| F38: Default Axios timeout was actually 0 (unbounded) across 4 clients | **FIXED** | Web: "Axios zero timeout receives a finite default; multipart stays FormData". Desktop: "native Axios adapter preserves multipart, HTTP conflicts and timeout classification". Bot: "Axios zero timeout gets a deadline; only reads fail over; receipt uploads are never replayed". Mobile covered by its own client tests exercising timeout/queue paths. |
| F39: Web image upload sent JSON instead of multipart | **FIXED** | Covered by the same "multipart stays FormData" evidence above. |
| F40: Desktop CSP blocked the Render failover host and R2 images | **NEEDS_PRODUCTION_VERIFICATION** | Not independently re-checked against the current `index.html`/CSP in this pass — the handoff lists this as part of the implemented architecture but no automated test enforces a CSP string. Recommend a manual check of `desktop/index.html`'s `connect-src`/`img-src` against the live `API_BACKUP_URL` and R2 public host before calling this closed. |
| F41: Web proxy threw on 204/205/304 (null-body statuses) | **FIXED** | Test: "proxy passes application conflicts without retry and supports all null-body statuses". |
| F42: Cache TTL reset itself on every cache hit | **FIXED** | Test: "reading a cached response never renews its original expiry". |
| F43: Audit log wasn't part of the transaction it recorded | **FIXED** | Covered by the same transactional tests as F11 ("failure after snapshot write rolls back stock, report, audit and claim; retry succeeds" — audit is explicitly part of the rollback). |
| F44: CSV export vulnerable to spreadsheet formula injection | **FIXED** | Desktop test: "CSV formula strings, leading controls, quotes and numeric losses are exported safely". Mobile's exporter is covered by the shared dependency-patch/export test but was not separately named — recommend confirming Mobile's CSV path explicitly if it diverges from Desktop's. |

## Task 1 (2026-10-01): Sync checkpoint reset recovery — FIXED

Scope: when `sync.pull.ts` throws `INVALID_SYNC_CURSOR` (400), `SYNC_RESET_REQUIRED` (409), or
`SYNC_SCOPE_CHANGED` (409) — i.e. the cursor/checkpoint token itself is the problem, not a
transient failure — Desktop and Mobile previously surfaced this as a plain, unrecoverable sync
error with no distinguishing signal, because both clients' generic Axios error handler dropped
the backend's `error.code` field before it ever reached the sync layer.

**What changed:**
- `desktop/src/api/client.ts` and `media-project-mobile/src/api/client.ts`: the final/generic
  response-error interceptor branch now extracts `code` from `response.data.error.code` and
  attaches it to the rejected `Error` via `Object.assign(new Error(message), { code })` — the
  same pattern each file already used for `SESSION_REPLACED`/`ECONNABORTED`/`ERR_NETWORK`, just
  generalized to the default path instead of being dropped there.
- `desktop/src/store/syncEngine.ts` (`performSync`) and `media-project-mobile/src/api/client.ts`
  (`pullSync`, called from `apiClient.sync`): the pull loop's `syncApi.sync(...)` call is now
  wrapped in a try/catch. On one of the three reset codes, and only if this is not already a
  retry (`isCursorResetRetry` flag), it clears **only** the persisted checkpoint (`localStorage`
  key `hisvex_sync_v2:<owner>` on Desktop; the `sync-v2-checkpoint` row in the `meta` table on
  Mobile) and recurses into the sync function exactly once with the retry flag set. A second
  consecutive failure with the same code is not caught specially and propagates as a normal
  error.
- **Zero-wipe policy, by construction**: this recovery path only ever calls
  `localStorage.removeItem`/`removeRow` against the checkpoint key. It never calls any function
  that touches the offline queue (`offlineQueue.ts` on Desktop, `syncQueue.ts`/the SQLite
  `queue` table on Mobile) or any local business table. The push phase that runs ahead of the
  pull loop is unaffected by this change and is naturally safe to re-run on retry regardless,
  since it only sends what is still queued and every pushed item carries a durable, idempotent
  operation ID.
- **Bounded to exactly one retry**: enforced by the `isCursorResetRetry` boolean parameter
  (`performSync(owner, isCursorResetRetry = false)` / `pullSync(isCursorResetRetry = false)`) —
  the recovery branch is only taken when that flag is still `false`, and the recursive call
  always passes `true`.

**Evidence:**
- Desktop (`desktop/tests/sync-recovery.test.cjs`, 3 new tests, run via the project's real
  `ts.transpileModule` + `vm` test harness against the actual `syncEngine.ts` source):
  "sync cursor reset recovers with exactly one bounded retry, never touching the offline
  queue", "a cursor reset that fails again is not retried a second time", "SYNC_SCOPE_CHANGED
  mid-page also triggers exactly one reset-and-retry". Full desktop suite: 16/16 passed;
  `npm run check` clean.
- Mobile (`media-project-mobile/tests/sync-recovery.test.cjs`, 5 new tests, run against the
  real `src/api/client.ts` via the project's in-memory-SQLite `ts.transpileModule` + `vm`
  harness, with the HTTP layer mocked at the Axios adapter level so the real response-error
  interceptor is exercised): "cursor-reset error clears only the checkpoint and retries exactly
  once", "cursor-reset recovery never touches a pending offline operation, even on successful
  retry" (seeds a real pending sale via `recordLocalSale` and asserts the queue count is still 1
  afterward), "a cursor reset that fails again is not retried a second time, and the queue is
  still preserved", "SYNC_SCOPE_CHANGED mid-page also triggers exactly one reset-and-retry", "a
  non-cursor sync error ... is never treated as a reset and is not retried" (negative control).
  Full mobile suite: 21/21 passed; `npm run check` clean; `npm run lint` unchanged (0 errors).

**Not claimed:** this is local unit/VM-sandbox coverage of the client-side recovery logic
against a mocked backend contract, not a live run against a real rotated-secret or
revision-rollback scenario on the deployed backend. The backend side of these three error codes
(`sync.pull.ts`) was not modified in this task and was verified only by reading it, not by a
dedicated new integration test.

## Task 2 (2026-10-01 re-verification): Session hijacking OTP defense — FIXED end-to-end

Re-confirmed, not newly built — this feature (from "Prompt 10") was already implemented before
this pass; this section records the explicit end-to-end re-check requested, since
`auth.controller.ts`/`auth.service.ts` had shown "changed on disk" notifications (Codex's
parallel work) after the frontend pieces were originally built.

**Backend** (`comp-bar-server/backend/src/modules/auth/`):
- `auth.service.ts`'s `login()` returns `{ success: false, requiresVerification: true,
  verificationType: "PHONE_OTP", sessionChallengeId }` on a session conflict (confirmed by
  reading the current source: lines ~160–162).
- `POST /api/auth/verify-session-challenge` (`auth.routes.ts` line 46, `auth.controller.ts`'s
  `verifySessionChallenge`) calls `authService.verifySessionChallenge(sessionChallengeId,
  otpCode, deviceId)`.
- 3-attempt lockout is enforced via `OTP_MAX_ATTEMPTS = 3` with atomic
  `SessionChallengeModel.findOneAndUpdate` claims for both the wrong-guess increment and the
  correct-guess consume (confirmed by reading `auth.service.ts` lines ~205–232) — this is the
  same atomic-claim pattern that makes the race-safety test below meaningful.
- A successful verification calls `alertService.reportSessionTakeover({ username })` (confirmed
  at `auth.service.ts` line ~265).
- Integration evidence (re-run fresh this pass): "parallel OTP completion issues only one
  session; device, expiry and attempt limit are enforced" — part of the 42-test
  `test:integration` suite above.

**Frontend wiring, confirmed intact against the current backend contract:**
- `hisvex-web/src/app/login/page.tsx` checks `'requiresVerification' in data` and stores
  `data.sessionChallengeId`; `hisvex-web/src/lib/api.ts`'s `verifySessionChallenge()` posts to
  `/auth/verify-session-challenge` with `{ sessionChallengeId, otpCode, deviceId }`.
- `desktop/src/screens/LoginScreen.tsx` checks the same `'requiresVerification' in data` shape
  and stores `sessionChallengeId`; `desktop/src/api/client.ts`'s `verifySessionChallenge()`
  posts the same payload shape to the same endpoint.
- Both were checked by reading the current source against the current backend response/request
  shape (field names, endpoint path, and payload keys all match) — not by driving the UI in a
  browser/Electron window in this pass.

**Not claimed:** no live Telegram OTP delivery, no manual browser/Electron click-through of the
OTP modal, and no fresh penetration-style attempt to actually race two real sessions against a
running server were performed in this pass — the race-safety claim rests on the integration
test above (a disposable local replica set), not a production run.

## Additional conditional risks from the original audit (not full findings)

- **Production CORS for packaged Desktop/Landing** — still needs a check against an actual
  packaged build's origin, not just source review.
- **Click callback body format** (`application/x-www-form-urlencoded` vs JSON) — the handoff
  flags this as still needing "official/sandbox protocol verification"; local tests exercise
  the application logic but not a real Click sandbox callback.
- **Electron navigation/IPC allow-list** — `electron/trust.ts` and the IPC frame-origin tests
  above address the sender-validation half of this; window-open/navigation allow-listing was
  not independently re-audited in this pass.
- **Public receipt image URLs** — receipts now live in a private collection per the handoff,
  which should resolve this; not independently re-verified against R2 bucket ACLs in this pass.

## What Section 6 of the handoff still lists as open (not attempted in this pass)

1. ~~Sync checkpoint reset recovery~~ — **done 2026-10-01**, see "Task 1" above.
2. Non-queue financial manual-retry identity (product create, debtor adjust, admin subscription
   renewal outside the offline queue).
3. Additional Desktop/Mobile regression coverage (>1,000-record sync failure modes, cache
   generation/auth-refresh races, coalesced push/pull, native disk/keychain durability).
4. Migration CLI barcode-duplicate preflight (needs per-document unwind, not a group-level
   check) and executable `database-readiness.ts` regressions.
5. F06 PIN policy decision (see above).
6. Click Prepare/Complete-before-Prepare protocol review against real Click documentation.
7. Remaining lint warnings (22 in Mobile, 22 in Web — all non-blocking, listed above).
8. This report itself — supersedes the previous version of this file, which had many
   `NOT_FIXED` rows that were already fixed by the time it was written.

## Explicitly not claimed

Per the handoff's own instruction: this report does not claim "100% safe", a guaranteed
absence of bugs, or that 1,000-concurrent-user behavior has been confirmed *in production*.
Every capacity/concurrency number above comes from a local Apple M2 / Node 26.4 / local replica
set run. WAN latency, the actual Railway/Render/Atlas production tier, TLS overhead, replica
election, sustained soak, and regional outage behavior remain unmeasured.
