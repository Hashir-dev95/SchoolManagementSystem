# G1 — Parent Leave Application Foundation

Audit/implementation date: 2026-11-04 (Asia/Karachi).

## A. Baseline and scope

Repository `D:/SchoolManagementSystem`; branch `integration/team-merge`; initial
HEAD `498d66a373142f037b2d1fd4a1f634c54cfea739`. Initial working tree was clean
and the index empty. No branch, dependency, startup, route, approval engine,
attendance, mobile or donor files are changed. Changes remain unstaged.

Product authority: `C:/Users/Laptop Valley/OneDrive/Documents/Hira_School_App_Features.pdf`
is the master/MVP specification, as clarified by the Lead Engineer. Physical
page 58 specifies Parent leave dates/type/private reason, optional medical
attachment, assigned reviewer, pending withdrawal and decision history. Pages
10, 20 and 57 preserve Branch/approval separation and attendance ownership.
G0 approved typed Parent intake linked to existing ApprovalRequest authority.

Exactly six new files are allowed and created:

1. `backend/src/models/parentLeaveApplication.ts`
2. `backend/src/services/parent-application-access.service.ts`
3. `backend/src/services/parent-leave-application.policy.ts`
4. `backend/tests/parent-application-authority.security.test.ts`
5. `backend/tests/parent-leave-application.policy.test.ts`
6. `docs/integration/pr-g1-application-foundation.md`

## B. Typed model and invariants

`ParentLeaveApplication` stores server-derived requester, Student, originating
Branch, ParentStudentLink, StudentEnrollment, AcademicPeriod, Class and Section
references. These identity/provenance references are immutable. It stores leave
type, date-only start/end, private reason, application revision, lifecycle state,
future ApprovalRequest reference, future opaque protected-attachment references,
immutable create operation/fingerprint, timestamps and creation provenance.

G1 persists **unlinked drafts only**, at application revision zero, with one
`draft_created` event attributed to the requester. The Mongoose document
validation guard rejects pending/terminal states, populated approval references,
populated protected attachment references and other initial revisions. This
guard must not be removed independently of the later atomic workflow. There is
no approved boolean, approver default, routing rule or actionable ApprovalRequest.

Leave type is bounded free text, not an invented school category catalogue.
Type/reason bounds (80/500 characters) and operation bound (120 characters) are
technical input limits, not school entitlement policy. Date validation rejects
impossible, reversed and timestamp-shaped ranges. G1 does not invent a maximum
leave duration, future-only rule, holiday calendar, balance or allowed category.

Indexes declared on the model:

- Unique `(requesterId, clientOperationId)` across Branch changes and children:
  the create operation cannot be silently reused for a different child/Branch.
- `(branchId, requesterId, studentId, createdAt desc)` for future owner history.
- `(branchId, studentId, state, startDate, endDate)` for future overlap queries.
- Unique non-null ObjectId `approvalRequestId` for future one-to-one linkage.

Tests explicitly create indexes in their ephemeral database. The module is not
mounted/imported into production startup in G1, so production initialization of
this new model is not claimed. G2 must use the established index/init pattern and
prove required indexes before enabling routes. `server.ts` is unchanged.

Mongoose validation is not a database security perimeter. Native collection
writes and unguarded query updates can bypass document validators, as with other
canonical models. Future writers must use typed services, compare-and-set and
transactions. The indexes are database-enforced uniqueness constraints, not a
cross-document foreign-key or interval-exclusion constraint.

## C. Pure lifecycle and future integration contracts

`validateParentLeaveTransition` implements the six intended edges:

```text
draft -> pending
pending -> approved | rejected | changes_requested | withdrawn
changes_requested -> pending
```

All other pairs, including repeated terminal decisions, are rejected. Safe
integer revision equality is required and the result advances the revision once;
overflow is denied. Requester capability permits submit/resubmit/withdraw.
Reviewer capability permits approved/rejected/changes_requested. Meaningful
bounded applicant-visible reasons are required for rejection/change requests.

This is a pure validation contract, **not an authorization grant or mutation**.
Capability strings must be derived by trusted future callers, never accepted as
frontend authority. Current reviewer category, role, session, Branch, requester
separation and delegation checks remain canonical ApprovalRequest concerns.
G1 contains no reviewer resolver and no executable decision or withdrawal writer.

`assertNoActiveParentLeaveOverlap` defines the proposed submit-time interval
contract: pending, approved and changes_requested records for the same Student
and Branch block inclusive overlapping dates, across requesters. Drafts,
rejected and withdrawn records reserve no dates. This predicate is tested but
**not a production overlap-exclusion workflow**. G2/G3 must query/check/insert
under the same persisted Branch transaction lock. No unique date index can
enforce arbitrary date-range exclusion. Independent draft operations may overlap.

## D. Current authority and revocation

`authorizeParentApplication` first verifies the actual JWT, binds it to the
authenticated identity and requires Parent role. It uses the same first-token
record semantics as `session.service.ts:isTokenRevoked`, additionally matching
session user/role. Missing/revoked sessions and mismatched/expired/invalid tokens
fail closed. A duplicate live token row cannot revive the first revoked record.

The boundary calls canonical `verifiedChild`, which uses `parentActor`,
`currentAcademicActor`, active Branch and `resolveStudentReadScope`. This retains
current active persisted Parent role, independently verified live link, current
verifier eligibility, exact active Student/User and one valid current enrollment
with valid academic references. Profile class/section strings are never authority.

When an application ID is supplied, the query includes every server-derived
provenance reference, including requester and originating Branch. Another
verified guardian does not become the owner of an existing private application.
New enrollment or Branch provenance cannot silently retarget the old record.
Role/session failure uses sanitized 401; unavailable child/application authority
uses sanitized 404. No private reason, file, fingerprint or foreign profile is
included in service responses/errors. Invalid input uses bounded generic errors.

Revocation policy: current link and canonical scope are required on each protected
access and before retry acknowledgement. Revocation/transfer conceals retained
drafts; it does not delete them. A complete valid new-Branch relationship still
cannot expose the old-Branch record. No historical permission exception is added.

`withParentApplicationWriteAuthority` reuses `withAcademicCatalogLock` (persisted
Branch conflict, snapshot transaction, primary reads, majority write concern).
It fences the exact registered Session, Parent/Student/verifier Users, Student,
ParentStudentLink, StudentEnrollment and academic dependencies. The reused
`communicationFence` is only a collection-document lock helper; Teacher or chat
eligibility is not reused. Fresh canonical authority is checked after locking and
after the trusted callback; witness changes and JWT expiry abort the transaction.
This is commit-order serialization, not a promise that revocation can retroactively
undo a mutation that committed before the revocation.

`withPrincipalWriteAuthority` and all existing role unions remain unchanged.
The internal callback boundary grants Parent ownership only, never approval.
It is not exposed through an HTTP endpoint.

## E. Draft persistence, replay and privacy

`createParentLeaveDraft` is an internal G1 persistence exercise, not a production
submission endpoint. It accepts only type/dates/reason/operation ID. Branch,
requester, academic placement, approval state, attachments and URLs are rejected
as unsupported input. It returns only application ID and replay acknowledgement.

Normalized trimmed/NFC payload plus canonical Student ID produces a versioned
SHA-256 fingerprint. The immutable draft create fields are the create-operation
receipt. Under the Branch transaction lock:

1. Current authority is validated before looking up any receipt.
2. Same owner/operation, provenance and fingerprint replays the original ID.
3. Changed payload conflicts; changed provenance is concealed.
4. Otherwise one unlinked draft is inserted with creation history.
5. Failure rolls back both draft and its receipt; retry can create normally.

Real replica-set tests exercise simultaneous identical and conflicting operations,
two independent Node processes, unique-index rejection and rollback. No in-memory
mutex or mocked relationship resolver is used. The race tests pause a collection
operation only to establish timing, commit actual authority changes, then resume
real MongoDB locking/validation. Native fixture writes are deliberate test setup,
not a production import or permission mechanism.

Private reason, operation ID, fingerprint and future attachment references are
`select:false`. This is query hygiene, not encryption or authorization. Direct
trusted model reads must never be serialized as API DTOs. G1 returns no medical
evidence and supports no medical upload, storage, URL or file retrieval.

## F. Boundaries, remaining policies and G2/G3 prerequisites

- **Approver routing — pending school policy.** No default Teacher/Principal is
  invented. Current TeacherAssignment is not a unique class-approver registry.
- **Protected medical attachments — future implementation.** Need scoped storage,
  type/size validation, authenticated delivery, retention and access policy.
- **Parent submit/history/withdraw endpoints — not implemented.** No routes/mobile
  screens/navigation are added. Draft persistence does not claim a complete Save UI.
- **Principal typed decision integration — not implemented.** Future typed source
  allowlisting, DTOs and requester separation must reuse existing grants. Generic
  review/resubmission must not bypass new typed application effects.
- **ApprovalRequest integration — not implemented.** Submission must atomically
  create the typed link and approval; withdrawal must atomically make the linked
  pending approval non-reviewable. Existing status enum is unchanged; its future
  withdrawn extension requires explicit review. Never keep two decision authorities.
- **Draft edit/resubmission operation ledger — future implementation.** Creation
  receipts cannot be recomputed from edited content; later operations need their
  own immutable receipts and revision checks. No edit writer exists in G1.
- **Attendance effect — not implemented.** Existing occurrence-anchored
  StudentLeave is Teacher-initiated. Do not impersonate a Teacher to bridge Parent
  date-range intake. An attendance-owned adapter must preserve original marks and
  approved correction behavior; never auto-fill unmarked attendance or equate
  live participation with physical attendance.
- **Notifications — not implemented.** Need typed canonical request event/target,
  atomic event identity/deduplication and current recipient authority. No sensitive
  request text in notification summaries. No push-delivery guarantee is implied.
- **Custody/early pickup — outside G1.** Parent verification alone is not custody
  authority, and an approved request is not a confirmed gate exit.
- School leave catalogue, duration/retroactive rules, working-day semantics,
  approver/recommendation routing and detailed retention policy remain unapproved.
- F-AUD-03 and actual production/native deployment checks remain separate.

No G2/G3 workflow, bulk Faraz import, frontend-only authorization, finance,
payroll, transport GPS or AI feature is implemented here.

## G. Validation evidence

The command ledger below records actual exits/counts and raw output tails.
Empty native output is identified explicitly. Test fixtures use owned ephemeral
MongoMemoryReplSet databases and existing installed binaries/dependencies; no
configured application database or real `.env` is used. Logs are outside the
repository in the host temporary directory.

### Validation ledger

Final distinct tests: **206 PASS, 0 FAIL** (69 G1 plus 137 existing regressions).
Earlier executions are listed separately and are not added to that total.

#### Initial G1 launch (sandbox startup failure)

Working directory: `D:\SchoolManagementSystem\backend`. Exit: **1**. Counts: 0 tests executed; tsx failed before test discovery.

```powershell
.\node_modules\.bin\tsx.cmd --test tests/parent-application-authority.security.test.ts tests/parent-leave-application.policy.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g1-new-initial.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
          ^

SystemError [ERR_SYSTEM_ERROR]: A system error occurred: uv_os_get_passwd returned ENOMEM (not enough memory)
    at Object.userInfo (node:os:306:11)
    at file:///D:/SchoolManagementSystem/backend/node_modules/tsx/dist/temporary-directory-Du7LpLp9.mjs:1:659
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at async node:internal/modules/esm/loader:643:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {
  code: 'ERR_SYSTEM_ERROR',
  info: {
    errno: -4057,
    code: 'ENOMEM',
    message: 'not enough memory',
    syscall: 'uv_os_get_passwd'
  },
  errno: [Getter/Setter],
  syscall: [Getter/Setter]
}

Node.js v24.19.0
```

#### First executable G1 run

Working directory: `D:\SchoolManagementSystem\backend`. Exit: **1**. Counts: 68 tests: 67 PASS, 1 FAIL, 0 cancelled/skipped.

```powershell
.\node_modules\.bin\tsx.cmd --test tests/parent-application-authority.security.test.ts tests/parent-leave-application.policy.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g1-new-run1.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 39051.552

✖ failing tests:

test at tests\parent-application-authority.security.test.ts:477:1
✖ model rejects non-draft lifecycle, malformed dates, revision and evidence references (249.8705ms)
  Error [StrictModeError]: Field `approved` is not in schema and strict mode is set to throw.
      at model.$set (D:\SchoolManagementSystem\backend\node_modules\mongoose\lib\document.js:1207:19)
      at model.Document (D:\SchoolManagementSystem\backend\node_modules\mongoose\lib\document.js:183:12)
      at model.Model (D:\SchoolManagementSystem\backend\node_modules\mongoose\lib\model.js:143:12)
      at new model (D:\SchoolManagementSystem\backend\node_modules\mongoose\lib\model.js:5072:15)
      at TestContext.<anonymous> (D:\SchoolManagementSystem\backend\tests\parent-application-authority.security.test.ts:495:7)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    isImmutableError: false,
    path: 'approved'
  }
```

#### Corrected G1 run

Working directory: `D:\SchoolManagementSystem\backend`. Exit: **0**. Counts: 68 tests: 68 PASS, 0 FAIL, 0 cancelled/skipped.

```powershell
.\node_modules\.bin\tsx.cmd --test tests/parent-application-authority.security.test.ts tests/parent-leave-application.policy.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g1-new-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
✔ missing body and required fields fail closed (0.3519ms)
✔ pure contract permits draft -> pending with proper capability (0.348ms)
✔ pure contract permits pending -> approved with proper capability (0.0958ms)
✔ pure contract permits pending -> rejected with proper capability (0.0798ms)
✔ pure contract permits pending -> changes_requested with proper capability (0.1133ms)
✔ pure contract permits pending -> withdrawn with proper capability (0.1285ms)
✔ pure contract permits changes_requested -> pending with proper capability (0.0637ms)
✔ exhaustive state-pair matrix rejects every unlisted transition (0.7702ms)
✔ requester cannot decide and reviewer cannot submit/withdraw for requester (0.2822ms)
✔ stale, missing, invalid and exhausted revisions cannot transition (3.4325ms)
✔ rejection/change requests require bounded meaningful public reasons (1.3459ms)
✔ future overlap contract includes boundary dates and all active states (1.3597ms)
ℹ tests 68
ℹ suites 0
ℹ pass 68
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 19005.8137
```

#### Final G1 run (includes full Branch transfer)

Working directory: `D:\SchoolManagementSystem\backend`. Exit: **0**. Counts: 69 tests: 69 PASS, 0 FAIL, 0 cancelled/skipped.

```powershell
.\node_modules\.bin\tsx.cmd --test tests/parent-application-authority.security.test.ts tests/parent-leave-application.policy.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g1-new-verified.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
✔ missing body and required fields fail closed (0.455ms)
✔ pure contract permits draft -> pending with proper capability (0.5424ms)
✔ pure contract permits pending -> approved with proper capability (0.1495ms)
✔ pure contract permits pending -> rejected with proper capability (0.1065ms)
✔ pure contract permits pending -> changes_requested with proper capability (0.3294ms)
✔ pure contract permits pending -> withdrawn with proper capability (0.1365ms)
✔ pure contract permits changes_requested -> pending with proper capability (0.1036ms)
✔ exhaustive state-pair matrix rejects every unlisted transition (1.1361ms)
✔ requester cannot decide and reviewer cannot submit/withdraw for requester (0.4463ms)
✔ stale, missing, invalid and exhausted revisions cannot transition (0.4921ms)
✔ rejection/change requests require bounded meaningful public reasons (0.4584ms)
✔ future overlap contract includes boundary dates and all active states (0.8199ms)
ℹ tests 69
ℹ suites 0
ℹ pass 69
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12249.5469
```

#### Existing Parent/Principal approval/Student/Teacher authority regressions

Working directory: `D:\SchoolManagementSystem\backend`. Exit: **0**. Counts: 137 tests: 137 PASS, 0 FAIL, 0 cancelled/skipped.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/parent-scope.security.test.ts tests/approval-authority.security.test.ts tests/student-self.security.test.ts tests/teacher-scope.security.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g1-regressions.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
✔ revoked assignment immediately removes roster access (289.059ms)
✔ expired assignment immediately removes roster access (270.6511ms)
✔ future assignment immediately removes roster access (283.6974ms)
✔ current inactive change fails closed on roster and independent service call (258.7009ms)
✔ current role change fails closed on roster and independent service call (273.9195ms)
✔ current branch change fails closed on roster and independent service call (326.5156ms)
✔ current branch inactive change fails closed on roster and independent service call (257.7825ms)
✔ current permission change fails closed on roster and independent service call (268.7311ms)
✔ roster query/body injection never widens scope and malformed tuple IDs are sanitized (379.3968ms)
✔ roster has independent authentication/role gates and no guessed learner detail surface (350.7439ms)
✔ roster reference changes invalidate authority and DB failure is sanitized (287.2674ms)
✔ roster resolves scope once and executes one aggregate regardless of learner count (303.4165ms)
ℹ tests 137
ℹ suites 0
ℹ pass 137
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 41664.8253
```

#### Initial backend TypeScript

Working directory: `D:\SchoolManagementSystem\backend`. Exit: **0**. Counts: N/A (static check).

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g1-ts-initial.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (zero emitted lines).

#### Final backend TypeScript

Working directory: `D:\SchoolManagementSystem\backend`. Exit: **0**. Counts: N/A (static check).

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g1-ts-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (zero emitted lines).

#### Strict scoped ESLint: sms-g1-lint-initial.log

Working directory: `D:\SchoolManagementSystem`. Exit: **0**. Counts: N/A (static check; zero warnings/errors).

```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 backend/src/models/parentLeaveApplication.ts backend/src/services/parent-application-access.service.ts backend/src/services/parent-leave-application.policy.ts backend/tests/parent-application-authority.security.test.ts backend/tests/parent-leave-application.policy.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g1-lint-initial.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (zero emitted lines).

#### Strict scoped ESLint: sms-g1-lint-final.log

Working directory: `D:\SchoolManagementSystem`. Exit: **0**. Counts: N/A (static check; zero warnings/errors).

```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 backend/src/models/parentLeaveApplication.ts backend/src/services/parent-application-access.service.ts backend/src/services/parent-leave-application.policy.ts backend/tests/parent-application-authority.security.test.ts backend/tests/parent-leave-application.policy.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g1-lint-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (zero emitted lines).

#### Strict scoped ESLint: sms-g1-lint-verified.log

Working directory: `D:\SchoolManagementSystem`. Exit: **0**. Counts: N/A (static check; zero warnings/errors).

```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 backend/src/models/parentLeaveApplication.ts backend/src/services/parent-application-access.service.ts backend/src/services/parent-leave-application.policy.ts backend/tests/parent-application-authority.security.test.ts backend/tests/parent-leave-application.policy.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-g1-lint-verified.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (zero emitted lines).

The initial sandbox launch failed in `os.userInfo` before test discovery. The
same authorized tests then ran with host access to existing local MongoDB and
Node workers. Automatic approval review did not reject the test runs.

The first executable run's one failure was in the new test wrapper: Mongoose's
strict unknown-field rejection throws during construction, before `.validate()`
returns. The assertion was changed to wrap construction in an async function;
the unknown-field rejection expectation was retained. No production behavior or
existing assertion was weakened. The final run additionally proves valid current
new-Branch authority cannot expose an old-Branch application. JWT is rechecked
at the end of the access boundary as well as at write completion.

### Formatting commands

Working directory for all three: `D:\SchoolManagementSystem`. Each exit was 0;
test count N/A. Only the explicit new files were formatted. Exact commands and
their complete raw output (each shorter than 20 lines):

```powershell
.\node_modules\.bin\prettier.cmd --write backend/src/models/parentLeaveApplication.ts backend/src/services/parent-application-access.service.ts backend/src/services/parent-leave-application.policy.ts backend/tests/parent-application-authority.security.test.ts backend/tests/parent-leave-application.policy.test.ts
```

```text
backend\src\models\parentLeaveApplication.ts 372ms
backend\src\services\parent-application-access.service.ts 49ms
backend\src\services\parent-leave-application.policy.ts 25ms
backend\tests\parent-application-authority.security.test.ts 63ms
backend\tests\parent-leave-application.policy.test.ts 20ms
```

```powershell
.\node_modules\.bin\prettier.cmd --write backend/tests/parent-application-authority.security.test.ts
```

```text
backend\tests\parent-application-authority.security.test.ts 324ms
```

```powershell
.\node_modules\.bin\prettier.cmd --write backend/src/services/parent-application-access.service.ts backend/tests/parent-application-authority.security.test.ts
```

```text
backend\src\services\parent-application-access.service.ts 228ms
backend\tests\parent-application-authority.security.test.ts 93ms
```

### Git, untracked-file whitespace and exact scope

Working directory: `D:\SchoolManagementSystem`. Commands below exit 0;
test count N/A. `git diff --check` cannot inspect untracked files, so the explicit
six-file whitespace check is also required. Git inspection was repeated after
the report was completed.

```powershell
git diff --check
git status --short
git diff --cached --name-only
git diff --name-only
```

Raw output (all lines; diff checks and both name lists are empty):

```text
?? backend/src/models/parentLeaveApplication.ts
?? backend/src/services/parent-application-access.service.ts
?? backend/src/services/parent-leave-application.policy.ts
?? backend/tests/parent-application-authority.security.test.ts
?? backend/tests/parent-leave-application.policy.test.ts
?? docs/integration/pr-g1-application-foundation.md
```

Exact PowerShell whitespace/scope command, run before and after ledger completion:

```powershell
$g1Paths = @('backend/src/models/parentLeaveApplication.ts','backend/src/services/parent-application-access.service.ts','backend/src/services/parent-leave-application.policy.ts','backend/tests/parent-application-authority.security.test.ts','backend/tests/parent-leave-application.policy.test.ts','docs/integration/pr-g1-application-foundation.md')
foreach ($g1Path in $g1Paths) {
  $g1Text = [IO.File]::ReadAllText((Join-Path (Get-Location) $g1Path))
  if ($g1Text -match '(?m)[\t ]+$' -or -not $g1Text.EndsWith("`n") -or $g1Text -match '\r?\n\r?\n\z') { throw "Whitespace failure: $g1Path" }
  Write-Output "Whitespace PASS: $g1Path"
}
$g1Status = @(git status --porcelain=v1 --untracked-files=all)
$g1Actual = @($g1Status | ForEach-Object { if (-not $_.StartsWith('?? ')) { throw 'Unexpected tracked/index modification' }; $_.Substring(3) })
if ($g1Actual.Count -ne 6 -or @(Compare-Object ($g1Paths | Sort-Object) ($g1Actual | Sort-Object)).Count) { throw 'Unexpected file scope' }
if (@(git diff --cached --name-only).Count) { throw 'Index is not empty' }
Write-Output 'Scope PASS: exactly six allowed new files; no tracked modifications; empty index.'
```

Raw output (all lines):

```text
Whitespace PASS: backend/src/models/parentLeaveApplication.ts
Whitespace PASS: backend/src/services/parent-application-access.service.ts
Whitespace PASS: backend/src/services/parent-leave-application.policy.ts
Whitespace PASS: backend/tests/parent-application-authority.security.test.ts
Whitespace PASS: backend/tests/parent-leave-application.policy.test.ts
Whitespace PASS: docs/integration/pr-g1-application-foundation.md
Scope PASS: exactly six allowed new files; no tracked modifications; empty index.
```

## H. Claim self-check and G1 verdict

- Model/index/guard claims checked against `parentLeaveApplication.ts` schema,
  indexes and validation hook. No medical file storage or approved boolean exists.
- Authority/replay claims checked against all exports of
  `parent-application-access.service.ts`. Only the draft creator writes an
  application; no ApprovalRequest or attendance mutation is imported there.
- Lifecycle, revision and overlap claims checked against pure policy exports.
  Pure validation does not grant a reviewer role or persist a state transition.
- Security test coverage includes valid/foreign ownership, link verification and
  revocation, enrollment/catalog inconsistency, Branch transfer, changed role,
  inactive account, missing/revoked session, mismatched token, operation/index
  conflicts, multi-process duplicates, actual committed authority races,
  rollback, model guards, default private-field omission and unchanged real
  attendance records. No new HTTP application endpoint is claimed as tested.
- All six allowed files reviewed; existing tracked code/tests unchanged. No
  dependency installation, commit, push, branch switch, reset, restore or clean.
- Remaining unimplemented policies/workflows are listed in F; they are later
  slice prerequisites, not unresolved dependencies of this draft foundation.
- Native/mobile builds and production connectivity were not run or claimed.

DONE — G1 Parent Leave Application Foundation implemented and verified; G2/G3 workflows remain unimplemented.
