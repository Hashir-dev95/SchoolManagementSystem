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
