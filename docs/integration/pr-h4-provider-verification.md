# PR-H4 — Canonical Payment Provider Verification

## 1. Baseline Git state

- Branch: `integration/team-merge`.
- Starting HEAD: `9de27a6f21afd101a18867560836b098b6a26cf6` (`hr-3`).
- Initial worktree/index: clean; PR-H3 committed.

## 2. Existing provider authority inspected

Reviewed `backend/src/models/finance.ts`, `backend/src/services/finance-payment.service.ts`, `backend/src/services/payment-provider.ts`, `backend/src/services/finance-authority.service.ts`, `backend/src/routes/finance.routes.ts`, `backend/src/routes/parent-self.routes.ts`, `backend/src/app.ts`, canonical authentication, and Finance/provider tests and fixtures.

Existing authority consists of immutable obligations, held intents, settled transactions, FinanceAudit operation records, provider observations, raw callback routing, verified-child checkout and a disabled production adapter. The callback already authenticates and settles atomically. PR-H4 strengthens its verification gates without introducing another provider architecture.

## 3. Donor behavior inspected

Inspected `D:\Faraz-Reference\backend\src\parentPaymentRoutes.js` directly: `merchantRequest`, `validateMerchantStatus`, `fetchVerifiedMerchantStatus` and provider/idempotency indexes.

| Behavior | Classification |
| --- | --- |
| Exact transaction/order/amount/currency matching and duplicate protection | DUPLICATE: retained canonical equivalents |
| Explicit provider uncertainty and reservation-state checks | ADAPT NOW |
| Merchant status polling, real adapter configuration and recovery workers | LATER |
| Donor authentication/runtime, invoice stores, floating-point conversion and merchant assumptions | REJECT |

No donor files, credentials or runtime were imported.

## 4. Provider verification contract

Existing route remains `POST /api/finance-provider/callback`, with raw JSON capped at 64 KiB and mounted before the global JSON parser. It is provider-to-server and does not require a frontend Session. The server adapter authenticates evidence before returning a normalized ProviderEvent.

Only `eventId`, `orderRef`, `transactionRef`, `merchantId`, `amountMinor`, `currency` and `state` are allowed. Unknown/structured fields, invalid IDs, invalid integer amounts and unsupported states fail closed. Evidence states remain `paid`, `pending` and `failed`; no new lifecycle state was added.

Empty/oversized service evidence returns 400; invalid authenticity/bindings return 403; conflicting event reuse returns 409; missing configuration or adapter-reported verification outages return sanitized 503. Expired captures return `reconciliation_required`; terminal/corrupt lifecycle states return `inconsistent` without resurrection.

## 5. Authenticity and matching guarantees

The existing adapter owns cryptographic/provider authentication. Canonical checks bind its verified event to provider ID, merchant, intent/order, provider transaction, exact reserved integer amount and currency. Extra normalized fields cannot override trusted provider/Branch metadata.

Bindings are rechecked inside the existing transaction against the locked obligation and current intent. The initiating `checkout.reserved` audit must match Branch, actor, target, amount and obligation/provider fingerprint. Completed replays require an actual matching settled transaction.

Provider amount means the gross payable amount corresponding to the reservation, without fee/net subtraction. Production authenticity remains unavailable until a reviewed real provider adapter is supplied; no protocol or credentials were fabricated.

## 6. Replay/concurrency guarantees

Existing unique `(provider,eventId)`, unique transaction `intentId`, unique provider transaction effect, unique audit operation and Branch/obligation transaction fencing remain authoritative. Merchant identity is now persisted in observations and included in replay comparison. One provider transaction cannot credit two unrelated reservations. Identical concurrent callbacks retain one existing financial effect.

## 7. Settlement boundary

The baseline callback already combines verification, settlement and receipt-reference creation in one Mongo transaction. That established atomic contract and its existing tests are preserved. A separate verified-but-unsettled state would require a lifecycle/API and test-contract change, so it was not introduced here.

PR-H4 adds no new settlement/receipt flow. Failed or uncertain verification does not reach the existing settlement branch. Late captures keep their reservation held for explicit reconciliation. No reconciliation automation was added. The audit now records the actual pre-transition state.

## 8. Security guarantees

No secrets, provider credentials, raw gateway responses or client financial authority were added. Observations retain only normalized evidence and safe outcomes, with optional immutable merchant identity. Parent checkout retains Session/RBAC and verified-child ownership; Student initiation remains deferred. Callback authorization is provider authenticity plus canonical reservation/audit binding. Recovery updates exclude manual and foreign-provider intents.

## 9. Files changed

| Path | Purpose |
| --- | --- |
| `backend/src/models/finance.ts` | Store immutable merchant identity in normalized provider observations. |
| `backend/src/services/finance-payment.service.ts` | Strict evidence validation, sanitized uncertainty, transactional binding/audit checks, expiry protection and completed-replay proof. |
| `backend/src/services/payment-provider.ts` | Document authenticated normalized evidence, gross amount and temporary-outage adapter contract. |
| `backend/tests/payment-provider.security.test.ts` | Fourteen new verification cases; existing assertions preserved. |
| `docs/integration/pr-h4-provider-verification.md` | Persistent implementation, security, validation and Git report. |

## 10. Tests added/changed

Fourteen new cases cover malformed/extra-field evidence, sanitized verification outage, missing configuration and evidence bounds, expired-paid replay, three terminal/corrupt states, five corrupt reservation mappings (actor, Student, obligation, channel, provider), transaction reuse across two reservations, and merchant replay/completed-transaction proof.

Existing positive exact matching, invalid signature, unknown order, amount/currency/merchant/reference mismatch, conflicting event reuse, concurrent duplicate callbacks, raw HTTP callback, Parent scope, checkout timeout and receipt/settlement safety assertions remain intact.

## 11. Validation results

| Check | Result |
| --- | --- |
| Provider security | 30 PASS, 0 FAIL |
| Finance security/reservations, including PR-H1/H2/H3 | 45 PASS, 0 FAIL |
| Student/Parent backend regression | 43 PASS, 0 FAIL |
| Backend total | 118 PASS, 0 FAIL; five files |
| Finance frontend | 50 PASS, 0 FAIL |
| Student/Parent frontend | 23 PASS, 0 FAIL |
| Auth/session and Developer Preview | 14 PASS, 0 FAIL |
| Frontend total | 87 PASS, 0 FAIL; six suites |
| Backend source TypeScript | PASS |
| Mobile source/test TypeScript | PASS |
| Root TypeScript comparison | 76 baseline, 76 final, 0 introduced |
| Scoped ESLint | Four TS files; 0 errors/warnings |
| git diff --check | PASS |

No Android build was required: dependencies, native configuration, assets and mobile implementation are unchanged. Validation evidence is kept in the existing ignored `.validation-principal-audit/pr-h4/` directory.

## 12. Remaining issues

Production provider configuration/authenticity integration is still intentionally disabled pending a reviewed real adapter and its provider-specific evidence contract. No fake configuration enables it. Legacy observations without merchant identity fail replay comparison and require explicit review rather than inferred migration. Separating verification from the baseline atomic settlement contract, receipts/export and reconciliation automation are deferred.

## 13. Persistent report

Created `docs/integration/pr-h4-provider-verification.md`.

## 14. Final Git state

- Branch and HEAD unchanged: `integration/team-merge`, `9de27a6f21afd101a18867560836b098b6a26cf6`.
- Zero staged files; four modified tracked files plus this new untracked report, all left unstaged.
- Working tree contains only the five intentional paths listed above; initial unrelated changes: none.
- No merge in progress; donor checkout unchanged.
- No staging, commit, push, merge, cherry-pick, reset, clean or branch switch performed.

## 15. PR-H4 disposition

READY FOR REVIEW
