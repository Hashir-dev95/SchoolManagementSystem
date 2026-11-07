# G4c Part 1 — Pickup authorization backend

## A. Verified Git baseline and feature branch

The preflight confirmed a clean worktree and empty index on `integration/team-merge` at `3aceff7914dff843c304238181a9c7c0704a6316`, the committed G4b foundation. The requested feature branch was absent from local and remote-tracking refs. The authorized `git switch -c feature/g4c-pickup-authorization` created the local feature branch from that checkpoint. HEAD remains the same G4b commit. The changes are uncommitted and unstaged. No upstream synchronization is claimed for the new local branch.

## B. HIRA PDF and Faraz evidence

The actual local PDF at `C:/Users/Laptop Valley/OneDrive/Documents/Hira_School_App_Features.pdf` was read on pages 10, 51, 56 and 72.

| Page | Applied requirement |
| --- | --- |
| 10 | Current Principal review scope, requester separation, status revalidation, safe retries, explanations and history. |
| 51 | Current school-verified Parent-child relationship and concealment of unrelated Student IDs. |
| 56 | Proposed persons and requested validity remain separate from school verification and current custody authority. |
| 72 | Physical gate confirmation and token verification remain separate future operations. |

The committed G4b report was reviewed. Its blocked Verified custody transition and disabled operational Gate permissions remain intact.

The actual local donor is `D:/Faraz-Reference` at `293966bf7f477bd430133e91d9a87d75523782f4`.

| Donor evidence | Disposition |
| --- | --- |
| `src/mobileApp/roles/parent/ParentApplicationsPage.jsx:181` | Adapt selected-child operation context, understandable status/history and uncertain-operation concepts. Backend receipts provide the safe retry contract. |
| `src/mobileApp/roles/parent/ParentTransportPage.jsx:114` | Its pickup view opens the generic applications page. Reject that domain routing for custody authority. |
| `src/mobileApp/roles/parent/ParentWorkspaceUI.jsx:17` | Selected-child and feedback presentation remain a Part 2 reference. No UI code was added. |
| `backend/src/applicationService.js:24` | Reject class-Teacher routing and free-text application authority. |
| `backend/src/applicationReviewRoutes.js:29` | Retain the useful explanation/history concept through canonical typed transactions. Reject generic status mutation and separate notification production. |
| `backend/src/parentRoutes.js:395` | Replace the donor's generic application contract with current canonical verified-child scope and exact provenance. |

No donor authentication, model, approval engine or application route was imported.

## C. Model/index contracts

All new models are in `D:/SchoolManagementSystem/backend/src/models/pickupAuthorization.ts`.

| Model | Contract |
| --- | --- |
| PickupPerson | Student/Branch/original requester/link/exact enrollment/academic provenance are immutable. Name, relationship and private phone are proposed data. Parent revisions and chronological audit are protected. Verification remains Proposed. |
| PickupAuthorization | One private proposal per newly proposed person. Pins original provenance and the policy record/revision. Holds requested dates, private notes, state, revision, reciprocal approval identity, current submission and cycle. Operational state stays Inactive. Revocation/suspension fields are reserved for a later approved contract. |
| PickupSubmission | Separate immutable submitted payload and fingerprint, actor/source IDs, application/person revisions, cycle, submission time, routing version and custody-policy binding. Old content is retained when the current person or requested dates change. |
| PickupCustodyPolicy | Branch-unique persisted dependency created as an Unconfigured, activation-disabled sentinel. This is a system record of missing approved policy. It represents no school verification. No policy activation/configuration API exists. |
| PickupOperation | Immutable actor/operation identity, action, Branch/Student/resource IDs, expected application/person/approval revisions, payload fingerprint and original committed acknowledgment. |

Names and phone numbers are not global identity keys. Each creation makes a new proposed-person/authorization pair. Separate operation IDs may create separate proposals without asserting that two matching names identify the same person.

| Index | Purpose |
| --- | --- |
| Parent/requester + Student + Branch + state/date | Bounded private lists and histories. |
| Unique authorization pickupPersonId | One proposal pair per person record in this slice. |
| Unique typed approval entityId, partial by pickup entity | Exactly one canonical approval per authorization. |
| Unique authorization approvalRequestId, partial for ObjectId | Reciprocal approval identity uniqueness. |
| Branch + state + creation time | Typed review candidates. |
| Branch + Student + operational state + requested end date | Current authorization lookup support. |
| Unique submission authorizationId/cycle and authorizationId/applicationRevision | Immutable review-cycle uniqueness. |
| Unique actorId/clientOperationId | Durable idempotency across all pickup actions for an actor. |
| Unique policy Branch | One current policy dependency identity. |

All required indexes are initialized before the listener through the existing startup gate. The startup regression and new suite assert actual indexes under `autoIndex: false`.

## D. Exact typed API endpoints

All responses use the existing `{success, data}` envelope. Dates use canonical school-local `YYYY-MM-DD` strings. Phone is bounded contact data and establishes no identity verification.

The payload fields are `fullName` (2–100), `relationship` (2–80), `phone` (7–30), `validFromDate`, `validUntilDate`, and optional `notes` (up to 500). Dates must be valid, ordered and inside the pinned current enrollment/academic provenance. No school authorization-duration policy is inferred from that input validation.

Parent prefix is `/api/parent/me/children/:studentId/pickup-authorizations`.

| Method/path | Request |
| --- | --- |
| GET `/` | Optional bounded `offset` and `state`. Returns `items` and `nextOffset`. |
| GET `/:authorizationId` | Exact owned detail with no query/body. |
| POST `/` | Payload and `clientOperationId`. Returns 201 after commit. |
| PATCH `/:authorizationId` | Payload, `applicationRevision`, `personRevision`, operation ID. Draft only. |
| POST `/:authorizationId/submit` | Application/person revisions and operation ID. Requires explicit valid review routing. |
| POST `/:authorizationId/withdraw` | Application/person/approval versions and operation ID. Pending only. |
| POST `/:authorizationId/resubmit` | Revised payload, all three versions and operation ID. Changes Requested only, with atomic content replacement and submission. |

Principal prefix is `/api/principal/pickup-authorizations`.

| Method/path | Request |
| --- | --- |
| GET `/` | Optional bounded offset. Pending typed queue only. |
| GET `/:approvalId` | Current authorized typed detail and safe history. |
| POST `/:approvalId/decisions` | `action`, all three expected versions, operation ID, and a 10–500 character normalized `decisionReason` for Reject/Request Changes. |

`approve` is accepted as a typed action but denied with 403 in this phase. `reject` and `request_changes` are implemented with current authority and transactions.

Unknown fields, attachments, authoritative identities, Branch selectors, verification flags and timestamps are rejected. Errors are 401 for invalid session/current identity, 403 for role/category/activation denial, concealed 404 for unavailable objects, 409 for stale/incompatible state and 503 for unavailable review routing.

## E. Parent verified-child scoping

The implementation reuses `authorizeParentApplication` and `withParentApplicationWriteAuthority` without changing their existing Parent Leave behavior. Calls omit the leave-specific application parameter and independently enforce exact pickup resource ownership.

Every scope derives the original requester, Student, Branch, verified relationship, exact enrollment, academic period, Class and Section from canonical persisted facts. The registered session, current active Parent role, independent verifier, Student identity and academic relationships are rechecked. Writes take the persisted Branch lock and fence those dependencies. Reads check the current Parent proof before and after the snapshot.

A second verified guardian sees their own proposals and cannot retrieve or modify the first guardian's private proposal. Closing, replacing or transferring enrollment invalidates the old proposal's current scope. Records and submitted evidence remain stored. No legacy profile placement fallback is used.

## F. Principal/category authorization

The typed reviewer must have a current registered Principal session, persisted active Principal role, active own Branch, current approvals view/manage permissions where applicable and an explicit `pickup_authorization` category grant in canonical `PRINCIPAL_APPROVAL_AUTHORITY` configuration. Existing leave or safety grants provide no pickup category authority.

`PICKUP_AUTHORIZATION_ROUTING_POLICY` is a separate, opt-in server configuration using the strict fields `policy`, `version`, `enabled` and `branchIds`. The supported policy value is `shared_branch_principal`. It becomes usable only when explicitly configured for the Branch and a current eligible Principal has the category grant. Missing or invalid configuration blocks submission/relevant review. Its default is disabled. This supported routing mechanism is an implementation choice for explicit school configuration, not an assertion that HIRA has approved a custody review policy.

Submitted routing versions must remain compatible. At the final write boundary, routing/grants and policy binding are checked again. Deployment configuration must be consistent across workers, following the existing canonical approval configuration model.

Principal reads repeat current reviewer checks and repeat the original Parent/enrollment proof after the read snapshot. Current relationship revocation therefore conceals a slow response as well as the next request.

## G. Canonical ApprovalRequest integration

The dedicated entity/category is `pickup_authorization`. Submission creates exactly one linked ApprovalRequest in the same transaction as the immutable submission, authorization revision and receipt. Resubmission reuses both original IDs. The canonical approval points to the current submitted application revision.

Generic reads, pending queues, decisions, delegate discovery/delegation and requester resubmission retain their typed-workflow guards, extended for pickup. Public generic routes cannot change this entity. Typed decisions preserve the actual reviewer/time/reason and mirror the application history exactly.

The existing dashboard's exhaustive category map gains a zero initializer for the new type. Its generic approval counts continue to exclude pickup records. Part 2 should use the dedicated paginated queue for pickup cards. This part adds no combined pickup dashboard count or UI.

## H. Immutable history and idempotency

Application/person audit prefixes are protected, revisions are monotonic, and each submitted cycle stores the exact proposed person, phone, dates and notes independently of mutable current fields. Graph reads validate source links, payload fingerprints, cycle order, current submitted revision, approval status and mirrored actor/reason/timestamps. Tampered evidence is rejected.

Submitted or returned payloads cannot be changed by draft PATCH. Returned content is replaced only during atomic resubmission. Reject or withdrawal does not delete history. Current reviewer metadata is reset when re-entering Pending, while old decision events remain immutable.

Receipts bind the action, resources, all expected versions and normalized content. Authorized same-operation replay returns the original acknowledgment plus a fresh scoped resource projection. Earlier-cycle replay cannot mutate the current cycle. Conflicting reuse returns 409. Replays after role/session/relationship/enrollment/policy revocation remain denied. Receipt and history DTOs explicitly whitelist fields, including on replay, so raw stored metadata is never forwarded.

An authorized Parent may withdraw their pending proposal when review routing becomes unavailable. That safe invalidation still requires current ownership/provenance, current persisted policy binding and exact versions. It requires no new reviewer selection.

## I. School-policy fail-closed boundaries

No compatible approved custody-verification implementation exists in the baseline. The new sentinel policy stays Unconfigured. G4b's Verified custody write restriction and `requireAutomatedReleaseAuthority` remain intact. Proposed persons cannot be verified or activated through this API.

Every eligibility projection reports `operationallyEligible: false`, unverified identity and Unknown/Hold custody as appropriate. It includes safe blocked reasons and policy revision. `policyBindingCurrent` and `reviewRoutingState` distinguish stale policy, configured routing, missing routing and routing revision mismatch without exposing grants or custody evidence.

Principal capability DTOs expose only safe Reject/Request Changes actions for current manageable Pending records, and `canApprove: false`. Approval requests cannot convert unverified Parent claims into school authority. Unknown/Hold, absent approved policy, stale provenance and incompatible revisions never authorize collection. Even a mistakenly broadened generic Gate permission does not bypass G4b's operational phase guard.

No QR/OTP, identity-evidence upload, early-exit, physical entry/exit, emergency or offline release, attendance effect or notification production was added.

## J. Concurrency and rollback evidence

The new suite uses only the existing owned in-memory MongoDB replica-set fixture, with automatic index creation disabled. It never loads the development database configuration.

Thirteen independent-process cases cover competing same/different-nonce submissions, two distinct explicitly granted Principals, both withdrawal/decision orders, both Request Changes/resubmission orders, committed relationship/enrollment/session/role revocation during an attempt, and both Custody Hold/approval orders. MongoDB's persisted Branch lock provides serialization.

Fifteen failure-injection cases throw after a person, authorization, approval, submission or receipt write, depending on the lifecycle action. Every linked record is compared to its pre-attempt state. Rollback leaves no orphan approval, duplicate cycle, lost version or active authorization. Additional tests change routing or revoke the category grant after staged writes and verify transactional rollback.

The suite also checks direct generic bypasses, real foreign Principal scope, forged reciprocal IDs, historical evidence corruption, version conflicts, creation/edit/decision replay, repeated cycles, disabled-routing withdrawal, explicit receipt projection and exact preservation of stored Parent Leave, attendance, corrections and notification records.

## K. Security/regression test results

Counts are per invocation and overlap. They must not be added together as unique test counts.

| Invocation | Exit | Passed | Failed |
| --- | ---: | ---: | ---: |
| Pre-change G4b/Parent/approval baseline | 0 | 88 | 0 |
| Initial pickup contract suite | 1 | 19 | 1 |
| Pickup security/race/rollback gate before final read refinements | 0 | 52 | 0 |
| Full backend regression gate | 0 | 728 | 0 |
| Final pickup gate after explicit DTO projections | 0 | 58 | 0 |

The initial contract test used a nonexistent generic decision URL. It was corrected to test the actual guarded PATCH endpoint and the actual `/pending` queue. No runtime authorization or existing assertion was relaxed. The final regression gate includes 19 backend files and all required G1–G3c, G4b, Parent scope, approval, session/RBAC, enrollment, attendance and real startup/index regressions.

The final pickup invocation covers the additional replay-whitelist case and the final acknowledgement/history DTO projections. The full regression invocation includes 57 pickup cases that overlap this final suite. The final focused gate has 58 passes, zero failures and zero skipped tests. Its counts are separate from the full regression invocation.

Backend TypeScript and strict scoped ESLint each exited 0 with no diagnostics or warnings. Tracked/staged diff checks and explicit whitespace checks across all 20 changed/new paths exited 0. The exact scope check confirmed 10 tracked modifications, 10 new files, an empty index and unchanged HEAD/integration baseline. No generated validation files are included.

### Exact commands

Backend commands run in `D:/SchoolManagementSystem/backend`.

```powershell
# Baseline
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/gate-foundation.security.test.ts tests/parent-scope.security.test.ts tests/approval-authority.security.test.ts
# Full regression gate
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-review.security.test.ts tests/parent-leave-decision.security.test.ts tests/parent-scope.security.test.ts tests/teacher-scope.security.test.ts tests/student-enrollment.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/teacher-attendance.security.test.ts tests/principal-attendance.security.test.ts tests/attendance-amendment.security.test.ts tests/development-startup.security.test.ts tests/bootstrap.security.test.ts tests/teacher-provisioning.security.test.ts
# Pickup suite, also used for the final projection verification
.\node_modules\.bin\tsx.cmd --test tests/pickup-authorization.security.test.ts
# Backend TypeScript
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json
```

Repository checks run in `D:/SchoolManagementSystem`.

```powershell
$paths = @(git -c core.safecrlf=false diff --name-only) + @(git ls-files --others --exclude-standard)
.\node_modules\.bin\eslint.cmd --max-warnings=0 ($paths | Where-Object { $_ -match '\.ts$' })
git -c core.safecrlf=false diff --check
git diff --cached --check
foreach ($path in $paths) {
  if (Select-String -LiteralPath $path -Pattern '[ \t]+$' -Quiet) { throw "Trailing whitespace in $path" }
}
git status --short --branch
git diff --cached --name-only
```

Part 1 changed no React Native source. Native builds, physical devices, production connectivity and operational school custody approval were not verified.

## L. Exact changed/new files

All paths are relative to `D:/SchoolManagementSystem`.

| Category | Paths |
| --- | --- |
| Existing backend integration (8) | `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/models/approvalRequest.ts`, `backend/src/routes/parent-self.routes.ts`, `backend/src/routes/principal.routes.ts`, `backend/src/services/approval-request.service.ts`, `backend/src/services/approval-resubmission.service.ts`, `backend/src/services/principal-dashboard.service.ts` |
| Existing regression contracts (2) | `backend/tests/development-startup.security.test.ts`, `backend/tests/principal-authorization.security.test.ts` |
| New model and router (2) | `backend/src/models/pickupAuthorization.ts`, `backend/src/routes/pickup-authorization.routes.ts` |
| New domain services (5) | `backend/src/services/pickup-authorization.policy.ts`, `backend/src/services/pickup-authorization-access.service.ts`, `backend/src/services/pickup-authorization-read.service.ts`, `backend/src/services/pickup-authorization-write.service.ts`, `backend/src/services/pickup-authorization-review.service.ts` |
| New verification (2) | `backend/tests/pickup-authorization.security.test.ts`, `backend/tests/helpers/pickup-authorization-worker.ts` |
| Report (1) | `docs/integration/pr-g4c1-pickup-authorization-backend.md` |

The startup test adds required index assertions. The Principal regression's exact empty category map adds the new zero category. All previous authority assertions remain. Existing source edits are narrow insertions or typed-guard extensions.

## M. Outstanding decisions for Lead Engineer

School identity verifiers and acceptable evidence, guardian consent and disputed-custody precedence, authorization duration/restrictions, revocation rights, evidence access/retention, reviewer delegation and emergency collection remain unapproved. No activation path is enabled by this implementation.

Review routing must be explicitly configured and granted before a school uses submission or review. Consistent per-process canonical grant/routing configuration remains a deployment requirement. The inherited private HTTP API origin is a separate operational deployment blocker and was not changed.

Lead Engineer review and a separate checkpoint commit of Part 1 must precede Part 2. G4c UI/Developer Preview, early exit, verification tokens and physical Gate operations remain subsequent scopes.

## N. Assessment

PASS — G4c Part 1 backend implemented and verified within the deliberate school-policy boundary. Parent ownership/current authority, typed Principal category grants, immutable review cycles, reciprocal approval identity, receipts, indexes, rollback and independent-process races pass. Existing G1–G4b, session/RBAC, enrollment, attendance and startup checks pass.

Approval and operational activation remain intentionally denied. There is zero new physical pickup/checkout capability. Implementation readiness does not imply operational school custody approval.

All 20 changes remain unstaged and uncommitted on `feature/g4c-pickup-authorization` at `3aceff7914dff843c304238181a9c7c0704a6316`. The index is empty. No push or merge occurred. React Native, Developer Preview, API origin configuration, dependency manifests/locks and the G4b Gate foundation are preserved. Part 2 requires Lead Engineer review and a separate checkpoint commit.
