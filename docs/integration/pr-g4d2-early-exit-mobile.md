# G4d Part 2 — Early Exit Mobile Integration

## A. Verified Git baseline

Initial branch: `feature/g4d-early-exit-requests`. Initial local and fetched remote HEAD: `39f8f1727ad6e262732f752ef76eedbdc3e3c89e` (G4d Part 1). Worktree clean, index empty, ahead/behind `0 0`. `git fetch origin` succeeded. The remote feature contains Part 1; `49fc00ce6d7f2bc7c7eb36777ce10345dc85288c` is an ancestor and remained `origin/integration/team-merge`. No intervening local/remote commits were found. Work continues on the same branch; no new branch, reset, restore, clean, rebase, cherry-pick or merge was used.

Part 1 report, G4c completion audit and current backend routes/models/authority/read/write contracts were compared with current canonical Parent Leave/Pickup, Principal review, AuthContext, apiClient, navigators, shared components and Developer Preview. Backend source remains unchanged from Part 1. The separate historical G2b artifact remains untouched.

## B. Exact inventory (23 paths)

New production source (8):

- `src/services/parent/earlyExitService.ts`
- `src/services/principal/earlyExitReviewService.ts`
- `src/hooks/useEarlyExitSession.tsx`
- `src/components/earlyExit/EarlyExitPresentation.tsx`
- `src/components/earlyExit/ParentEarlyExitRequests.tsx`
- `src/screens/parent/ParentEarlyExitRequestsScreen.tsx`
- `src/screens/principal/PrincipalEarlyExitReviewScreen.tsx`
- `src/devPreview/EarlyExitPreview.tsx`

Modified production source (6):

- `src/navigation/ParentNavigator.tsx`
- `src/navigation/PrincipalNavigator.tsx`
- `src/screens/parent/ParentWorkspaceScreen.tsx`
- `src/screens/principal/PrincipalWorkspaceScreen.tsx`
- `src/devPreview/ParentPreview.tsx`
- `src/services/api/apiClient.ts` — separately authorized narrow transport repair, described below.

New verification (4):

- `__tests__/early-exit-services.test.ts`
- `__tests__/parent-early-exit.test.tsx`
- `__tests__/principal-early-exit.test.tsx`
- `__tests__/helpers/early-exit-fixture.ts`

Updated verification (4):

- `__tests__/pickup-navigation.test.tsx`
- `__tests__/developer-preview.test.tsx`
- `__tests__/parent-workspace.test.tsx`
- `__tests__/principal-approval-context.test.tsx`

Report (1): `docs/integration/pr-g4d2-early-exit-mobile.md`.

No backend exception, dependency, lockfile, root tsconfig, native manifest, Gradle, ATS, Babel, Metro, origin-validation policy, Gate/attendance/notification domain or unrelated role module is changed. Existing route inventory assertions were extended with the new exact route names/order; their uniqueness and one-NavigationContainer assertions remain intact.

### Approved shared-client exception

The first full mobile run exposed eight existing failures in `__tests__/api-client.test.ts`. A no-cache isolated reproduction passed 6/14, failed 8/14, exit 1. Before repair, `git diff --quiet HEAD --` confirmed the client, resolver, transport tests and build configuration were unchanged. The committed client still used a hardcoded LAN base and bypassed the existing approved resolver, reproducing missing/invalid-setting and configured-origin failures. This was not hidden or attributed to Early Exit backend authority.

The Lead Engineer explicitly authorized: import existing `getApiBaseUrl()` and use it to construct the URL, preserving all configuration policy, endpoints, JWT headers, methods, body, timers, abort behavior and native restrictions. Only that minimal source repair and a final newline were applied to apiClient. The unchanged 14-test transport suite then passed 14/14, exit 0. No endpoint was invented or embedded in production source. Missing configuration now fails closed through the existing resolver before fetch. Real production connectivity remains unverified.

## C. Architecture and privacy decisions

One existing AuthProvider and apiClient are reused. No alternate credentials, role switch, token cache, generic approval decision API, store or NavigationContainer is introduced. Route entries use existing Parent/Principal workspace buttons and native stacks. The Parent screen obtains children exclusively from canonical authenticated `parentService.children`; response Branch identity is checked against the current session. Selected-child state is keyed by Student, enrollment and Branch. No arbitrary route-supplied child identity authorizes data access.

`EarlyExitSession` gates real current auth and focus and keys its children by account ID, role, Branch and token. Changing any component of that identity, logout or losing focus destroys private local state. The established G4c lifetime fence is reused; response generations and live refs reject obsolete read/write success and denial callbacks. An old 401 cannot log out a newer session. There is no insecure disk persistence of reasons, histories or pending commands.

The established native cryptographic UUID generator is reused through an Early Exit alias; it has no Math.random or fake-ID fallback. The canonical API wrapper remains the sole transport. Service types distinguish list summary from private detail, Parent capabilities from Principal capabilities, application revision from approval version, and historical operation acknowledgment from fresh current request DTO.

Parent service checks returned Student/request identity and exact supported state. Principal service verifies returned Student/Branch and canonical approval ID; the expected Branch argument is only response validation and is never sent as authorization in a URL/body. Server session/RBAC/Branch/relationship enforcement remains mandatory and unchanged.

Current 401/403/404 responses conceal private details, summaries, working forms and confirmations; 401 additionally invokes canonical logout. Errors shown to users are fixed safe messages, never raw private server messages. Remote category/permission revocation is observed on the next protected request/revalidation; no real-time server-push revocation channel is claimed. Focus return performs fresh reads instead of reviving cached private data.

## D. Parent workspace

`ParentEarlyExitRequests` route opens the authenticated Early Exit workspace. It supports current verified-child selection, bounded history, exact server state filters, deduplicated nextOffset pagination, refresh, private detail and immutable submission/decision history.

Supported states are exactly Draft, Pending, Changes Requested, Rejected and Withdrawn. There is no Approved state. The form contains only civil date `YYYY-MM-DD` and private reason, with accessible labels, inline feedback and normalized character count. NFC/trimmed reason length is 1–500. Date validation rejects malformed/impossible/zero-year dates; the backend still decides enrollment and academic-date validity. No exit-hour/window, collector verification, school/Branch authority or attachment input exists.

Draft create/edit, Submit, Pending withdrawal and Changes Requested resubmission use typed endpoints and actual returned revisions. Submit, Withdraw and Resubmit require explicit confirmation. Server capabilities control available actions. Rejected/Withdrawn records are read-only. The safety notice is always visible: **Submitting an Early Exit request does not authorize the child to leave school.**

The existing-edit identity is stored independently from loaded detail. A transient or conflict detail refresh clears stale revision context while retaining the original request ID and working fields. Save remains disabled until current detail/capabilities/versions are recovered. Recovery edits the same request; absence of detail is never interpreted as Create. A 409 requires reviewing refreshed versions before applying the retained working copy. A definitive denial clears the entire protected child workspace.

Every mutation retains one complete immutable-in-memory command: action, normalized payload, target, expected revisions and clientOperationId. A synchronous sending ref prevents duplicate taps/nonce generation. Timeout, unknown network/server failure and 503 keep that exact command and lock new actions/child refresh/switching until safe retry. The retry sends identical normalized content and versions with the same nonce, not a new create. Confirmed responses use the fresh authorized `request` DTO, never historical `operationState`. Deliberate new actions receive new IDs. Auth/focus loss intentionally clears private in-memory context; no cross-session retry identity is persisted.

Shared DashboardShell supplies safe areas/scrolling; KeyboardAvoidingView supports iOS and native Android layout. Hardware keyboard, screen-reader and screen-size behavior remain device-verification work, not an automated native UX certification.

## E. Principal workspace

`EarlyExitReviews` is the dedicated own-Branch Pending queue; `EarlyExitReview` takes canonical `approvalId`. Queue cards show only authorized Student/requester context and proposed date/state. Private reason and submission/decision history load only through typed detail. Pagination merges by canonical request identity without duplicate cards.

Reject and Request Changes require current server capabilities, application/approval versions, explicit confirmation and an NFC/trimmed explanation of 10–500 characters. A synchronous send fence prevents duplicate decisions. Unknown/503 failures retain the exact decision command for retry. A 409 retains explanation but disables a new decision until fresh detail/version context is recovered and explicitly acknowledged; failed refresh cannot enable stale versions. Confirmed decisions refresh current server state.

Approve is disabled and cannot be sent through the typed service even by a forged runtime action. The required informational notice is visible: **Early Exit approval is unavailable until the school's identity and custody policy is formally configured.** No UI config switch or school verification claim exists. Current denials conceal queue and detail data. Account/token/role/Branch/focus changes isolate old responses.

## F. Backend API mapping

All endpoints use the canonical `/api` base supplied by apiClient; all success envelopes are `{success:true,data:...}`. No backend contract change was necessary. `N` means clientOperationId; `F` means exitDate + normalized private reason; `V` means applicationRevision; `RV` means applicationRevision + approvalVersion.

| Method | Endpoint after `/api` | Input | Authorized response data |
| --- | --- | --- | --- |
| GET | `/parent/me/children/:studentId/early-exit-requests` | offset 0–100000, optional exact state | `{items:EarlyExitSummary[],nextOffset}` |
| GET | same + `/:requestId` | None | EarlyExitDetail |
| POST | Parent base | F + N | EarlyExitResult; Draft only |
| PATCH | Parent base + `/:requestId` | F + V + N | EarlyExitResult |
| POST | same + `/submit` | V + N | EarlyExitResult |
| POST | same + `/withdraw` | RV + N | EarlyExitResult |
| POST | same + `/resubmit` | F + RV + N | EarlyExitResult |
| GET | `/principal/early-exit-requests` | offset 0–100000 | `{items:EarlyExitReviewSummary[],nextOffset}` |
| GET | same + `/:approvalId` | None | EarlyExitReviewDetail, decisionVersion |
| POST | same + `/:approvalId/decisions` | RV + N + reject/request_changes + decisionReason | EarlyExitResult with fresh review detail |

Summary fields match Part 1: requestId/studentId/approvalId/date/state/revision/createdAt/updatedAt/eligibility/routing/capabilities. Detail adds private reason, reviewVersion, history action/revision/time/decisionReason and immutable submitted cycle/date/reason/revision/time. Principal detail adds permitted requester/Student context and decisionVersion. Result includes original operation acknowledgment and fresh `request`; there is no `authorization` or personRevision field in this contract.

Service allowlists reject extra authority keys, unsupported actions/states, invalid dates/reasons, negative/unsafe revisions and out-of-bound offsets before network. IDs are encoded, then scoped server-side; DTO identity mismatches conceal the whole response. HTTP 400 is field feedback, 401/403/404 concealment, 409 revalidation, 503 unavailable dependency/unconfirmed write; other network/5xx errors retain safe retries. No error calls an alternate or generic endpoint.

## G. Security verification matrix

| Boundary | Automated evidence |
| --- | --- |
| Real session/role and current Branch | Identity/focus tests; service returned-Branch checks; unchanged backend registered-session/role/Branch regressions |
| Verified child and original requester | Canonical children service, keyed child workspace, mixed-child/detail mismatch tests; backend original-owner/relationship/enrollment tests |
| Private summary/detail concealment | Current read/write 401/403/404; cached queue/list denial; safe fixed error strings; no reason in queue presentation |
| Stale read/write responses | Child/account/token/role/Branch/logout/focus matrix, out-of-order reads and late 401 after identity replacement |
| Draft refresh invariant | Failed ordinary refresh retains request ID/form, disables Save and recovers edit with returned versions |
| Idempotency/concurrency | Exact command retries, double-tap fences, 409 version review, 503 retry, fresh DTO over old receipt; actual replica-set backend races/rollback |
| Principal typed authority | Typed queue/detail approvalId mapping, exact decision payloads, current capabilities and denial concealment; generic bypass backend regressions |
| Pagination | Exact server offsets/state filters and duplicate request identity removal |
| Preview isolation | Five fictional read-only states in existing Parent preview; zero fetch/auth changes; child switch clears selection; existing production guard |
| Physical safety | No enabled approve, no runtime approve service call, no Gate/release/token/attendance/notification mutation; unchanged backend policy guards and Gate/Pickup tests |

Developer Preview adds only fictional, read-only Early Exit cards/details inside the existing Parent preview. No service or auth import, network adapter or operation exists in that component. Principal preview continues using the real canonical navigator/session boundary; preview role selection never creates Principal JWT authority.

## H. Validation evidence

Final applicable gates passed. Root-wide TypeScript remains an explicitly measured inherited failure, as permitted by the brief; it is not reported as PASS.

| Gate | Actual final result | Exit |
| --- | --- | --- |
| Three new Early Exit Jest files | 109 passed, 0 failed/skipped (Parent 42; Principal 30; services 37) | 0 |
| Full mobile Jest | 1,301 passed, 0 failed/skipped; 91/91 suites. Includes 109 new dedicated cases and 1,192 existing/expanded regression cases. | 0 |
| Unchanged API-client transport suite after approved repair | 14 passed, 0 failed/skipped; included in full suite | 0 |
| Fresh backend security, 5 files | 251 passed, 0 failed/cancelled/skipped/todo; includes real replica-set races/rollback | 0 |
| Mobile-scoped TypeScript, including mobile tests | No diagnostics | 0 |
| Root-wide TypeScript | 96 inherited diagnostic headers, identical file/line/code/message set before and after; zero introduced diagnostics | 2 |
| Strict scoped ESLint | All 22 changed/new TS/TSX paths, 0 warnings/errors | 0 |
| Git diff and explicit changed-file whitespace checks | No whitespace/conflict-marker issues | 0 |

The first post-transport full run overlapped replica-set validation and hit the unchanged 5-second timeout in one existing Principal context test (1,298 passed, 1 timed out). Its assertions/timeouts were not modified. Sequential validation resolved that timeout. Final self-review then added synchronous pending-command guards and two regression cases proving retained Save/Confirm callbacks cannot generate a new operation after an uncertain timeout, even with stale React state. The final complete sequential suite passed all 1,301 tests in 52.633 seconds. The earlier initial full run's 10 failures were eight reproduced transport defects plus two exact route inventories; all are resolved in the final run. No failed final regression gate is accepted.

Root baseline/final diagnostic header sets both contain 96 entries with zero delta. Examples: `backend/src/services/rtc/zego-room-control.ts:37` (AbortSignal.timeout typing), `backend/tests/academic-evidence.security.test.ts:99` and `:101` (Mongoose overload typing). Three nested detail lines merely reorder the same union members; there are no new diagnostic headers or changed backend source. F-AUD-03 is not repaired or suppressed.

Initial new-test iterations corrected contract-specific names/fields and React retry callback typing; no pre-existing security assertion was weakened. The first full mobile run found exact navigation inventories needing the authorized new routes and the unchanged eight transport failures described above. Exact route assertions were extended, and the Lead-approved transport fix was applied only after isolated reproduction. Root TypeScript was measured before edits so inherited diagnostics cannot be hidden as a passing root check.

Final focused new suites: **109 passed, 0 failed**, exit 0 — Parent 42, Principal 30, services 37. An earlier five-file Early Exit/navigation/preview gate passed **130/130**, exit 0, before the two final retained-callback cases were added. The final full suite includes both cases and all navigation/preview tests. Counts overlap; they must not be summed as unique coverage.

Repository working directory: `D:/SchoolManagementSystem`.

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/early-exit-services.test.ts __tests__/parent-early-exit.test.tsx __tests__/principal-early-exit.test.tsx --json --outputFile "$env:TEMP\hira-g4d2-new-tests.json"
.\node_modules\.bin\jest.cmd --runInBand __tests__/api-client.test.ts
# Pre-repair reproduction only: 6 passed, 8 failed, exit 1 against unchanged committed transport.
.\node_modules\.bin\jest.cmd --runInBand --no-cache __tests__/api-client.test.ts
# Full Jest uses a process-local test-only development origin; it is restored afterward.
$env:SCHOOL_APP_DEV_API_ORIGIN = 'http://127.0.0.1:5000'
.\node_modules\.bin\jest.cmd --runInBand --json --outputFile "$env:TEMP\hira-g4d2-mobile-full.json"
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json --pretty false
$lintPaths = @((git diff --name-only -- '*.ts' '*.tsx'), (git ls-files --others --exclude-standard -- '*.ts' '*.tsx')) | ForEach-Object { $_ } | Where-Object { $_ }
& .\node_modules\.bin\eslint.cmd --max-warnings=0 $lintPaths
git diff --check
git diff --cached --check
git status --short
```

Backend working directory: `D:/SchoolManagementSystem/backend`.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/early-exit.security.test.ts tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts
```

The backend run uses existing isolated disposable real MongoDB replica-set fixtures and independent worker processes, never production databases or .env. Validation output/JSON files remain under system TEMP and are excluded from the checkpoint. No package installation was performed.

Android build: NOT RUN. iOS native build: NOT RUN. Physical device/accessibility/keyboard checks: NOT RUN. Actual production HTTPS/connectivity: NOT RUN. Automated Babel/Metro/transport tests are distinct from complete native builds or deployed TLS verification.

## I. Remaining risks and deployment inputs

School identity/custody/operational approval policy remains unconfigured. Early Exit approval, actual departure, Gate checkout, QR/OTP, emergency exceptions, attendance exit effects and notifications remain unavailable. Part 1 current server fences and generic typed-entity guards remain intact.

The inherited hardcoded client bypass was repaired under explicit approval; this does not supply a production endpoint. Development builds require an explicit `SCHOOL_APP_DEV_API_ORIGIN`; release builds require a school-approved valid public HTTPS `SCHOOL_APP_RELEASE_API_ORIGIN` on the build host through existing Babel/Metro/Gradle configuration. No secrets belong in these public settings. Missing/invalid settings fail closed. Android cleartext/iOS ATS policies are unchanged. Production hostname/TLS/reachability and native release/device behavior require separate verification. No synthetic test origin is a deployed endpoint claim.

Root TypeScript/F-AUD-03 debt is separate: baseline and final each have 96 diagnostics, with zero introduced diagnostic headers. No root config change or blanket suppression was made. Private pending commands are memory-only and intentionally do not survive logout/focus loss; refresh authoritative history before deliberately creating another request after returning from a discarded context.

## J. Verdict and handoff

**PASS — G4d Part 2 mobile integration implemented and verified within the deliberate school-policy boundary.** Parent and Principal use canonical typed Early Exit services, current scoped capabilities and revisions; private state is fenced across auth/child/Branch/focus changes; uncertain writes retry identical commands; existing modules pass the complete mobile regression suite. Backend authority and physical-release restrictions remain unchanged. The shared-client repair was explicitly approved and independently verified. This is not certification of school operational approval, production connectivity or native/device behavior. Root-wide TypeScript retains only the measured inherited debt above.

Checkpoint procedure: review the complete 23-file scope, stage explicit paths only, inspect cached diff/inventory/whitespace, commit once without amending Part 1 and push only the existing feature branch. Verify remote SHA and clean worktree/index. Commit SHA/remote verification are included in the final handoff, avoiding a self-referential commit hash here.

Next: Lead Engineer G4d Part 2 review followed by a separately approved final G4d audit/PR decision. No PR creation, merge, G4e, operational approval or physical release is part of this task.

## K. Raw final validation outputs (last 20 lines per command)

### New Early Exit suites, exit 0

~~~~text
PASS __tests__/parent-early-exit.test.tsx
PASS __tests__/principal-early-exit.test.tsx
PASS __tests__/early-exit-services.test.ts

Test Suites: 3 passed, 3 total
Tests:       109 passed, 109 total
Snapshots:   0 total
Time:        4.737 s
Ran all test suites matching /__tests__\\early-exit-services.test.ts|__tests__\\parent-early-exit.test.tsx|__tests__\\principal-early-exit.test.tsx/i.
Test results written to: C:\Users\LAPTOP~1\AppData\Local\Temp\hira-g4d2-new-tests.json
~~~~

### Full mobile suite, exit 0

~~~~text
PASS __tests__/attendance-amendment-service.test.ts
PASS __tests__/teacher-attendance-service.test.ts
PASS __tests__/result-service.test.ts
PASS __tests__/teacher-assignment-service.test.ts
PASS __tests__/student-enrollment-service.test.ts
PASS __tests__/academic-setup-service.test.ts
PASS __tests__/teacher-service.test.ts
PASS __tests__/teacher-communication-service.test.ts
PASS __tests__/class-subject-service.test.ts
PASS __tests__/permissions.test.ts
PASS __tests__/live-lesson-api.test.ts
PASS __tests__/academic-phase2-service.test.ts
PASS __tests__/notification-service.test.ts

Test Suites: 91 passed, 91 total
Tests:       1301 passed, 1301 total
Snapshots:   0 total
Time:        52.633 s
Ran all test suites.
Test results written to: C:\Users\LAPTOP~1\AppData\Local\Temp\hira-g4d2-mobile-full.json
~~~~

### Approved transport repair suite, exit 0

~~~~text
  √ an unconfigured transformation leaves markers that fail before fetch (2272 ms)
  √ invalid configuration dev=true fails before fetch (89 ms)
  √ invalid configuration dev=false fails before fetch (63 ms)
  √ invalid configuration dev=false fails before fetch (58 ms)
  √ invalid configuration dev=false fails before fetch (50 ms)
  √ invalid configuration dev=false fails before fetch (48 ms)
  √ valid configuration dev=true preserves auth, chat and notification requests (93 ms)
  √ valid configuration dev=false preserves auth, chat and notification requests (72 ms)
  √ HTTP 401 retains ApiError status and message (55 ms)
  √ HTTP 403 retains ApiError status and message (55 ms)
  √ HTTP 404 retains ApiError status and message (67 ms)
  √ HTTP 409 retains ApiError status and message (62 ms)
  √ HTTP 500 retains ApiError status and message (72 ms)
  √ network errors and timeout/abort behavior remain unchanged (100 ms)

Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        5.086 s
Ran all test suites matching /__tests__\\api-client.test.ts/i.
~~~~

### Backend security regression, exit 0

~~~~text
✔ branch reassignment after login uses DB scope on every read and write family (597.8373ms)
✔ notice list publication/expiry filtering and scoped detail preserve current behavior (266.3361ms)
✔ task and safety assignments deny foreign, inactive and non-staff users (270.2418ms)
✔ task creator/assignee restrictions and final-state guards survive valid requests (299.3707ms)
✔ safety valid action and repeated final action retain atomic conflict semantics (203.6971ms)
✔ legacy safety assignee references cannot populate foreign user identity (176.0004ms)
✔ approval category, stored financial limits and requester separation fail closed (314.7508ms)
✔ approval requester/entity references and historical populations cannot leak another branch (367.8815ms)
✔ delegation denies foreign/ineligible delegates and expired grants but permits valid scoped delegation (324.5961ms)
✔ all Super Admin route families deny Principals, students, teachers and anonymous callers (941.14ms)
✔ Super Admin retains authenticated access to administrative read routes (290.1974ms)
✔ unexpected authorization/data failures are sanitized across Principal read families (436.1262ms)
ℹ tests 251
ℹ suites 0
ℹ pass 251
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 131202.7825
~~~~

### Root TypeScript, exit 2 (inherited)

~~~~text
      Type 'string' is not assignable to type '{ readonly schemaName?: "ObjectId" | undefined; auto?: ((turnOn: boolean) => ObjectId) | undefined; $conditionalHandlers?: { [x: string]: ((val: any, context: any) => any) | undefined; } | undefined; ... 24 more ...; validateAll?: ((validators: (RegExp | ... 1 more ... | ValidatorFunction<...>)[]) => ObjectId) | und...'.
backend/tests/student-enrollment.security.test.ts(331,51): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Type 'string' is not assignable to type '{ readonly schemaName?: "ObjectId" | undefined; auto?: ((turnOn: boolean) => ObjectId) | undefined; $conditionalHandlers?: { [x: string]: ((val: any, context: any) => any) | undefined; } | undefined; ... 24 more ...; validateAll?: ((validators: (RegExp | ... 1 more ... | ValidatorFunction<...>)[]) => ObjectId) | und...'.
      Type 'string' is not assignable to type '{ readonly schemaName?: "ObjectId" | undefined; auto?: ((turnOn: boolean) => ObjectId) | undefined; $conditionalHandlers?: { [x: string]: ((val: any, context: any) => any) | undefined; } | undefined; ... 24 more ...; validateAll?: ((validators: (RegExp | ... 1 more ... | ValidatorFunction<...>)[]) => ObjectId) | und...'.
backend/tests/student-enrollment.security.test.ts(339,43): error TS2339: Property '_id' does not exist on type 'never'.
backend/tests/student-enrollment.security.test.ts(342,43): error TS2339: Property '_id' does not exist on type 'never'.
backend/tests/student-enrollment.security.test.ts(345,42): error TS2769: No overload matches this call.
  Overload 1 of 2, '(filter?: _QueryFilter<{ status: NonNullable<FeeStatus>; description: string; dueDate: Date; branchId: ObjectId; studentId: ObjectId; createdAt: Date; ... 282 more ...; "studentId.validateAll": (validators: (RegExp | ... 1 more ... | ValidatorFunction<...>)[]) => ObjectId; }> | undefined, options?: (CountOptions & ... 2 more ... & Abortable) | ... 1 more ... | undefined): Query<...>', gave the following error.
    Type 'string' is not assignable to type 'StrictCondition<ApplyBasicQueryCasting<ObjectId>> | undefined'.
  Overload 2 of 2, '(filter?: Query<any, any, {}, unknown, "find", Record<string, never>> | undefined, options?: (CountOptions & Pick<QueryOptions<IFee>, "timestamps" | ... 1 more ... | "lean"> & { ...; } & Abortable) | null | undefined): Query<...>', gave the following error.
    Object literal may only specify known properties, and 'studentId' does not exist in type 'Query<any, any, {}, unknown, "find", Record<string, never>>'.
backend/tests/student-enrollment.security.test.ts(350,233): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Argument of type '{ effectiveTo: Date; effectiveFrom: Date; status?: undefined; reason: string; createdBy: string; updatedBy: string; academicPeriodId: string; classId: string; sectionId: string; studentId: string; branchId: string; } | { ...; } | { ...; } | { ...; }' is not assignable to parameter of type '{ revision?: number | undefined; classId?: ObjectIdQueryTypeCasting | undefined; sectionId?: ObjectIdQueryTypeCasting | undefined; ... 13 more ...; _id?: ObjectIdQueryTypeCasting | undefined; }'.
      Type '{ status: string; effectiveTo?: undefined; effectiveFrom: Date; reason: string; createdBy: string; updatedBy: string; academicPeriodId: string; classId: string; sectionId: string; studentId: string; branchId: string; }' is not assignable to type '{ revision?: number | undefined; classId?: ObjectIdQueryTypeCasting | undefined; sectionId?: ObjectIdQueryTypeCasting | undefined; ... 13 more ...; _id?: ObjectIdQueryTypeCasting | undefined; }'.
        Types of property 'status' are incompatible.
          Type 'string' is not assignable to type 'RegExp | "withdrawn" | "active" | "transferred" | "promoted" | undefined'.
backend/tests/teacher-timetable.security.test.ts(411,17): error TS2554: Expected 2-3 arguments, but got 0.
backend/tests/teacher-timetable.security.test.ts(602,21): error TS2554: Expected 2-3 arguments, but got 0.
~~~~

### Mobile-scoped TypeScript and strict ESLint, each exit 0

Both commands emitted no diagnostics; their output files are empty. Root baseline/final diagnostic header comparison: BASELINE=96, FINAL=96, DELTA=0.
