# Phase E: canonical finance authority

## Pre-implementation authority map

| Existing source | Classification | Decision |
| --- | --- | --- |
| models/fee.ts | LEGACY / PARTIAL | Mutable amount/paidAmount/status without immutable settlement evidence. Keep records unchanged, exclude from new balance authority; report unmigrated count. |
| services/fee.service.ts | PARTIAL | Principal dashboard reader; switch implementation to canonical ledger projection, preserving existing summary field names. |
| approval-scope.service fee references | LEGACY reference-only | Generic refund/discount approvals do not execute money; retain references, add no refund/discount execution. |
| Principal finance.view grant | AUTHORITATIVE read scope | Keep branch summary oversight; no new Principal payment mutations. |
| StaffPayslip | AUTHORITATIVE owner-only read contract | Not a payroll producer. No payroll integration in this phase. |
| Canonical transaction/provider/receipt models | NOT PRESENT | Establish one obligation + immutable settled-transaction authority. |

Product evidence: Hira_School_App_Features.pdf, 73 pages, locally supplied under OneDrive/Documents. Relevant pages 12–14 and 63–65; pages 12 and 64 visually reviewed. The PDF requires branch/permission scope, shared balances, no screenshot/redirect settlement, one effect for duplicate callbacks, and receipt reads without financial mutations. Full accounting/payroll setup belongs on Web and cash receipt printing on Desktop. This mobile/API slice does not claim full PDF parity for approvals, advances, installments, physical printing or accounting.

## Donor decision matrix

| Feature | Donor reference | Canonical equivalent | Decision | Reason / target |
| --- | --- | --- | --- | --- |
| Derived balance/status | invoiceReservations.js, invoiceStatus.js | Legacy Fee totals only | ADAPT NOW | New integer-minor-unit obligation minus immutable settled transactions; no donor float conversion or stored balance. |
| Reservation/fence | invoiceReservations.js | Branch transaction fence | ADAPT NOW | Reserve server-derived full available balance under Branch/obligation serialization. |
| Idempotency/duplicate settlement | parentPaymentRoutes.js | Canonical operation/audit patterns | ADAPT NOW | Unique operation, intent transaction and provider-reference indexes plus Mongo transactions. |
| Merchant verification | parentPaymentRoutes.js | No validated provider adapter | NEEDS DEEPER REVIEW | Define disabled-by-default provider boundary; verify all event bindings server-side; live integration pending. |
| Reconciliation | parentPaymentReconciler.js | None | ADAPT NOW (read-only) | Queue unresolved/expired intents and verified-event inconsistencies; no automatic recovery worker. |
| Receipt/status UX | FinanceDashboard, StudentFeesPage, ParentMultiChildPayment | Phase B UI | ADAPT NOW | Safe settled receipts/status from canonical DTOs; no frontend balance math or sample fallback. |
| Fee structures/assignment | financeWorkspaceRoutes.js | No canonical writer | ADAPT NOW | Finance-authorized structures; enrollment-scoped obligations with server-derived amount. |
| Batch checkout/recovery | parentPaymentRoutes.js | None | LATER | Unnecessary complexity for single-obligation MVP. |
| Payroll/expenses | financePayrollRoutes.js, financeWorkspaceRoutes.js | StaffPayslip reader only | LATER / Phase E2 candidate | PDF broader product scope, not required to unlock core fee/payment reads; no expansion here. |
| Donor User/auth/session/runtime and balance stores | financeService, parentService, server/database | Canonical auth/RBAC/enrollment | REJECT | No donor runtime, identity, class placement, credentials or parallel financial truth. |

## Chosen contract and boundaries

One FeeStructure defines a versioned fixed charge in integer PKR minor units. One FeeObligation captures its assigned Student/enrollment context. FinanceTransaction records immutable settled payments. FinancePaymentIntent reserves a server-derived amount; pending intents reduce availability but never count as paid. FinanceAudit records operation identity/fingerprint, actor, target, amount/reference and state transition. Provider observations support reconciliation without altering money.

This initial workflow pays an obligation's whole available balance; arbitrary partial amount, concessions, refunds, advances and installment approvals are not implemented. Manual payment recording reserves funds and requires a different authorized Finance actor to verify actual receipt before credit. Online production execution stays disabled until a real provider contract/credentials/signature implementation is validated; tests inject a provider solely into isolated test routers/services. Unknown/unverified provider payloads cannot create money.

No live database migration or automatic opening credit is performed. Legacy Fee rows remain historical, explicitly unmigrated, and no longer define the Principal financial total after the projection switch. Trusted reconciliation/migration is a deployment prerequisite wherever legacy balances exist.

## Implementation and authorization

- `backend/src/models/finance.ts`: FeeStructure, FeeObligation, FinancePaymentIntent, FinanceTransaction, FinanceAudit and FinanceProviderObservation. Required unique indexes are built before the server accepts traffic.
- `finance-authority.service.ts`: fixed structures, enrollment-bound assignment, operation replay, scoped fee/receipt DTOs and derived branch summaries. `fee.service.ts` preserves the Principal summary contract as a projection of this same ledger.
- `finance-payment.service.ts`: manual record/review, reserved balance, settlement, isolated provider contract and reconciliation observations. `payment-provider.ts` is disabled in production; it has no credentials or enable switch.
- `/api/finance/me`: branch summary, structures, Student lookup, obligations, payments and read-only reconciliation. POST structures/fees require fee management; recording requires payment-record permission; verify/reject requires payment-verification permission and a different actor from the recorder. All routes require a real active persisted Finance User and canonical Session. Unsupported refund/adjustment routes are forbidden.
- `/api/student/me/fees`: strict own Student identity, own Branch, recipient User and current valid StudentEnrollment. `/api/parent/me/children/:studentId/fees`: the existing verified-child scope, rechecked after reading. No query-selected Branch or legacy profile placement can authorize reads.
- Parent checkout exists under `/api/parent/me/children/:studentId/fees/:feeId/checkout`; only an operation ID is accepted. Production returns 503 before reserving funds. `/api/finance-provider/callback` receives bounded raw JSON before the global JSON parser, through the disabled provider boundary.
- Finance financial writes serialize through the existing Branch transaction fence, lock the actor/session and obligation, and revalidate authority before commit. Assignment also fences the authoritative Student, recipient User and enrollment. TeacherAssignment, attendance, timetable and result authorities are unchanged.
- Canonical User now supports the Finance role, with only finance-view, fee-management, payment-record and payment-verification actions. Principal retains branch financial summary oversight without new payment mutation rights. Existing Super Admin policy remains unchanged. No Finance provisioning UI is added; trusted canonical account provisioning is required.
- `FinanceNavigator` uses the existing root navigation/auth container. `FinanceWorkspaceScreen` uses Phase B dashboard components and canonical API client. Student/Parent Fees use `FeeCards`; money labels/status are server-supplied. Developer Preview remains unchanged and development-only.

## Payment safety and MVP status

| Capability | Status | Evidence / limit |
| --- | --- | --- |
| Finance dashboard and fee obligations/challans | INTEGRATED | Canonical structures, current-enrollment assignment, server totals and immutable obligation snapshots. |
| Student/verified-child fee reads | INTEGRATED | Own/linked scope, safe receipt DTOs, honest errors/empty states; no preview fallback. |
| Server-derived amount and reservation | INTEGRATED | Positive safe integer PKR minor units; balance minus held intents controls payable amount. Pending or expired reservation is never paid. |
| Manual payment recording and verification | INTEGRATED | Cash/bank API; mobile bank-record/review UI; distinct authorized checker, revision and review note; atomic intent/transaction/audit. |
| Operation replay and duplicate protection | INTEGRATED | Payload fingerprint, unique actor operation, unique intent settlement, unique provider transaction effect, Branch/fee transaction fence; concurrent tests. |
| Online production payments | PARTIAL / PROVIDER VALIDATION PENDING | Server-only adapter and verified settlement contract tested with an isolated test provider. No live merchant implementation, credentials, checkout button or successful production-payment claim. |
| Receipts | INTEGRATED (read data) | Only settled transactions yield receipt data under the fee/Student context. Repeat reads have no financial effect. Physical printing/export is deferred. |
| Reconciliation | INTEGRATED (branch read queue); PARTIAL (recovery) | Expired/pending/uncertain intents and inconsistent verified events are visible. No automatic recovery. Unknown references are recorded as unmatched without revealing them to an arbitrary Branch. A global operator queue is not implemented. |
| Audit trail | INTEGRATED | Actor/action/target/amount/reference/time and transition states; no silent paid-field overwrite. Provider observations retain rejected bindings separately. |
| Payroll / expenses | DEFERRED | Phase E2 candidates for explicit product review; no writers or new payroll authority. |
| Batch recovery, partial allocations, refunds, concessions, advances, installments | DEFERRED | No endpoint silently implements these or changes a settled transaction. |

An expired manual intent needs explicit independent verification or rejection; expiry alone never frees potentially paid funds. Provider timeout retains one held intent and does not retry external checkout. Invalid signature/merchant/currency/amount/order/transaction bindings cannot credit a fee. Duplicate verified callbacks settle once; later inconsistent states create observations without reversing settlement. Captured provider payments settle against the reserved obligation, not client-supplied amounts.

Legacy Fee records are not migrated or deleted and are excluded from every live balance. Finance, Principal, Student and Parent receive an explicit unmigrated-record warning/count within their authorized scope. Generic approval references remain historical only; approval does not execute refund/discount money. The initial workflow settles the whole available obligation, in PKR only. Finance lists are bounded (100 records; Student picker 50); Student/Parent statements beyond 100 obligations fail explicitly pending pagination. Pagination, global reconciliation operations and live provider validation remain follow-up work.

## Validation

- Final backend selection: **478 PASS, 0 FAIL**, 15 files. Includes **32 finance/provider tests** plus Parent, Student, enrollment, academic work/results, Teacher timetable, Principal attendance/authorization and bootstrap regressions.
- Enrollment fixture rerun: **58 PASS, 0 FAIL**. Principal authorization fixture rerun after Mongoose constructor typing correction: **50 PASS, 0 FAIL**. Original monetary/scope assertions remain unchanged; fixtures now seed canonical charge/settlement evidence alongside preserved historical Fee records.
- Frontend selection: **132 PASS, 0 FAIL**, 14 suites: Finance service/workspace, Student/Parent services/workspaces, auth session, Developer Preview, shared tabs, Teacher navigation, Principal attendance/substitutions, timetable and academic setup navigation.
- Positive finance coverage: branch-authorized structure/assignment/read; same Student/Parent DTO; uncredited reservation; independent verification; settled receipts; stable operation replay; concurrent recording/verification/callbacks; read-only expiry/inconsistency queue.
- Denial coverage: foreign Branch, wrong role, forged scope selectors, unlinked child, missing enrollment, unsafe/floating/negative money, client amount/status tampering, self-verification, inactive/revoked actor, removed payment action permission, unknown fee/payment, unsupported refund, invalid signature and mismatched merchant/currency/amount/transaction, reused event payload and selector injection. Timeout and unknown-order cases preserve funds and evidence without credit.
- Backend source TypeScript and mobile source/test TypeScript: PASS. Root project TypeScript remains nonzero with **76 inherited diagnostics**, compared with **85** on Phase D (`4aa923968616e341b85cfc38ec37148a17f29e29`); **0 introduced diagnostics**, comparing file/code/message multiplicity without shifted source offsets. No unrelated TypeScript repairs.
- Scoped ESLint: **38 TypeScript/TSX files, 0 errors, 0 warnings**. `git diff --check` and staged checks pass.
- No dependencies, lockfiles or native configuration changed, so no Android rebuild was required. No physical-device runtime or live provider test is claimed.
- Local logs, temporary Mongo output, PDF text/renders and TypeScript comparison evidence stay under the already excluded `.validation-principal-audit/phase-e/`; none are committed. No ignore rule changes.

Phase A–D and canonical Principal/Teacher authorities are preserved by the selected regression coverage; no claim is made that every repository suite was run. No donor runtime/auth/session/theme/data store was imported, no branch was merged, and nothing was pushed. Phase E stops at core fees/payments; Chat/Notifications, Applications and Payroll/Expenses are not started.
