# G4c Part 2 — Pickup authorization mobile integration

## A. Baseline and checkpoint

The original Part 2 preflight verified repository `D:/SchoolManagementSystem`, branch `feature/g4c-pickup-authorization`, clean worktree, empty index and Part 1 checkpoint `59299658b220f5f703f58f5b75662cb78a0e2a3f` (`feat: add secure typed pickup authorization backend`). G4b `3aceff7914dff843c304238181a9c7c0704a6316` is an ancestor. No remote synchronization is claimed. No branch switch, commit, push or merge is part of this task.

On the 2026-11-08 continuation, the same Part 1 checkpoint and ancestry were reverified; `git show --check --oneline HEAD` passed and every required Part 1 module/test/report was present in the committed tree. The current worktree was intentionally **not clean**: it contained exactly the 23 pending Part 2 paths listed in section L, with an empty index and no unexpected path. The approved queue `approvalId` correction and regression coverage were already present and were preserved rather than applied a second time. No source or test rewrite was necessary during the continuation. The supplied Part 1 report remains separate and unchanged; this file is the complete Part 2 delivery report.

The brief's version assumptions differ from the committed manifests: this repository actually declares React Native **0.86.2**, React **19.2.3**, and React Navigation 7. Existing installed packages were used without dependency changes.

The authoritative local `C:/Users/Laptop Valley/OneDrive/Documents/Hira_School_App_Features.pdf` was read on pages 10 (scoped review, explanations, confirmation and history), 51 (verified Parent-child access), 56 (proposed persons, validity, school verification and custody separation) and 72 (physical gate confirmation as a separate operation). G4b and Part 1 implementation/report were inspected.

## B. Actual backend contract and approved correction

Paths below include `/api`; the canonical mobile API client already supplies that prefix. All successes are `{success:true,data:DTO}`, all failures `{success:false,message:string}` with an HTTP error status. Create returns 201; other listed successes return 200. No client-supplied requester, role, Branch, enrollment or verification fields are sent.

`Fields` = `fullName`, `relationship`, `phone`, `validFromDate`, `validUntilDate`, `notes` (backend permits omitted notes, mobile sends a string). `Version` = nonnegative `applicationRevision`, `personRevision`. `ReviewVersion` adds `approvalVersion`. Every write includes `clientOperationId`.

| Endpoint | Method | Body/query | DTO / effect |
| --- | --- | --- | --- |
| `/parent/me/children/:studentId/pickup-authorizations` | GET | `offset`, optional exact `state` | `{items,nextOffset}`, bounded 20-row page; original requester's current scoped records |
| same | POST | Fields + operation ID | Receipt + fresh detail; creates Draft only |
| same + `/:authorizationId` | GET | None | Private owned detail |
| same + `/:authorizationId` | PATCH | Fields + Version + operation ID | Draft edit only |
| same + `/:authorizationId/submit` | POST | Version + operation ID | Draft → Pending when configured reviewer routing permits |
| same + `/:authorizationId/withdraw` | POST | ReviewVersion + operation ID | Pending → Withdrawn; retains evidence |
| same + `/:authorizationId/resubmit` | POST | Fields + ReviewVersion + operation ID | Changes Requested → Pending; reuses existing authorization and approval |
| `/principal/pickup-authorizations` | GET | `offset` only | Dedicated pending queue `{items,nextOffset}`; explicit category/routing checks |
| same + `/:approvalId` | GET | None | Typed scoped review detail |
| same + `/:approvalId/decisions` | POST | ReviewVersion, action, decisionReason, operation ID | `reject` / `request_changes`; receipt + fresh review detail |

Parent summaries contain authorization/person/student IDs, state, both revisions, person's name/relationship, proposed dates, eligibility, capabilities, `policyBindingCurrent`, `reviewRoutingState`. They do **not** contain phone, notes, history, snapshots or update timestamps. Detail additionally contains phone, notes, `approvalId`, nullable `reviewVersion`, whitelisted history and submitted snapshots. The UI obtains last-update time from detail history; it does not invent a summary timestamp.

Parent capabilities are `canEditDraft`, `canSubmit`, `canWithdraw`, `canResubmit`. Principal capabilities replace them with `allowedActions: ('reject'|'request_changes')[]`, `canApprove:false`; detail exposes nullable `decisionVersion`. Principal DTOs also contain authorized Student ID/name/Branch/class/section and requester ID/name. No category grant can be inferred from the persisted role alone.

Receipt fields: `authorizationId`, `pickupPersonId`, `approvalId`, `operationRevision`, `operationPersonRevision`, `operationState`, `operationCycle`, `replayed`, `authorization`. An older replay receipt can describe a past state. The screen always displays the fresh `authorization` state instead.

**Explicit Lead Engineer-approved exception:** Part 1's queue omitted the approval identifier needed by its existing `/:approvalId` detail route. Only `backend/src/services/pickup-authorization-review.service.ts` and `backend/tests/pickup-authorization.security.test.ts` were changed on the backend. The service adds `approvalId: String(graph.approval!._id)` to its existing whitelisted Principal DTO, after `readPickupGraph` validates reciprocal persisted linkage. No input ID, raw ApprovalRequest document, phone, notes or custody evidence is added to queue summaries. Tests verify the exact whitelist, queue-to-detail resolution, role/grant denial and foreign-Branch concealment. Existing generic approval bypass tests remain intact. No RBAC, routing, transaction, eligibility or custody gate is changed.

401 means invalid/revoked session; 403 forbidden action/category/policy; 404 unavailable or concealed object; 409 revision/operation conflict; 503 unavailable review routing. UI text is sanitized and never displays the raw server message or stack.

## C. Faraz selective reuse

Inspected actual local donor `D:/Faraz-Reference` at `293966bf7f477bd430133e91d9a87d75523782f4`; no assumption that it equals current remote work.

| Donor | Adapted presentation | Rejected behavior |
| --- | --- | --- |
| `src/mobileApp/roles/parent/ParentApplicationsPage.jsx` (submit around line 181; pickup hero around 258) | Selected-child request context, clear cards, form feedback, loading/retry, history/detail and confirmation concepts | Generic title/message authority, client-only pending/reviewed filtering, assigned class-Teacher routing, optimistic/fictional approved custody |
| `ParentTransportPage.jsx:114` | Discoverable pickup-specific workspace | Generic application delegation and transport expansion |
| `ParentWorkspaceUI.jsx:99` | Child identity/class context and explicit selection | Donor authentication or arbitrary child queries |
| `ParentDashboard.jsx:1150` | Applications/history discoverability | Independent services, free-text-only requests and class-Teacher authority |

No donor source is imported. All visual components use the existing HIRA dashboard design tokens and components.

## D. Parent screen

`ParentPickupPersonsScreen` lists only children returned by the canonical authenticated Parent children API. Each child's private workspace is keyed by Student, enrollment and Branch. Forms expose the six actual proposal fields, local strict calendar/date-range validation and backend-aligned lengths/phone feedback. The server retains enrollment/date authority; no maximum duration is invented.

All/Draft/Pending use server pagination and exact filters. Reviewed contains explicit Changes Requested/Rejected/Withdrawn/Approved-history subfilters because the backend accepts only one exact state; the UI never downloads an unbounded union. Cards omit private detail fields. Details show authorized contact/notes, revisions, history, explanations and prior submitted snapshots. Submitted snapshots are read-only.

Create/edit use server versions. Submit and withdrawal require confirmation. Changes Requested uses the existing linked resubmission contract with all expected versions and a structured revised form. No replacement approval is created. No Revoke/QR/OTP/checkout/upload action is introduced.

## E. Principal review

The dedicated typed queue displays only its authorized response fields, bounded pagination and canonical linked `approvalId` navigation. Typed detail includes Student/Branch/requester context, proposal, history and server review versions. Reject and Request Changes require 10–500-character explanations and confirmation. Actual `allowedActions` and nullable decision versions determine action availability; server checks remain decisive.

Approve is visibly disabled with the school-policy explanation. No generic approval service is used by either new pickup service. The mobile session DTO does not expose server category grants, so the real Principal navigation entry opens the typed server check; a grant denial reveals no queue/detail data. No new client permission system or fabricated grant is added.

## F. Navigation

ParentNavigator registers `ParentPickupPersons`; ParentWorkspace places Pickup Persons next to Leave applications. PrincipalNavigator registers `PickupAuthorizationReviews` for the queue and `PickupAuthorizationReview` with the canonical approval ID for detail. A separate native detail stack entry preserves hardware/header back behavior and returns to a freshly revalidated queue. PrincipalWorkspace exposes Pickup Authorization Reviews for the real persisted Principal session. Existing leave, generic approval, attendance, safety, notices, tasks, academic, notifications/chat and back routes are preserved. No pickup count is added to generic approval totals.

## G. Developer Preview

The existing fictional ParentPreview now visibly contains **Pickup Persons · Design Preview**, sample Pending, Changes Requested and Rejected proposals, a read-only local detail interaction and explicit school-verification-unavailable/policy-blocked/inactive explanations. Sample names and dates are display strings, never domain DTOs or authority.

No preview module imports pickup services, creates identities/tokens, changes the real AuthContext, writes storage or calls the network. The existing development-only authenticated preview boundary is retained. Changing sample child clears the open sample detail. No pass, release challenge or checkout control exists.

## H. Policy safeguards

The actual Part 1 projection is `operationallyEligible:false`, `identityVerification:'unverified'`, `policyState:'unconfigured'`, custody `unknown|hold`. The UI reports inactive pickup permission and school verification required, including unavailable/mismatched review routing and stale policy binding. Pending, rejection and historical approval labels never imply collection authority. There is no activation or debug bypass.

## I. Authentication, scope and concurrency

PickupSession uses the actual AuthContext and correct Parent/Principal role. Identity/token/role/Branch keys remount private components; focus loss unmounts them. Per-component lifetime and request-generation checks ignore obsolete reads and writes, including old denials that must not log out a newer session. Selected-child changes remount the child workspace. All sensitive state stays in component memory.

Current 401/403/404 clears protected workspace/detail/summary/form state; 401 additionally invokes canonical logout, guarded against obsolete responses. Transient failures retain the working copy. A 409 refreshes scoped authoritative versions and requires explicit comparison/acknowledgement before applying the retained working copy. No automatic stale-write overwrite occurs.

## J. Operation IDs and retries

Native cryptographic randomness, already installed in `index.js`, generates UUID v4 operation IDs with no Math.random fallback. Secure randomness unavailable means no write. A ref prevents duplicate taps synchronously. Every uncertain mutation retains its exact immutable request body, expected versions and operation ID; safe retry resends those unchanged. Parent child switching/refresh is locked while a mutation is pending or uncertain so those controls cannot discard its receipt. Different payloads never silently reuse an operation receipt. Known 400/409/503 outcomes permit a deliberate corrected/new operation after feedback and applicable revalidation. No mutation reports success before server confirmation.

Private operation memory is deliberately discarded on logout/account/role/Branch/focus teardown. After reopening, users must inspect authoritative history before making another proposal; no unapproved persistent storage is introduced.

## K. Validation

Final execution evidence is appended below. Jest uses this repository's installed `react-test-renderer`/`act` convention; React Native Testing Library is not installed and no dependency was added. Tests simulate component/API behavior; they do not claim native-device rendering or production connectivity.

Initial checks exposed a nonexistent mobile permission constant, two test typing issues, six strict-lint warnings and one first-render Jest timeout (39 passed, 1 timed out). The source/test issues were corrected, warnings removed, and the same timeout/runner settings were retained. The next focused run passed 62/62; navigation/preview passed 16/16; combined five-suite run passed 78/78. These runs overlap and must not be added together.

An initial sandbox backend launch executed zero tests: `uv_os_get_passwd ENOMEM` occurred inside tsx. The isolated fixtures were then launched with authorized external process access; no production/development database was used.

The first broad mobile run passed 352/354. Its only failures were exhaustive route-inventory assertions in `parent-workspace.test.tsx` and `principal-approval-context.test.tsx` expecting the pre-feature arrays. The exact new Parent pickup route and two Principal pickup routes were added to those expected arrays; all prior routes, uniqueness and root-container assertions remain. No timeout or security assertion was relaxed. The identical broad command then passed **354/354 in 24 suites**. Existing LoginScreen SafeAreaView deprecation output is not a new pickup failure.

Final backend broad regression passed **730/730 in 19 test files**, including the separately run **59/59** pickup suite. These overlap. Backend TypeScript, mobile-scoped TypeScript and strict ESLint (all 22 changed/new TS/TSX files) exit 0. No test is skipped by the selected commands. Root-wide TypeScript and unrelated suites are not claimed.

## L. Exact changed/new files

There are **23 intended paths: 13 source files, 9 test/fixture files and this report** (11 modified tracked paths, 12 new paths). Backend scope is limited to the two explicitly approved exception paths above. All changes remain unstaged.

| File | Category / self-check |
| --- | --- |
| `backend/src/services/pickup-authorization-review.service.ts` | Source; one persisted validated ID field, no authority change |
| `backend/tests/pickup-authorization.security.test.ts` | Tests; exact DTO whitelist, typed resolution and queue privacy |
| `src/services/parent/pickupAuthorizationService.ts` | Source; explicit DTOs, exact write union, field validation, native secure UUID |
| `src/services/principal/pickupAuthorizationReviewService.ts` | Source; typed queue/detail/decision API only, no generic approval calls |
| `src/hooks/usePickupSession.tsx` | Source; real identity/focus boundary, liveness and sanitized error classification |
| `src/components/pickup/PickupPresentation.tsx` | Source; HIRA form/history/status and truthful blocked-state presentation |
| `src/screens/parent/ParentPickupPersonsScreen.tsx` | Source; verified children, bounded history, proposals and versioned lifecycle |
| `src/screens/principal/PrincipalPickupAuthorizationReviewScreen.tsx` | Source; dedicated queue/detail, reasoned decisions and disabled approval |
| `src/navigation/ParentNavigator.tsx` | Source; adds only real pickup route |
| `src/navigation/PrincipalNavigator.tsx` | Source; adds dedicated queue/detail stack routes |
| `src/screens/parent/ParentWorkspaceScreen.tsx` | Source; one discoverable pickup entry |
| `src/screens/principal/PrincipalWorkspaceScreen.tsx` | Source; real Principal entry, no fabricated category grant or count |
| `src/devPreview/ParentPreview.tsx` | Source; local fictional detail interaction, no service/auth mutation |
| `src/devPreview/previewData.ts` | Source; three clearly fictional display-only proposals |
| `__tests__/helpers/pickup-fixture.ts` | Test fixtures; synthetic isolated DTOs and deferred requests |
| `__tests__/pickup-services.test.ts` | Tests; exact paths, methods, body/revisions, DTO identity and UUID validation |
| `__tests__/parent-pickup-persons.test.tsx` | Tests; lifecycle, scope/focus/account races, denial concealment, receipts and conflicts |
| `__tests__/principal-pickup-review.test.tsx` | Tests; grant denial, typed navigation/back, capabilities, reasons, races and retries |
| `__tests__/pickup-navigation.test.tsx` | Tests; actual navigator registrations and real workspace entry actions |
| `__tests__/developer-preview.test.tsx` | Tests; sample details, no fetch, no mutation or authentication impersonation |
| `__tests__/parent-workspace.test.tsx` | Tests; exact route expectation includes the new Parent screen |
| `__tests__/principal-approval-context.test.tsx` | Tests; exact route expectation includes the two new Principal screens |
| `docs/integration/pr-g4c2-pickup-authorization-mobile.md` | Documentation; contracts, approved exception, evidence and deployment limitations |

Self-review evidence: Parent transport/validation begins at `src/services/parent/pickupAuthorizationService.ts:116`; Principal transport at `src/services/principal/pickupAuthorizationReviewService.ts:34`; real session boundary at `src/hooks/usePickupSession.tsx:8`; Parent write safety at `src/screens/parent/ParentPickupPersonsScreen.tsx:321`; current Principal decision safeguards at `src/screens/principal/PrincipalPickupAuthorizationReviewScreen.tsx:153`; persisted linked queue ID at `backend/src/services/pickup-authorization-review.service.ts:143`. The inventory and each responsibility were checked against actual code and tests, not inferred from filenames.

No changes to API transport/configuration, dependencies, root tsconfig, Part 1 models/startup, G4b gate authority, attendance or notification source are present. The accidental tracked G2b artifact remains blob `5202fa32a48fe26894cdfcb2e3e07f20c49d899f`. Validation logs are outside the repository under `%TEMP%`; no generated output is included.

## M. Deployment blockers and excluded work

`src/services/api/apiClient.ts:1` still hardcodes `http://192.168.18.32:5000/api`; the approved configurable origin exists in `src/services/api/apiConfig.ts` but is bypassed by the active client. Both remain untouched. This is a separate **operational deployment blocker** requiring a reviewed HTTPS/configuration repair and actual connectivity verification.

Explicit review routing and Principal category grants must be school-configured; they are not implied by this UI. School-approved identity verification/custody policy/activation is still unavailable and fail-closed. Android/iOS native builds, physical-device UX, keyboard behavior, accessibility on hardware and production HTTPS connectivity were **not run**. F-AUD-03 root TypeScript cleanup remains separate. G4d early exit, QR/OTP, physical events, emergency release, uploads, attendance and notification production are excluded.

## N. Verdict

**PASS — G4c Part 2 frontend integration and the explicitly approved linked queue-ID correction are implemented and verified at code level.** Parent draft/history/submission/withdrawal/resubmission, typed Principal queue/detail/reject/request-changes, navigation and fictional read-only preview are covered. Approval and operational pickup remain intentionally blocked. This verdict does not approve deployment or claim native/device verification.

HEAD remains `59299658b220f5f703f58f5b75662cb78a0e2a3f` on `feature/g4c-pickup-authorization`. The index is empty. No staging, commit, push, merge, reset, clean or restore was used. Stop here for Lead Engineer review; G4d has not begun.

## Execution evidence

All test output below is the raw last 20 log lines (or the complete output if shorter). Commands redirect output to `%TEMP%` and preserve the process exit code; no pipeline is used to infer success. Static tools produced no output on success, as recorded below. Results are not summed across overlapping runs.

### Focused backend pickup security

Working directory: D:/SchoolManagementSystem/backend

```powershell
.\node_modules\.bin\tsx.cmd --test tests/pickup-authorization.security.test.ts
```

Exit 0; 59 passed, 0 failed, 0 skipped. Real local MongoDB replica-set fixtures.

```text
✔ submit rolls back every linked record on approval failure (361.325ms)
✔ submit rolls back every linked record on snapshot failure (413.6733ms)
✔ submit rolls back every linked record on authorization failure (416.4172ms)
✔ submit rolls back every linked record on receipt failure (376.2017ms)
✔ resubmit rolls back every linked record on person failure (708.475ms)
✔ resubmit rolls back every linked record on approval failure (726.7174ms)
✔ resubmit rolls back every linked record on snapshot failure (745.3918ms)
✔ resubmit rolls back every linked record on authorization failure (806.9297ms)
✔ resubmit rolls back every linked record on receipt failure (957.6766ms)
✔ decision rolls back every linked record on authorization failure (496.2253ms)
✔ decision rolls back every linked record on approval failure (465.5545ms)
✔ decision rolls back every linked record on receipt failure (465.5139ms)
ℹ tests 59
ℹ suites 0
ℹ pass 59
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 107109.2494
```

### Backend G1-G4c and shared-authority regressions

Working directory: D:/SchoolManagementSystem/backend

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-review.security.test.ts tests/parent-leave-decision.security.test.ts tests/parent-scope.security.test.ts tests/teacher-scope.security.test.ts tests/student-enrollment.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/teacher-attendance.security.test.ts tests/principal-attendance.security.test.ts tests/attendance-amendment.security.test.ts tests/development-startup.security.test.ts tests/bootstrap.security.test.ts tests/teacher-provisioning.security.test.ts
```

Exit 0; 730 passed, 0 failed, 0 skipped; 19 test files. Includes the 59 pickup tests above.

```text
✔ revoked assignment immediately removes roster access (567.9441ms)
✔ expired assignment immediately removes roster access (533.0285ms)
✔ future assignment immediately removes roster access (534.5326ms)
✔ current inactive change fails closed on roster and independent service call (476.3234ms)
✔ current role change fails closed on roster and independent service call (469.5009ms)
✔ current branch change fails closed on roster and independent service call (466.5702ms)
✔ current branch inactive change fails closed on roster and independent service call (471.9398ms)
✔ current permission change fails closed on roster and independent service call (546.2534ms)
✔ roster query/body injection never widens scope and malformed tuple IDs are sanitized (1433.8811ms)
✔ roster has independent authentication/role gates and no guessed learner detail surface (514.7978ms)
✔ roster reference changes invalidate authority and DB failure is sanitized (482.6273ms)
✔ roster resolves scope once and executes one aggregate regardless of learner count (527.7899ms)
ℹ tests 730
ℹ suites 0
ℹ pass 730
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 323900.8367
```

### Mobile pickup and required regressions

Working directory: D:/SchoolManagementSystem

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/pickup-services.test.ts __tests__/parent-pickup-persons.test.tsx __tests__/principal-pickup-review.test.tsx __tests__/pickup-navigation.test.tsx __tests__/developer-preview.test.tsx __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts __tests__/principal-parent-leave-review.test.tsx __tests__/principal-approval-context.test.tsx __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/teacher-navigation.test.tsx __tests__/academic-setup-navigation.test.tsx __tests__/teacher-provisioning.test.tsx __tests__/auth-session.test.tsx __tests__/gate-foundation.test.tsx __tests__/chat-navigation.test.tsx __tests__/chat-workspace.test.tsx __tests__/chat-service.test.ts __tests__/notification-inbox.test.tsx __tests__/notification-inbox-service.test.ts __tests__/teacher-notifications.test.tsx __tests__/permissions.test.ts __tests__/App.test.tsx
```

Exit 0; 24 suites passed, 354 tests passed, 0 failed, 0 skipped.

```text
      at performWorkOnRoot (node_modules/react-test-renderer/cjs/react-test-renderer.development.js:12181:11)
      at performWorkOnRootViaSchedulerTask (node_modules/react-test-renderer/cjs/react-test-renderer.development.js:2908:7)
      at flushActQueue (node_modules/react/cjs/react.development.js:590:34)
      at node_modules/react/cjs/react.development.js:847:21

PASS __tests__/teacher-navigation.test.tsx
PASS __tests__/gate-foundation.test.tsx
PASS __tests__/auth-session.test.tsx
PASS __tests__/chat-service.test.ts
PASS __tests__/parent-service.test.ts
PASS __tests__/parent-leave-service.test.ts
PASS __tests__/pickup-services.test.ts
PASS __tests__/notification-inbox-service.test.ts
PASS __tests__/permissions.test.ts

Test Suites: 24 passed, 24 total
Tests:       354 passed, 354 total
Snapshots:   0 total
Time:        14.62 s, estimated 19 s
Ran all test suites matching /__tests__\\pickup-services.test.ts|__tests__\\parent-pickup-persons.test.tsx|__tests__\\principal-pickup-review.test.tsx|__tests__\\pickup-navigation.test.tsx|__tests__\\developer-preview.test.tsx|__tests__\\parent-leave-applications.test.tsx|__tests__\\parent-leave-service.test.ts|__tests__\\principal-parent-leave-review.test.tsx|__tests__\\principal-approval-context.test.tsx|__tests__\\parent-workspace.test.tsx|__tests__\\parent-service.test.ts|__tests__\\teacher-navigation.test.tsx|__tests__\\academic-setup-navigation.test.tsx|__tests__\\teacher-provisioning.test.tsx|__tests__\\auth-session.test.tsx|__tests__\\gate-foundation.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\chat-workspace.test.tsx|__tests__\\chat-service.test.ts|__tests__\\notification-inbox.test.tsx|__tests__\\notification-inbox-service.test.ts|__tests__\\teacher-notifications.test.tsx|__tests__\\permissions.test.ts|__tests__\\App.test.tsx/i.
```

### Backend TypeScript

Working directory: D:/SchoolManagementSystem/backend

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

Exit 0; no diagnostics. Not a test count.

```text

```

The output block is empty: the command emitted no diagnostics.

### Mobile-scoped TypeScript

Working directory: D:/SchoolManagementSystem

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json
```

Exit 0; no diagnostics. Root tsconfig unchanged.

```text

```

The output block is empty: the command emitted no diagnostics.

### Strict scoped ESLint

Working directory: D:/SchoolManagementSystem

```powershell
$pickupLintPaths = @(git -c core.safecrlf=false diff --name-only -- '*.ts' '*.tsx'); $pickupLintPaths += @(git ls-files --others --exclude-standard -- '*.ts' '*.tsx'); & .\node_modules\.bin\eslint.cmd --max-warnings=0 $pickupLintPaths
```

Exit 0; all 22 reviewed changed/new TS/TSX paths; 0 errors, 0 warnings.

```text

```

The output block is empty: the command emitted no diagnostics.

### Git and explicit whitespace gates

Working directory: `D:/SchoolManagementSystem`.

- `git diff --check`: exit 0. Only Git LF-to-CRLF informational warnings; no whitespace defects.
- `git diff --cached --check`: exit 0, no output.
- `git diff --cached --name-only`: exit 0, no output: index empty.
- `git branch --show-current`: exit 0, `feature/g4c-pickup-authorization`.
- `git rev-parse HEAD`: exit 0, `59299658b220f5f703f58f5b75662cb78a0e2a3f`.
- Explicit ReadAllLines trailing-space/tab check and final-newline check across every tracked modified and untracked path: exit 0, **23 paths passed**, including this untracked report.
- `git status --short --untracked-files=all`: exit 0; the full 23-path intended inventory is reproduced below. ` M` means unstaged tracked modification; `??` means new and unstaged.

```text
 M __tests__/developer-preview.test.tsx
 M __tests__/parent-workspace.test.tsx
 M __tests__/principal-approval-context.test.tsx
 M backend/src/services/pickup-authorization-review.service.ts
 M backend/tests/pickup-authorization.security.test.ts
 M src/devPreview/ParentPreview.tsx
 M src/devPreview/previewData.ts
 M src/navigation/ParentNavigator.tsx
 M src/navigation/PrincipalNavigator.tsx
 M src/screens/parent/ParentWorkspaceScreen.tsx
 M src/screens/principal/PrincipalWorkspaceScreen.tsx
?? __tests__/helpers/pickup-fixture.ts
?? __tests__/parent-pickup-persons.test.tsx
?? __tests__/pickup-navigation.test.tsx
?? __tests__/pickup-services.test.ts
?? __tests__/principal-pickup-review.test.tsx
?? docs/integration/pr-g4c2-pickup-authorization-mobile.md
?? src/components/pickup/PickupPresentation.tsx
?? src/hooks/usePickupSession.tsx
?? src/screens/parent/ParentPickupPersonsScreen.tsx
?? src/screens/principal/PrincipalPickupAuthorizationReviewScreen.tsx
?? src/services/parent/pickupAuthorizationService.ts
?? src/services/principal/pickupAuthorizationReviewService.ts
```

Raw git diff --check output:

```text
warning: in the working copy of '__tests__/developer-preview.test.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of '__tests__/parent-workspace.test.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/src/services/pickup-authorization-review.service.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/tests/pickup-authorization.security.test.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/devPreview/ParentPreview.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/devPreview/previewData.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/navigation/ParentNavigator.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/screens/parent/ParentWorkspaceScreen.tsx', LF will be replaced by CRLF the next time Git touches it
```

## Continuation verification — 2026-11-08

The Lead Engineer's continuation was handled without repeating completed implementation. Part 1 remains the clean committed checkpoint `59299658b220f5f703f58f5b75662cb78a0e2a3f`; the current worktree is deliberately dirty with the same 23 Part 2 paths and an empty index. The linked queue-ID exception was already implemented, so it was not applied twice. SHA-256 checks confirm all 22 existing source/test paths were preserved byte-for-byte during this continuation; only this Part 2 report was clarified and extended. The Part 1 report was not edited.

Fresh checks: mobile **354/354**, backend pickup/gate/shared authority **197/197**, no failures or skipped tests, both TypeScript scopes and strict scoped ESLint exit 0. The fresh backend selection contains the complete 59-test pickup suite and four relevant gate/authority/security files. The earlier broader 730-test backend run is retained above as previous evidence for the unchanged implementation; it was not rerun in full during this continuation. Counts overlap and must not be summed.

The exact fresh commands and raw last 20 lines follow. Static checks emitted no diagnostics.

### Fresh mobile regression gate

Working directory: D:/SchoolManagementSystem

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/pickup-services.test.ts __tests__/parent-pickup-persons.test.tsx __tests__/principal-pickup-review.test.tsx __tests__/pickup-navigation.test.tsx __tests__/developer-preview.test.tsx __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts __tests__/principal-parent-leave-review.test.tsx __tests__/principal-approval-context.test.tsx __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/teacher-navigation.test.tsx __tests__/academic-setup-navigation.test.tsx __tests__/teacher-provisioning.test.tsx __tests__/auth-session.test.tsx __tests__/gate-foundation.test.tsx __tests__/chat-navigation.test.tsx __tests__/chat-workspace.test.tsx __tests__/chat-service.test.ts __tests__/notification-inbox.test.tsx __tests__/notification-inbox-service.test.ts __tests__/teacher-notifications.test.tsx __tests__/permissions.test.ts __tests__/App.test.tsx
```

Exit 0; 24 suites passed; 354 passed, 0 failed, 0 skipped.

```text
      at performWorkOnRootViaSchedulerTask (node_modules/react-test-renderer/cjs/react-test-renderer.development.js:2908:7)
      at flushActQueue (node_modules/react/cjs/react.development.js:590:34)
      at node_modules/react/cjs/react.development.js:847:21

PASS __tests__/pickup-navigation.test.tsx
PASS __tests__/teacher-navigation.test.tsx
PASS __tests__/gate-foundation.test.tsx
PASS __tests__/auth-session.test.tsx
PASS __tests__/pickup-services.test.ts
PASS __tests__/chat-service.test.ts
PASS __tests__/parent-service.test.ts
PASS __tests__/parent-leave-service.test.ts
PASS __tests__/notification-inbox-service.test.ts
PASS __tests__/permissions.test.ts

Test Suites: 24 passed, 24 total
Tests:       354 passed, 354 total
Snapshots:   0 total
Time:        11.111 s, estimated 15 s
Ran all test suites matching /__tests__\\pickup-services.test.ts|__tests__\\parent-pickup-persons.test.tsx|__tests__\\principal-pickup-review.test.tsx|__tests__\\pickup-navigation.test.tsx|__tests__\\developer-preview.test.tsx|__tests__\\parent-leave-applications.test.tsx|__tests__\\parent-leave-service.test.ts|__tests__\\principal-parent-leave-review.test.tsx|__tests__\\principal-approval-context.test.tsx|__tests__\\parent-workspace.test.tsx|__tests__\\parent-service.test.ts|__tests__\\teacher-navigation.test.tsx|__tests__\\academic-setup-navigation.test.tsx|__tests__\\teacher-provisioning.test.tsx|__tests__\\auth-session.test.tsx|__tests__\\gate-foundation.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\chat-workspace.test.tsx|__tests__\\chat-service.test.ts|__tests__\\notification-inbox.test.tsx|__tests__\\notification-inbox-service.test.ts|__tests__\\teacher-notifications.test.tsx|__tests__\\permissions.test.ts|__tests__\\App.test.tsx/i.
```

### Fresh backend pickup, gate and shared authority

Working directory: D:/SchoolManagementSystem/backend

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/parent-scope.security.test.ts
```

Exit 0; 197 passed, 0 failed, 0 skipped; isolated real MongoDB replica-set fixtures.

```text
✔ branch reassignment after login uses DB scope on every read and write family (523.0708ms)
✔ notice list publication/expiry filtering and scoped detail preserve current behavior (236.6027ms)
✔ task and safety assignments deny foreign, inactive and non-staff users (239.3397ms)
✔ task creator/assignee restrictions and final-state guards survive valid requests (252.7553ms)
✔ safety valid action and repeated final action retain atomic conflict semantics (172.9462ms)
✔ legacy safety assignee references cannot populate foreign user identity (166.726ms)
✔ approval category, stored financial limits and requester separation fail closed (289.3396ms)
✔ approval requester/entity references and historical populations cannot leak another branch (313.519ms)
✔ delegation denies foreign/ineligible delegates and expired grants but permits valid scoped delegation (316.7197ms)
✔ all Super Admin route families deny Principals, students, teachers and anonymous callers (874.3645ms)
✔ Super Admin retains authenticated access to administrative read routes (284.4386ms)
✔ unexpected authorization/data failures are sanitized across Principal read families (437.7453ms)
ℹ tests 197
ℹ suites 0
ℹ pass 197
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 88772.2017
```

### Fresh backend TypeScript

Working directory: D:/SchoolManagementSystem/backend

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

Exit 0; no diagnostics.

```text

```

### Fresh mobile-scoped TypeScript

Working directory: D:/SchoolManagementSystem

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json
```

Exit 0; no diagnostics.

```text

```

### Fresh strict scoped ESLint

Working directory: D:/SchoolManagementSystem

```powershell
$pickupLintPaths = @(git -c core.safecrlf=false diff --name-only -- '*.ts' '*.tsx'); $pickupLintPaths += @(git ls-files --others --exclude-standard -- '*.ts' '*.tsx'); & .\node_modules\.bin\eslint.cmd --max-warnings=0 $pickupLintPaths
```

Exit 0; 22 reviewed TS/TSX paths, 0 errors, 0 warnings.

```text

```
