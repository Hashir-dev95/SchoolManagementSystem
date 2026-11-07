# G3c — Parent leave changes and resubmission

## A. Actual Git baseline

The baseline was clean with an empty index on `integration/team-merge` at `c48022d07bb5fee88e80df5623e2246c62985b42`. The configured local upstream ref, `origin/integration/team-merge`, was one commit behind at `ab406561f2578b723f95e1f6aa735079d7166546` (DEV-STARTUP-01). The local history contains G3b (`7e5d4e89`, `d07e555c`), G3a (`c635a292`), G2b (`d6e0c2f0`), G2a and G1. The pre-change security run passed 133 tests. The upstream comparison uses the local tracking ref.

## B. HIRA PDF requirements

| Page | Requirement applied to G3c |
| --- | --- |
| 10 | A scoped Principal can return an approval with an explanation, confirmation and audit history. |
| 19 | Attendance continues to use the authorized roster and preserves its versions, author and time. |
| 20 | Attendance corrections preserve the prior value and record the authorized change. |
| 57 | Unmarked attendance stays distinct from absence. A Parent has no attendance marking authority. |
| 58 | A verified Parent acts for the selected child, supplies leave dates and a private reason, and can see status and history. Attendance effects remain with the attendance domain. |

Source pages were inspected in the local copy of `Hira_School_App_Features.pdf`.

## C. Faraz donor reuse matrix

Local reference `D:/Faraz-Reference` at `293966bf`.

| Evidence | Disposition |
| --- | --- |
| `D:/Faraz-Reference/src/mobileApp/TeacherApplicationsPage.jsx:20`, `:38` | Adapted the actionable request-for-information, chronological history, busy and retry concepts through existing HIRA screens and confirmation. |
| `D:/Faraz-Reference/backend/src/applicationReviewRoutes.js:29`, `:56` | Rejected the assigned-Teacher reviewer and generic status mutation. The useful review note and history behavior comes from the HIRA typed transaction. |
| `D:/Faraz-Reference/backend/src/applicationService.js:24`, `:52` | Rejected independent class-Teacher routing, identity and authority. Existing HIRA Branch and attendance services own those decisions. |

## D. Canonical authority reuse

- The existing typed Principal router and approval middleware gate the endpoint. The transaction reloads current registered session, persisted active role, own Branch, view/manage permissions and the leave category grant, and checks requester separation. The Branch lock and final fences are shared with G3b. See `D:/SchoolManagementSystem/backend/src/routes/principal.routes.ts:31` and `D:/SchoolManagementSystem/backend/src/services/parent-leave-review.service.ts:335`.
- Parent writes use the existing Branch-first verified child write wrapper and exact application provenance. The wrapper checks the current session, persisted identity, verified link and eligible verifier, and exact enrollment at the write boundary. Both typed actions enforce the pinned enabled Option A policy. Parent resubmission also verifies the eligible Branch queue before commit. See `D:/SchoolManagementSystem/backend/src/services/parent-application-access.service.ts:110` and `D:/SchoolManagementSystem/backend/src/services/parent-leave-routing.policy.ts:57`.

## E. Multi-cycle review data model

The existing first submission remains the current frozen submission until a resubmission replaces it. Before that replacement, the validator requires an exact archive of the prior revision, type, dates, private reason, fingerprint and routing policy/version, along with the unchanged archive prefix. The immutable application event at the archived revision records the original submission actor and time. The next event records the request for changes with Principal, time and reason. The linked approval mirrors all non-draft events. The application revision sequence establishes cycle order, and the approval's `parentLeaveRevision` points to the current submitted revision. The same reciprocal IDs remain throughout.

The join validates types, both IDs, Branch, requester, status, revision, actors, reasons and timestamps before typed access or writes. G2b generated a separate nested withdrawal timestamp. The join validates that legacy timestamp as a valid date and checks the exact withdrawal time against the application event and the approval's withdrawal metadata. Archived reasons and fingerprints are selected explicitly for the typed services. Typed DTOs project only the fields needed for review. See `D:/SchoolManagementSystem/backend/src/models/parentLeaveApplication.ts:190` and `D:/SchoolManagementSystem/backend/src/services/parent-leave-review-history.ts:17`.

## F. Typed Principal request-changes contract

`POST /api/principal/parent-leave-reviews/:approvalId/decisions` accepts `request_changes`, the quoted application revision and approval version, a stable operation ID, and an NFC-normalized explanation of 10–500 characters. With the pending reciprocal pair and current authority revalidated, the transaction moves both records to `changes_requested`, appends both events, records the actual reviewer and writes the decision receipt. Returning a record for changes keeps its current reservation even when a date correction is needed. Approve/reject retain the G3b coverage validation. Request changes writes no attendance or notification records.

## G. Parent resubmission contract

`POST /api/parent/me/children/:studentId/leave-applications/:applicationId/resubmit` accepts only `leaveType`, `startDate`, `endDate`, `reason`, `applicationRevision`, `approvalVersion` and `clientOperationId`. It requires the original requester, current independently verified relationship, eligible verifier, exact active enrollment and academic provenance, and compatible current routing. The transaction checks both versions, archives the old content, saves the normalized replacement, updates the approval's submitted revision and appends both events. Only the approval's current reviewer fields are cleared as it re-enters pending review. An authorized replay returns the original operation acknowledgement and a separately scoped read of current detail. See `D:/SchoolManagementSystem/backend/src/routes/parent-leave-draft.routes.ts:110` and `D:/SchoolManagementSystem/backend/src/services/parent-leave-resubmission.service.ts:42`.

## H. Atomic reservation replacement

The service checks the full inclusive school-local range against the exact pinned enrollment and academic period, all other active Parent reservations for the student, and pending or approved Teacher-origin reservations. The shared persisted Branch lock serializes these checks with G2b/G3b and Teacher leave writes. Only the current application's own reservation is excluded. Its old range stays reserved until commit. The old range, approval and history remain intact on failure.

## I. Idempotency and rollback design

The Principal receipt extends the existing enum with `request_changes`. The existing decision fingerprint format and uniqueness apply to all three actions. Parent resubmission uses the G2b requester/operation identity and a kind-specific fingerprint binding the linked IDs, both expected versions and normalized revised content. The receipt records requester, student, Branch, IDs, kind, expected versions, committed revision and cycle. Conflicting reuse is a 409, and replay still requires current authority and compatible routing. An older receipt cannot change the current cycle. All application, approval and receipt writes share one transaction. Existing indexes cover both new actions.

## J. Cross-process concurrency results

| Real replica-set scenario | Result |
| --- | --- |
| Request changes against approve, reject and withdrawal, each in both lock orders | Six cases passed. Only the winning transition committed. |
| Competing returns and competing resubmissions | Three cases passed. Competing returns and distinct resubmissions committed once. Duplicate resubmission returned the same committed outcome without a second history event. |
| Resubmission against a second guardian's submission and Teacher leave, each in both lock orders | Four cases passed. Each winner retained the date reservation. |
| Committed enrollment transfer and verified-link revocation during a resubmission attempt | Two cases passed. Resubmission was concealed and its receipt and revised content were absent. |
| Application, approval and receipt failure injection for both actions | Six cases passed. Both linked records and the old reservation rolled back together. |

The suite forks independent Node workers for the races. It also covered stale Principal versions, replay after later cycles, routing-version rejection, replay after link revocation, eventual approve and reject, and repeated cycles followed by G2b withdrawal. See `D:/SchoolManagementSystem/backend/tests/parent-leave-decision.security.test.ts:805`, `:980`, `:1187` and `:1228`.

## K. Privacy and RBAC checks

The typed pending queue and dashboard count use the same eligible pending selection. Detail reads include authorized returned requests. Historical private evidence appears only in typed Principal or owning-Parent detail. Decision versions are issued only for manageable pending requests and resubmission versions only for eligible returned requests. Existing generic decision routes remain denied. The focused G3c test also exercised denied generic detail, delegate and requester resubmission reads, out-of-enrollment revised dates, and identical persisted physical attendance marks and sessions before and after both actions. It confirmed zero new coverage and notifications. Eventual typed approval after resubmission creates exactly one Parent-origin coverage record for the revised range.

## L. Frontend implementation

- Principal review extends the existing confirm-and-retry workflow with Request Changes, server-provided versions and a required explanation. It refreshes scoped typed detail and uses the existing queue/dashboard refresh path. A conflict reloads detail. Current authorization denials conceal data, and stale responses are ignored across scope or focus changes.
- Parent detail shows the actionable Principal reason and read-only submitted evidence beside a separate working copy. The Parent confirms before resubmitting. Uncertain transport failures retain the operation ID and form. Conflicts refresh scoped detail and require review before another attempt. Account, token, role, Branch, child and screen scope protect against stale responses. Current 401/403/404 clears protected detail and working data.

## M. Exact changed files

| Category | Paths |
| --- | --- |
| Backend models (3) | `D:/SchoolManagementSystem/backend/src/models/parentLeaveApplication.ts`, `D:/SchoolManagementSystem/backend/src/models/parentLeaveDecisionOperation.ts`, `D:/SchoolManagementSystem/backend/src/models/parentLeaveOperation.ts` |
| Backend routes and services (7) | `D:/SchoolManagementSystem/backend/src/routes/parent-leave-draft.routes.ts`, `D:/SchoolManagementSystem/backend/src/services/attendance-parent-leave.service.ts`, `D:/SchoolManagementSystem/backend/src/services/parent-leave-draft.service.ts`, `D:/SchoolManagementSystem/backend/src/services/parent-leave-lifecycle.service.ts`, `D:/SchoolManagementSystem/backend/src/services/parent-leave-review.service.ts`, `D:/SchoolManagementSystem/backend/src/services/parent-leave-resubmission.service.ts`, `D:/SchoolManagementSystem/backend/src/services/parent-leave-review-history.ts` |
| Mobile screens and services (4) | `D:/SchoolManagementSystem/src/screens/parent/ParentLeaveApplicationsScreen.tsx`, `D:/SchoolManagementSystem/src/screens/principal/PrincipalParentLeaveReviewScreen.tsx`, `D:/SchoolManagementSystem/src/services/parent/leaveApplicationService.ts`, `D:/SchoolManagementSystem/src/services/principal/parentLeaveReviewService.ts` |
| Tests and worker (4) | `D:/SchoolManagementSystem/backend/tests/parent-leave-decision.security.test.ts`, `D:/SchoolManagementSystem/backend/tests/helpers/parent-leave-decision-worker.ts`, `D:/SchoolManagementSystem/__tests__/parent-leave-applications.test.tsx`, `D:/SchoolManagementSystem/__tests__/principal-parent-leave-review.test.tsx` |
| Report (1) | `D:/SchoolManagementSystem/docs/integration/pr-g3c-parent-leave-change-resubmission.md` |

## N. Exact test commands, exit codes and counts

Backend commands ran in `D:/SchoolManagementSystem/backend`. Each count below is for its own invocation.

| Run | Exit | Pass | Fail |
| --- | ---: | ---: | ---: |
| Baseline | 0 | 133 | 0 |
| Integration and replica-set races | 0 | 191 | 0 |
| Authorization, startup and domain regressions | 0 | 365 | 0 |
| Final focused physical attendance and generic bypass regression | 0 | 1 | 0 |

```powershell
# Baseline
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-review.security.test.ts tests/parent-leave-decision.security.test.ts tests/attendance-amendment.security.test.ts
# Integration
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/parent-leave-decision.security.test.ts tests/parent-leave-review.security.test.ts tests/attendance-amendment.security.test.ts tests/principal-attendance.security.test.ts
# Regressions
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/parent-scope.security.test.ts tests/student-enrollment.security.test.ts tests/teacher-attendance.security.test.ts tests/development-startup.security.test.ts tests/bootstrap.security.test.ts
# Final focused test added after the integration invocation started
.\node_modules\.bin\tsx.cmd --test --test-name-pattern='G3c protects existing' tests/parent-leave-decision.security.test.ts
# Backend TypeScript
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json
```

The regression group includes the actual startup readiness/index gate, the required MongoDB unique indexes and durable receipts. Backend TypeScript exited 0.

Mobile and static checks ran in `D:/SchoolManagementSystem`. The final isolated Jest run exited 0 with 156 passes and 0 failures across 10 suites. The initial run overlapped with the replica-set runs and exited 1 with 154 passes and one timeout in the existing Principal approval workspace test. The isolated run passed that test with the original timeout and included the final Parent stale-response case.

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/principal-parent-leave-review.test.tsx __tests__/principal-approval-context.test.tsx __tests__/principal-attendance.test.tsx __tests__/attendance-amendment.test.tsx __tests__/auth-session.test.tsx __tests__/chat-navigation.test.tsx
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json
$paths = @(git -c core.safecrlf=false diff --name-only) + @(git ls-files --others --exclude-standard)
.\node_modules\.bin\eslint.cmd --max-warnings=0 ($paths | Where-Object { $_ -match '\.tsx?$' })
git -c core.safecrlf=false diff --check
git diff --cached --check
foreach ($path in $paths) {
  if (Select-String -LiteralPath $path -Pattern '[ \t]+$' -Quiet) { throw "Trailing whitespace in $path" }
}
```

Mobile-scoped TypeScript, strict scoped ESLint and whitespace checks exited 0. The index is empty.

## O. Remaining Phase G work

Medical evidence storage, notifications, early pickup and custody, and administrative closure of stranded requests remain separate. A routing version change strands an older case until compatible configuration is restored or an authorized administrative policy exists. The deployment must keep routing consistent across processes. Production and physical-device verification are separate.

## P. Final verdict

PASS. The verified flows preserve the original approval/application IDs and immutable submitted evidence. The two new actions share the existing Branch lock, exact version checks and transaction, and preserve G3b attendance behavior. All 19 changes are unstaged.
