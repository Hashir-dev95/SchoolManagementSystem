# G4e-2A — Safe backend custody foundation

Date: 2026-11-11 (Asia/Karachi).

## A. Baseline and authorized scope

Repository: `D:/SchoolManagementSystem`. Starting branch: `integration/team-merge`. Starting and unchanged implementation HEAD: `86b43c48b69cea40976a6e4c779a1ae7caaba952`. Initial worktree was clean and the index empty. No unexpected pending work was present. No fetch or remote-synchronization claim is made for this task.

The approved G4e-0 architecture audit and G4e-1 policy contract are conversation evidence, not repository files. Existing G4b/G4c/G4d reports and current production source were rechecked. This implementation adds only internal non-operational contracts and hardens validation of the existing canonical unconfigured policy. School policy remains unapproved.

## B. Exact five-path inventory

| Path | Rationale |
| --- | --- |
| `backend/src/services/school-custody-contract.ts` | Internal policy normalization/denial assessment, future custody/collector dependency types and collector identity-binding consistency comparison. |
| `backend/src/services/pickup-authorization.policy.ts` | Use the internal contract when loading the existing policy and projecting always-denied eligibility. Preserve existing DTO fields, sentinel creation and transaction ownership. |
| `backend/tests/school-custody-contract.test.ts` | Pure negative contract/binding tests; no mocked authorization. |
| `backend/tests/school-custody-foundation.security.test.ts` | Actual JWT/session/relationship and HTTP/service integration against a disposable real replica set. |
| `docs/integration/pr-g4e2a-safe-backend-foundation.md` | This implementation and validation report. |

No existing test assertion was modified. There are no new models, collections, indexes, routes, permissions, environment flags or startup initialization requirements. A new database record would duplicate the existing `PickupCustodyPolicy` sentinel without adding justified persistence. Existing domain writers and required startup indexes remain responsible for their current transactions.

## C. Canonical architecture reused

| Boundary | Exact source/function evidence |
| --- | --- |
| Canonical policy dependency | `backend/src/models/pickupAuthorization.ts:164`, `PickupCustodyPolicy`; activation validation at `:184`. |
| Current Parent/session authority | `backend/src/services/parent-application-access.service.ts:47`, `authorizeParentApplication`; `:110`, `withParentApplicationWriteAuthority`. |
| Independently verified relationship | `backend/src/services/parent-scope.service.ts:48`, `resolveVerifiedParentChild`. |
| Exact current enrollment and academic provenance | `backend/src/services/student-self-scope.service.ts:38`, `resolveStudentReadScope`; current-membership query at `:66`. |
| Branch-scoped transaction serialization | `backend/src/services/academic-catalog-lock.service.ts:9`, `withAcademicCatalogLock`; existing snapshot/majority and document-fence behavior unchanged. |
| Principal category grant | `backend/src/services/approval-authority.policy.ts:19`, `assertApprovalAuthority`; no default grants. |
| Current Gate identity and assignment | `backend/src/services/gate-authority.service.ts:30`, `currentIdentity`; `:137`, `assignmentContext`; `:196`, `withGateAssignmentContext`. |
| Custody administration and provenance | `backend/src/services/gate-administration.service.ts:484`, `updateStudentCustody`; Unknown/Hold only. |
| Existing safe proposal/review lifecycles | `backend/src/services/pickup-authorization-write.service.ts:146`, `writeParentPickup`; `pickup-authorization-review.service.ts:204`, `decidePickup`; `early-exit-write.service.ts:133`, `writeParentExit`, and `:388`, `decideEarlyExit`. |
| Required indexes before traffic | `backend/src/server.ts:67` through `:69`, existing Gate/Pickup/Early Exit initialization before listener at `:88`. |

## D. New contract and trust boundaries

`SCHOOL_CUSTODY_CONTRACT_VERSION = 1` versions the internal TypeScript contract. It is not a new persisted model field or a school approval version. Unknown schema fields injected into the persisted sentinel are rejected, not silently migrated or treated as supported school configuration.

`schoolCustodyPolicyContract` validates only supported canonical sentinel fields: policy identity, expected server-authorized Branch, bounded safe revision, `status: unconfigured`, `activationEnabled: false`, and optional valid persistence metadata. It returns a frozen internal contract with separate policy identity/revision, schema version, `schoolApproval: {state: unapproved, evidenceReference: null}`, and `activation: unavailable`. Missing, malformed, foreign-Branch or unknown-field records return null. Client-provided claims cannot supply policy authority.

`assessSchoolCustodyPolicy` validates the internal version/allowlists and distinguishes invalid contract, unsupported version and valid-but-unapproved policy. Its return type and every runtime path have `operationallyEligible: false`. There is no approved input variant, positive eligibility path, database activation switch or environment override. No approval evidence is accepted in this slice.

`currentPickupPolicy` now rejects malformed/fabricated persisted policy records with the existing sanitized 409 conflict. The old implementation checked only the policy revision, so a raw database activation/approval/unknown-version claim could still reach proposal detail as HTTP 200. This did not enable physical release in the baseline; existing guards already denied that. The change makes the policy contract itself fail closed while normal legacy sentinel draft/history behavior remains usable.

`pickupEligibility` retains its public DTO shape and false operational eligibility. Its policy revision comes only from a validated internal contract. Internal dependency types, fingerprints and evidence references are not added to API responses.

Future-only `CustodyVerificationDependencies` identifies canonical Student/Branch/exact enrollment/academic provenance, verifying actor/session and revisions, school authority reference, policy identity/schema/revision/approval reference, protected evidence reference, verification revision/validity, audit provenance and custody Hold/revocation dependencies. `CollectorVerificationDependencies` adds the exact original collector identity/revision/provenance binding. These are prerequisite descriptions, not runtime validation of those prerequisites, authenticated proof objects, approved verifier roles or accepted document/expiry rules. No service persists or executes them.

`collectorIdentityBindingMatches` checks record identity, all pinned provenance, person revision and the canonical identity fingerprint over full name/relationship/phone. Identity edits invalidate the old binding even if a corrupt source neglects to advance revision. It is only an internal consistency comparison, never a verification or authorization decision. A match does not validate session, role, evidence, policy, dates, Hold or revocation and must never be used alone for authority. This helper is not attached to a verification endpoint. Existing field allowlists, registered-session checks and persisted role/relationship/Branch fences remain the actual protected-operation boundaries.

No sensitive document storage, raw evidence acceptance, token logging or new API document exposure is introduced. Fingerprint comparison is in-memory and reuses the existing digest format; no new collector fingerprint persistence or delivery is added.

## E. Preserved fail-closed gates

- `StudentCustodyState -> verified` remains rejected by schema (`gateFoundation.ts:188`) and HTTP enum (`gate-administration.service.ts:492`).
- `PickupPerson` remains `proposed` (`pickupAuthorization.ts:143`); operational status remains inactive (`:277`).
- `PickupCustodyPolicy` activation remains unavailable (`pickupAuthorization.ts:184`).
- `requireAutomatedReleaseAuthority()` always denies (`gate-authority.service.ts:257`); typed Pickup Approve still invokes it (`pickup-authorization-review.service.ts:320`).
- `requireEarlyExitApprovalPolicy()` still denies (`early-exit-authority.service.ts:223`); typed Early Exit Approve still invokes it (`early-exit-write.service.ts:512`).
- Gate Staff has no operational permissions (`rolePermissions.ts:11`); `requireGateDuty` independently denies (`gate-authority.service.ts:244`).
- Generic typed-entity bypass guards remain unchanged (`approval-request.service.ts:37`, `:128`; `approval-resubmission.service.ts:20`).
- No QR/OTP issuance/redemption, student search, Gate entry/exit/checkout, operational collector revocation, emergency override, attendance/transport write or release notification endpoint was added.

## F. Security tests and red-to-green evidence

The four HTTP negative tests were written and executed before production changes. They injected native persisted `activationEnabled: true`, `status: approved`, unsupported `schemaVersion`, and fabricated school approval evidence. All four failed the intended assertion: baseline returned 200 instead of the required 409. Baseline result: 0 passed, 4 failed, exit 1. After hardening, the same assertions pass without weakening them.

The new two-file selection has 48 tests. Coverage includes missing/unsupported/malformed/fabricated policy contracts, valid sentinel compatibility, Branch identity and revision validation, Parent field forgery/self-verification attempts, foreign Student access, current revoked/missing/expired session and inactive/changed-role actor, revoked guardian links, denied create replay, Unknown/Hold/native Verified custody, exact original collector provenance, actual revisioned identity edit and unchanged prior history, blocked typed approvals, absent operational routes and no downstream effects.

The actual model/service edit test loads the original private collector fields, captures its binding, executes `writeParentPickup` under a real registered Parent session, and proves the original binding no longer matches. It also asserts the unchanged history prefix/provenance and still-proposed state.

The blocked-decision test snapshots all existing fixture collections before attempting typed approvals, then compares them after denial. It asserts no notification/attendance/leave/correction records appear and authenticates an actual registered Gate Staff account before checking missing operational routes. These tests do not replace backend authorization with role mocks.

No new persisted mutation or transaction algorithm was introduced. Therefore no artificial new concurrency test was invented. Existing independent-process races, receipts, index initialization, rollback and immutable-history suites are included in the broad validation selection.

Initial expanded run: 47 passed, 1 failed, exit 1 because the pre-existing fixture HTTP parser unconditionally decoded Express's expected HTML 404 as JSON. The new test file now uses a local content-type-aware helper; production responses and 404 assertions are unchanged. Focused rerun: 48 passed, 0 failed/cancelled/skipped/todo, exit 0. Initial strict lint found one local test variable shadowing the imported `before` hook; it was renamed, with no suppression or assertion change. Final strict lint exited 0.

## G. Validation commands and results

Root working directory: `D:/SchoolManagementSystem`. Backend working directory: `D:/SchoolManagementSystem/backend`. Logs are outside Git under system TEMP, named `hira-g4e2a-*.log`.

| Gate | Actual result | Exit |
| --- | --- | --- |
| Baseline new negative HTTP cases | 0 pass / 4 fail | 1 |
| Initial expanded new selection | 47 pass / 1 test-helper failure | 1 |
| Final focused new selection | 48 pass / 0 fail/cancelled/skipped/todo | 0 |
| Complete applicable backend regression | 22 files; 846 pass / 0 fail/cancelled/skipped/todo; includes the new 48 and existing 798 cases | 0 |
| Backend TypeScript | No diagnostics | 0 |
| Final strict scoped ESLint | No diagnostics/warnings | 0 |
| Root TypeScript baseline/current | 96 identical diagnostic headers each; delta 0 | 2 / 2 |

Backend commands:

```powershell
# Red run, before production edits; four negative cases existed at that time:
.\node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests/school-custody-foundation.security.test.ts
# Final focused run:
.\node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests/school-custody-contract.test.ts tests/school-custody-foundation.security.test.ts
# Complete applicable regression selection:
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/school-custody-contract.test.ts tests/school-custody-foundation.security.test.ts tests/early-exit.security.test.ts tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-review.security.test.ts tests/parent-leave-decision.security.test.ts tests/parent-scope.security.test.ts tests/teacher-scope.security.test.ts tests/student-enrollment.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/teacher-attendance.security.test.ts tests/principal-attendance.security.test.ts tests/attendance-amendment.security.test.ts tests/development-startup.security.test.ts tests/bootstrap.security.test.ts tests/teacher-provisioning.security.test.ts
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
```

Root commands:

```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 backend/src/services/school-custody-contract.ts backend/src/services/pickup-authorization.policy.ts backend/tests/school-custody-contract.test.ts backend/tests/school-custody-foundation.security.test.ts
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
git diff --check
git diff --cached --check
git status --short
git diff --cached --name-only
```

Commands were captured with PowerShell output redirection to the named TEMP logs, and actual native exit codes were retained. Root compilation is an inherited failing gate, not reported as PASS: comparing exact file/line/code/message error headers returned `BASELINE=96 FINAL=96 DELTA=0`. Compiler configuration and existing diagnostic sources were not changed. No root error suppression was used.

## H. Remaining school approvals and limitations

School decisions remain pending: authorized verifiers and independent evidence standards; collector verification/validity/revocation; custody disputes/Hold precedence; operational Pickup and Early Exit approval; dismissal windows and verified campus presence; challenge expiry/issuance/replacement/attempt limits; supervised handover and uncertainty reconciliation; emergency/manual outage authority; recipients, privacy, protected evidence storage and retention.

TypeScript interfaces are not evidence that any of those decisions, evidence stores or operational workflows exist. No activation path is supplied. No frontend, native build/device, deployment connectivity or school operational acceptance is claimed. The inherited release-signing and root TypeScript limitations remain separate.

No production database or real .env was used. Persistence/security assertions run on isolated disposable MongoDB replica sets with fixture identities. Existing transaction semantics are preserved; all new security fixtures are test-only writes.

## I. Final self-check and handoff

The complete 22-file backend selection finished with 846 passes and no failures/cancellations/skips/todos, exit 0 (318739.7535 ms). This includes the 48 new tests and the existing 798 applicable regressions; focused-run counts overlap and must not be added as unique coverage.

Final review confirmed exactly the five intended paths, one existing tracked source modification and four new files. The full tracked diff is the narrow policy integration: 9 insertions and 3 deletions. All new source/test files were reviewed individually. Models, routes, permissions, startup, authentication/scope/transaction services, release guards, old tests, frontend, native configuration, package/lockfiles and root compiler settings have no changes. No raw policy/evidence data is added to API DTOs. All activation paths remain blocked by both unchanged guards and the new always-denied policy assessment.

`git diff --check`, `git diff --cached --check` and an explicit whitespace/conflict-marker scan over all five paths passed. The index is empty. Final status:

```text
 M backend/src/services/pickup-authorization.policy.ts
?? backend/src/services/school-custody-contract.ts
?? backend/tests/school-custody-contract.test.ts
?? backend/tests/school-custody-foundation.security.test.ts
?? docs/integration/pr-g4e2a-safe-backend-foundation.md
```

Branch/HEAD remain `integration/team-merge` / `86b43c48b69cea40976a6e4c779a1ae7caaba952`. All changes are unstaged and uncommitted. No staging, commit, push, PR, merge, reset, restore, clean, rebase, branch creation/switch or dependency/configuration change occurred. No operational release path was enabled. Await explicit Lead Engineer review and separate school operational approvals; do not start the next slice automatically.

Recommendation: **PASS — SAFE FOUNDATION ONLY; READY FOR LEAD REVIEW**.

## J. Raw final validation tails

### Focused new tests — exit 0

```text
✔ current changed_role cannot access the foundation or replay original create (266.432ms)
✔ current revoked_link cannot access the foundation or replay original create (281.025ms)
✔ Parent cannot supply school verification or authoritative fields (234.7918ms)
✔ custody unknown cannot become release authority even via a native record (268.8008ms)
✔ custody hold cannot become release authority even via a native record (259.919ms)
✔ custody verified cannot become release authority even via a native record (293.4516ms)
✔ real revisioned collector edit invalidates old binding while history/provenance remain intact (390.3271ms)
✔ typed approvals and operational routes stay blocked with no downstream effects (781.5818ms)
✔ native policy claim activationEnabled cannot become a usable policy (258.4711ms)
✔ native policy claim status cannot become a usable policy (299.4614ms)
✔ native policy claim schemaVersion cannot become a usable policy (303.0925ms)
✔ native policy claim schoolApproval cannot become a usable policy (300.6749ms)
ℹ tests 48
ℹ suites 0
ℹ pass 48
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10285.0388
```

### Complete backend regression — exit 0

```text
✔ revoked assignment immediately removes roster access (300.2022ms)
✔ expired assignment immediately removes roster access (370.6791ms)
✔ future assignment immediately removes roster access (345.5242ms)
✔ current inactive change fails closed on roster and independent service call (377.0193ms)
✔ current role change fails closed on roster and independent service call (386.851ms)
✔ current branch change fails closed on roster and independent service call (386.1075ms)
✔ current branch inactive change fails closed on roster and independent service call (328.8591ms)
✔ current permission change fails closed on roster and independent service call (301.9819ms)
✔ roster query/body injection never widens scope and malformed tuple IDs are sanitized (441.6728ms)
✔ roster has independent authentication/role gates and no guessed learner detail surface (326.5104ms)
✔ roster reference changes invalidate authority and DB failure is sanitized (281.0388ms)
✔ roster resolves scope once and executes one aggregate regardless of learner count (301.8833ms)
ℹ tests 846
ℹ suites 0
ℹ pass 846
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 318739.7535
```

Backend TypeScript and final scoped ESLint emitted no diagnostics, each exit 0. Root baseline/final each exited 2: BASELINE=96 FINAL=96 DELTA=0.

PASS — SAFE FOUNDATION ONLY; READY FOR LEAD REVIEW
