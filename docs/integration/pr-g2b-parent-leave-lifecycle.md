# G2b Parent Leave Submission & Withdrawal

## A. Git baseline and final scope

Implementation began from a clean worktree and empty index on `integration/team-merge` at `3ee65a6810875807e32573bac9323be556b5295e`. The baseline includes G1 at `81da0399` and the G2a draft/history commit. HIRA PDF page 58 and the G2b contract audit define submission, pending withdrawal and private history. The approved brief selects the shared own-Branch Principal queue.

| Area | Files |
| --- | --- |
| Models and indexes | `backend/src/models/approvalRequest.ts`, `backend/src/models/parentLeaveApplication.ts`, `backend/src/models/parentLeaveOperation.ts` |
| Parent APIs | `backend/src/routes/parent-leave-draft.routes.ts`, `backend/src/services/parent-leave-draft.service.ts`, `backend/src/services/parent-leave-lifecycle.service.ts`, `backend/src/services/parent-leave-routing.policy.ts` |
| Generic approval guards | `backend/src/services/approval-request.service.ts`, `backend/src/services/approval-resubmission.service.ts` |
| Mobile | `src/screens/parent/ParentLeaveApplicationsScreen.tsx`, `src/services/parent/leaveApplicationService.ts`, `src/services/principal/principalService.ts` |
| Tests and report | `backend/tests/parent-leave-lifecycle.security.test.ts`, `backend/tests/parent-leave-draft.security.test.ts`, `__tests__/parent-leave-applications.test.tsx`, `__tests__/parent-leave-service.test.ts`, this report |

## B. Approved Option A routing

Enable intake for the specified Branches through a server deployment setting. The value below is an example with a placeholder identifier.

```json
{
  "policy": "shared_branch_principal",
  "version": 1,
  "enabled": true,
  "branchIds": ["<approved-branch-object-id>"]
}
```

Set this JSON as `PARENT_LEAVE_ROUTING_POLICY`. Use the same policy version and Principal grants across workers. The policy parser rejects missing, disabled, malformed and inapplicable values. An eligible queue requires an active persisted Principal in the originating Branch, approval view/manage role permissions and a matching server-configured `leave` category grant. The transaction fences eligible membership and stores the policy identifier and version on the submission.

The queue is shared and stores no individual assignee. A Principal's registered session and current authorization will be checked when G3 provides an actual review action. Queue membership at intake can include staff who are signed out. The code and fixtures establish the contract. Deployment configuration and device operation are outside the verification evidence.

## C. Atomic submission

`POST /api/parent/me/children/:studentId/leave-applications/:applicationId/submit` accepts the quoted revision and `clientOperationId`.

The inherited Parent routes and G1 transaction wrapper verify the registered session, persisted role, active Branch, verified child link and exact enrollment and application provenance. The application revision, state and link participate in the save predicate alongside Mongoose optimistic concurrency. The persisted Branch lock serializes the inclusive date overlap check across guardians for pending, approved and changes-requested Parent applications.

The transaction creates the canonical approval and reciprocal link, freezes the saved payload using a private submission fingerprint, appends owner history and inserts the operation receipt. ApprovalRequest has a partial unique index on Parent application entity IDs. The existing startup initializer creates the lifecycle receipt and approval indexes before serving requests.

## D. Atomic withdrawal

`POST /api/parent/me/children/:studentId/leave-applications/:applicationId/withdraw` accepts the same request shape. Withdrawal verifies the reciprocal IDs, Branch, requester and submitted revision. The canonical approval must be pending at the observed version. The transaction sets both records to withdrawn, records the owner and withdrawal time, removes active delegation fields and appends history and a receipt. Existing history and frozen submission metadata survive the transition. Withdrawal remains available when routing is disabled for new submissions.

## E. Canonical approval protection

ApprovalRequest remains the canonical decision record. Parent leave is excluded from generic reviewable queues and generic detail, approve, reject, change-request and delegation operations. Generic resubmission rejects the source independently of requester role. The generic reference allowlist does not resolve the new source in G2b.

The generic approval record uses the neutral summary “Parent leave application”. Private reason and submission fingerprints remain in the Parent domain. Owner list summaries omit the reason. Authenticated owner detail returns the reason, state and history.

## F. Parent UI

The existing screen opens saved drafts and requires confirmation for submission and withdrawal. Unsaved edits must be saved before submission. Pending and withdrawn records remain in history, with read-only fields and server-confirmed labels. Confirmations and requests are scoped to the current account, token, Branch and child. Current 401/403/404 responses conceal protected data. Uncertain requests keep their operation ID and quoted revision for retry. The screen uses the existing HIRA components and retains the compatible Faraz form and history patterns.

## G. Idempotency and concurrency

Lifecycle operation IDs are unique per requester across submit and withdraw. The immutable receipt binds operation kind, normalized request fingerprint, requester, Branch, Student, application, approval and result revision. The result state follows from the stored operation kind. A matching replay follows fresh authorization and returns the original acknowledgement alongside the current application. A conflicting request receives 409.

Replica-set tests cover independent Node processes, overlapping guardians, edit/submission and stale withdrawal races, rollback of both linked writes on receipt failure, terminal states, revocation, backlink uniqueness and generic review denial. The G2a test for previously absent actions now asserts validation of malformed requests to those supported endpoints and retains the generic approve and side-effect assertions.

## H. Validation

| Verification | Exit | Result |
| --- | --- | --- |
| mobile | 0 | no diagnostics |
| backend-ts | 0 | no diagnostics |
| jest | 0 | 86 passed, 0 failed |
| lint | 0 | 0 errors, 0 warnings |
| backend | 0 | 125 passed, 0 failed |
| regressions | 0 | 179 passed, 0 failed |
| Git diff, exact scope and trailing whitespace | 0 | 17 expected paths, empty index, original HEAD |

The initial backend TypeScript check found typing errors, and strict ESLint found one test warning. Both were corrected. The additional generic resubmission test initially used the wrong request format and returned 400 before reaching the guard. The corrected test supplies the canonical quoted `If-Match` header and keeps the 403 assertion. The final suites passed 390 tests in total.

### mobile

Working directory `D:\SchoolManagementSystem`.

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2b-final-mobile.log" | Select-Object -Last 15; exit $LASTEXITCODE
```

The command emitted no diagnostics.

### backend-ts

Working directory `D:\SchoolManagementSystem\backend`.

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2b-final-backend-ts.log" | Select-Object -Last 15; exit $LASTEXITCODE
```

The command emitted no diagnostics.

### jest

Working directory `D:\SchoolManagementSystem`.

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/principal-approval-context.test.tsx __tests__/chat-navigation.test.tsx __tests__/auth-session.test.tsx 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2b-final-jest.log" | Select-Object -Last 15; exit $LASTEXITCODE
```

```text
PASS __tests__/parent-leave-applications.test.tsx (7.356 s)
PASS __tests__/chat-navigation.test.tsx
PASS __tests__/parent-workspace.test.tsx
PASS __tests__/auth-session.test.tsx
PASS __tests__/parent-leave-service.test.ts
PASS __tests__/parent-service.test.ts

Test Suites: 7 passed, 7 total
Tests:       86 passed, 86 total
Snapshots:   0 total
Time:        18.773 s
Ran all test suites matching /__tests__\\parent-leave-applications.test.tsx|__tests__\\parent-leave-service.test.ts|__tests__\\parent-workspace.test.tsx|__tests__\\parent-service.test.ts|__tests__\\principal-approval-context.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\auth-session.test.tsx/i.
```

### lint

Working directory `D:\SchoolManagementSystem`.

```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 backend/src/models/approvalRequest.ts backend/src/models/parentLeaveApplication.ts backend/src/models/parentLeaveOperation.ts backend/src/routes/parent-leave-draft.routes.ts backend/src/services/approval-request.service.ts backend/src/services/approval-resubmission.service.ts backend/src/services/parent-leave-draft.service.ts backend/src/services/parent-leave-lifecycle.service.ts backend/src/services/parent-leave-routing.policy.ts backend/tests/parent-leave-lifecycle.security.test.ts backend/tests/parent-leave-draft.security.test.ts src/screens/parent/ParentLeaveApplicationsScreen.tsx src/services/parent/leaveApplicationService.ts src/services/principal/principalService.ts __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2b-verified-lint.log" | Select-Object -Last 16; exit $LASTEXITCODE
```

The command emitted no diagnostics.

### backend

Working directory `D:\SchoolManagementSystem\backend`.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-application.policy.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2b-verified-backend.log" | Select-Object -Last 16; exit $LASTEXITCODE
```

```text
✔ a terminal approval or a broken backlink prevents withdrawal (443.4579ms)
✔ generic Principal queue, details, decisions and delegation stay closed during pending and withdrawal (589.6055ms)
✔ generic resubmission also denies a former Parent with a registered Principal session (335.6619ms)
✔ forged authority, private file fields and stale revisions produce no writes (311.0167ms)
ℹ tests 125
ℹ suites 0
ℹ pass 125
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 27489.5187
```

### regressions

Working directory `D:\SchoolManagementSystem\backend`.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/parent-scope.security.test.ts tests/parent-occurrence.security.test.ts tests/parent-academic.security.test.ts tests/approval-authority.security.test.ts tests/teacher-attendance.security.test.ts tests/attendance-amendment.security.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g2b-final-regressions.log" | Select-Object -Last 15; exit $LASTEXITCODE
```

```text
✔ Teacher period attendance does not reinterpret or modify legacy daily summaries (533.2379ms)
✔ Principal cannot reach Teacher attendance even with mistakenly granted operational permissions (367.0904ms)
✔ submitted history pins the old version after an approved replacement; draft history stays operational (750.5669ms)
✔ historical substitute read is record-specific and explicit substitute revocation still denies it (886.006ms)
ℹ tests 179
ℹ suites 0
ℹ pass 179
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 83344.9953
```

### Git and whitespace

Working directory `D:\SchoolManagementSystem`.

```powershell
git diff --check; if ($LASTEXITCODE) { exit $LASTEXITCODE }; git diff --cached --check; if ($LASTEXITCODE) { exit $LASTEXITCODE }; $g2bExpected = @('__tests__/parent-leave-applications.test.tsx','__tests__/parent-leave-service.test.ts','backend/src/models/approvalRequest.ts','backend/src/models/parentLeaveApplication.ts','backend/src/models/parentLeaveOperation.ts','backend/src/routes/parent-leave-draft.routes.ts','backend/src/services/approval-request.service.ts','backend/src/services/approval-resubmission.service.ts','backend/src/services/parent-leave-draft.service.ts','backend/src/services/parent-leave-lifecycle.service.ts','backend/src/services/parent-leave-routing.policy.ts','backend/tests/parent-leave-draft.security.test.ts','backend/tests/parent-leave-lifecycle.security.test.ts','docs/integration/pr-g2b-parent-leave-lifecycle.md','src/screens/parent/ParentLeaveApplicationsScreen.tsx','src/services/parent/leaveApplicationService.ts','src/services/principal/principalService.ts'); $g2bPaths = @(git -c core.safecrlf=false diff --name-only) + @(git ls-files --others --exclude-standard); if (Compare-Object ($g2bExpected | Sort-Object) ($g2bPaths | Sort-Object)) { throw 'Unexpected file scope' }; foreach ($g2bPath in $g2bPaths) { if (Select-String -LiteralPath $g2bPath -Pattern '[ \t]+$' -Quiet) { throw "Trailing whitespace in $g2bPath" } }; if (@(git diff --cached --name-only).Count) { throw 'Index is not empty' }; if ((git rev-parse HEAD) -ne '3ee65a6810875807e32573bac9323be556b5295e' -or (git branch --show-current) -ne 'integration/team-merge') { throw 'Unexpected branch or HEAD' }; Write-Output 'Scope verified: 17 expected files, no staged changes, original HEAD.'; git status --short
```

```text
Scope verified: 17 expected files, no staged changes, original HEAD.
```

Git printed the workspace's LF-to-CRLF notices. The diff check and the explicit trailing whitespace scan both succeeded.

## I. Medical evidence and G3

This implementation accepts text only and rejects attachment fields. Private medical evidence still requires authenticated encrypted storage, validation and restricted delivery, plus a retention and rollback contract. G3 must supply typed Principal decisions, live review authorization, the attendance-owned effect and the actual Principal decision-versus-withdrawal integration test. G2b tests generic decision denial during withdrawal. Notification production is deferred.

## J. Verdict

PASS for G2b. The original HEAD and empty index were verified at delivery.

DONE — G2b Parent Leave Submission & Withdrawal implemented and verified under approved Option A routing; G3 typed Principal decisions remain disabled.
