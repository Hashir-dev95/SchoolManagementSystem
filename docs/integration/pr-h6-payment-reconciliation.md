# PR-H6 — Canonical Payment Reconciliation

## 1. Baseline Git state

Branch `integration/team-merge`; HEAD `b8b76ae834b594bdb1e0476b83ac9aa453147e1e`; clean worktree/index; H5 committed.

## 2. Existing reconciliation authority inspected

Canonical Finance intents, observations, transactions and audits; `processProviderCallback`, `verifyManualPayment`, `feeDTO`, Finance reconciliation route/pane, Parent checkout, H1-H5 tests. Existing holds, observations and read queue are authoritative; no new model/store is required.

## 3. H6 decision matrix

Recorded before implementation. All HARDEN/MISSING_MVP actions are now completed; classifications retain their original audit decisions to distinguish preserved payment authority from H6 read/UI work. Evidence paths: `backend/src/services/finance-payment.service.ts` (P), `backend/src/routes/finance.routes.ts` (R), `src/screens/finance/FinanceWorkspaceScreen.tsx` (UI), `backend/tests/payment-provider.security.test.ts` (PT), `backend/tests/finance.security.test.ts` (FT).

| Case | Existing canonical behavior | Evidence | Decision | H6 action |
| --- | --- | --- | --- | --- |
| Expired reservation + verified paid event | Holds funds and records reconciliation_required; no settlement | P callback; PT expired-paid test | HARDEN | Surface safe late_capture classification; preserve financial behavior |
| Provider timeout/outage | Checkout uncertainty holds funds; verification outage returns 503 without success | P checkout/callback; PT outage/timeout tests | HARDEN | Surface provider_uncertain from persisted state; never infer success |
| Conflicting provider transaction | Unique effect blocks duplicate credit; observation/review marker retained | P callback; PT cross-reservation test | HARDEN | Surface conflicting_effect without foreign record details |
| Duplicate provider transaction | Database uniqueness and replay checks | Finance model indexes; PT concurrent tests | COMPLETE | Preserve |
| Corrupt reservation/audit evidence | H4/H5 block settlement but queue lacks integrity classification | P callback/manual verification; PT/FT corruption tests | HARDEN | Read-only corrupt_evidence classification; never repair |
| Manual-payment evidence inconsistency | Requires independent verification; bad bindings fail closed | P verifyManualPayment; FT H5 cases | HARDEN | Surface inconsistency; preserve verification policy |
| Already-settled consistent replay | Stable effect/receipt; no duplicate settlement | PT/FT replay tests | COMPLETE | Preserve; omit from default unresolved list and expose resolved view |
| Reconciliation queue/read API | Fixed 100-row lists, no validated filters/paging or evidence assessment | R /reconciliation | MISSING_MVP | Extend same endpoint with bounded paging, classification and safe evidence DTO |
| Reconciliation UI | Existing read-only pane with generic reason/state | UI reconciliation pane | MISSING_MVP | Extend pane with filters, paging and explicit review states |
| Reconciliation mutation/action | No safe Finance recovery policy | Existing manual verification only | DEFER | Keep H6 read/review only |
| Automatic recovery worker | Not present canonically | Existing read queue only | DEFER | No worker |

## 4. Reconciliation contract

Existing `GET /api/finance/me/reconciliation` now delegates to `financeReconciliation` in the existing payment service. Accepted filters: `reason` (late_capture, provider_uncertain, conflicting_effect, corrupt_evidence, already_resolved, requires_review), `offset` (0–10000), `limit` (1–100, default 25). Unsupported selectors are forbidden; invalid enum/page values return 400.

Response: `items`, `observations`, `offset`, `limit`, `nextOffset`. Default items omit consistently resolved payments; the already_resolved filter exposes them explicitly. Each item contains safe intent/reference/state, classification, reviewStatus/reason, timestamps, provider state/reference, and validated obligation/challan/Student ID and amount/currency context. Corrupt items omit canonical financial/context labels rather than presenting inconsistent evidence as truth. No private identity/contact, provider credentials or audit internals are exposed.

Pagination applies to stable newest-first Branch payment candidates BEFORE classification filtering. A filtered page can be empty and still return nextOffset; this is explicit in the UI. The retained observation view is a separate latest-100 Branch evidence list, including orphaned observations, independent of classification filters. It preserves existing consumers and never hydrates foreign records from observation references.

No reconciliation mutation endpoint was added. All classifications are derived from current canonical evidence in one read-only snapshot, not persisted as a second financial state machine.

## 5. Financial safety guarantees

No settlement, release, receipt, audit, observation, enrollment or Session mutation from reads. The service reuses feeDTO validation, original reservation fingerprints/audits, terminal audit/effect proof and H3-H5 state precedence. Exact authenticated paid evidence plus expiry yields late_capture while funds stay held. Persisted provider uncertainty never becomes paid or failed by inference. Conflicting effects are flagged without credit. Consistent settled replay is omitted from unresolved items and retains the existing receipt identity.

Malformed imported references/amounts and missing/corrupt evidence return sanitized review classifications without authoritative financial labels. Unexpected database failures propagate as request errors rather than fabricated empty queues.

## 6. Security guarantees

Canonical Session/JWT, persisted active Finance actor, finance.view permission and active server-derived Branch are mandatory. The actor/Branch is rechecked after the snapshot. All returned intents, obligations, audits and observations are Branch scoped. A global provider-reference uniqueness lookup returns only an existence flag for an actor-owned intent; no foreign transaction, identity, amount or reference is returned.

No client Branch/financial authority, secrets, new dependency, ledger model, provider configuration or frontend financial calculation was introduced. Historical financial review does not substitute profile placement for enrollment authority. Filters and pagination use the existing workspace request-generation pattern; filter changes, account/token changes and unmount invalidate old responses. The UI has no reconciliation payment mutations.

## 7. Donor behavior inspected

Read `D:\Faraz-Reference\backend\src\parentPaymentReconciler.js` directly. Safe uncertainty/review concepts: ADAPT NOW. Existing duplicate protection: DUPLICATE. Merchant polling, leases, backoff and batch workers: LATER. Donor auth/runtime/stores and floating-point authority: REJECT. No donor imports.

## 8. Files changed

| Path | Purpose |
| --- | --- |
| `backend/src/services/finance-payment.service.ts` | Read-only snapshot classification, safe DTO and bounded candidate pages in existing service. |
| `backend/src/routes/finance.routes.ts` | Existing reconciliation endpoint delegates to service with query allowlist. |
| `src/services/finance/financeService.ts` | Typed reconciliation filters/DTO and encoded GET parameters. |
| `src/screens/finance/FinanceWorkspaceScreen.tsx` | Existing pane gains reason filters, safe context, pagination and stale-response protection. |
| `backend/tests/finance.security.test.ts` | Six queue scope, permission, input, integrity and zero-write cases. |
| `backend/tests/payment-provider.security.test.ts` | Resolved-view case and review assertions for existing late/uncertain/conflict cases. |
| `__tests__/finance-service.test.ts` | Reconciliation GET serialization/backward compatibility. |
| `__tests__/finance-workspace.test.tsx` | Ten UI cases for classifications, paging, errors and session/request safety. |
| `docs/integration/pr-h6-payment-reconciliation.md` | Persistent matrix and implementation report. |

## 9. Tests added/changed

Six new Finance cases cover own-Branch safe DTO/foreign exclusion; permission/session/active-account denial; bounded paging and invalid selectors; missing original audit; malformed imported references/amounts; and deep zero-write comparison including obligations, intents, transactions, audits, observations, enrollment and Sessions.

One new provider case proves consistent settled replay is absent from unresolved items, available as resolved and retains receipt identity. Existing expired-paid, checkout-timeout and conflicting-effect tests now assert the corresponding classifications. Late-capture evidence is also excluded from foreign Branch reads.

One client service test verifies reason/page encoding and unchanged default GET semantics. Ten UI cases cover late capture and server context, provider uncertainty/conflict/corrupt reasons, pagination/filter stale responses, separate 401/403 states, network loading/error/retry, token/session isolation and resolved read-only presentation. H1-H5 assertions remain intact.

## 10. Validation results

| Check | Result |
| --- | --- |
| Finance backend/security/reservation/settlement | 60 PASS, 0 FAIL |
| Provider security | 33 PASS, 0 FAIL |
| Student/Parent backend regression | 43 PASS, 0 FAIL |
| Backend total | 136 PASS, 0 FAIL; five files |
| Finance frontend | 61 PASS, 0 FAIL |
| Student/Parent frontend | 23 PASS, 0 FAIL |
| Auth/session and Developer Preview | 14 PASS, 0 FAIL |
| Frontend total | 98 PASS, 0 FAIL; six suites |
| Backend source TypeScript | PASS |
| Mobile source/test TypeScript | PASS |
| Root TypeScript against starting HEAD | 76 baseline; 76 final; 0 introduced |
| Scoped ESLint | Eight TS/TSX files; 0 errors/warnings |
| git diff --check | PASS |

Android build unnecessary: dependencies, native configuration and assets unchanged. Evidence remains in existing ignored `.validation-principal-audit/pr-h6/`; no ignore rules changed.

## 11. Remaining issues

No known H6 blocker. Resolution/recovery mutations have no safe existing policy and remain deferred; the canonical manual verification workflow remains unchanged. No automatic polling, recovery worker, batch recovery, real-provider adapter or historical evidence repair was implemented. Verification outages without authenticated reservation mapping cannot safely be attributed to a particular intent; existing pending holds remain reviewable without inferred outcomes. Candidate-page/filter semantics and separate bounded observation history are documented above.

## 12. Persistent report

Created before implementation: docs/integration/pr-h6-payment-reconciliation.md.

## 13. Final Git state

- Branch `integration/team-merge`; HEAD unchanged at `b8b76ae834b594bdb1e0476b83ac9aa453147e1e`.
- Zero staged files; eight modified tracked files plus this new untracked report, all unstaged.
- Initial unrelated work: none. No merge in progress; donor checkout unchanged.
- No staging, commit, push, merge, cherry-pick, reset, clean or branch switch performed.

## 14. PR-H6 disposition

READY FOR REVIEW
