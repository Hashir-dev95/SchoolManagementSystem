# PR-H5 — Canonical Settlement and Receipt Contract Closure

## 1. Baseline Git state

Branch `integration/team-merge`; HEAD `c9a08410c2316851a1dfa762370b2f00e49f7b6a`; initial worktree and index clean; PR-H4 committed.

## 2. Existing settlement/receipt authority inspected

Reviewed `backend/src/models/finance.ts`; `finance-payment.service.ts` (`processProviderCallback`, `verifyManualPayment`, `receiptDTO`); `finance-authority.service.ts` (`feeDTO`, `financeWrite`, `readStudentFees`); Finance/Parent/Student routes; `FeeCards.tsx`; provider/Finance tests and fixtures. Paths below are under `backend/src` unless tests are specified.

## 3. H5 decision matrix

Completed before implementation. HARDEN rows identify a concrete integrity or missing-test gap; COMPLETE rows retain implementation. All HARDEN actions below are now closed by the narrow implementation and tests described in sections 4 and 11. Decisions retain their audit classification to distinguish preserved authority from H5 work.

Exact test evidence: `backend/tests/finance.security.test.ts` includes the original manual concurrency/receipt tests and nine H5 cases; `backend/tests/payment-provider.security.test.ts` includes the original callback/matching/replay/expiry tests and two H5 cases. No existing assertion was removed or weakened.

| Capability | Current canonical implementation | Evidence/files | Decision | Required H5 action |
| --- | --- | --- | --- | --- |
| Provider-verified payment → settlement | Atomic callback settlement | `services/finance-payment.service.ts:processProviderCallback`; provider concurrent callback test | COMPLETE | Preserve |
| Atomic transaction boundary | Intent, transaction and audit share Mongo session; Branch/fee fence | `financeWrite`, `withTimetablePublication`; both settlement functions | HARDEN | Add provider audit-failure and manual transaction-failure rollback tests; preserve implementation |
| Single-settlement guarantee | Unique intent effect and provider effect; Branch/fee serialization | `models/finance.ts` indexes; existing duplicate callback/manual verification tests | COMPLETE | Preserve |
| Amount/currency authority | Provider checks exact evidence/intent/audit; manual lacks Student/currency/original-audit binding | Both settlement functions; manual inspection | HARDEN | Validate manual intent against obligation and originating audit before settlement/replay; regression tests |
| Canonical balance/status update | Derived from settled effects and holds by feeDTO | `services/finance-authority.service.ts:feeDTO`; existing five-status tests | COMPLETE | Preserve; assert post-settlement read agreement |
| Settlement audit trail | Canonical FinanceAudit writes in same transaction | `models/finance.ts`; both settlement functions | HARDEN | Test rollback and corrupt/missing manual audit denial |
| Receipt identity/reference | Transaction ID plus unique stable RC-intent reference | Transaction schema; `receiptDTO`, `feeDTO` | HARDEN | Add explicit stable replay/zero-write assertions; preserve reference creation |
| Receipt read contract | Safe nested settled receipts in fee DTO; safe manual verification response | `feeDTO`, `receiptDTO`; Finance fee route | COMPLETE | Preserve; no standalone endpoint or export required |
| Parent receipt/payment visibility | Verified-child fee read returns same canonical DTO | `routes/parent-self.routes.ts`; `verifiedChild`, `readStudentFees` | HARDEN | Add settled-receipt scope and repeated-read tests |
| Student receipt/payment visibility | Own Student/current enrollment fee read | `routes/student-self.routes.ts`; `readStudentFees` | HARDEN | Add settled-receipt equality/read-only tests; no initiation |
| Manual payment settlement | Independent Finance verification; replay currently checks only intent/Branch receipt | `verifyManualPayment`; manual concurrency tests | HARDEN | Require complete replay transaction/verification-audit binding; preserve lifecycle |
| Expired/late provider capture | Retained hold with reconciliation_required | `processProviderCallback`; H4 expired-paid test | RECONCILIATION | Preserve; no recovery automation |
| Duplicate callback replay | One effect; completed replay requires matching transaction | H4 callback proof; existing concurrent test | COMPLETE | Preserve; explicit receipt/audit stability coverage |
| Conflicting provider transaction reuse | Unique provider transaction index with rollback/review | `models/finance.ts`; H4 cross-reservation reuse test | COMPLETE | Preserve |
| Uncertain/failed verification | No verified effect; failures/outages do not infer success | H4 signature/outage/expiry tests | COMPLETE | Preserve |
| Reconciliation automation | Read queue/observations only | `routes/finance.routes.ts:/reconciliation` | DEFER | No implementation |

## 4. Contract assessment

Only `verifyManualPayment` required source changes. Seven targeted cases reproduced the gaps against the starting implementation (seven expected regression failures before the fix). Manual settlement now requires the original payment.recorded audit to bind the intent's actor, obligation, method, reference and amount. Student and currency must match the locked obligation; amount must be a positive safe integer and currency PKR.

Completed manual replay additionally requires the exact settled transaction (intent, obligation, Student, Branch, amount, currency, method, reference, original actor and verifier) and matching payment.verified audit. Corrupt/missing evidence returns sanitized 503 without a financial effect.

Other HARDEN rows were closed with tests only. Provider settlement, models/indexes, routes, receipt creation, fee calculations and frontend implementation were preserved. No new receipt endpoint, payment initiation, lifecycle or accounting authority was needed.

## 5. Settlement guarantees

Both settlement paths retain their existing transaction/fence authority. Manual status, verifier metadata, settled transaction/receipt reference and audit commit together. Provider state/effect/audit likewise commit together; provider observations and existing reconciliation markers may remain outside a failed financial transaction as safe review metadata. Injection tests prove no success audit, receipt or transaction survives a failed settlement.

Balances/statuses remain derived by feeDTO from canonical settled effects and holds; no stored duplicate balance or client calculation was added. Exact provider evidence/reservation matching remains from H4. Manual verification retains a distinct authorized Finance checker and Session/RBAC validation at commit.

## 6. Idempotency/concurrency guarantees

Existing unique transaction intentId, provider transaction effect, receipt reference, FinanceAudit operation, provider event identity, Branch serialization and obligation fencing remain unchanged. Existing concurrent provider/manual settlement and conflicting-provider-reference tests pass. New positive manual and provider replay tests assert one stable receipt and one success audit/effect.

## 7. Receipt guarantees

Paid receipts remain projections of settled FinanceTransaction documents; references are stable RC-intent IDs. A pending intent has no paid receipt. Student `/api/student/me/fees`, Parent `/api/parent/me/children/:studentId/fees` and Finance obligation reads return the same canonical receipt identity and server labels.

New tests compare receipt DTOs, prove repeated user reads leave obligations/intents/transactions/audits unchanged, reject a foreign Parent/Branch and guessed transaction-as-obligation IDs, and reject unsupported receipt selectors. No raw provider evidence, audit internals, credentials or private identity fields are exposed. Existing FeeCards already renders server receipt data and remains unchanged.

## 8. Deferred reconciliation cases

Late/expired captures, uncertain provider outcomes, conflicting transaction effects and corrupt financial evidence require explicit review. No automation.

## 9. Donor behavior inspected

Additional donor inspection unnecessary: canonical receipt and settlement contracts are already present. Prior donor equivalents are DUPLICATE; no donor work imported.

## 10. Files changed

| Path | Purpose |
| --- | --- |
| `backend/src/services/finance-payment.service.ts` | Minimal manual reservation/receipt replay binding guards within the existing transaction. |
| `backend/tests/finance.security.test.ts` | Nine manual integrity, replay and rollback cases. |
| `backend/tests/payment-provider.security.test.ts` | Two provider rollback and scoped/stable/read-only receipt cases. |
| `docs/integration/pr-h5-settlement-receipt-closure.md` | Decision matrix and closure evidence. |

## 11. Tests added/changed

Nine Finance cases: five corrupt binding variants (Student, currency, amount, reference, actor); missing original audit; corrupt completed receipt/missing verification audit; positive stable completed replay; injected transaction failure rolling back status/audit/receipt.

Two provider cases: injected audit failure after transaction creation rolls back the financial effect and obligation revision; stable receipt identity across identical/new-event replays, safe DTO keys, identical Student/Parent/Finance views, zero-write user reads and scope/guessed-ID denial.

PR-H1 through PR-H4 tests remain intact, including concurrent duplicates, cross-intent provider reuse, amount/currency corruption, invalid signatures, provider outage and late-capture handling.

## 12. Validation results

| Check | Result |
| --- | --- |
| Finance security/payment tests | 54 PASS, 0 FAIL |
| Provider security tests | 32 PASS, 0 FAIL |
| Student/Parent backend regressions | 43 PASS, 0 FAIL |
| Backend total | 129 PASS, 0 FAIL; five files |
| Finance frontend | 50 PASS, 0 FAIL |
| Student/Parent frontend | 23 PASS, 0 FAIL |
| Auth/session and Developer Preview | 14 PASS, 0 FAIL |
| Frontend total | 87 PASS, 0 FAIL; six suites |
| Backend source TypeScript | PASS |
| Mobile source/test TypeScript | PASS |
| Root TypeScript comparison against starting HEAD | 76 baseline; 76 final; 0 introduced |
| Scoped ESLint | Three changed TS files; 0 errors/warnings |
| git diff --check | PASS |

Android build unnecessary: no dependencies, native configuration, assets or frontend implementation changed. Validation evidence remains under the existing ignored `.validation-principal-audit/pr-h5/` directory. The seven pre-fix regression failures are reproduction evidence, not final failures.

## 13. Remaining issues

No known H5 blocker. Real provider adapter implementation, standalone receipt export/printing and reconciliation automation remain outside H5. Existing corrupt or legacy manual reservations lacking original/verification audit evidence now require explicit review; H5 does not infer, repair or migrate financial evidence.

## 14. Persistent report

Created `docs/integration/pr-h5-settlement-receipt-closure.md` before source implementation to record the decision matrix.

## 15. Final Git state

- Branch `integration/team-merge`; HEAD unchanged at `c9a08410c2316851a1dfa762370b2f00e49f7b6a`.
- Zero staged files; three modified tracked files and this new untracked report, all unstaged.
- No unrelated initial changes; no merge in progress; no staging, commit, push, merge, cherry-pick, reset, clean or branch switch performed.

## 16. PR-H5 disposition

READY FOR REVIEW
