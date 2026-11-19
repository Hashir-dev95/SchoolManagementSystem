# G4e-2B1 — Safe custody and collector verification contracts

Date: 2026-11-11 (Asia/Karachi).

## A. Verified starting state

Repository: `D:/SchoolManagementSystem`. Starting branch: `integration/team-merge`. Starting HEAD: `0cdb1fb81cf11b7c7de9eb9408f8237879b98409` (`feat(g4e2a): add fail-closed school custody policy foundation`). The working tree was clean and the index empty. The G4e-2A implementation, tests and report were present and committed. B1 had not been implemented; neither a local B1 branch nor a committed B1 report existed. The previously reviewed B1 design is conversation evidence; it is not a separate repository report.

`origin` is `https://github.com/Hashir-dev95/SchoolManagementSystem.git`. A live read-only check, `git ls-remote --heads origin refs/heads/integration/team-merge refs/heads/feature/g4e-2b1-safe-contracts`, returned the expected integration SHA and no B1 branch. No fetch, pull or shared-branch update was needed. After that gate, the expressly authorized command `git switch -c feature/g4e-2b1-safe-contracts 0cdb1fb81cf11b7c7de9eb9408f8237879b98409` created the feature branch. Ending branch: `feature/g4e-2b1-safe-contracts`; HEAD remains the starting SHA. The integration ref remains unchanged.

## B. Exact four-file scope

| File | Change |
| --- | --- |
| `backend/src/services/school-custody-contract.ts` | Document distinct revision meanings; add a future-only revision observation interface and typed invalidation diagnostics. Existing runtime validation and authorization functions are unchanged. |
| `backend/tests/school-custody-contract.test.ts` | Four additional counter-separation and negative-input tests; all existing assertions retained. |
| `backend/tests/school-custody-foundation.security.test.ts` | Five additional real replica-set compatibility and negative-authority tests; all existing assertions retained. |
| `docs/integration/pr-g4e2b1-verification-contracts.md` | This report. |

G4e-2A is reused, not reimplemented. In particular, `pickup-authorization.policy.ts`, models, routes, controllers, permissions, startup, native configuration and dependencies are unchanged. No new persistence or verification writer is introduced.

## C. Revision and invalidation contract

| Counter | Meaning and boundary |
| --- | --- |
| `CollectorIdentityBinding.personRevision` | Existing `PickupPerson.revision`, pinned by immutable submissions. Identity edits advance it. Future verification metadata must not advance it. |
| `CollectorVerificationRevisionContext.verificationRevision` | A future verification-decision observation only. It is not a persisted B1 field, current verified state or substitute for identity revision. |
| `SchoolCustodyPolicyIdentity.revision` | Existing persisted business-policy revision. The exact policy ID/revision remain bound to each proposal and submission. |
| `documentVersions.pickupPerson` / `.policy` | Future in-memory observations of Mongo document `__v` for write serialization. These are separate from identity and policy revisions. |
| Verifier `actorRevision` / `sessionRevision` | Transaction-document observations, not durable officer grants or school authority. |
| `SCHOOL_CUSTODY_CONTRACT_VERSION` | Internal schema version only; remains 1. It is not school approval or the policy business revision. |

The new interface is erased by TypeScript and has no factory, persistence mapping, endpoint or consumer granting authority. Ordinary number types are not validated proof objects. Future B2 must independently validate every observation under current authority and transaction fences.

`VERIFICATION_INVALIDATION_REASONS` is an immutable diagnostic vocabulary, with a corresponding literal union: unapproved school policy, changed subject provenance, changed collector identity, custody Hold, expired/revoked verification, changed policy revision, unavailable verifier authority and unavailable evidence. These describe dependency failures; they define no school-approved actions, validity durations, evidence standards, custody priority exceptions or transition permissions. No invalidation writer or workflow is implemented. Supplying these labels or future revision metadata to existing Parent APIs remains unsupported input (400). Supplying them inside policy or identity-binding contracts is also rejected. No diagnostic label can clear Hold or grant authority.

## D. Evidence and security boundaries

| Boundary | Production evidence (unchanged) | Fresh test evidence |
| --- | --- | --- |
| Submitted identity remains pinned | `pickup-authorization-read.service.ts:91`, including `latest.personRevision !== person.revision` at `:96`; `pickupAuthorization.ts:334`, immutable submission schema | A real registered Principal requests changes to a submitted proposal. Person and policy document `__v` increase, while person identity revision, original identity history, all provenance and full submission records remain unchanged. Parent and Principal detail reads continue to work. Approval history retains its original prefix. |
| Transaction version is not expected identity revision | `pickup-authorization-write.service.ts:146`, existing `writeParentPickup` revision checks | A fixture-only change to person `__v` cannot substitute for `personRevision`: secured edit fails 409 without changing the person or proposal. |
| Policy business revision remains separate | `pickup-authorization-write.service.ts:42`, `lockPickupPolicy` | Unit tests compare normalized contracts with different valid `__v`; real Principal fencing preserves the exact normalized policy identity. Internal schema version and all revision counters are independently represented. |
| Hold is never defeated by a matching identity | `gate-administration.service.ts:484`, Unknown/Hold administration; `gate-authority.service.ts:257`, unconditional operational denial | Actual registered and allowlisted Super Admin sets Hold through the existing API. A matching collector remains ineligible; Parent clear attempt is 403 and stored Hold history remains unchanged. This fixture grant exists only inside the disposable test environment. |
| Exact original enrollment cannot retarget | `pickup-authorization-access.service.ts:37`, existing `pickupSubject`; `parent-scope.service.ts:48`, current verified-child scope | Close the original enrollment and insert a current same-Branch replacement. Old detail and create replay return 404; list omits the original proposal. Original person, proposal, provenance and histories remain stored and unchanged. |
| No forged verifier input | Existing strict request-body and contract allowlists | B1 revision/diagnostic claims return 400 with no person, proposal or policy created. Frozen diagnostic labels never yield positive policy eligibility. |
| Current identity and foreign-scope isolation | Existing Parent/Principal/Gate authority services | Existing session, role, guardian, Branch, enrollment, category, generic-bypass and concurrency regressions are included in the broader selection. |

The security fixture uses actual JWTs, registered sessions, persisted roles and existing HTTP/service authorization with disposable MongoDB replica sets. The transaction-version corruption case is explicitly a test-only metadata perturbation, not a production verification operation. No real `.env`, production database or private custody evidence is used.

Existing integration cases still prove that native fabricated Verified state cannot authorize release, invalid policy gives 409, current relationship/session revocation conceals access and receipt replay, typed Pickup/Early Exit Approve returns 403 without downstream mutations, and operational Gate routes remain absent. Error-code semantics are unchanged; intentional policy/revision conflicts remain 409, denied ownership is concealed with 404 and unsupported client fields are 400.

No production transaction algorithm changed. Existing independent-process races, idempotency, rollback and immutable-history tests are rerun; B1 does not claim a new operational verification race implementation or manufactured red-to-green result.

## E. Validation commands and actual results

Backend working directory: `D:/SchoolManagementSystem/backend`. Root working directory: `D:/SchoolManagementSystem`. Logs live outside Git in system TEMP, named `hira-g4e2b1-*.log`. Commands with redirected output preserve and report their actual native exit codes.

| Check | Result | Exit |
| --- | --- | --- |
| Focused contract/security suite | 57 passed, 0 failed/cancelled/skipped/todo; 33 contract and 24 security tests | 0 |
| Applicable 22-file backend regression | 855 passed, 0 failed/cancelled/skipped/todo; includes the focused 57 and existing 798 regressions | 0 |
| Backend TypeScript | No diagnostics | 0 |
| Strict scoped ESLint | No warnings or errors | 0 |
| Root TypeScript before/after | 96 identical diagnostic headers; no new or removed diagnostics | 2 / 2 |
| Git tracked/cached whitespace checks | No whitespace errors; index empty | 0 / 0 |
| Explicit four-file inventory, whitespace and conflict scan | Exactly four paths, no trailing whitespace or conflict markers, including the untracked report | 0 |

Backend commands:

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests/school-custody-contract.test.ts tests/school-custody-foundation.security.test.ts
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/school-custody-contract.test.ts tests/school-custody-foundation.security.test.ts tests/early-exit.security.test.ts tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-review.security.test.ts tests/parent-leave-decision.security.test.ts tests/parent-scope.security.test.ts tests/teacher-scope.security.test.ts tests/student-enrollment.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/teacher-attendance.security.test.ts tests/principal-attendance.security.test.ts tests/attendance-amendment.security.test.ts tests/development-startup.security.test.ts tests/bootstrap.security.test.ts tests/teacher-provisioning.security.test.ts
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
```

Root commands:

```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 backend/src/services/school-custody-contract.ts backend/tests/school-custody-contract.test.ts backend/tests/school-custody-foundation.security.test.ts
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
git diff --check
git diff --cached --check
git status --short --branch
git diff --cached --name-only
git diff --stat
```

Root compilation is a separately reported inherited failure, not a passing gate. No compiler configuration, diagnostic source or assertion was weakened. Focused and broad counts overlap and must not be added as distinct coverage. Mobile/native/device/deployment checks are not run for this backend-only contract refinement.

The complete fresh regression ran for 325132.3287 ms. Its 855 tests are the previous applicable 846 plus nine B1 cases. This is a fresh execution, not reliance on the prior G4e-2A report. All B1-focused tests passed on their first execution; no failing assertion was weakened. Raw last 20 regression output lines:

```text
✔ revoked assignment immediately removes roster access (383.9488ms)
✔ expired assignment immediately removes roster access (359.6589ms)
✔ future assignment immediately removes roster access (325.3425ms)
✔ current inactive change fails closed on roster and independent service call (308.7375ms)
✔ current role change fails closed on roster and independent service call (509.5968ms)
✔ current branch change fails closed on roster and independent service call (339.1776ms)
✔ current branch inactive change fails closed on roster and independent service call (287.4474ms)
✔ current permission change fails closed on roster and independent service call (282.5416ms)
✔ roster query/body injection never widens scope and malformed tuple IDs are sanitized (401.0723ms)
✔ roster has independent authentication/role gates and no guessed learner detail surface (301.5887ms)
✔ roster reference changes invalidate authority and DB failure is sanitized (296.2905ms)
✔ roster resolves scope once and executes one aggregate regardless of learner count (318.2086ms)
ℹ tests 855
ℹ suites 0
ℹ pass 855
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 325132.3287
```

## F. B2 dependencies and disabled operations

Separate explicit school and Lead Engineer approvals are still required for verifier identity/grants and separation of duties, protected evidence ownership/storage/delivery/retention, independent collector decision persistence and revisions, verification validity/revocation/reverification rules, conflicting guardian/custody decisions, normal dismissal/campus presence, challenge and handover/uncertain reconciliation, emergency/manual procedures, notifications and operational audit acceptance.

B2 must not reuse person identity revision for verification metadata, retarget an old enrollment or Branch, overwrite immutable submissions/approval history, trust in-memory types as evidence, or treat a matching collector as authorized. Any future persisted decision requires its own justified durable contract, current dependency validation, commit-time fences, idempotency, rollback and real independent-process races. B1 defines none of those school choices or persistence changes.

All operational gates remain closed: custody Verified, school collector verification, policy activation, Pickup/Early Exit Approve, Gate operational permissions, QR/OTP, physical checkout/release, emergency release, attendance/transport effects and release notifications. Existing Unknown/Hold administration is unchanged. No new model, migration, collection, index, route, permission, default officer grant, startup hook, API field or public evidence URL was added.

## G. Final scope and handoff

The complete source/test diff and new report were reviewed. Existing runtime function bodies and prior test assertions are unchanged. There are 35 source additions (comments, one interface and diagnostic vocabulary), 120 unit-test additions and 302 integration-test additions, plus this new report. Exactly the four section-B paths are changed: three tracked modifications and one untracked document. The index is empty; feature HEAD and the shared integration ref remain `0cdb1fb81cf11b7c7de9eb9408f8237879b98409`. No whitespace or conflict markers were found, including in the untracked report. No unrelated work, generated files or private data were added.

No commit, push, PR, merge, reset, restore, clean or discard was performed. Only the authorized feature branch was created. G4e-2B2 remains unimplemented and operationally blocked. Backend implementation and applicable validation pass; the inherited root TypeScript failure is explicitly preserved separately. School operational approval and production/native acceptance are not claimed.

READY FOR LEAD ARCHITECT REVIEW — G4e-2B1 SAFE IMPLEMENTATION
