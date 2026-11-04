# G2a — Parent Leave Draft & History Integration

Date: 2026-11-04 (Asia/Karachi).

## A. Baseline and exact changes

Repository: `D:/SchoolManagementSystem`; branch: `integration/team-merge`.
Initial/final HEAD: `81da039970a7d26e38090dc4a368665b6da042c9`
(`feat: add secure parent leave application foundation`). Initial working tree
was clean and index empty. G1 follows `498d66a3`. No commit or ref mutation is
performed by this implementation. All changes remain unstaged.

Authoritative master/MVP: `Hira_School_App_Features.pdf`, physical page 58,
re-extracted and visually reviewed. G2a implements Save and private draft history,
not the page's later Submit/Withdraw/decision/attachment capabilities.

Seven existing files modified:

| File | Narrow change |
|---|---|
| `backend/src/models/parentLeaveApplication.ts` | Draft revision/history validation; separate edit receipt model; index initializer |
| `backend/src/services/parent-application-access.service.ts` | Comment update identifying the G2a adapter; authority runtime unchanged |
| `backend/src/routes/parent-self.routes.ts` | Mount draft router after existing JWT/Parent/no-store middleware |
| `backend/src/server.ts` | Await required application/edit indexes before accepting traffic |
| `src/navigation/ParentNavigator.tsx` | Register the Parent leave screen |
| `src/screens/parent/ParentWorkspaceScreen.tsx` | Existing-theme navigation button |
| `__tests__/parent-workspace.test.tsx` | Add the new route to the exact existing route expectation; retain old routes and one-root-container assertion |

Eight files created:

1. `backend/src/routes/parent-leave-draft.routes.ts`
2. `backend/src/services/parent-leave-draft.service.ts`
3. `backend/tests/parent-leave-draft.security.test.ts`
4. `src/services/parent/leaveApplicationService.ts`
5. `src/screens/parent/ParentLeaveApplicationsScreen.tsx`
6. `__tests__/parent-leave-applications.test.tsx`
7. `__tests__/parent-leave-service.test.ts`
8. `docs/integration/pr-g2a-parent-leave-drafts.md`

No dependency, root TypeScript, native, Finance, Student/Teacher domain or F-series
implementation changes. Existing Parent navigation/entry points are extended for
G2a only. No generic applications engine or new approval authority is introduced.

## B. Faraz adaptation matrix

Read-only donor worktree: `D:/Faraz-Reference`, clean at
`293966bf7f477bd430133e91d9a87d75523782f4`. This is the inspected donor snapshot;
no new remote query, fetch or claim of current remote freshness was made in G2a.

| Donor evidence | Disposition | G2a implementation |
|---|---|---|
| `ParentApplicationsPage.jsx:92` selected-child form/list/detail composition | ADAPT | Canonical verified-child picker, scoped list and separate editor |
| `ParentApplicationsPage.jsx:119` request generation and selected-child reset | ADAPT/STRENGTHEN | Auth/Branch/token keyed remount, child/enrollment keyed editor, focus/request lifetime fences |
| `ParentApplicationsPage.jsx:181` field feedback and synchronous sending lock | ADAPT/STRENGTHEN | Typed leave fields, real date feedback, in-flight guard and durable backend operation receipts |
| `ParentApplicationsPage.jsx:204` uncertain network result handling | ADAPT/STRENGTHEN | Same payload/revision/operation retained for retry; fields locked until resolved |
| `ParentApplicationsPage.jsx:420` chronological status history presentation | ADAPT | Draft-created/edited revision/time metadata, not approval history |
| Parent `parentService.js:65` application list/submit API | REJECT contract; adapt interaction only | Canonical bearer API client and narrow Parent draft paths |
| `applicationService.js:24` legacy class Teacher routing | REJECT | No approver resolution or Teacher routing |
| `applicationReviewRoutes.js` review/notifications | REJECT | No decisions, domain effects or notifications |
| Preview samples, independent auth/session/runtime/theme/models | REJECT | Existing HIRA components, memory-only auth and canonical G1/Mongoose authority |

No donor source is imported into the runtime. UI behavior is selectively rebuilt
using HIRA primitives rather than copying its backend/identity contracts.

## C. Backend API and authority contract

Base: `/api/parent/me/children/:studentId/leave-applications`.

| Method/path | Contract |
|---|---|
| `POST /` | Create an unlinked draft using the unchanged G1 create operation receipt |
| `GET /?offset=0&limit=25` | Own/current-provenance draft summaries and bounded pagination; no reason or history in summaries |
| `GET /:applicationId` | Authorized owner's private current draft plus revision/action/time history |
| `PATCH /:applicationId` | Edit fields at expected revision, using a separate durable edit operation receipt |

Create body: `leaveType`, `startDate`, `endDate`, `reason`, `clientOperationId`.
Edit body: those fields plus `revision`. No role, Branch, requester, Student,
enrollment, approver, state, history, attachment or URL input is accepted.
Impossible/reversed dates and missing/malformed values are rejected. Technical
limits remain G1's 80-character type, 500-character reason and 120-character
operation ID; no unapproved school catalogue/duration/retroactive rule is added.

All routes inherit JWT authentication, persisted active role validation,
Parent-only RBAC and `Cache-Control: no-store` from the Parent router. Every
service uses G1 registered-session/verified-child/current enrollment authority.
Application queries include immutable originating Branch, requester, Student,
link and academic provenance. A second guardian is not automatically the owner
of another guardian's private draft. Current link/session/role/Branch/enrollment
changes deny old access; retained records are not deleted or silently retargeted.

Writes reuse G1's actual Branch transaction, exact Session fence, dependency
fences and post-lock/post-write authority checks. Reads recheck canonical
authority and witness identity after data fetching, before returning DTOs.
Sanitized 401/403/404/409/400 responses never expose foreign records or database
errors. Unknown persistence failures return a generic retryable 500 message.

Summary DTO: application/Student IDs, literal `draft`, type/dates, revision and
created/updated times. Detail adds private current reason and history metadata
`action`, `revision`, `at`. Raw requester/verifier/enrollment/Branch IDs, storage
references, fingerprints and operation ledger records are not serialized.
History does not duplicate previous private reason bodies; it records who acted
internally and displays the owner's creation/edit revision/time metadata.

### Concurrency and receipts

- Creation's immutable owner/operation/fingerprint fields remain unchanged by
  edits. Replaying creation returns the same application and current authorized
  detail, not a new record.
- `ParentLeaveEditOperation` has a database-unique `(requesterId,
  clientOperationId)` key, immutable application/Branch/Student provenance,
  fingerprint and resulting revision. Create/edit operation namespaces are
  separate. A changed payload/revision/application using an edit ID conflicts.
- Edit fingerprint includes application ID, expected revision and normalized G1
  payload fingerprint. Replay is checked only after current application authority.
- Under the persisted Branch lock, the service checks expected revision, updates
  the draft with Mongoose optimistic concurrency, validates the full history and
  draft-only invariant, and inserts the edit receipt in the same transaction.
- Concurrent distinct edits at one revision yield one winner and one 409.
  Identical operations converge on one edit/history event. Failure inserting the
  receipt rolls back content, revision, history and timestamps.
- The acknowledgement's `operationRevision` is the original edit result, while
  `application` is a fresh authorized current DTO. Replaying an older edit never
  rewinds later edits. Client editing always uses the current DTO's revision.
- Post-commit response/detail reads are separately authorized. A failed response
  read does not undo an already committed edit; the same operation safely retries.
- Every persisted application remains `draft` with null ApprovalRequest linkage
  and no attachments. Drafts reserve no leave dates; overlapping drafts are allowed.

History validation now requires revision `n` to have exactly `n+1` contiguous,
chronological owner-attributed events: one `draft_created` then `draft_edited`.
The Mongoose/native-driver boundary remains G1's documented trusted-service
contract, not a new database foreign-key/authorization mechanism.

### Index initialization before endpoints

The existing canonical startup already awaits required domain index helpers
before `app.listen`. G2a adds `ensureParentLeaveApplicationIndexes` at
`backend/src/server.ts:40`; listening remains at `:74`. The helper creates both
application and edit receipt indexes. Failure prevents startup reaching listen.
Tests explicitly call this real helper and inspect the resulting unique MongoDB
indexes, including the edit owner-operation index. No `server.ts` redesign or
runtime index deletion is introduced. A production boot using real deployment
credentials was not performed.

## D. Parent UI functionality

The existing Parent workspace opens a registered `ParentLeaveApplications`
screen. It uses HIRA DashboardShell, ScreenHeading, SectionCard, Button,
WorkspaceTabs, StatusBadge and theme tokens. Every visible status is explicitly
labelled **Draft**, and text explains that saving does not submit an application.

Verified children are fetched from the canonical Parent service. The selected
child's name/Branch/Class/Section remains visible. New drafts and authorized
existing drafts expose type, start/end dates and private reason, with field-level
feedback. Save confirmation comes from the server; no optimistic success is shown.
The list is paginated; details show saved revision history. Empty/loading/error
and retry states are provided. No enabled or placeholder Submit/Approve/Withdraw
action exists. Medical upload is not exposed.

The whole scope remounts on account, role, token or Branch changes. Child and
enrollment identity remount private editor state. Focus loss clears the child
workspace, and request generations/lifetime guards reject late responses.
Current 401/403/404 clears protected summaries, editor/form/history and selected
child state. Only a current 401 may call canonical logout. A stale denial cannot
log out or clear a newer account. Unknown errors never display raw private error
messages.

Unconfirmed saves retain the exact attempted fields, expected revision and
operation ID in memory and offer **Retry save**. Fields/close are locked while
the result is uncertain. A 409 requires explicit reload before editing; successful
save followed by list-refresh failure does not repeat the write or claim that
the save was unconfirmed. Synchronous in-flight guards prevent double taps.
Secure IDs use the existing native random-values runtime and fail closed when
secure native generation is unavailable. No private form is persisted locally.

Switching scope discards local pending UI state; a previously sent operation can
still commit while authorized, and its durable backend receipt remains. Returning
to that scope reloads server history. No automatic cross-scope resubmission occurs.

## E. Security and concurrency verification

Real MongoMemoryReplSet suites use owned ephemeral databases and existing local
MongoDB binaries, not a configured application database or `.env`. New tests use
real HTTP routes plus two independent Node edit processes. Timing/fault hooks
pause collection operations or inject a receipt-storage error; relationship and
authorization resolution are never mocked.

Verified cases include:

- Verified Parent ownership and exact safe list/detail DTOs.
- Foreign valid Student/application IDs, wrong roles and unauthenticated access.
- Unverified/revoked/inactive links, Branch/enrollment transfer and changed
  session/role; slow-read revocation and committed pre-transaction revocation.
- Database index existence/uniqueness, duplicate creates/edits, conflicting
  operation reuse, stale revisions, competing same-revision edits and two-process
  serialization.
- Immutable original creation receipt after edits and replaying an old edit
  after a newer revision without rewinding state.
- Receipt failure rollback of content, revision/history and timestamps.
- Rejection of forged authority, lifecycle and attachment fields; unchanged real
  attendance records; zero new approvals, StudentLeave, corrections or notifications.
- UI field validation, same-operation retry, double-tap prevention, 409 reload,
  save-versus-list-refresh distinction and no false save confirmation.
- Current list/detail/save 401/403/404 concealment; child/account/token/Branch/role
  switching; late old detail/save/denial response isolation; canonical navigation.

G1's 69 existing tests and existing Parent/Principal authority regressions remain
passing. The single existing route expectation was extended for the intended new
route; no old route or authorization assertion was removed.

## F. Exact test results

Final distinct automated tests: **253 PASS, 0 FAIL**.

| Group | Count | Exit |
|---|---:|---:|
| G2a backend plus G1 security/policy | 99 PASS / 0 FAIL | 0 |
| Existing Parent scope/occurrence/academic and Principal approval backend | 79 PASS / 0 FAIL | 0 |
| New frontend screen/service | 29 PASS / 0 FAIL | 0 |
| Existing Parent/service/Principal/auth/navigation frontend | 46 PASS / 0 FAIL | 0 |
| Backend TypeScript | No diagnostics | 0 |
| Mobile-scoped TypeScript | No diagnostics | 0 |
| Strict scoped ESLint | Zero errors/warnings | 0 |

No snapshots, cancellations, skips or pending tests are counted as passes.
Backend TypeScript uses the existing backend project; mobile TypeScript uses the
existing mobile-scoped project. Root configuration and deferred F-AUD-03 are
unchanged. Native Android/iOS builds, device/keyboard/visual/accessibility review
and actual production HTTPS connectivity were not run and are not labelled PASS.

Development attempts before the final passes: initial backend TypeScript caught
Express parameter typing and widened Mongoose filter-state types, now narrowed;
initial mobile TypeScript caught a missing required retry callback, now supplied.
The first combined backend test run was 97/99, due to two new test harness errors
(sorting expected DTO keys and a wrong Notification export import), corrected
with assertions retained. First frontend run was 25/26 with the first renderer
test exceeding Jest's existing 5-second timeout; the unchanged timeout/assertions
passed on rerun. Initial lint caught three unused new test variables/imports;
they were removed. Existing security assertions were not weakened.

Exact final commands and raw output tails follow.

## G. G2b prerequisites and blockers

No remaining implementation blocker is known for the G2a draft-only scope.
Architectural review is required before any G2b work. Remaining prerequisites:

- School-approved leave type catalogue, approver/recommendation routing and any
  entitlement, duration, retroactive, calendar or retention policies.
- Protected medical attachment storage contract: validated content/type/size,
  authenticated owner/reviewer delivery, retention and revocation. No approved
  general Parent medical storage contract was found; uploads are not implemented.
- Atomic linked ApprovalRequest submission and typed source/reference/DTO rules;
  no fabricated Teacher requester, default approver or generic review bypass.
- Pending withdrawal and request-changes/resubmission lifecycle integration;
  existing ApprovalRequest status enum and decision authority remain unchanged.
- Principal typed decision integration with current category grants, requester
  separation, delegation policy and commit-time relationship checks.
- Attendance-owned effects that preserve occurrence authority, old marks and
  approved correction semantics. Generic approval must not mutate attendance.
- Typed canonical notification production/deduplication and protected navigation.
- Custody/early pickup is a separate safety owner and remains outside this slice.

No submission, withdrawal, approval decisions, attendance effects, notifications,
medical uploads, Finance, transport GPS, AI or generic applications engine was
implemented. No G2b work started. All changes remain unstaged.

## Validation command ledger

All commands below exited **0**. Raw tails include at most the last 20 lines;
shorter output is reproduced in full. Logs are outside the repository in TEMP.

### G2a and G1 backend

Working directory: `D:\SchoolManagementSystem\backend`. Exit: **0**. Counts: 99 tests: 99 PASS / 0 FAIL.

```powershell
.\node_modules\.bin\tsx.cmd --test tests/parent-leave-draft.security.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-application.policy.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2a-backend-run2.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output tail:

```text
✔ invalid edit input fails without mutation state approved (507.4355ms)
✔ invalid edit input fails without mutation requesterId forged (296.2312ms)
✔ invalid edit input fails without mutation branchId forged (298.5054ms)
✔ invalid edit input fails without mutation enrollmentId forged (281.6297ms)
✔ invalid edit input fails without mutation approvalRequestId 6aeb2aafb5da42bb66693fde (251.4509ms)
✔ invalid edit input fails without mutation protectedAttachmentIds 6aeb2aafb5da42bb66693fdf (268.9685ms)
✔ invalid edit input fails without mutation startDate 2026-02-30 (283.8277ms)
✔ invalid edit input fails without mutation endDate 2026-01-01 (269.1548ms)
✔ invalid edit input fails without mutation reason  (263.0186ms)
✔ invalid edit input fails without mutation revision -1 (244.2431ms)
✔ pagination is bounded and scope cannot be supplied in queries (328.7906ms)
✔ no approval/attendance/notification mutation or lifecycle endpoints (444.4844ms)
ℹ tests 99
ℹ suites 0
ℹ pass 99
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 26023.6343
```

### Existing backend regressions

Working directory: `D:\SchoolManagementSystem\backend`. Exit: **0**. Counts: 79 tests: 79 PASS / 0 FAIL.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/parent-scope.security.test.ts tests/parent-occurrence.security.test.ts tests/parent-academic.security.test.ts tests/approval-authority.security.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2a-regressions.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output tail:

```text
✔ another Parent child and valid foreign ObjectId are forbidden (195.8202ms)
✔ unverified/inactive/revoked relationship fails closed {"status":"pending"} (187.3743ms)
✔ unverified/inactive/revoked relationship fails closed {"status":"revoked"} (168.6068ms)
✔ unverified/inactive/revoked relationship fails closed {"isActive":false} (142.2212ms)
✔ unverified/inactive/revoked relationship fails closed {"verifiedBy":null} (141.1097ms)
✔ unverified/inactive/revoked relationship fails closed {"verifiedAt":null} (142.3463ms)
✔ unverified/inactive/revoked relationship fails closed {"createdBy":null} (161.271ms)
✔ Parent cannot self-verify or rely on a non-administrative verifier (149.9677ms)
✔ inactive Parent retains canonical 401 semantics; Student cannot use Parent routes (122.0391ms)
✔ link and child Branch mismatches are denied (145.3794ms)
✔ missing enrollment and inconsistent Section never fall back to child profile (184.7318ms)
✔ query-selected child or verification metadata grants no relationship (138.9404ms)
ℹ tests 79
ℹ suites 0
ℹ pass 79
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 20595.5324
```

### New frontend

Working directory: `D:\SchoolManagementSystem`. Exit: **0**. Counts: 29 tests: 29 PASS / 0 FAIL; 2 suites.

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2a-frontend-run2.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output tail:

```text
PASS __tests__/parent-leave-applications.test.tsx
PASS __tests__/parent-leave-service.test.ts

Test Suites: 2 passed, 2 total
Tests:       29 passed, 29 total
Snapshots:   0 total
Time:        3.412 s, estimated 24 s
Ran all test suites matching /__tests__\\parent-leave-applications.test.tsx|__tests__\\parent-leave-service.test.ts/i.
```

### Existing frontend regressions

Working directory: `D:\SchoolManagementSystem`. Exit: **0**. Counts: 46 tests: 46 PASS / 0 FAIL; 5 suites.

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/principal-approval-context.test.tsx __tests__/chat-navigation.test.tsx __tests__/auth-session.test.tsx 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2a-frontend-regressions.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output tail:

```text
PASS __tests__/principal-approval-context.test.tsx (7.797 s)
PASS __tests__/chat-navigation.test.tsx
PASS __tests__/parent-workspace.test.tsx
PASS __tests__/auth-session.test.tsx
PASS __tests__/parent-service.test.ts

Test Suites: 5 passed, 5 total
Tests:       46 passed, 46 total
Snapshots:   0 total
Time:        10.863 s, estimated 51 s
Ran all test suites matching /__tests__\\parent-workspace.test.tsx|__tests__\\parent-service.test.ts|__tests__\\principal-approval-context.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\auth-session.test.tsx/i.
```

### Final backend TypeScript

Working directory: `D:\SchoolManagementSystem\backend`. Exit: **0**. Counts: N/A (static check).

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2a-backend-ts-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (zero diagnostic lines).

### Final mobile-scoped TypeScript

Working directory: `D:\SchoolManagementSystem`. Exit: **0**. Counts: N/A (static check).

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2a-mobile-ts-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (zero diagnostic lines).

### Final strict scoped ESLint

Working directory: `D:\SchoolManagementSystem`. Exit: **0**. Counts: N/A (static check); zero errors/warnings.

```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 backend/src/models/parentLeaveApplication.ts backend/src/routes/parent-self.routes.ts backend/src/routes/parent-leave-draft.routes.ts backend/src/server.ts backend/src/services/parent-application-access.service.ts backend/src/services/parent-leave-draft.service.ts backend/tests/parent-leave-draft.security.test.ts src/navigation/ParentNavigator.tsx src/screens/parent/ParentWorkspaceScreen.tsx src/screens/parent/ParentLeaveApplicationsScreen.tsx src/services/parent/leaveApplicationService.ts __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts __tests__/parent-workspace.test.tsx 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2a-lint-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (zero diagnostic lines).

### Git and explicit file-scope checks

Working directory: `D:\SchoolManagementSystem`. Exit 0; test count N/A.

```powershell
git diff --check
git status --short
git diff --cached --name-only
git branch --show-current
git rev-parse HEAD
```

`git diff --check` passed. Git emitted LF-to-CRLF policy warnings for edited
tracked files, not whitespace errors. A separate explicit scan of all 15 intended
files, including untracked files, rejects trailing whitespace, missing final
newline and extra blank EOF lines. The exact Git status path set is compared to
the 15-file allowlist above; the staged-name list must be empty. Checks are
repeated after the report is finished.

File-scope/whitespace check output:

```text
Whitespace PASS: all 15 intended files, including untracked files.
Scope PASS: 7 modified tracked files and 8 new files; empty index.
```

### Final claim self-check

- Reviewed model guards/indexes, all new API/service exports, inherited route
  middleware, production startup ordering, DTOs and replay response semantics.
- Reviewed screen auth/child/focus keys, late-response guards, current denial
  concealment, save/reload/retry paths and canonical navigation entry.
- Verified the exact test counts against executed runner summaries. Earlier
  failed attempts are disclosed separately and are not added to final counts.
- Verified no actionable approval, attendance, notification or upload code path
  was added. G1 authority runtime, F-series services and root TS config are unchanged.
- Exact scope is 15 files; index empty; HEAD unchanged. No dependency install,
  commit, push, branch switch, merge, reset, clean or restore was used.

PASS — G2a Parent leave draft and history integration implemented and verified; awaiting architectural review.
