# G4b — Gate Staff and custody authority foundation

## A. Baseline and actual HEAD

Work began on `integration/team-merge` at `6602355e42cca4cc4da45109f3f27987f0b36653`, with a clean worktree and empty index. G3c and DEV-STARTUP-01 were committed. The baseline authorization run passed 195 tests with exit 0. The configured upstream was equal to HEAD. This implementation did not fetch or change refs.

## B. HIRA/Faraz compatibility

The authoritative local PDF pages 10, 51, 56 and 72 were inspected. Page 10 requires current scoped review and audit. Page 51 requires school-verified child relationships. Page 56 requires school-approved pickup authority and current custody checking. Page 72 requires assigned gate personnel and confirmed physical events. This foundation implements the identity, assignment and fail-closed prerequisites. Custody verification policy and actual release remain gated.

The G4a report in the conversation is the architecture input. The available donor at `D:/Faraz-Reference` is `293966bf7f477bd430133e91d9a87d75523782f4`. Its Parent pickup screen submits generic applications to an assigned class Teacher. The reference provided presentation context only. No donor identity, class-Teacher routing, status mutation or attendance authority was imported.

## C. Implemented Gate Staff role

`gate_staff` extends both canonical role unions and the exhaustive permission maps. Canonical login hashes, JWTs and registered sessions are reused. Public registration continues to create only Student accounts even when a caller submits a different role. Provisioning creates a new Gate Staff identity and does not change or activate an existing account. Its response excludes the password/hash.

Gate Staff has an empty permission list. A registered Gate Staff account receives only a narrowly authorized assignment metadata read after current Branch, Gate, assignment, validity and ownership verification. It receives no Student roster, custody evidence, operational task list or physical-event action.

## D. Permissions and provisioning

The new permissions are `gate.registry.manage`, `gate.assignments.manage`, `gate.operators.provision`, `gate.custody.manage`, `gate.tasks.view`, `gate.entry.record`, `gate.pickup.verify`, `gate.exit.confirm` and `gate.incident.escalate`.

Only the first four are granted, to global Super Admin. The broad Super Admin permission filter explicitly excludes the operational permissions. Existing Principal, Teacher, Parent, Student and Finance grants retain their previous contents. The existing approval matrix test was extended to assert the new operational exclusions while retaining its previous role assertions.

Administrative endpoints additionally require the current active persisted Super Admin with no account Branch, its registered session and an explicitly allowlisted active target Branch. `GATE_ADMIN_BRANCH_IDS` is a server-side JSON array of lowercase Branch ObjectIds. Missing, malformed, empty or duplicate configuration denies administration. Deployment operators must supply the reviewed allowlist consistently across processes. A route Branch selector never grants authority by itself.

This is the implementation choice for the current canonical global administrator model. Principal safety/approval grants do not acquire custody administration or checkout authority.

All writes require a stable `clientOperationId` and a bounded internal audit reason of 10–500 characters. Durable requester/operation receipts bind the action, target Branch/IDs and normalized content. Provisioning fingerprints use HMAC so the receipt stores no submitted password. Replay rechecks current administration authority. Reusing an operation ID with different content is 409. Duplicate credentials are 409. The password requirements and canonical account creation logic are reused from existing Teacher provisioning.

### Administrative API

All paths below have prefix `/api/gate-admin/branches/:branchId`.

| Method/path | Accepted domain fields in addition to operation ID and reason |
| --- | --- |
| `POST /operators` | `fullName`, `email`, `password` |
| `POST /gates` | `code`, `name` |
| `POST /gates/:gateId` | `name`, `isActive`, `revision` |
| `POST /gates/:gateId/assignments` | `operatorId`, `duties`, `validFrom`, `validUntil` |
| `POST /assignments/:assignmentId/revoke` | `revision` |
| `GET /students/:studentId/custody` | No body |
| `POST /students/:studentId/custody` | `state` restricted to Unknown/Hold, `revision` |

Bodies reject unknown authority fields. Parser failures and unexpected failures are sanitized. Responses use `Cache-Control: no-store`.

## E. Gate registry

Gate records have immutable originating Branch and normalized stable code, human-readable name, active state, explicit monotonic revision, creator/modifier identities and private append-only history. Codes use uppercase letters, digits, underscore and hyphen. Administrative updates require the exact revision and optimistic concurrency. A disabled Gate fails the current assignment context check and cannot receive a new assignment.

## F. Assignment model

Each assignment pins operator, Branch, Gate and validity interval. Only a current active same-Branch `gate_staff` User can be assigned. Self-assignment is denied. Duties are a strict known enumeration and describe allocated responsibilities for later activation. They grant no G4b operational permission.

Validity uses server time with an inclusive start and exclusive end. The Branch transaction serializes overlapping intervals for the same operator across Gates. A partial unique index also permits at most one stored active assignment per operator/Gate. An expired stored active assignment is unusable and must be explicitly revoked before replacing that same Gate slot. Revocation appends the actor, time, reason and next revision and retains the old evidence. Revoked assignments are terminal.

The model requires the unchanged audit prefix and an exact snapshot for every new revision. Assignment metadata exposes only Gate name/ID/revision, assignment ID/revision/end and an empty operational action list.

## G. Custody-state foundation

`StudentCustodyState` is school-owned and uniquely identified by Student and Branch. Student identity, exact enrollment, academic period, Class and Section are derived from the existing canonical Student scope service. The original provenance is immutable. Both business revision and authority revision advance monotonically together.

Missing state reads as Unknown. The supported writes are Unknown and Hold. The schema reserves the name Verified but its validation rejects entry into it, and the HTTP contract rejects it. A raw native Verified record would still project no release authority. `requireAutomatedReleaseAuthority` always denies in G4b.

The current DTO contains only effective state, revision, whether the original enrollment remains current, and `automatedReleaseAllowed: false`. It exposes no legal claims, restrictions text or evidence. Internal audit reasons are protected fields and must contain only the minimum operational explanation.

Closing or transferring the pinned enrollment conceals ordinary current access. A replacement enrollment does not inherit the old authority. For a same-Branch replacement, the effective state is Unknown and ordinary writes reject automatic retargeting with 409. The old row and its Hold history remain stored. Cross-Branch continuity, school verification and any administrative migration require a separately reviewed future contract.

## H. Current authority verification

The shared service checks verified JWT identity against the authenticated caller, current persisted role/active account, the first matching registered session and current Branch. Assignment context additionally checks exact Gate/operator/Branch linkage, Gate active state, active/unrevoked assignment, server-time validity, known duties and valid revisions.

The metadata route is `GET /api/gate/me/gates/:gateId/assignments/:assignmentId`. An authenticated Gate Staff account can read only its exact currently valid context. Business operations must also intersect assigned duties with role permissions. The G4b phase guard independently denies every operational action even if a permission map is mistakenly broadened.

Typed errors are 401 for invalid sessions or changed identities, 403 for forbidden role/capability/configuration, concealed 404 for unavailable objects and 409 for authorized version/state/replay conflicts. The service comment defines the mandatory future Student enrollment, current custody, school-approved pickup and release/challenge fences. No generic callback is selected from HTTP input.

## I. Indexes and transaction ordering

Required indexes are initialized before the listener using the existing startup index gate.

| Model | Required unique index |
| --- | --- |
| Gate | `{branchId, code}` with name `gate_branch_code_unique` |
| GateStaffAssignment | `{operatorId, gateId}` filtered by stored active status, `gate_operator_active_unique` |
| StudentCustodyState | `{studentId, branchId}`, `custody_student_branch_unique` |
| GateAdminOperation | `{actorId, clientOperationId}`, `gate_admin_operation_unique` |
| User | Existing unique email identity |

Gate active lookup and operator/Branch/validity indexes support scoped reads. Required index initialization is safe to repeat with autoIndex disabled. The real server startup test verifies all four new domain indexes before testing login.

All foundation transactions acquire the persisted active Branch lock first, then fence current account/session and the relevant domain dependencies. They recheck current authority before acknowledgment. Student custody writes fence exact academic provenance. Administrative result receipts and domain writes commit together with snapshot reads and majority durability. No process-memory lock substitutes for MongoDB concurrency.

## J. Security and concurrency tests

The new suite uses the existing isolated Parent/Student workspace replica-set fixture and never loads the development database configuration. Independent Node workers connect only to that owned fixture database.

Coverage includes public role injection, canonical hashed login, administrative allowlist enforcement, wrong roles, foreign Gate IDs/operators, current Branch, expired/future/revoked assignments, disabled Gate/account, missing/revoked sessions, changed roles, versions, malformed fields, immutable history, duplicate credentials and receipts, Hold/Unknown, rejected Verified claims, exact enrollment replacement and rollback.

Five independent-process cases cover duplicate assignment creation, assignment revocation against context access, committed role and session revocation during an attempt, and competing custody updates. The tests assert a single active assignment or winning custody version and the preserved audit trail. The preservation test stores attendance and Parent Leave records and verifies their exact contents after foundation operations.

The endpoint test verifies absent physical entry, exit, verification and challenge routes. The existing Parent router explicitly rejects unsupported operations with 403, which is asserted with its exact sanitized fallback message.

## K. Mobile compatibility

The Gate Staff role opens a minimal account destination showing activation status and sign-out through the existing AuthContext. It has no Student data, task list, scan action or checkout controls. The exhaustive mobile permission map includes the role with no grants. Tests verify root navigation, its sole sign-out action, handled logout transport failure and operational permission exclusion for all roles. Existing auth/session tests continue to own local logout clearing.

## L. Exact changed files

| Category | Paths |
| --- | --- |
| Existing backend wiring/types (6) | `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/models/user.ts`, `backend/src/constants/permissions.ts`, `backend/src/constants/rolePermissions.ts`, `backend/tests/development-startup.security.test.ts` |
| Existing approval regression (1) | `backend/tests/approval-authority.security.test.ts` |
| New backend foundation (4) | `backend/src/models/gateFoundation.ts`, `backend/src/services/gate-authority.service.ts`, `backend/src/services/gate-administration.service.ts`, `backend/src/routes/gate-foundation.routes.ts` |
| New backend verification (2) | `backend/tests/gate-foundation.security.test.ts`, `backend/tests/helpers/gate-foundation-worker.ts` |
| Existing mobile compatibility (4) | `src/constants/roles.ts`, `src/constants/permissions.ts`, `src/navigation/AppNavigator.tsx`, `__tests__/teacher-navigation.test.tsx` |
| New mobile compatibility (2) | `src/screens/gate/GateFoundationScreen.tsx`, `__tests__/gate-foundation.test.tsx` |
| Report (1) | `docs/integration/pr-g4b-gate-custody-authority.md` |

All paths are relative to `D:/SchoolManagementSystem`. Existing file changes are limited to the intended insertions. No dependency or lockfile changes were made.

## M. API-origin blocker

The committed active client at `src/services/api/apiClient.ts:1` still uses the private cleartext LAN URL identified by G4a. G4b did not alter it. Restoring the approved shared API-origin configuration and verifying production HTTPS is a separate deployment prerequisite for operational Gate functionality.

## N. School-policy decisions still pending

Custody verification evidence and authorized verifiers, disputed-custody precedence, multiple-guardian rights, pickup authorization/revocation rules, duration and exit windows, emergency release, delegation, outage verification/reconciliation, document protection and retention remain unapproved. Verified state activation, pickup authorization, early-exit review and all physical operations stay gated. The server Branch administration allowlist must be explicitly configured for reviewed administrative Branches.

## O. Regression results

The baseline invocation exited 0 with 195 passes and no failures. The first broad backend run exited 1 with 668 passes and two test-contract failures. One existing expected matrix assumed every newly introduced permission belonged to Super Admin. It was strengthened with explicit operational exclusions. The other test initially expected 404 from the Parent router's deliberate unsupported-operation 403 fallback. The corrected focused run exited 0 with 74 passes and no failures.

The initial mobile run overlapped replica-set testing and exited 1 with 132 passes and one existing Principal workspace timeout. Its assertions and timeout were retained for isolated rerun.

The final full backend invocation exited 0 with 671 passes and zero failures across 18 test files. It includes all 27 current Gate foundation cases and the existing G1–G3c, Parent scope, enrollment, approval, attendance, provisioning and startup checks. The final isolated mobile invocation exited 0 with 133 passes and zero failures across 10 suites. The earlier Principal workspace timeout passed with its original timeout unchanged.

| Final check | Exit | Verified result |
| --- | ---: | --- |
| Complete backend gate | 0 | 671 passed, 0 failed, 0 skipped |
| Mobile gate | 0 | 133 passed, 0 failed, 10 suites passed |
| Backend TypeScript | 0 | No diagnostics |
| Mobile-scoped TypeScript | 0 | No diagnostics |
| Strict scoped ESLint | 0 | No errors or warnings |
| Tracked and staged diff whitespace | 0 | Clean |
| Explicit whitespace on every changed/new path | 0 | Clean |
| Exact scope and Git gate | 0 | 20 intended paths, 11 tracked modifications, 9 new files, empty index |

For completeness, the first standalone foundation run had 23 passes and one failure caused by the same Parent fallback expectation. A diagnostic filtered invocation reproduced that assertion with zero passes and one failure. Those expectations were corrected to assert the existing denial contract. The earlier strict lint pass identified two shadowed variable names, which were renamed. No runtime authorization was relaxed and no test timeout was changed.

### Exact commands

Backend commands run in `D:/SchoolManagementSystem/backend`.

```powershell
# Clean pre-implementation baseline
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/parent-scope.security.test.ts tests/student-enrollment.security.test.ts tests/teacher-scope.security.test.ts tests/approval-authority.security.test.ts tests/bootstrap.security.test.ts
# Complete final backend gate
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/gate-foundation.security.test.ts tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-review.security.test.ts tests/parent-leave-decision.security.test.ts tests/parent-scope.security.test.ts tests/teacher-scope.security.test.ts tests/student-enrollment.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/teacher-attendance.security.test.ts tests/principal-attendance.security.test.ts tests/attendance-amendment.security.test.ts tests/development-startup.security.test.ts tests/bootstrap.security.test.ts tests/teacher-provisioning.security.test.ts
# Corrected focused gate
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/gate-foundation.security.test.ts tests/approval-authority.security.test.ts
# Backend TypeScript
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json
```

Mobile and repository checks run in `D:/SchoolManagementSystem`.

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/gate-foundation.test.tsx __tests__/teacher-navigation.test.tsx __tests__/auth-session.test.tsx __tests__/permissions.test.ts __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts __tests__/principal-parent-leave-review.test.tsx __tests__/principal-approval-context.test.tsx __tests__/principal-attendance.test.tsx __tests__/attendance-amendment.test.tsx
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json
$paths = @(git -c core.safecrlf=false diff --name-only) + @(git ls-files --others --exclude-standard)
.\node_modules\.bin\eslint.cmd --max-warnings=0 ($paths | Where-Object { $_ -match '\.tsx?$' })
git -c core.safecrlf=false diff --check
git diff --cached --check
foreach ($path in $paths) {
  if (Select-String -LiteralPath $path -Pattern '[ \t]+$' -Quiet) { throw "Trailing whitespace in $path" }
}
```

The mobile-scoped TypeScript configuration includes source, tests and App.tsx and excludes backend. The root TypeScript configuration was not modified. All testing is automated. Native Android/iOS builds, physical devices and production HTTPS connectivity were not verified in this phase.

## P. Final verdict

PASS — G4b foundation implemented and verified. Dedicated Gate Staff identity, server-enforced assignment scope, fail-closed custody, required indexes and independent-process concurrency checks pass. Existing Parent Leave and attendance regressions pass. The implementation exposes no physical release capability.

All 20 intended changes remain unstaged on `integration/team-merge` at the original HEAD. The API client, dependency manifests/locks, root TypeScript configuration, startup scripts and separately tracked G2b artifact are preserved. The index is empty. No commit, push, merge or later G4 implementation was performed. Operational deployment remains blocked on the separate API-origin correction, school policy and future typed pickup/release slices.
