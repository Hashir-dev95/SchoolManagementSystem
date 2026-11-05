# G3b Parent Leave Decisions and Attendance Coverage

## A. Git baseline and scope

The starting branch was `integration/team-merge` at `c635a2925ae33c3c86e107243943b71b16be0f1f` (`g3a`), with an empty index and a clean worktree. G2b, G2a and G1 were present at `d6e0c2f0`, `3ee65a68` and `81da0399`. The committed G2b root artifact whose name ends in `U+F022` was excluded from this change.

## B. HIRA PDF requirements and integration formula

Implementation followed **HIRA PDF → Faraz's existing work → canonical HIRA architecture → secure gap implementation → tests and architectural verification**.

| Physical PDF page | Requirement | G3b scope |
| --- | --- | --- |
| 10 | Scoped Principal decisions, requester separation, repeat prevention, confirmation and history | The typed decision route requires current view and manage authority. Revision checks and receipts protect repeat requests. Mobile confirmation precedes writes and detail refresh follows server acknowledgment. |
| 19 | Preserve authorship, attendance history, roster and version controls | The decision writes coverage. Existing attendance records and Teacher occurrence authority govern marks. |
| 20 | Effective attendance changes through approved corrections, with old values retained | The canonical correction path checks coverage for a requested `leave` status. Parent approval neither creates nor decides a correction. |
| 57 | Keep classroom, gate and online attendance distinct. Unmarked is its own state. | Occurrence coverage is a separate indicator. Future dates and unscheduled days do not create marks or sessions. |
| 58 | Leave dates, verified child, pending withdrawal, decision history and controlled attendance effects | G2b owns withdrawal. G3b adds typed approval and rejection, Parent decision history and coverage bound to the exact child and enrollment. Medical files and notifying the guardian are separate slices. |

Source reviewed from `C:/Users/Laptop Valley/OneDrive/Documents/Hira_School_App_Features.pdf`, physical pages 10, 19, 20, 57 and 58.

## C. Faraz donor adaptation

Local donor checkout `D:/Faraz-Reference` at `293966bf`.

| Donor source | Adapted behavior | Authority kept in canonical HIRA |
| --- | --- | --- |
| `src/mobileApp/TeacherApplicationsPage.jsx:20` | Busy feedback, retry after failure and server-confirmed review | HIRA modal confirmation, scoped request generation and stable operation identity. |
| `src/mobileApp/TeacherApplicationsPage.jsx:38` | Chronological status history and distinct decision labels | Typed, authorized history DTOs and existing HIRA cards. |
| `backend/src/applicationService.js:24` | Reference for the donor workflow only | Option A shared own-Branch Principal authority. Donor `classTeacherAssignments` and stored reviewer routing were excluded. |
| `backend/src/applicationReviewRoutes.js:29` | Stale-action feedback and bounded reviewer notes | HIRA validates persisted JWT session, Branch, role, grant, relationship and enrollment. Generic status-only writes and donor notification behavior were excluded. |

## D. Canonical authority reuse

- `ApprovalRequest` remains the canonical decision record. The reciprocal G2b link and submission fingerprint remain in force, alongside the generic detail, mutation, delegation and resubmission exclusions.
- The write path shares the persisted `withAcademicCatalogLock` Branch fence with Parent submission and withdrawal. Teacher occurrence mutation acquires that same Branch document first and keeps existing TeacherAssignment, effective-Teacher and occurrence checks.
- G3a's current Parent subject proof checks the verified relationship, eligible verifier, active Parent and Student and exact enrollment. The reviewer uses their own registered Principal session. The applicant's login state has no bearing on the relationship proof.
- `StudentLeave` owns attendance coverage. Existing attendance sessions, marks, effective-state projection and correction review retain authority over physical attendance.

## E. Locked policies

1. **Exact enrollment and academic period.** Approval checks the entire inclusive school-local range against the pinned active enrollment and its term. It rejects date gaps, cross-term dates and another intersecting enrollment. `effectiveTo` is an exclusive civil-date boundary. A fresh authorized application is required for a different enrollment.
2. **Symmetric overlap.** Same-Student, same-Branch Parent and Teacher reservations conflict on inclusive date overlap. Both writers serialize on the Branch lock. Parent-versus-Parent and Teacher-versus-Teacher behavior is preserved.
3. **Revoked relationship.** Typed decisions and reads require the current authorized subject proof. Inaccessible records and their reservations are retained for a separately authorized resolution workflow.
4. **Routing.** The typed write requires Principal view and manage permissions, the configured `leave` grant and exact equality with the active Option A policy version. The transaction rechecks the actor, registered session, permissions, grant and policy before returning its result.
5. **Attendance ownership.** Approval creates coverage. It preserves original marks, existing effective corrections and unmarked status, and creates no attendance session or notification.

## F. Typed decision contract

`POST /api/principal/parent-leave-reviews/:approvalId/decisions` accepts `action` (`approve` or `reject`), `applicationRevision`, `approvalVersion` and `clientOperationId`. Rejection requires `decisionReason`, normalized to NFC and bounded to 10–500 characters. Approval accepts no decision reason. Current authorized detail supplies `decisionVersion` only while pending and manageable. The typed queue and dashboard remain pending-only. Authorized typed detail can display approved and rejected records.

A successful response returns approval ID, terminal state, application revision, decision time and replay flag. Missing or revoked session returns `401`. Missing view/manage permission returns `403`. Foreign, corrupt or currently inaccessible linked records return a concealed `404`. Stale revisions, conflicting replay and disallowed coverage ranges or overlaps return `409`. The frontend refreshes the scoped detail on `409` and clears data on current `401/403/404`.

Both decisions require subject validity, reciprocal links, policy, status, quoted revisions, full-range eligibility and the current cross-origin overlap check. Rejection releases only the reservation for the linked valid application. A request that fails these checks remains available only through an applicable Parent withdrawal or a separately authorized resolution workflow.

## G. Attendance-owned coverage

The `parent_application` variant of `StudentLeave` records the Parent requester, actual Principal reviewer, linked ApprovalRequest and application IDs, submitted revision, exact enrollment and academic tuple, inclusive dates and review time. It carries no Teacher identity, attendance session, medical reason or attachment. The partial unique `one_parent_leave_coverage` index allows one approved coverage row per application. Existing Teacher rows without an origin marker retain their legacy representation.

Teacher correction and Principal oversight share the exact Parent coverage membership filter. Readers first authorize the real scheduled occurrence or submitted roster. Parent coverage additionally requires the matching Branch, Student, exact enrollment, class, section, academic period and school date. Historical lookups use the half-open enrollment interval. A same-tuple replacement enrollment does not inherit old coverage. Principal oversight exposes coverage separately from marks, and the existing Teacher correction flow can consume the coverage ID after its own checks. Parent rows are excluded from legacy attendance-request history and typed Teacher leave review.

The existing pre-listen initializers create the coverage and receipt indexes even with automatic indexing disabled. The application initialization builds the Principal receipt index, and attendance amendment initialization builds the coverage index.

## H. Parent and Teacher overlap enforcement

Parent submission checks existing pending and approved Teacher reservations before creating the pending application reservation. Principal approval checks again to catch older conflicts. Teacher-origin creation and approval check pending and approved Parent reservations under the same Branch lock. The Teacher path still validates the authorized occurrence and Student evidence. It uses the stored range tied to that occurrence for the reservation, including legacy records. A correction to an unrelated status remains available through the existing correction path.

## I. Withdrawal, concurrency and durable receipts

The decision transaction fences the reviewer and exact login record, the Parent, Student account and profile, the relationship and verifier, enrollment, term, class and section. It uses the Branch lock before these dependencies. The compare-and-set operations consume both pending revisions and append both histories at one decision instant. The approval CAS uses the typed native collection to preserve the shared instant through the history append. Coverage for approval and the receipt are part of that same transaction. Rejection creates no coverage and leaves its application outside active-reservation states.

The Principal receipt is separate from Parent creation, editing and lifecycle receipts. Its unique key is reviewer and client operation ID. It stores both linked IDs, action, expected revisions, normalized payload fingerprint, decision time and coverage identity. Replay requires current authorization. An identical replay returns the original outcome, and changed reuse returns `409`.

## J. Exact file scope

| Area | Files |
| --- | --- |
| Typed review and history | `backend/src/controllers/parent-leave-review.controller.ts`, `backend/src/routes/principal.routes.ts`, `backend/src/services/parent-leave-review.service.ts`, `backend/src/models/parentLeaveApplication.ts`, `backend/src/models/parentLeaveDecisionOperation.ts`, `backend/src/services/parent-leave-draft.service.ts` |
| Attendance and reservation | `backend/src/models/attendanceAmendment.ts`, `backend/src/services/attendance-parent-leave.service.ts`, `backend/src/services/approval-scope.service.ts`, `backend/src/services/attendance-amendment.service.ts`, `backend/src/services/parent-leave-lifecycle.service.ts`, `backend/src/services/principal-attendance.service.ts`, `backend/src/services/teacher-timetable.service.ts` |
| Mobile | `src/hooks/useParentLeaveReviewRead.ts`, `src/screens/parent/ParentLeaveApplicationsScreen.tsx`, `src/screens/principal/PrincipalParentLeaveReviewScreen.tsx`, `src/services/parent/leaveApplicationService.ts`, `src/services/principal/parentLeaveReviewService.ts` |
| Tests | `backend/tests/parent-leave-decision.security.test.ts`, `backend/tests/helpers/parent-leave-decision-worker.ts`, `backend/tests/parent-leave-review.security.test.ts`, `__tests__/parent-leave-applications.test.tsx`, `__tests__/principal-parent-leave-review.test.tsx` |
| Closure report | `docs/integration/pr-g3b-parent-leave-decisions-attendance.md` |

## K. Validation commands, exits, counts and output tails

The G3b race workers used independent Node.js processes against a real local MongoDB replica set. The first worker holds the persisted Branch write and the second signals its lock attempt before the first is released. Approval and rejection each ran against withdrawal in both orders. A duplicate approval replay and competing Principals also ran across separate processes. Failure injection covered the application update, approval CAS, coverage insert and receipt insert. The final focused run repeats the decision tests from the broader integration run, so those counts are counted once.

### Baseline approval, attendance amendment and G3a

Working directory `D:\SchoolManagementSystem\backend`. Exit `0`. 117 passed, 0 failed, 0 skipped.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/approval-authority.security.test.ts tests/attendance-amendment.security.test.ts tests/parent-leave-review.security.test.ts
```

```text
✔ invalid routing policy hides the application from queue, detail and count (839.2436ms)
✔ incompatible routing version hides the application from queue, detail and count (811.5562ms)
✔ changed Principal Branch hides the application from queue, detail and count (823.7671ms)
✔ revoked Parent link hides the application from queue, detail and count (1010.7802ms)
✔ unverified Parent link hides the application from queue, detail and count (897.0465ms)
✔ replaced enrollment with the same academic tuple hides the application from queue, detail and count (987.6283ms)
✔ broken approval backlink hides the application from queue, detail and count (891.5827ms)
✔ broken application backlink hides the application from queue, detail and count (878.213ms)
✔ invalid submitted revision hides the application from queue, detail and count (911.5103ms)
✔ changed submitted payload hides the application from queue, detail and count (884.9324ms)
✔ self-review hides the application from queue, detail and count (927.9172ms)
✔ terminal approval hides the application from queue, detail and count (869.9783ms)
ℹ tests 117
ℹ suites 0
ℹ pass 117
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 72336.5157
```

### G3b, G3a and attendance integration

Working directory `D:\SchoolManagementSystem\backend`. Exit `0`. 166 passed, 0 failed, 0 skipped.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/parent-leave-decision.security.test.ts tests/parent-leave-review.security.test.ts tests/attendance-amendment.security.test.ts tests/principal-attendance.security.test.ts
```

```text
✔ patterns reject invalid range/filter from=2020-01-01 (157.8741ms)
✔ patterns reject invalid range/filter from=2099-01-01 (446.0011ms)
✔ patterns reject invalid range/filter until=2099-01-01 (153.4402ms)
✔ patterns reject invalid range/filter branchId=forged (109.9898ms)
✔ patterns reject invalid range/filter offset=-1 (126.7023ms)
✔ oversight response omits sessions, credentials, approval reasons and operation fingerprints (421.3532ms)
✔ missing eligible roster is an overview configuration exception as well as a detail exception (206.3624ms)
✔ live lesson connection does not change unmarked physical attendance or absence patterns (258.4036ms)
✔ school civil date and timezone align overview, Home and timetable boundaries (238.8813ms)
✔ Principal oversight exposes no direct attendance marking mutation (230.9468ms)
✔ roster and request history pages are bounded independently (1010.3181ms)
✔ submitted history keeps the actual substitute context after a newer replacement is approved (458.6024ms)
ℹ tests 166
ℹ suites 0
ℹ pass 166
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 98380.9384
```

### G1–G2b, approval, Principal, Parent, enrollment and Teacher attendance regressions

Working directory `D:\SchoolManagementSystem\backend`. Exit `0`. 345 passed, 0 failed, 0 skipped.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/parent-scope.security.test.ts tests/student-enrollment.security.test.ts tests/teacher-attendance.security.test.ts
```

```text
✔ malformed IDs, unknown fields and invalid statuses are sanitized and write nothing (497.6408ms)
✔ actual unique indexes protect occurrence, row and operation identities (363.9953ms)
✔ foreign timetable occurrence is concealed even with valid IDs (615.9974ms)
✔ same operation identity from separate actors cannot expose or deduplicate another actor audit (986.7507ms)
✔ real concurrent student movement is fenced until the valid attendance write commits (859.6194ms)
✔ real concurrent timetable retirement waits for fenced attendance commit (778.4987ms)
✔ three explicit draft marks out of thirty never turn the other twenty-seven into absences (818.9097ms)
✔ Teacher view and manage permissions never broaden Principal or Super Admin attendance authority (343.2181ms)
✔ Teacher period attendance does not reinterpret or modify legacy daily summaries (573.8172ms)
✔ Principal cannot reach Teacher attendance even with mistakenly granted operational permissions (347.8106ms)
✔ submitted history pins the old version after an approved replacement; draft history stays operational (821.5956ms)
✔ historical substitute read is record-specific and explicit substitute revocation still denies it (742.3146ms)
ℹ tests 345
ℹ suites 0
ℹ pass 345
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 126717.0611
```

### Focused G3b rerun after strict decision and contention checks

Working directory `D:\SchoolManagementSystem\backend`. Exit `0`. 37 passed, 0 failed, 0 skipped, included in the 166 above.

```powershell
.\node_modules\.bin\tsx.cmd --test tests/parent-leave-decision.security.test.ts
```

```text
✔ session revocation after Branch lock prevents stale commit (400.9747ms)
✔ enrollment revocation after Branch lock prevents stale commit (378.439ms)
✔ failure at parentleaveapplications rolls back the whole decision (427.3079ms)
✔ failure at approvalrequests rolls back the whole decision (397.0075ms)
✔ failure at studentleaves rolls back the whole decision (466.1438ms)
✔ failure at parentleavedecisionoperations rolls back the whole decision (416.1843ms)
✔ independent processes approve versus withdrawal, withdrawal owns Branch lock first (2743.8291ms)
✔ independent processes approve versus withdrawal, decision owns Branch lock first (2642.9505ms)
✔ independent processes reject versus withdrawal, withdrawal owns Branch lock first (2386.1481ms)
✔ independent processes reject versus withdrawal, decision owns Branch lock first (2485.8697ms)
✔ simultaneous approvals in independent processes acknowledge exactly one persisted receipt (2364.0107ms)
✔ two different Principals cannot commit competing decisions (3494.2656ms)
ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 33043.7771
```

### Mobile Parent, Principal, attendance, auth and navigation

Working directory `D:\SchoolManagementSystem`. Exit `0`. 149 passed, 0 failed, 10 suites.

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/principal-parent-leave-review.test.tsx __tests__/principal-approval-context.test.tsx __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/chat-navigation.test.tsx __tests__/auth-session.test.tsx __tests__/attendance-amendment.test.tsx __tests__/principal-attendance.test.tsx
```

```text
PASS __tests__/principal-approval-context.test.tsx (9.59 s)
PASS __tests__/parent-leave-applications.test.tsx (6.46 s)
PASS __tests__/principal-attendance.test.tsx
PASS __tests__/parent-workspace.test.tsx
PASS __tests__/attendance-amendment.test.tsx
PASS __tests__/chat-navigation.test.tsx
PASS __tests__/principal-parent-leave-review.test.tsx
PASS __tests__/auth-session.test.tsx
PASS __tests__/parent-service.test.ts
PASS __tests__/parent-leave-service.test.ts

Test Suites: 10 passed, 10 total
Tests:       149 passed, 149 total
Snapshots:   0 total
Time:        26.163 s, estimated 39 s
Ran all test suites matching /__tests__\\principal-parent-leave-review.test.tsx|__tests__\\principal-approval-context.test.tsx|__tests__\\parent-leave-applications.test.tsx|__tests__\\parent-leave-service.test.ts|__tests__\\parent-workspace.test.tsx|__tests__\\parent-service.test.ts|__tests__\\chat-navigation.test.tsx|__tests__\\auth-session.test.tsx|__tests__\\attendance-amendment.test.tsx|__tests__\\principal-attendance.test.tsx/i.
```

### Static and Git verification

| Working directory | Command | Exit | Output |
| --- | --- | --- | --- |
| `D:\SchoolManagementSystem\backend` | `.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` | 0 | Empty |
| `D:\SchoolManagementSystem` | `.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json` | 0 | Empty |
| `D:\SchoolManagementSystem` | `.\node_modules\.bin\eslint.cmd --max-warnings=0 ($paths \| Where-Object { $_ -match '\.tsx?$' })` | 0 | Empty |
| `D:\SchoolManagementSystem` | `git -c core.safecrlf=false diff --check` and `git diff --cached --check` | 0 | Empty |

`$paths` was `@(git -c core.safecrlf=false diff --name-only) + @(git ls-files --others --exclude-standard)`. The scope gate compared it against the 24 paths in section J, checked each path with `Select-String -LiteralPath $path -Pattern '[ \t]+$' -Quiet`, checked `git diff --cached --name-only`, and compared the artifact blob via `git hash-object -- $artifact`. Exit `0`.

```text
Branch and original HEAD verified. 24 paths match approved scope (19 modified, 5 new).
Tracked, staged, and untracked whitespace clean. Index empty. G2b artifact matches its committed blob.
```

Initial test runs exposed a generated subdocument timestamp that caused valid approval replay to fail, and an incorrect TeacherAssignment import in the new fixture. The native approval CAS now writes the common decision timestamp, and the fixture uses the model's default export. Final runs include the real replay, correction and overlap tests.

## L. Remaining G3c, medical and notification work

G3c owns request changes and typed Parent resubmission. Medical evidence requires a protected upload, access and delivery contract. Guardian notification production requires its own authorization, deduplication and delivery verification. Device testing and production deployment verification were outside this work.

## M. Stranded-request resolution follow-up

A future own-Branch operational view should flag still-pending reservations when the typed subject proof fails because the Parent or Student is inactive or moved, the verified link or verifier is invalid, the exact enrollment or academic references are stale, or the pinned routing version no longer matches. It should also flag pending reservations blocked by invalid dates or a pre-existing cross-origin conflict. The operational output needs opaque request IDs, Branch, reservation window and reason codes for triage. Private evidence requires its own detail authority.

The school must approve a separate, explicit own-Branch resolution capability and designate the staff authorized to use it. The contract must define which conditions justify closure and reservation release, the required resolution reason and audit history, and how both linked rows are invalidated atomically under the Branch lock. Normal approval permission and generic Super Admin status do not grant this capability. Existing records and reservations are retained pending an applicable authorized withdrawal or that future resolution.

## N. Multi-worker routing consistency limitations

Option A and category grants are environment-backed. Each transaction checks the current configuration in its own worker before commit. A worker running an older grant can still see that older grant. Persisted actor, session and relationship revocations use database fences. Instantaneous fleet-wide configuration revocation is unverified.

The deployment preflight contract is to run the following digest check in every serving worker's launch environment and require a match to the release controller's expected digest before admitting traffic. Hash exact configuration bytes and keep the JSON out of logs. For a policy revoke or incompatible version change, remove all old workers from routing, deploy the approved version and grant configuration, verify matching digests, and then admit traffic. The digest check complements the API's own validation of configured policy and grant values.

```powershell
node -e "const {createHash}=require('node:crypto'); const keys=['PARENT_LEAVE_ROUTING_POLICY','PRINCIPAL_APPROVAL_AUTHORITY','SCHOOL_TIMEZONE']; const values=keys.map(k=>[k,process.env[k]??null]); if(values.slice(0,2).some(([,v])=>!v)) process.exit(2); console.log(createHash('sha256').update(JSON.stringify(values)).digest('hex'))"
```

The `node -e` command above was exercised with synthetic inputs from `D:\SchoolManagementSystem`. Identical configurations matched, changing the grant changed the digest, and the command returned `2` for a missing grant. The enclosing check returned `0` and printed the line below. The traffic-drain procedure was not exercised against a production fleet.

```text
Identical synthetic configuration matches; changed grant differs; missing grant exits 2.
```

## O. Verdict

**PASS** for the G3b code and automated acceptance gates. The two final backend groups passed 511 tests without double-counting the focused rerun, and mobile passed 149 tests. Exact path scope, an empty index and unchanged HEAD were verified.

DONE — G3b Typed Principal Approve/Reject and Attendance-Owned Parent Leave Coverage implemented and verified under locked HIRA policies; G3c remains disabled.

