# G4d Part 1 — Secure Early Exit Backend

## A. Baseline and specification

Work began on a clean `integration/team-merge` worktree with an empty index at `49fc00ce6d7f2bc7c7eb36777ce10345dc85288c`. `git fetch origin` succeeded. The fetched integration ref matched that SHA. GitHub PR #2 metadata independently confirmed its merged state, target `integration/team-merge`, merge SHA, and G4c final-fix head `3d713bfb69f80a3df829b06242717bf327f50651`. Both the merge and G4c fix ancestry were verified before creating `feature/g4d-early-exit-requests` from `origin/integration/team-merge` with `--no-track`. No changes were discarded.

The authoritative local `Hira_School_App_Features.pdf` at `C:/Users/Laptop Valley/OneDrive/Documents/Hira_School_App_Features.pdf` was inspected on pages 10, 51, 56 and 72. It is the specification/MVP; no separate MVP is assumed.

| PDF page | Requirement and implementation boundary |
| --- | --- |
| 10 | Principal actions require Branch/category authority, current status, requester separation and retained history. Early Exit uses canonical ApprovalRequest through typed handlers. |
| 51 | Contact details alone do not establish child access. Every Parent operation uses the current independently verified ParentStudentLink and exact StudentEnrollment. |
| 56 | Early Exit has reason, date and request state. School-approved identity/custody verification is a separate prerequisite for collection. This slice stores only an exit-date proposal and private reason. |
| 72 | Actual exit is a distinct staff-confirmed event with operator/time/person provenance. No physical event, token, checkout or notification is produced by this slice. |

The PDF does not establish a permitted release time/window, collector selection for an Early Exit request, attachment policy, emergency exception, overlapping-proposal rule or approved school verification contract. None is invented. Dates are valid civil dates within the current academic period and not before the pinned enrollment's effective start, using the existing school-timezone utilities. This is provenance validation, not an approved school departure-hours or notice-period policy. There is no new prohibition on historical proposals or additional maximum-duration rule.

## B. Exact changed files (18)

| Category | Paths |
| --- | --- |
| New models (1) | `backend/src/models/earlyExitRequest.ts` |
| New typed API (1) | `backend/src/routes/early-exit.routes.ts` |
| New domain services (3) | `backend/src/services/early-exit-authority.service.ts`; `backend/src/services/early-exit-read.service.ts`; `backend/src/services/early-exit-write.service.ts` |
| Canonical wiring/model/guards (8) | `backend/src/app.ts`; `backend/src/models/approvalRequest.ts`; `backend/src/routes/parent-self.routes.ts`; `backend/src/routes/principal.routes.ts`; `backend/src/server.ts`; `backend/src/services/approval-request.service.ts`; `backend/src/services/approval-resubmission.service.ts`; `backend/src/services/principal-dashboard.service.ts` |
| New security verification (2) | `backend/tests/early-exit.security.test.ts`; `backend/tests/helpers/early-exit-worker.ts` |
| Existing regression extensions (2) | `backend/tests/development-startup.security.test.ts`; `backend/tests/principal-authorization.security.test.ts` |
| Handoff (1) | `docs/integration/pr-g4d1-early-exit-backend.md` |

The dashboard change only initializes the new exhaustive approval-type count to zero. Typed Early Exit requests remain excluded from generic approval queues/counts. The existing Principal assertion adds that zero category without weakening any privacy assertion. No dashboard feature, mobile source, dependency, environment file, G4b/G4c domain source or unrelated module is changed. The separately tracked historical G2b artifact is untouched.

## C. Models, history and index readiness

All original requester/Student/Branch/ParentStudentLink/StudentEnrollment/AcademicPeriod/Class/Section identities are immutable.

| Model | Responsibility |
| --- | --- |
| EarlyExitRequest | Mutable current date/reason only during Draft edit or typed resubmission; state, application revision, immutable approval identity after first submit, current snapshot/cycle and append-only private history. Strict schema and optimistic concurrency. No approved state. |
| EarlyExitSubmission | Separate immutable exact date/reason, original provenance, linked approval, application revision, cycle, routing version, fingerprint and submission time for every submitted cycle. |
| EarlyExitOperation | Separate durable immutable actor/nonce/action/resource/Branch/Student receipt and payload fingerprint. Creation receipts are never overwritten by edits or later lifecycle actions. Stored results are never returned without an explicit whitelist. |
| ApprovalRequest | Existing canonical decision record, typed `early_exit_request` entity/category and source `earlyExitRevision`. Its history mirrors submission, changes requested, resubmission, rejection or withdrawal. |

Required indexes:

- Parent/requester + Student + Branch + creation time, and Branch + state + creation time.
- `early_exit_reciprocal_approval_unique`: unique partial source approval reference.
- `early_exit_submission_cycle_unique`: unique request/cycle.
- `early_exit_submission_revision_unique`: unique request/submitted revision.
- `early_exit_actor_operation_unique`: unique actor/clientOperationId.
- `one_approval_per_early_exit`: unique typed ApprovalRequest entity identity.

`ensureEarlyExitIndexes()` explicitly creates the new indexes and canonical approval indexes. Startup follows the already-established sequence, rather than adding a new boot mechanism: `backend/src/server.ts:66–70` awaits Parent Leave, Gate, Pickup and Early Exit initialization before `app.listen` at line 88. Errors prevent readiness. The real-server regression verifies unique indexes with automatic indexing disabled; the focused domain suite verifies every new unique index and repeat initialization.

## D. Endpoint and DTO contracts

Every path below is under `/api`. Parent base `P` is `/parent/me/children/:studentId/early-exit-requests`; Principal base `R` is `/principal/early-exit-requests`.

Normalized proposal fields `F`: `exitDate` (`YYYY-MM-DD`) and `reason` (NFC, trimmed, 1–500 characters). Write operation ID `N`: `clientOperationId`, trimmed 1–120 characters, durable and unique per actor in this domain. Revisions are nonnegative safe integers below MAX_SAFE_INTEGER.

| Method/path | Accepted input | Result |
| --- | --- | --- |
| GET P | Optional `offset`, `state` | Current owner's authorized child-specific summary history; up to 20 items and nextOffset. |
| GET P/:requestId | No query/body | Authorized original owner's private detail/history. |
| POST P | F + N | Create Draft; 201, including replay acknowledgment. |
| PATCH P/:requestId | F + N + applicationRevision | Draft-only edit. |
| POST P/:requestId/submit | N + applicationRevision | Draft → Pending and first linked approval/snapshot. |
| POST P/:requestId/withdraw | N + applicationRevision + approvalVersion | Pending → Withdrawn, with linked approval invalidation. |
| POST P/:requestId/resubmit | F + N + applicationRevision + approvalVersion | Changes Requested → Pending, same original approval, new immutable snapshot. |
| GET R | Optional `offset` | Own-Branch, current-category-authorized Pending queue. |
| GET R/:approvalId | No query/body | Typed reciprocal detail with Student/requester context, private proposal/history and decision versions. |
| POST R/:approvalId/decisions | N + applicationRevision + approvalVersion + action, and decisionReason for reject/request_changes | `reject` or `request_changes`; trimmed NFC reason 10–500 characters. `approve` is recognized but always denied 403 by a separate school-approval policy gate. |

No input accepts Branch, role, requester, enrollment, approval identity, verified-person claims or release-token fields. Unknown fields, write queries and unsupported read bodies are rejected. IDs are validated and then object-scoped. Errors are sanitized: 400 contract, 401 session, 403 role/permission/category/policy, 404 missing/foreign/unavailable scope, 409 revision/receipt/graph conflict, 503 unavailable configured review routing/transaction support. Unexpected internals produce a generic 500. Responses use no-store caching.

Parent summary whitelist: requestId, studentId, approvalId, exitDate, state, revision, createdAt, updatedAt, eligibility, reviewRoutingState and capabilities. Private detail additionally exposes reason, reviewVersion, safe history action/revision/time/decisionReason, and submitted cycle/revision/date/reason/time. It omits verification evidence, raw source documents, hashes, receipts and internal authority.

Principal queue adds only authorized Student identity/name/Branch/class/section and requester identity/name. It includes canonical linked approvalId for typed detail navigation. It omits private reason/history/snapshots until detail. Manageable Pending detail supplies decisionVersion; actions are limited to reject/request_changes. `canApprove` is always false.

Write acknowledgment whitelist: requestId, approvalId, operationRevision, operationState, operationCycle, replayed, plus a freshly authorized `request` DTO. A retry may acknowledge an earlier operation while the fresh DTO shows a later cycle; it never rewinds state. Clients must retain the same nonce, expected versions and normalized content after an uncertain response, and use a new nonce after a deliberate edit/new action.

## E. Authorization matrix

| Operation | Required current authority |
| --- | --- |
| Every HTTP entry | Valid signed unexpired JWT; registered, unrevoked session; persisted active user whose current role matches the token. |
| Parent list/detail | Current Parent in active own Branch; independently verified current ParentStudentLink and valid verifier; exact active enrollment/period/Class/Section; original requester and all pinned source identities for each record. Another guardian's valid link does not confer ownership. |
| Parent writes/replay | Same current authority; canonical `withParentApplicationWriteAuthority`, persisted Branch lock, registered-session and source-document write fences, fresh authority before callback and again before commit. Same-payload receipts never authorize revoked scope. |
| Principal queue/detail | Current Principal registered session, persisted active Principal role, active own Branch, current approval-view permission, explicit server category grant for early_exit_request and explicit Branch routing policy; requester separation; reciprocal graph; current original Parent-child/enrollment/verifier proofs. Proofs are rechecked after the read snapshot. |
| Principal decision/replay | All read authority plus current approval-manage permission, exact application/approval versions, Branch lock, reviewer session/user fences and source proof fences, current category/routing/subject rechecks; safe receipt replay. |
| Generic review/detail/delegation/resubmission | Explicit typed-entity guards reject Early Exit. Generic queues omit it. Category grant alone never authorizes a generic decision. |
| Approve/release | No enabling policy exists. Typed approval fails closed. G4b gate duty and automated-release guards remain unchanged. No collection authority can be produced. |

TeacherAssignment is not Parent or Principal decision authority and is never overwritten or used as a fallback. Source placement is the exact canonical StudentEnrollment, with no legacy/global fallback. Current relationship/role/Branch changes conceal access without deleting original requests, snapshots, receipts or history.

## F. Routing and missing school policy

The existing shared own-Branch Principal queue mechanism is reused through a separate explicit `EARLY_EXIT_ROUTING_POLICY` server configuration, default unavailable. Strict supported shape:

```text
{ policy: "shared_branch_principal", version: positive integer,
  enabled: true, branchIds: [explicit lowercase Branch ObjectIds] }
```

The server's existing `PRINCIPAL_APPROVAL_AUTHORITY` must separately grant `early_exit_request` to the current Principal in that Branch. Pickup/leave grants do not imply it. Submission/resubmission verifies at least one current eligible reviewer, fences reviewer records and rechecks the version before commit. Incompatible submitted routing versions block review/resubmission rather than rerouting existing history silently. Configuration must be consistent across server workers; changing this existing environment-based authority requires controlled deployment/restart. No live policy-administration system is added.

This opt-in routing contract is not a claim that school Early Exit approval policy has been approved. No production settings or principals were changed. Without valid routing, Draft access remains available but submission/review is unavailable. A current original owner can safely invalidate their unapproved Pending proposal even if routing is disabled; ownership/current provenance and exact versions remain required. Terminal rejection/withdrawal cannot be changed.

`requireEarlyExitApprovalPolicy()` (`early-exit-authority.service.ts:223`) always denies approval independently of physical release. Every eligibility DTO states `operationallyEligible:false`, `physicalReleaseAllowed:false`, `schoolPolicyState:"unconfigured"` and current `unknown`/`hold` custody. No invented Verified state, policy activation switch or Early Exit custody engine exists. G4b's `gate-authority.service.ts:257` remains a separate unchanged physical-release guard.

Lead Engineer/school decisions still required for operational approval: permitted review/approval criteria, current custody/identity verification source and authorizer, exact collector/pickup binding, date/time validity and expiration, revocation and emergency rules, retention/privacy policy, and distinct staff-confirmed checkout/token/outage/notification contracts. This slice does not implement those capabilities.

## G. Lifecycle, transactions and concurrency

```text
Draft --edit--> Draft
Draft --submit--> Pending
Pending --request_changes(reason)--> Changes Requested
Changes Requested --resubmit(revised payload)--> Pending
Pending --reject(reason)--> Rejected [terminal]
Pending --withdraw(original Parent)--> Withdrawn [terminal]
Pending --approve--> 403; no state or domain effect
```

The persisted Branch lock is canonical `withAcademicCatalogLock` (snapshot reads, primary, majority writes). Competing processes conflict/retry against committed state; no in-memory mutex substitutes for database serialization. Session/user/relationship/enrollment/verifier/academic dependencies are fenced to conflict with concurrent revocation.

Initial submit atomically creates one canonical ApprovalRequest, one immutable submitted cycle, the source transition/history and a separate operation receipt. Resubmission reuses the same approval, appends a new snapshot, resets current reviewer metadata and preserves prior reason/evidence/history. Source revision/state/approval identity and canonical approval version/status/source revision are compare-and-set. Withdrawal invalidates the linked Pending approval in the same transaction. Rejection/changes requested mirror reason, actor and time in source/approval history and persist the receipt atomically.

Graph reads validate reciprocal source/approval links, provenance, snapshot/cycle counts, payload fingerprints, submitted revision, status, chronological append-only source history, mirrored approval actor/reason/time and reviewer/withdrawal metadata. A malformed graph fails closed. Required unique indexes prevent duplicate approval/cycle/receipt identities.

The new suite has 11 independent-process race cases: same/different-nonce competing submissions (2), both withdrawal/decision orders (2), two separately granted Principals (1), both Request Changes/resubmission orders (2), and committed link/enrollment/session/role revocation before dependency fences (4). Workers connect independently to the real test replica set; IPC barriers hold the actual persisted Branch transaction lock and prove the second process attempted it.

Thirteen injected failures occur after actual persisted writes: create request/receipt (2); submit approval/snapshot/request/receipt (4); resubmit approval/snapshot/request/receipt (4); decision request/approval/receipt (3). Every linked collection is compared with its pre-attempt contents. Two more cases change routing or reviewer grant after staged writes to prove rollback. Unknown/Hold policy tests prove approval has no side effects on Pickup, Parent Leave, attendance sessions/marks/corrections or notifications. Existing Gate regressions separately cover forbidden operational routes. No generic approval, Gate event, token, attendance mutation or notification call is added.

## H. Validation

Final regression gate: **798 PASS, 0 FAIL, 0 cancelled/skipped/todo; exit 0**, across 20 backend test files. This includes 68 Early Exit cases and 730 existing G1–G4c/shared authority, enrollment, attendance and startup cases. The final same-child guardian setup strengthening was separately rechecked after the broad process loaded its test files; that invocation passed 1, failed 0, skipped 0, exit 0. Runtime source did not change during the broad invocation. Overlapping follow-ups are not added to 798 as unique coverage.

| Validation | Actual result | Exit |
| --- | --- | --- |
| Full backend regression command below | 798 passed; 0 failed/skipped | 0 |
| Selected Principal revocation/receipt/generic-bypass follow-up | 11 passed; 0 failed/skipped; overlaps full gate | 0 |
| Strengthened same-child guardian ownership follow-up | 1 passed; 0 failed/skipped; overlaps full gate | 0 |
| Backend TypeScript | No diagnostics | 0 |
| Strict scoped ESLint, all 17 changed/new TS paths | No errors or warnings | 0 |
| Git diff checks and explicit changed-file whitespace scan | No whitespace/conflict-marker issues | 0 |

The first isolated run found two new test setup assumptions: strict immutable fields reject save rather than silently ignoring it, and generic action payloads must obey the real route contract. The next run exposed a POST instead of PATCH in the generic-resubmission test. Tests were corrected to assert immutable rejection and exercise valid canonical HTTP contracts; no runtime authorization/assertion was relaxed. Initial TypeScript ObjectId/nullability diagnostics and a scoped lint unused import/no-shadow warning were corrected. The final gate uses the corrected full source/tests.

Backend test working directory: `D:/SchoolManagementSystem/backend`.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/early-exit.security.test.ts tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-review.security.test.ts tests/parent-leave-decision.security.test.ts tests/parent-scope.security.test.ts tests/teacher-scope.security.test.ts tests/student-enrollment.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/teacher-attendance.security.test.ts tests/principal-attendance.security.test.ts tests/attendance-amendment.security.test.ts tests/development-startup.security.test.ts tests/bootstrap.security.test.ts tests/teacher-provisioning.security.test.ts

.\node_modules\.bin\tsx.cmd --test --test-name-pattern='generic reads|current Principal|permission is required|Principal receipt' tests/early-exit.security.test.ts

.\node_modules\.bin\tsx.cmd --test --test-name-pattern='foreign Student/Branch' tests/early-exit.security.test.ts
```

The follow-up selected invocation passed 11 tests, failed 0, skipped 0, exit 0. It overlaps the final regression invocation and must not be added to its count.

Repository-check working directory: `D:/SchoolManagementSystem`.

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p backend/tsconfig.json

$lintPaths = @((git diff --name-only -- '*.ts'), (git ls-files --others --exclude-standard -- '*.ts')) | ForEach-Object { $_ } | Where-Object { $_ }
& .\node_modules\.bin\eslint.cmd --max-warnings=0 $lintPaths

git diff --check
git diff --cached --check
git status --short
```

Backend TypeScript and scoped strict ESLint each exited 0 with no diagnostics. The scope is the explicit 17 changed/new backend TypeScript files. Generated test logs remain under the system TEMP directory, outside Git. Tests use isolated disposable MongoMemoryReplSet databases and fixture credentials, never the real .env/database. Package/dependency installation was unnecessary.

Mobile/device/release/production-connectivity checks were not run: no mobile source or release configuration changes. Root/mobile TypeScript debt is outside this backend slice. The inherited cleartext LAN endpoint at `src/services/api/apiClient.ts:1` remains an independent deployment blocker; backend tests do not establish production transport readiness.

## I. Final self-check and handoff

Before checkpointing, inspect all tracked/untracked source/tests, enforce the exact 18-file inventory, validate whitespace including this initially untracked report, stage only those reviewed paths, inspect staged content/list and require an empty worktree after commit. Push only the new feature branch, verify remote SHA, and do not create a PR/merge automatically. Final commit and remote status are provided in the task handoff rather than inserting a self-referential commit SHA here.

Remaining Part 2: Parent typed API/mobile form/history/resubmission/retry and child/account/Branch isolation, Principal typed queue/detail/reject/changes-requested presentation, navigation and fictional read-only preview where approved, mobile regressions and explicit policy-blocked status. Backend list summary DTOs intentionally withhold private reason until authorized detail. Part 2 must not enable operational approval, verification, Gate checkout, QR/OTP or physical release.

Final security verdict: **PASS — G4d Part 1 backend implemented and verified within the explicit school-policy boundary.** Current Parent/Principal authority, original ownership, typed canonical approval linkage, immutable history/snapshots, revision/receipt conflicts, independent-process races, rollback and startup/index readiness pass with existing regressions. Operational Early Exit approval and real child collection remain blocked and are not certified by this verdict.

## J. Raw final regression output (last 20 lines)

~~~~text
✔ revoked assignment immediately removes roster access (944.9663ms)
✔ expired assignment immediately removes roster access (959.5131ms)
✔ future assignment immediately removes roster access (983.0689ms)
✔ current inactive change fails closed on roster and independent service call (644.7926ms)
✔ current role change fails closed on roster and independent service call (818.3523ms)
✔ current branch change fails closed on roster and independent service call (919.4959ms)
✔ current branch inactive change fails closed on roster and independent service call (834.9405ms)
✔ current permission change fails closed on roster and independent service call (777.6762ms)
✔ roster query/body injection never widens scope and malformed tuple IDs are sanitized (1257.7585ms)
✔ roster has independent authentication/role gates and no guessed learner detail surface (918.8407ms)
✔ roster reference changes invalidate authority and DB failure is sanitized (886.3988ms)
✔ roster resolves scope once and executes one aggregate regardless of learner count (945.6366ms)
ℹ tests 798
ℹ suites 0
ℹ pass 798
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 633170.6507
~~~~
