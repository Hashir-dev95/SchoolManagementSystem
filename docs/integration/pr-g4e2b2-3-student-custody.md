# G4e-2B2-3 — Protected Student Custody Records Foundation

## Baseline and scope

Implemented from integration baseline `b093699ed9d204bd9feebc059b06adf76b84adfc` on the isolated `feature/g4e-2b2-3-student-custody` branch. This is an unstaged, uncommitted backend foundation. No routes, permissions, mobile UI, policy writers, verifier-grant writers, custody-state mutations, approvals, attendance effects, notifications or release operations were added.

The implementation adds a strict `StudentCustodyRecord` model, an independently revisioned event collection, immutable evidence associations and operation receipts. The internal service supports draft creation, authorized reads/lists, optimistic draft edits, evidence association, submit, request-changes, administrative review-completed, withdrawal, revocation and invalidation. `review_completed` means administrative record completeness only; it is not a legal custody decision and grants no operational authority.

## Canonical infrastructure reused

- Student, StudentEnrollment, AcademicPeriod, SchoolClass, Section, Branch, User, Session and StudentCustodyState remain canonical authorities.
- Every operation checks a persisted active actor and matching non-revoked session, an active Branch, and the exact current active StudentEnrollment with matching Student and academic provenance.
- Mutations run under `withAcademicCatalogLock` and fence the current actor, session, Student, enrollment, record, and evidence metadata where relevant.
- B2-2 `readAvailable` is injected for content and digest validation. This service does not create a second upload or storage path.
- Startup initializes the four new model index sets before the HTTP listener, following the existing required-index startup sequence.

## Authorization boundary

The service requires a `CustodyRecordAuthorizer` callback for every record action and fails closed if it is missing, throws, or returns anything other than `true`. The callback receives the persisted role, Branch, exact student/enrollment/record identifiers and active Mongo session. It must implement the approved domain rule (including current verified ParentStudentLink ownership for Parent actions and independently authorized review scope for review actions) and fence any revocable authority data in the same transaction. No production callback or route is wired in this slice, so this code is not yet an HTTP capability. Possessing a role name, relationship identifier, record ID or evidence ID alone does not authorize an operation.

Evidence associations require `domain=custody`, `purpose=verification`, student owner, exact Branch/student/record resource, current uploader, available status, clean scan, current revision and matching digest. Bytes are used only inside the service for B2-2 integrity verification and are not included in custody DTOs. Association records are retained; unavailable evidence makes later submission/review fail closed.

## Lifecycle, history and consistency

Business `revision` is separate from Mongo `__v`. Each state-changing operation uses expected-revision compare-and-set, a unique actor/operation receipt and a payload fingerprint. Matching replays return the original record only after current actor, session, enrollment and action authority are rechecked; a payload conflict is rejected. The record, event, association and receipt writes use Mongo replica-set transactions. Competing updates cannot both advance one revision, and failed final authorization rolls back the transaction.

Events have unique `(recordId, revision)` keys, immutable identity fields, contiguous-revision checks on supported append writes, and query middleware that rejects update, replace and delete paths. Evidence associations have analogous immutability protections and exact persisted metadata checks. These controls prevent mutation through the supported Mongoose paths; they are not cryptographic tamper evidence and cannot prevent privileged direct collection/database edits. Events are stored as separate rows rather than truncated embedded arrays. Retention and long-term storage limits still require an approved configuration.

The B2-1 policy/grant history limitation is unchanged. No policy or verifier grant writer is introduced or relied upon here. Append-only history integrity and transaction/rollback testing remain a mandatory prerequisite before any future policy/grant lifecycle writer is enabled.

## Safety boundaries

- Missing custody state retains the existing Unknown interpretation; Hold blocks submit and review completion and is never cleared by this service.
- Any existing non-Unknown state or enrollment mismatch blocks submission/review.
- Enrollment replacement conceals an old record through current-scope reads without deleting its record, events or evidence associations. No authority is inherited by a replacement enrollment.
- This service never writes `StudentCustodyState`, never enables the B2-1 evaluator, and never authorizes Pickup, Early Exit, Gate checkout, QR/OTP, physical release, attendance or transport effects.
- No generic approval route or permission is added.

## Runtime defect corrections

The initial manual focused run reported 10 passed and 5 failed. Investigation found these root causes:

- FIX-01, FIX-04 and FIX-05 shared a service transition-table defect: the model permitted a revisioned `draft` → `draft` edit, but the service transition table omitted that self-transition. Valid edits therefore conflicted before their receipt, concurrency winner, or final authorization/rollback behavior could be exercised. Added the missing service transition while retaining expected-revision checks and fingerprint conflict rejection.
- FIX-02 was a command/event vocabulary mismatch. The service passed `submit`, `withdraw`, `revoke`, and `invalidate` directly to a strict event enum whose event names are `submitted`, `withdrawn`, `revoked`, and `invalidated`. Added one typed exhaustive mapping for all seven mutation commands, shared with the strict exported event-action enum. Added test coverage for request-changes, resubmission, withdrawal, revocation and invalidation event names.
- FIX-03 was a test actor mismatch. The service correctly limits `submit` to a Parent actor, while the fixture used a Principal reviewer, so authorization rejected the request before Hold was evaluated. The fixture now uses the authorized synthetic Parent actor; Hold remains checked after authorization and still blocks submission.

The rollback test now reaches the intended final authorization fence after the valid edit has staged the record update, event and receipt. It asserts the original record revision and summary remain unchanged, the event count is unchanged, no evidence association was created, and the attempted operation receipt is absent.

These are the five reported failures addressed: the transition defect explains the edit replay, zero-winner concurrency, and early rollback failures; the event vocabulary defect explains reviewer workflow failure; and the actor fixture defect explains the Hold test's unauthorized result.

## Validation status

At the initial acceptance baseline, the focused file contained these 16 tests:

1. Strict record schemas reject forged authority and operational fields.
2. Missing domain authorization denies record creation and storage.
3. Create replay returns the same draft and conflicting payload is rejected.
4. Edit replay is idempotent and conflicting edit payload cannot replace its receipt.
5. Current persisted session and Branch scope are required.
6. Foreign Branch reads, malformed identifiers and changed persisted roles are denied.
7. Enrollment replacement conceals old record while retaining record and events.
8. Evidence must be current custody verification evidence bound to this record and student.
9. Evidence revoked after association blocks later submission without deleting history.
10. Separate reviewer can complete administrative review but cannot establish operational custody.
11. All supported request and reviewer commands map to strict lifecycle event actions.
12. Hold prevents submission and record preparation never mutates custody state.
13. Competing revision updates permit one winner and append exactly one event.
14. Authorization loss at the final fence rolls back record, event and receipt writes.
15. Event and evidence association query mutation is rejected.
16. Record and evidence preparation do not make the verifier evaluator authorize anyone.

Static validation against the final source:

- Backend TypeScript: `cd /d D:\SchoolManagementSystem\backend && npx tsc --noEmit --pretty false` — PASS, exit 0.
- Focused test-source TypeScript: `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node tests/student-custody-record.security.test.ts` from `backend` — PASS, exit 0.
- Strict scoped ESLint: `npx eslint backend/src/models/studentCustodyRecord.ts backend/src/services/student-custody-record.service.ts backend/tests/student-custody-record.security.test.ts backend/src/server.ts --max-warnings 0` from repository root — PASS, exit 0.
- Whitespace: `git diff --check` plus explicit trailing-whitespace scan of all five paths — PASS, exit 0.

Accepted fresh manual runtime evidence for the current implementation:

- Focused student custody record suite: 16 total; 16 passed; 0 failed, skipped or cancelled; 5089.221 ms; exit 0.
- Consolidated applicable regressions: 192 total; 191 passed; 0 failed; 1 skipped; 0 cancelled; 56934.2719 ms; exit 0.
- Combined fresh validation: 208 total; 207 passed; 0 failed; 1 skipped.
- The single skip is the protected-evidence symbolic-link test, skipped because Windows returned EPERM. It is not counted as passed.
- The accepted fresh results were supplied after the earlier correction cycle. At the time of that independent acceptance review, no implementation source or test file changed; the P1 hardening section below records the subsequent source/test changes and does not reuse those old runtime results as fresh evidence.

Historical, pre-correction regression evidence remains distinct: School custody contracts 33/33, custody foundation 24/24, policy foundation 18/18, protected evidence 31 passed plus the symbolic-link skip, Gate foundation 27/27, Pickup authorization 59/59, and Early Exit 68/68. Student Enrollment did not have a result in that earlier report. The fresh consolidated 192-test evidence supersedes the earlier counts for the included suites. Pickup and Early Exit remain historical-only results from before the latest correction cycle.

## P1 persistence-boundary hardening

The confirmed supported-Mongoose-write bypass is corrected in the current unstaged implementation. The forgeable `$locals.custodyServiceWrite` string has been removed. The service now performs each record, event, evidence-association and operation-receipt save through `persistStudentCustodyDocumentInTransaction`, which grants a single save for the exact document and exact active transaction session. It is a narrow persistence gate, not an authorization decision; current actor/session, Branch, enrollment, domain-authorizer checks, expected revision, final authority fences, receipts and transaction boundaries remain in the service.

The four schemas now deny model-level and chained query mutation methods, including updates, replacements, deletes, `insertMany`, `bulkWrite`, `bulkSave` and aggregate access. Query/document middleware remains defense in depth, with explicit document hooks for document `deleteOne`, `updateOne` and `replaceOne`. The model document `$save` path is guarded independently of middleware options, so `middleware: false` cannot skip the exact-document transaction permit. The default Mongoose connection's `bulkWrite` rejects operations targeting any of the four models, whether the operation names a model constructor or model name. Read-only query behavior and the service's authorized document saves remain available.

The supported-model boundary intentionally does not claim protection against direct collection or MongoDB driver operations, privileged database edits, or arbitrary trusted-process code execution. It is not database-level immutability or cryptographic tamper evidence. The B2-1 policy/grant history limitation remains unchanged. No positive custody verification, route, permission, policy/grant writer, canonical `StudentCustodyState` mutation, or operational release capability was added. No existing service usage of aggregation on these four models was found; aggregate APIs are denied on them to avoid `$out`/`$merge` write-path ambiguity.

The future domain authorizer remains responsible for current verified ParentStudentLink/reviewer authority and for fencing revocable source records in the same transaction; this slice does not supply or wire that authorizer. At the time of this earlier review, no other source defect was confirmed. The final P1 closure review below supersedes that assessment for permit issuance.

## New regression coverage

The focused file preserves its original 16 cases and adds these three cases:

1. `model, query, bulk and connection mutation entry points reject middleware bypass options`
2. `document save and deletion methods cannot bypass scoped transaction persistence`
3. `events, evidence associations and operation receipts stay immutable while service writes succeed`

The new cases exercise all four models through model/query/bulk/connection APIs, explicit `middleware: false`, document delete/update/replace/save paths, direct `insertOne`, and aggregate access. They compare all four persisted collections before/after denied attempts, verify immutable event/evidence/receipt rows are unchanged, and verify the service can still create, attach evidence and revise a record. The pre-existing focused tests continue to cover optimistic concurrency, receipt replay/conflict and transaction rollback; they require a fresh runtime execution after this persistence-boundary change.

## Validation after P1 correction

- Backend TypeScript: `npx tsc --noEmit --pretty false` from `D:\SchoolManagementSystem\backend` — PASS, exit 0.
- Focused test-source TypeScript: `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node tests/student-custody-record.security.test.ts` from `D:\SchoolManagementSystem\backend` — PASS, exit 0.
- Strict scoped ESLint: `npx eslint backend/src/models/studentCustodyRecord.ts backend/src/services/student-custody-record.service.ts backend/tests/student-custody-record.security.test.ts backend/src/server.ts --max-warnings 0` from repository root — PASS, exit 0.
- Whitespace: `git diff --check` and explicit trailing-whitespace scan of all five paths — PASS, exit 0.
- Focused runtime attempt: `node_modules\\.bin\\tsx.cmd --test --test-concurrency=1 tests\\student-custody-record.security.test.ts` from `backend` — BLOCKED before test discovery; Node `v24.19.0` exited 1 with `uv_os_get_passwd returned ENOMEM`. No test was executed in that attempt.
- The previously accepted focused 16/16 and regression 191/192 (one symbolic-link test skipped for Windows EPERM) evidence predates this source change and is not accepted as validation of the P1 correction.

Manual Windows CMD commands to run from `D:\SchoolManagementSystem\backend` if the runner restriction persists:

```cmd
node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\student-custody-record.security.test.ts
```

```cmd
node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\protected-evidence.security.test.ts tests\school-custody-contract.test.ts tests\school-custody-foundation.security.test.ts tests\custody-policy-foundation.test.ts tests\gate-foundation.security.test.ts tests\pickup-authorization.security.test.ts tests\early-exit.security.test.ts
```

The second command covers the protected-evidence integration and custody/Gate/Pickup/Early Exit denial regressions. Its results must be reported separately from the focused test total. Preserve the symbolic-link EPERM skip accurately if it occurs; it is not a pass.

## Deferred production dependencies

- Real malware scanner and production private storage provider, including deployment-level isolation and recovery controls.
- A configured domain-specific authorization integration and authenticated HTTP integration; this slice intentionally wires neither.
- Approved retention and record-access policy.
- Supported-environment execution of B2-2 filesystem symbolic-link security coverage, previously skipped under Windows EPERM.
- Distributed storage coordination and consistency outside MongoDB; Mongo transactions do not make external file storage atomic.
- Mobile record-management and review experience in a separately approved slice.
- B2-1 history integrity enforcement before future policy/grant lifecycle writers.

## Current handoff status

The confirmed P1 source correction and three additional regression cases are implemented. Backend TypeScript, focused test-source TypeScript and strict scoped ESLint pass. Runtime acceptance remains **PARTIAL — MANUAL VALIDATION REQUIRED** because the focused test runner failed before test discovery with the known ENOMEM startup error; the regression command above has not been run after the source correction. All five files remain unstaged and uncommitted on the existing feature branch.

## Post-hardening runtime test correction

The Lead Engineer supplied an initial manual run of the 19-test focused file: 15 passed, 4 failed, 0 skipped/cancelled; exit 1. A subsequent run had 16 passed and 3 failed. Review of the complete failing blocks found these root causes:

1. **Synchronous mutation rejection and aggregation:** model statics and the protected model's `aggregate()` throw synchronously. The test previously handled most mutation calls as promised rejections, then passed the `aggregate()` call through that async helper even though it throws before an aggregate exists. It now asserts the aggregate denial synchronously with the exact message. The whole block compares all four persisted collections with a pre-attempt snapshot and confirms no output collection was created.
2. **Connection bulk fixture:** Mongoose 9.10.3 requires each `Connection.bulkWrite` operation's `model` to be either a registered model name or a compiled model constructor. The test destructured away `modelConstructor`, passing `undefined`; Mongoose rejected malformed input before the custody guard. It now supplies the actual constructor and separately tests the model-name form. Both paths are checked against the persisted snapshot.
3. **Document lifecycle validation versus persistence permit:** Mongoose's public `save()` path is separate from `$save()`. The previous production guard wrapped only `$save()`, so an unauthorized record `save()` reached lifecycle validation first and returned a `ValidationError` for missing service context and invalid revision. This exposed a real persistence-boundary gap. The production guard now wraps both `save()` and `$save()` with the same exact-document, exact-session, one-use permit check. The test independently exercises lifecycle validation on a changed synthetic record and asserts its exact state/revision errors, then verifies untouched documents are denied at the persistence permit.
4. **Immutable-field validation order:** in Mongoose 9.10.3, document assignment does not throw to the caller. Mongoose catches the immutable `StrictModeError` and stores it as a path validation error. The test now uses `doc.set(...)`, then requires `doc.validate()` to reject with a `mongoose.Error.ValidationError` whose matching path message contains `immutable`. It reloads pristine records for direct-save permit assertions and verifies event, evidence-association and receipt collections remain unchanged.

The correction changes `backend/src/models/studentCustodyRecord.ts`, `backend/tests/student-custody-record.security.test.ts` and this report. The only production change closes the confirmed public `save()` bypass; it does not change authorization, revisions, transactions or operational behavior. Middleware bypass guards, document deletion protections and immutable-field validation remain enabled.

After the correction, backend TypeScript, focused test-source TypeScript and strict scoped ESLint each passed with exit 0; `git diff --check` and explicit whitespace checks across all five paths passed with exit 0. The focused suite was attempted once, and the affected regression command was also attempted; both exited 1 before test discovery with Node `v24.19.0` error `uv_os_get_passwd returned ENOMEM`. **Zero tests ran after the current source/test correction.** Run both Windows CMD commands above to verify the corrected suite and the source change.

The earlier 261-test regression run described here predates the `save()` guard. The later fresh 261-test result in the final closure section below was supplied after that source correction and remains applicable because this newest cycle changes tests and documentation only. The focused results of 15/19, 16/19, and 17/19 all predate the current test corrections; none is a passing result for the current test source.

Current targeted disposition: **PARTIAL — MANUAL FOCUSED AND REGRESSION VALIDATION REQUIRED**. The existing branch/HEAD and five-path worktree scope are preserved; the index remains empty. No permissions, routes, operational custody or release behavior changed.

## Deferred production dependencies

- Real malware scanner and production private storage provider, including deployment-level isolation and recovery controls.
- A configured domain-specific authorization integration and authenticated HTTP integration; this slice intentionally wires neither.
- Approved retention and record-access policy.
- Supported-environment execution of B2-2 filesystem symbolic-link security coverage, previously skipped under Windows EPERM.
- Distributed storage coordination and consistency outside MongoDB; Mongo transactions do not make external file storage atomic.
- Mobile record-management and review experience in a separately approved slice.
- B2-1 history integrity enforcement before future policy/grant lifecycle writers.

## Final root-cause test closure cycle

The latest supplied focused result before this correction was 17/19 passed, 2 failed. The separately supplied fresh applicable regression result was 261 total, 260 passed, 0 failed, 1 skipped for Windows symbolic-link EPERM, exit 0. Source-grounded review and isolated Mongoose runtime probes confirmed both focused failures were test invocation/assertion mistakes; no additional production defect was found.

1. **`Model.insertOne` receiver:** the test extracted `StudentCustodyRecord.insertOne` and invoked it without binding `this`. Mongoose 9.10.3 validates the receiver before creating a document, so that call failed before reaching the scoped persistence guard. The test now uses `Reflect.apply(insertOne, StudentCustodyRecord, ...)`. With a valid receiver, Mongoose constructs the document and calls `$save`; the exact persistence permit denial is then observed. The test snapshots all four custody collections after the attempt to prove nothing was inserted.
2. **Synchronous `save()` permit rejection:** the integrity block called `assert.rejects(doc.save(), ...)`. The wrapper is synchronous and throws before `assert.rejects` receives an argument. The test now schedules the invocation inside `Promise.resolve().then(...)`, preserving an exact `/exact scoped service permit/` matcher. It then verifies denied deletes/updates and compares persisted rows before and after, followed by a legitimate service edit and expected event/association/receipt counts.

The complete affected blocks were inspected. The model/query/bulk/connection/aggregate test checks every later operation and the persisted-state assertions; aggregate denial is synchronous and covered with `assert.throws`. The document block checks exact lifecycle-validation errors, document delete/update/replace denials, both save entry points, correctly bound `insertOne`, and final persisted state. The integrity block checks immutable event reason, evidence digest and receipt operation ID through `set()` plus `validate()`, fresh-document persistence denials, unchanged MongoDB state, and successful authorized service writes. No meaningful security assertion was removed or widened to arbitrary errors.

Installed runtime evidence from Node `v24.19.0` and Mongoose `9.10.3`:

- `Model.prototype.save === Model.prototype.$save`; both are wrapped by the custody persistence permit guard.
- A standalone receiver-bound `Model.insertOne` probe reached a synthetic `$save` permit guard. Calling it without a model receiver produced the Mongoose receiver error first.
- Immutable assignment did not throw synchronously. Mongoose stored a path `StrictModeError`; `validate()` rejected with `ValidationError`, and its matching path error reported the immutable-field rule. The persisted test asserts this for event, evidence association and receipt fields.
- The probes used in-memory synthetic models and did not create files or database records.

This final correction changes only `backend/tests/student-custody-record.security.test.ts` and this report. Production source has not changed since the supplied 261-test regression execution; that result remains applicable and was not rerun.

Final static checks after the current test edits: backend TypeScript PASS (exit 0), focused test-source TypeScript PASS (exit 0), strict scoped ESLint PASS (exit 0), `git diff --check` and explicit whitespace checks for all five scoped paths PASS (exit 0).

The focused command was attempted after the latest test edits but the runner exited before test discovery with `uv_os_get_passwd returned ENOMEM`; zero tests ran after the corrections. Manual Windows CMD command from `D:\SchoolManagementSystem\backend`:

```cmd
node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\student-custody-record.security.test.ts
```

Final targeted disposition: **PARTIAL — CORRECTIONS COMPLETE, MANUAL RUNTIME VALIDATION REQUIRED**. No database-level immutability or cryptographic tamper evidence is claimed; the B2-1 history-integrity prerequisite and documented production storage, scanner, domain-authorization, retention, distributed-consistency and supported-platform symbolic-link requirements remain.

## Final independent P1 closure review

**P1 CLOSURE: BLOCKED.** The accepted test evidence is recorded, but the persistence-permit issuance boundary does not satisfy the requirement that no authorization bypass be exposed.

The forgeable string marker is gone. The permit is tied to one exact document and matching session, requires an active transaction, and is consumed once by the guarded `save()` / `$save()` entry points. Supported model, query, document, bulk, connection and aggregation mutation methods remain blocked. The service calls the helper only after its own actor/session, Branch, enrollment and domain-authorizer checks, and the supplied focused evidence is 19/19 with the applicable regressions 260 passed, zero failed and one symbolic-link EPERM skip. Combined accepted evidence is 280 total, 279 passed, zero failed and one skipped. These results do not exercise direct use of the exported permit issuer.

**Confirmed remaining P1:** `persistStudentCustodyDocumentInTransaction` is exported from `backend/src/models/studentCustodyRecord.ts:30-53`. It validates model name, transaction state, document/session identity and append status, then creates and consumes the AsyncLocalStorage permit. It does not require proof that `CustodyRecordAuthorizer` ran, nor does it validate actor/session identity, Branch, StudentEnrollment, evidence eligibility or service lifecycle authorization. The `StudentCustodyRecord` creation validator checks the permit plus initial draft/revision fields, but does not check those authorities. Any backend module can import this exported helper and persist a well-formed record directly; on an existing record it can also save a schema-allowed next transition without the service's domain authorization or associated event/receipt transaction. This is a normal exported application API path, not a direct collection operation or arbitrary database edit.

The current tests prove that direct `doc.save()` / `$save()` and model write APIs are denied without a permit, but none proves that the exported permit issuer itself is restricted to the authorized service boundary. The exact-document and transaction checks limit the write shape; they do not prevent this authorization bypass. Source references: permit creation and export at `backend/src/models/studentCustodyRecord.ts:30-53`; authorization immediately before service-created persistence at `backend/src/services/student-custody-record.service.ts:315-339`; direct persistence assertions at `backend/tests/student-custody-record.security.test.ts:421-467`.

No implementation change was made because this task authorizes report-only closure unless a material defect is confirmed, and any correction requires separate authorization. To close P1, the permit must only be issuable through an authorization-bound service capability that cannot be minted by an ordinary importing backend module; regression coverage must directly attempt to bypass the service using the exported writer contract and verify no record/event/receipt changes occur.

### Accepted validation and limitations

- Accepted focused runtime evidence: 19 total, 19 passed, zero failed/skipped/cancelled, 5360.7523 ms.
- Accepted applicable regression evidence: 261 total, 260 passed, zero failed, one skipped for Windows EPERM in the symbolic-link test.
- Combined accepted evidence: 280 total, 279 passed, zero failed, one skipped.
- Backend TypeScript, focused test-source TypeScript, strict scoped ESLint and whitespace checks were previously reported passing. These checks were not rerun during this read-only review.
- The final correction cycle changed tests and documentation only; production source remained unchanged from the accepted regression run. The 261-test suite was not rerun.
- The symbolic-link test still needs execution in a supported environment. No database-level immutability or cryptographic tamper evidence is claimed. B2-1 policy/grant history integrity remains required before its lifecycle writers. Production private storage, real malware scanning, domain authorization, authenticated HTTP integration and approved retention remain prerequisites. No operational custody or physical release authority is enabled.

### Git state at final closure review

Branch: `feature/g4e-2b2-3-student-custody`

HEAD: `b093699ed9d204bd9feebc059b06adf76b84adfc`

Index: empty.

Overall changed paths remain the expected five: `backend/src/models/studentCustodyRecord.ts`, `backend/src/services/student-custody-record.service.ts`, `backend/tests/student-custody-record.security.test.ts`, `backend/src/server.ts`, and this report. No source or test file changed in this review; only this completion report was updated.

Final disposition: **BLOCKED — CONFIRMED MATERIAL DEFECT**. No staging, commit, push, merge or branch switch occurred.

## Final P1 authorized persistence ownership correction

The P1 finding above is addressed in source. `persistStudentCustodyDocumentInTransaction` has been removed from the model module. The model module no longer issues permits. Permit issuance now occurs only in the unexported `persistCustodyDocumentInTransaction` function in `backend/src/services/student-custody-record.service.ts` (currently near line 72), and the service calls it only from its authorized transactional mutation flows after the existing actor/session, Branch, enrollment and domain-authorizer fences. The function still requires an allowed exact model, active transaction, exact document session and append-only semantics for event/association/receipt records. Its AsyncLocalStorage context is bound to that document and session and consumed once by the guarded save path.

The model imports `hasCustodyWriteContext` and `consumeCustodyWriteContext` from the service module solely for validation and one-use consumption. These exported helpers cannot create a context or grant a write by themselves. The private context object, AsyncLocalStorage instance and permit-issuing function are not exported. A repository search found no other issuer or stale call to the old exported function. The model/service circular dependency is limited to these call-time guard helpers; service imports of the model are used by service functions after module initialization.

The focused security file now has 20 tests, including `application module interfaces do not export custody persistence authority`. That regression checks both module namespaces for absence of the previous issuer and the private issuer name, and confirms the service API remains available. Existing tests continue to cover direct unauthorized document/model/query/bulk/connection/aggregation attempts and compare persisted record, revision, event, evidence-association and receipt state; legitimate authorized create/edit/review operations remain covered. This test change adds no alternate writer, route, permission or operational behavior.

### Validation after the ownership correction

- Backend TypeScript: `npx tsc --noEmit --pretty false` from `D:\SchoolManagementSystem\backend` — PASS, exit 0.
- Focused test-source TypeScript: `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node tests/student-custody-record.security.test.ts` from `D:\SchoolManagementSystem\backend` — PASS, exit 0.
- Strict scoped ESLint: `npx eslint backend/src/models/studentCustodyRecord.ts backend/src/services/student-custody-record.service.ts backend/tests/student-custody-record.security.test.ts backend/src/server.ts --max-warnings 0` from repository root — PASS, exit 0.
- Focused runtime attempted once with `node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\student-custody-record.security.test.ts` from `backend` — BLOCKED before test discovery, exit 1, Node `v24.19.0`: `uv_os_get_passwd returned ENOMEM`. Zero runtime tests ran after this production source change. Run that exact command in normal Windows CMD.
- Since production source changed, the earlier 261-test regression result is historical and does not validate this correction. Minimum affected regression command from `backend`:

```cmd
node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\protected-evidence.security.test.ts tests\school-custody-contract.test.ts tests\school-custody-foundation.security.test.ts tests\custody-policy-foundation.test.ts tests\gate-foundation.security.test.ts tests\pickup-authorization.security.test.ts tests\early-exit.security.test.ts
```

- `git diff --check` and an explicit trailing-whitespace scan across the five expected paths — PASS, exit 0.

### Current ownership disposition and limits

The architectural correction is implemented and static checks pass. Runtime confirmation remains required, including the focused 20-test suite and the directly affected custody/evidence/Gate/Pickup/Early Exit regressions above. Previously accepted 19/19 and 261-test evidence predates this production source change and is not counted as fresh validation. No claim is made that this boundary prevents arbitrary trusted-process execution, privileged database access or direct driver operations. No database-level immutability or cryptographic tamper evidence is claimed. Existing history-integrity, production storage/scanner, domain authorization, authenticated HTTP, retention, distributed consistency and supported-platform symbolic-link prerequisites remain. No operational custody or physical release authority is enabled.

Current Git scope remains exactly the five expected paths; index empty; branch `feature/g4e-2b2-3-student-custody`; HEAD `b093699ed9d204bd9feebc059b06adf76b84adfc`. No staging, commit, push, merge or branch switch occurred.

Final disposition: **PARTIAL — ARCHITECTURAL P1 CORRECTED; MANUAL FOCUSED AND REGRESSION RUNTIME VALIDATION REQUIRED**.

## Final authorized persistence ownership acceptance review

The supplied post-correction runtime evidence is accepted as execution evidence for the current reported source: focused suite 20/20 passed, 0 skipped, duration 12421.4196 ms; applicable regressions 261 total, 260 passed, 0 failed, 1 skipped for Windows EPERM in the symbolic-link test, duration 430634.0574 ms. Combined: 281 total, 280 passed, 0 failed, 1 skipped. The skipped test is not counted as passed. No implementation source was changed during this review, and the current source contains the private permit function described above.

### Confirmed remaining P1 ownership defect

The model-level permit issuer is now private, and neither module exports `persistStudentCustodyDocumentInTransaction`, `persistCustodyDocumentInTransaction`, or `issueCustodyWritePermit`. However, the required broader ownership condition is not yet established: `createStudentCustodyRecordService` remains publicly exported at `backend/src/services/student-custody-record.service.ts:212` and accepts caller-supplied `authorize` and `readEvidence` functions. An importing application module can construct this writer service with an always-true `authorize` callback. The service then performs its normal persisted actor/session/role, Branch, Student and exact active-enrollment checks, but the caller-controlled callback can bypass the required domain relationship authorization (for example, the canonical Parent-to-Student relationship check). It can then use the service's supported mutation methods, which reach the private persistence permit. This is an exported writer factory/equivalent capability, even though the raw permit issuer itself is private.

The new test at `backend/tests/student-custody-record.security.test.ts:111-120` checks that issuer names are absent, but explicitly confirms that the public service factory is available. It does not attempt to construct the service through that exported interface with an allow-all authorizer, so it does not prove the requested application-consumer boundary. The 20 passing focused tests therefore do not close this ownership issue. This conclusion concerns supported in-process module interfaces only; it makes no claim about arbitrary trusted-process execution or direct database/driver access.

Minimum correction: make service construction inaccessible to arbitrary application consumers, or bind it to a fixed trusted domain-authorizer composition that consumers cannot replace, while retaining a test-only seam that cannot enter production module exports. Add a regression that imports the supported production interface and proves callers cannot supply or obtain an unrestricted writer. Preserve the existing role/session, Branch/enrollment, transaction, revision, event, evidence, receipt and rollback guarantees. This review was authorized to update this report only, so no source/test correction was made.

### Git and validation

Branch `feature/g4e-2b2-3-student-custody`; HEAD `b093699ed9d204bd9feebc059b06adf76b84adfc`; index empty. The five expected changed paths remain `backend/src/models/studentCustodyRecord.ts`, `backend/src/services/student-custody-record.service.ts`, `backend/tests/student-custody-record.security.test.ts`, `backend/src/server.ts`, and this report. `git diff --check` and the explicit whitespace scan across all five paths pass. No runtime suite was repeated.

All previously documented production dependencies and the B2-1 history-integrity prerequisite remain in force. No operational custody or physical release authority is enabled.

Final disposition: **BLOCKED — CONFIRMED MATERIAL P1 REMAINS: the exported service factory accepts caller-controlled domain authorization and can create a supported writer that bypasses the required relationship authorizer.**

## Comprehensive authorization trust-boundary correction

This section supersedes the preceding P1 finding. The public factory accepting caller-provided `authorize` and `readEvidence` functions has been removed. `buildStudentCustodyRecordService` is now module-private (`backend/src/services/student-custody-record.service.ts:216`); it is called only at module initialization (`:605-608`) with the fixed dependencies imported from `student-custody-record.trusted-dependencies.ts`. No exported factory, setter, registration hook or caller-supplied operation callback can replace them. The exported `studentCustodyRecordService` is a frozen operations object, not a constructor.

Production domain authorization is intentionally still unwired. `authorizeStudentCustodyRecord` returns `false` unconditionally (`backend/src/services/student-custody-record.trusted-dependencies.ts:10-14`), and the production evidence reader rejects access (`:16-22`). Therefore missing authorization configuration denies operations rather than enabling them. No school relationship policy or reviewer grant was invented. The service continues to apply its persisted user/session/role/Branch checks, exact active StudentEnrollment scope and action checks before reaching the fixed domain authorizer (`student-custody-record.service.ts:228-308`). Since the fixed production authorizer denies, custody mutations and protected evidence access remain unavailable until approved trusted dependencies are implemented.

### Ownership and runtime export inventory

- **Service construction:** the custody service module constructs its own frozen singleton at module load. Ordinary consumers cannot construct another service or pass dependencies.
- **Domain authorization and evidence access:** the trusted-dependencies module owns the fixed deny-all authorizer and deny-all evidence reader. There is no runtime setter/configuration export. Its complete runtime export surface is those two denial functions.
- **Persistence permission:** the service module privately issues the exact-document/session, single-use permit inside its active transaction. `hasCustodyWriteContext` and `consumeCustodyWriteContext` remain exported only because model validation/save guards call them; neither creates or configures a context. The persistence function, context store and builder are not exported.
- **Model module runtime exports:** `STUDENT_CUSTODY_RECORD_EVENT_ACTIONS`, `STUDENT_CUSTODY_RECORD_STATES`, the Record/Event/Evidence/Operation models, and `ensureStudentCustodyRecordIndexes` only.
- **Service module runtime exports:** `StudentCustodyRecordError`, the two context guard helpers, and `studentCustodyRecordService`. Public type exports are erased at runtime. No writer factory or authorizer configuration export remains.
- **Test construction:** the isolated test helper under `backend/tests/helpers/` uses Node's test-runner module mocking to replace the trusted dependency module before the service is loaded. The test helper setter is under `backend/tests`, while `backend/tsconfig.json` includes only `src/**/*.ts` and emits only `src` files. Production consumers cannot import that test helper through the built application. This is a test-process seam, not a production configuration hook.
- **Mutation boundary:** create, mutate, and evidence-association methods continue through actor/session validation, exact Branch/enrollment scope, the fixed authorization function, revision and receipt checks, and the private transactional persistence path. The service singleton does not accept an `authorize` property on its operation input. The added regression verifies the complete relevant runtime export key sets, production default denial, ignored caller-supplied authorization data, and unchanged persisted records/events/associations/receipts after denial. Existing tests still exercise legitimate service behavior through the isolated test-runner dependency mock, without a production factory.

The added internal production dependency module and isolated test helper expand the earlier five-path scope to seven paths. This is necessary to separate fixed production authorization ownership from synthetic test dependencies without exporting a replaceable writer factory. No route, permission, custody-state mutation, approval policy or release capability was added. The test-only Node module mock is enabled only for the test command; it does not change server startup or production wiring.

### Validation after this correction

- Backend TypeScript: `npx tsc --noEmit --pretty false` from `D:\SchoolManagementSystem\backend` — PASS, exit 0.
- Focused test-source TypeScript: `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node tests/student-custody-record.security.test.ts` from `backend` — PASS, exit 0.
- Strict scoped ESLint: `npx eslint backend/src/models/studentCustodyRecord.ts backend/src/services/student-custody-record.service.ts backend/src/services/student-custody-record.trusted-dependencies.ts backend/tests/student-custody-record.security.test.ts backend/tests/helpers/mock-student-custody-dependencies.ts backend/src/server.ts --max-warnings 0` from repository root — PASS, exit 0.
- Focused runtime command attempted: `node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 tests/student-custody-record.security.test.ts` from `backend` — exit 1 before test discovery; Node `v24.19.0` reports `uv_os_get_passwd returned ENOMEM`. Zero tests ran for the current changes.
- Directly affected regression command attempted with the same runner restriction:

```cmd
node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 tests/protected-evidence.security.test.ts tests/school-custody-contract.test.ts tests/school-custody-foundation.security.test.ts tests/custody-policy-foundation.test.ts tests/gate-foundation.security.test.ts tests/pickup-authorization.security.test.ts tests/early-exit.security.test.ts
```

It exited 1 before test discovery with the same ENOMEM error; zero regression tests ran. Normal Windows CMD can retry these commands from `D:\SchoolManagementSystem\backend`. The existing 20/20 and 260-pass/one-skip runtime results predate this comprehensive source and test-boundary change and are historical only.

- `git diff --check` and explicit trailing-whitespace check over all seven changed paths — PASS, exit 0.

### Current disposition and limits

The factory authorization bypass has been corrected at the supported application interface. Production custody authorization remains deliberately disabled until a trusted domain authorizer and authenticated protected-evidence reader are approved and implemented. Runtime acceptance for this latest source remains pending because the runner failed before discovery. No claim is made against arbitrary trusted-process execution, malicious source modification, privileged database access or direct driver operations. Previously documented B2-1 history integrity, production private storage, real malware scanning, domain authorization, authenticated HTTP integration, approved retention, distributed storage consistency and supported-platform symbolic-link prerequisites remain. No operational custody or physical release authority is enabled.

Current Git state: branch `feature/g4e-2b2-3-student-custody`; HEAD `b093699ed9d204bd9feebc059b06adf76b84adfc`; index empty. Exact changed paths are the original five plus `backend/src/services/student-custody-record.trusted-dependencies.ts` and `backend/tests/helpers/mock-student-custody-dependencies.ts`. No staging, commit, push, merge, branch switch or destructive Git operation occurred.

Final disposition: **PARTIAL — TRUSTED AUTHORIZATION OWNERSHIP CORRECTED AND STATIC CHECKS PASS; MANUAL FOCUSED AND REGRESSION RUNTIME VALIDATION REQUIRED**.

## Consolidated final acceptance — authoritative current result

This section supersedes older interim findings and verdicts above. Fresh runtime validation completed through native Windows CMD using the installed dependencies.

### Baseline and source identity

- Repository: `Hashir-dev95/SchoolManagementSystem`, workspace `D:\SchoolManagementSystem`.
- Branch: `feature/g4e-2b2-3-student-custody`.
- HEAD: `b093699ed9d204bd9feebc059b06adf76b84adfc`.
- Index: empty.
- Exact changed paths (7): `backend/src/server.ts`; `backend/src/models/studentCustodyRecord.ts`; `backend/src/services/student-custody-record.service.ts`; `backend/src/services/student-custody-record.trusted-dependencies.ts`; `backend/tests/student-custody-record.security.test.ts`; `backend/tests/helpers/mock-student-custody-dependencies.ts`; `docs/integration/pr-g4e2b2-3-student-custody.md`.
- Runtime versions: Node `v24.19.0`, Mongoose `9.10.3`, tsx `4.23.15`.
- SHA-256 fingerprints at runtime validation: model `F79857B6FBCA1941BF8F4EA85064EFCC17A34969A697D8F83FF8F2BBA3ADC4F0`; service `4EBF324DA8D67CF4C58F774A8C3206988CDE94CF418A9C0AD5FB4136658525D6`; fixed dependencies `DE746A01E8EF5A9919E0C70CE3A4F587005A846AA06C972B756252532140FCD4`; focused test `58B5769BB0DB11A5B3EAB2814B30228447C981153244333718199F3E2AAFF1F2`; test helper `453AD7FB8220045716417442D929732E94F0D281782F19E21E9D3C2D4A1DA400`; startup index wiring `755E0505732F91FB6FBACE117347778A34E3C635DC7ECE4F8D26B251809E413F`.

### Implemented architecture and P1 closures

The model-level permit issuer was removed. The sole issuer, `persistCustodyDocumentInTransaction` (`backend/src/services/student-custody-record.service.ts:76`), is private and requires an allowed model, active transaction, exact document/session binding and append-only status for event, evidence-association and receipt documents. Its AsyncLocalStorage permit is exact-document bound and consumed once by the guarded save path. Earlier direct `save()` bypass protections remain in the model guard.

The caller-configurable exported service factory was also removed. `buildStudentCustodyRecordService` is private (`student-custody-record.service.ts:216`) and constructs the frozen service singleton at module initialization (`:605-608`) from fixed dependencies. Production `authorizeStudentCustodyRecord` always returns false and `readStudentCustodyEvidence` denies (`student-custody-record.trusted-dependencies.ts:10-22`). The domain authorizer and authenticated evidence reader are not wired, so operations remain disabled until approved trusted implementations are supplied; no school policy or reviewer grant was inferred.

Runtime export inventory: the model module exports two lifecycle constant arrays, four models and the index initializer; the service module exports `StudentCustodyRecordError`, `hasCustodyWriteContext`, `consumeCustodyWriteContext` and the frozen operations singleton. Type-only declarations are erased. The dependency module exports only fixed denial functions. There is no supported writer factory, authorizer setter, registration hook or persistence issuer. The two context helpers are required by model save/validation guards but cannot create a write context.

Synthetic authorization is injected only by `backend/tests/helpers/mock-student-custody-dependencies.ts`. It uses Node test-runner module mocking against the trusted dependency's file URL before loading the service. The focused test exercises the actual singleton and source implementation; it is not a duplicate service. `backend/tsconfig.json` includes only `src/**/*.ts`, excluding test helpers from the production build. The helper's test-runner setter is not imported by production modules. The module-mocks flag is used only for test execution.

The expanded regression checks runtime export inventories, absence of configurable construction APIs, ignored caller-supplied authorization data, denial without persistence changes and authorized service operations through the isolated test seam. Existing coverage verifies actor/session/role, Branch and exact enrollment isolation; evidence owner/domain/resource checks; revision CAS; idempotent receipts and conflicts; transactional rollback; immutable events and evidence; Hold precedence; and no operational custody-state mutation. Startup initializes the required indexes (`backend/src/server.ts:74-75`). Administrative review remains non-operational.

Native test execution first exposed a test-mock resolution defect (3 passed, 17 failed because the synthetic authorizer did not replace the production deny dependency). The helper was corrected to use the dependency's absolute file URL. The final focused suite then passed all 20 tests. This was a test harness fix; no permissive production authorizer was added.

### Fresh runtime evidence

The restricted runner's `uv_os_get_passwd returned ENOMEM` was avoided using the supported native Windows command interpreter. An attempt to place the experimental flag in `NODE_OPTIONS` was rejected by Node, so the flag was passed directly.

Focused suite, cwd `D:\SchoolManagementSystem\backend`:

```cmd
cmd.exe /d /c "node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 tests\student-custody-record.security.test.ts"
```

Exit 0; 20 tests, 20 passed, 0 failed, 0 skipped, 0 cancelled; duration `7676.7366 ms`.

Applicable regression suites, same cwd:

```cmd
cmd.exe /d /c "node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 tests\protected-evidence.security.test.ts tests\school-custody-contract.test.ts tests\school-custody-foundation.security.test.ts tests\custody-policy-foundation.test.ts tests\gate-foundation.security.test.ts tests\pickup-authorization.security.test.ts tests\early-exit.security.test.ts"
```

Exit 0; 261 tests, 260 passed, 0 failed, 1 skipped, 0 cancelled; duration `167983.2925 ms`. The one skipped test is symbolic-link storage protection, unavailable on Windows due to `EPERM`; it is not counted as a pass. Earlier accepted run counts are historical and not combined with these fresh results. Runtime fingerprints above correspond to the source and test files; only this report was changed afterward.

### Fresh static checks

- Backend TypeScript, cwd `backend`: `npx tsc --noEmit --pretty false` — PASS, exit 0.
- Focused test-source TypeScript, cwd `backend`: `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node tests/student-custody-record.security.test.ts` — PASS, exit 0.
- Strict scoped ESLint, cwd repository root: `npx eslint backend/src/models/studentCustodyRecord.ts backend/src/services/student-custody-record.service.ts backend/src/services/student-custody-record.trusted-dependencies.ts backend/tests/student-custody-record.security.test.ts backend/tests/helpers/mock-student-custody-dependencies.ts backend/src/server.ts --max-warnings 0` — PASS, exit 0.
- `git diff --check` and explicit whitespace scan covering all seven changed paths, including untracked files — PASS, exit 0.

### Findings, limits and B2-4 handoff

No confirmed in-scope P0/P1 defect remains in the supported application interfaces. This is not production deployment approval. Before operations may succeed, implement a separately approved trusted domain authorizer and authenticated evidence reader. Preserve remaining requirements for private production storage, a real malware scanner, authenticated HTTP integration, approved retention, distributed storage consistency, supported-environment symbolic-link testing, and B2-1 append-only policy/grant history integrity before those lifecycle writers. No database-level immutability or cryptographic tamper evidence is claimed. The boundary does not cover arbitrary trusted-process execution, malicious source changes, privileged database access or direct driver operations.

B2-4 must preserve private evidence, server-side Branch/enrollment/relationship checks, session revalidation, revision and transaction fencing, immutable application history, Hold precedence, and deny-by-default authorization. Do not add positive verification, custody-state mutation, pickup approval, Gate checkout, QR/OTP, attendance effects or physical release without separately approved policy and trusted authorizers.

### Final Git state

Branch `feature/g4e-2b2-3-student-custody`; HEAD `b093699ed9d204bd9feebc059b06adf76b84adfc`; index empty; exact seven paths listed above remain changed. No staging, commit, push, merge, branch switch or destructive Git operation occurred. The only change after runtime validation was this documentation update.

Final disposition: **PASS — B2-3 READY FOR COMMIT AUTHORIZATION**. This accepts the non-operational internal foundation only.
