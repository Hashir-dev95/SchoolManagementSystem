# G4e-2B2-4 — Protected Collector Verification Records Foundation

## Baseline and Git safety

- Repository: `D:\SchoolManagementSystem`
- Feature branch: `feature/g4e-2b2-4-collector-verification`
- Starting and current implementation base: `d7eec14602fc332c7ce4fd5b33ae396f3cc867ef` (`origin/integration/team-merge`)
- The base contains the integrated B2-3 checkpoint. No shared branch was changed.
- Implementation remains unstaged and uncommitted. No push, merge, reset, clean, or branch switch was performed.

## Reused canonical functionality

- `PickupPerson`, `PickupAuthorization`, `PickupSubmission`, `PickupCustodyPolicy`, and `pickupDigest` remain the sole collector identity/proposal/policy authority.
- `collectorIdentityBindingMatches` from B1 is used only as a consistency check against the current persisted person and immutable submitted payload.
- `ParentStudentLink`, `StudentEnrollment`, Branch, Student, AcademicPeriod, Class, and Section are reloaded from MongoDB for current scope.
- Existing `ApprovalRequest` linkage is checked reciprocally for the pending pickup proposal; no approval authority is added.
- B2-2 `ProtectedEvidence` metadata and its trusted reader contract are reused. No storage implementation or public evidence endpoint was added.
- B2-3 transaction, operation receipt, revision, event, persistence-guard and startup-index patterns were reused.

## Implemented foundation

`CollectorVerificationRecord` binds an immutable collector ID and `PickupPerson.revision` to one exact canonical pickup proposal, submission ID/cycle, Parent requester and verified ParentStudentLink, Student, Branch, active enrollment and placement, and unconfigured policy ID/revision. The business record revision remains separate from identity revision, policy revision and MongoDB `__v`.

A proposal cycle can have one record for a given collector identity revision. A later canonical submission cycle gets a separate immutable record; the prior cycle is concealed by current-binding checks and remains retained. The identity fingerprint is internal and never returned in DTOs.

The protected lifecycle supports draft creation, authorized reads/list, revisioned draft edits, evidence association, submit, request-changes, resubmission, administrative review completion, withdrawal, revocation and invalidation. Runtime command validation and explicit action-to-event mapping reject unsupported commands. Events are append-only through supported Mongoose paths and checked against the exact current record revision and provenance. Operation receipts are immutable and reject conflicting payload replay.

The service derives all authority IDs from persisted proposal data. It rechecks the registered session, persisted role, active Branch, verified current ParentStudentLink, exact active enrollment and placement, canonical pending proposal/approval/submission, current collector identity, unconfigured policy and Custody Hold state. Parent actions require the original requester. Principal review is limited to same-Branch principals and separated from the requester; actual action grants remain the responsibility of a trusted domain authorizer.

The fixed production authorizer returns `false`, and the fixed production evidence reader throws when not configured. The private service builder has no production setter or configurable export. Test-only dependency mocking lives under `backend/tests`; production modules do not import test helpers. Persistence permits are issued only inside the service module, scoped to a single document/session transaction and consumed once. These supported-interface guarantees do not claim protection from arbitrary trusted-process execution, direct MongoDB driver access, or privileged database operators.

Evidence association requires the B2-2 custody/verification domain, Student owner and exact record resource, matching Branch/uploader, available clean scan, current revision and SHA-256 digest. Evidence bytes, storage keys, internal paths and digests are excluded from ordinary DTOs. Missing/revoked/mismatched evidence is denied and sanitized. No upload/download HTTP route was added.

Administrative review completion does not verify a collector or Student, change `PickupPerson.verificationState`, change `PickupAuthorization.operationalStatus`, or write `StudentCustodyState`. Hold remains effective. No Pickup/Early Exit approval, Gate checkout, QR/OTP, physical release, attendance or transport effect was added.

## Exact changed files

1. `backend/src/models/collectorVerificationRecord.ts`
2. `backend/src/services/collector-verification-record.service.ts`
3. `backend/src/services/collector-verification-record.trusted-dependencies.ts`
4. `backend/src/server.ts`
5. `backend/tests/collector-verification-record.security.test.ts`
6. `backend/tests/collector-verification-record.production-deny.test.ts`
7. `backend/tests/helpers/mock-collector-verification-dependencies.ts`
8. `docs/integration/pr-g4e2b2-4-collector-verification.md`

The separate production-deny test file is intentional: the main behavioral suite mocks trusted dependencies within its Node test worker, so a separate worker verifies the real fixed production dependency exports.

## Validation evidence

Fresh B2-4 focused suite, run from `backend` using native Windows CMD:

```text
cmd.exe /d /c "node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 tests\collector-verification-record.security.test.ts tests\collector-verification-record.production-deny.test.ts"
```

Result: **35 tests, 35 passed, 0 failed, 0 skipped, 0 cancelled; exit code 0; duration 7994.584 ms.** The suite covers strict schemas and export surface; fixed deny-by-default production dependencies; synthetic authorized operations; persisted actor/session/role and Branch checks; Parent-link and enrollment lifecycle; approval/proposal/submission linkage; identity revision/fingerprint invalidation; policy and Hold denial; operation replay/conflict; revision competition; evidence binding/revocation; lifecycle history; rollback; persistence mutation guards; and non-operational outcomes. The new canonical proposal-cycle test confirms a later submission receives a distinct immutable record while the older cycle remains concealed.

Fresh applicable regression group, run from `backend` with the same native Node module-mocking method:

```text
cmd.exe /d /c "node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 tests\student-custody-record.security.test.ts tests\protected-evidence.security.test.ts tests\school-custody-contract.test.ts tests\school-custody-foundation.security.test.ts tests\custody-policy-foundation.test.ts tests\gate-foundation.security.test.ts tests\pickup-authorization.security.test.ts tests\early-exit.security.test.ts"
```

Result: **281 tests, 280 passed, 0 failed, 1 skipped, 0 cancelled; exit code 0; duration 154432.5082 ms.** The one skip is `storage refuses symbolic-link object targets and preserves the external target`, skipped because this Windows environment reports EPERM. It is not counted as passed and remains to be executed in a supported environment.

Static checks:

- Backend TypeScript, `backend`: `npx tsc --noEmit --pretty false` — **exit 0**.
- Focused test/helper TypeScript, `backend`: `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --strict --skipLibCheck --types node tests/collector-verification-record.security.test.ts tests/collector-verification-record.production-deny.test.ts tests/helpers/mock-collector-verification-dependencies.ts` — **exit 0**.
- Strict scoped ESLint, repository root: `npx eslint --max-warnings 0 backend/src/models/collectorVerificationRecord.ts backend/src/services/collector-verification-record.service.ts backend/src/services/collector-verification-record.trusted-dependencies.ts backend/tests/collector-verification-record.security.test.ts backend/tests/collector-verification-record.production-deny.test.ts backend/tests/helpers/mock-collector-verification-dependencies.ts backend/src/server.ts` — **exit 0, zero warnings**.
- Tracked diff whitespace: `git diff --check` — **exit 0**. Explicit trailing-whitespace validation across all eight intended paths, including untracked implementation, tests, helper and this report: `No trailing whitespace in all 8 intended paths` — **exit 0**.

## Startup indexes

`backend/src/server.ts` initializes `ensureCollectorVerificationRecordIndexes()` alongside the existing required B2-2/B2-3 indexes before binding the HTTP listener, following the existing startup index-initialization pattern. The indexes cover unique proposal-cycle/identity record binding, per-record event revisions, unique evidence association, operation idempotency, and scoped reads.

## Architectural self-review

- Model exports contain schemas/models, state/action constants and index initialization only. Service exports contain the fixed service, typed error, and internal context predicates; no writer permit issuer, factory, setter or trusted-dependency replacement capability is exported.
- Test injection exists only in the isolated Node test helper.
- Current identity changes, a reverted identity at a newer revision, Parent-link revocation, transferred/replaced enrollment, changed submission cycle, missing/activated policy, mismatched evidence and Hold all fail closed without deleting persisted records.
- No positive collector/student verification or operational authorization is represented in the record states or trusted production dependencies.
- No material in-scope P0/P1 defect remained after the test-driven corrections: numeric identity revisions are compared as numbers, event and operation records persist the complete provenance they require, invalid IDs are concealed, and evidence reader failures are mapped to safe errors.

## Remaining prerequisites and limitations

- Production Parent/reviewer authorization and authenticated protected-evidence reading are deliberately not configured; the service remains unusable in production until separately approved trusted domain implementations exist.
- Production private evidence storage, real malware scanning, deployed storage security controls, domain-specific authorization, retention policy and authenticated HTTP integration remain prerequisites.
- B2-1 policy/grant history integrity must be enforced before adding any policy/grant lifecycle writer.
- The Windows EPERM symbolic-link test still needs execution in an environment supporting symlink creation. Do not weaken OS protections to clear this gate.
- No database-level immutability or cryptographic tamper-evidence claim is made.
- This is an internal foundation, not a complete production custody/collector-verification feature.

## B2-5 handoff

A later, separately approved milestone may design trusted Parent and reviewer authorization plus authenticated evidence-reader composition and route integration. It must first preserve the B2-1 history-integrity prerequisite and keep all operational verification/release gates disabled until school policy and authority are explicitly approved. B2-5 is not started here.

## Validated source fingerprints

SHA-256 fingerprints for the implementation, tests, helper and startup file present at the final successful validation:

- `backend/src/models/collectorVerificationRecord.ts` — `b0086ccbad03258128d4ed15c3dc5c5d04c32174669df9205cf47b6b02b64eb6`
- `backend/src/services/collector-verification-record.service.ts` — `e9abd59849500402c93b01ecf8b731c6ba61f03f20d980957edec2f5953aff13`
- `backend/src/services/collector-verification-record.trusted-dependencies.ts` — `7fa40e045314355cc08a0e972e7a5278b1c4bcd5f4148307461887c5245d53c4`
- `backend/src/server.ts` — `7548860011c494184b80c79be6d96d1dbb621adb535f6c7176b708b50eb809f4`
- `backend/tests/collector-verification-record.security.test.ts` — `b1b12a677990ffe0887819ccd503a19810430293e29b2764b5da025614eb2cd6`
- `backend/tests/collector-verification-record.production-deny.test.ts` — `2f2f6de9197a550c66ae4e2de3ebd0e3fe75d28bb3409c287a1013236b4dc7af`
- `backend/tests/helpers/mock-collector-verification-dependencies.ts` — `cfb91af39e7ef102289edb9a636762a0ff87ec789818ad74a15c9e95a21e9434`
