# P-PR1 — Principal commit-time authority closure

Workspace: `D:\SchoolManagementSystem`; branch: `feture`. Audit/implementation date: 24 October 2026. This report covers the P-PR1 incremental changes in the existing mixed worktree, not all changes relative to HEAD.

## A. Verdict

**P-PR1 COMPLETE — COMMIT-TIME AUTHORITY CLOSED**

The reproduced approval and task authority races now have permanent regression coverage. Shared Safety writes use the same authority boundary without fixing their deferred response bug. Operational writes covered here reject inactive Branches. This is a security-scope closure, not a declaration that the whole Principal module or backend release gate is green.

## B. Root causes

Request middleware correctly authenticated the caller and checked role, permission and server-derived Branch scope. Services then loaded a valid actor before an atomic target update. ApprovalRequest/PrincipalTask CAS protected concurrent changes to the target, but did not include the separate persisted User, Session or Branch documents. Transferring/demoting/disabling the actor or revoking the login after that check left an already-authorized target write able to commit. Legacy operations also omitted an active-Branch write condition.

The original red evidence is retained in [probe-evidence.json](D:/SchoolManagementSystem/.validation-principal-audit/probe-evidence.json): the three approval races and task transfer returned 200 with committed state; inactive-Branch task creation returned 201. Permanent tests now exercise those boundaries and additional failure modes. New tests were not represented as having run against an untouched baseline; the prior audit supplies the original red reproductions.

## C. Architecture fix

Extended the existing Principal write-access service with `withPrincipalWriteAuthority` and a related-staff fence. This reuses the persisted-document increment pattern inspected in Academic Setup, StudentEnrollment, Timetable and `withAcademicCatalogLock`: Mongo transactions, real `$inc: {__v: 1}` writes, snapshot reads, primary read preference and majority write concern. No new identity/session model or in-memory mutex was added.

The boundary performs:

1. Validate IDs and verify the signed access token matches the acting identity and expected role.
2. Execute the existing target CAS/insert and history write **inside the transaction**, provisionally.
3. Fence the active Branch with a conditional real write.
4. Fence the persisted User with conditions on ID, Branch, active account and authorized role.
5. Read the token's Session record using the same lookup as authentication, then conditionally write that exact record with matching User/role and `isRevoked:false`. Missing/revoked sessions fail closed. A second valid row cannot revive a revoked first token record.
6. Fence relevant assignee/delegate/delegator Users and recheck approval policy/reference validity where applicable.
7. Reverify token validity and the required role permission before returning to the transaction commit.

Fences deliberately follow the provisional target write, covering changes both before and during that operation. If authority changes after the transaction snapshot, a conflicting document write aborts/retries against current state; a failed condition rejects the transaction. If the mutation acquires the authority write fence first, a competing transfer/revocation serializes after it. There is no successful unauthorized target/history commit followed merely by an error response.

Existing role permissions are server-side role-map configuration, not independently persisted per-user permission rows. The final permission check uses that actual map; tests remove the grant during the write window. Approval financial/category policy remains the existing server environment policy, rechecked before commit. No client role/Branch value creates authority.

Unsupported standalone Mongo deployments receive a sanitized 503; there is no unsafe nontransactional fallback. A replica set or sharded deployment is already required by the academic transaction architecture.

Error semantics: invalid/revoked login 401; lost role/account/Branch/permission/related-staff authority 403; concealed foreign target 404; target state/revision/delegation-expiry conflict 409. Existing request-entry middleware remains in place.

## D. Approval fixes

Protected every existing generic decision action: `approved`, `rejected`, `changes_requested`, `delegated`. Delegation still checks requester separation, permitted delegates, authority/category/financial limits and expiry. Delegated decisions also fence the delegator's current account/role/Branch and revalidate their policy.

The original target predicate is retained: pending status, Branch, revision, timestamp, approval type/amount, requester/entity and delegation snapshot. Database-clock delegation expiry predicates remain intact. Concurrent decisions still produce one success and one 409, with one history entry. Request-change actions retain their existing delegation clearing behavior.

The generic requester `resubmit` route is also a state-changing approval path, so it now uses the same boundary. Existing owner-only rules, If-Match revision, immutable business fields and supported Principal/Teacher/Student roles remain unchanged. It does not require reviewer permission: it requires the authenticated original requester. Existing typed attendance/leave/lesson/result review workflows are not rerouted through generic decisions.

There is no separate generic cancel or revoke-delegation action in the current action contract. No new endpoint/action was invented.

## E. Task and shared-helper fixes

Task creation/assignment and all existing actions (`start`, `complete`, `cancel`) now use the transaction boundary. Creation fences the active same-Branch Principal/Teacher assignee as well as the acting Principal. A transferred/ineligible assignee rolls back the inserted task.

Task actions retain their original ownership, transition, status/revision/timestamp/assignment CAS and history rules. These actions do not reassign a recipient; a historical task's creator can still manage it under the existing policy without treating every historical assignee as a new assignment. There are no separate reopen/general-edit endpoints to protect.

Safety also consumes the existing Principal write helper. Its `assign`, `resolve`, `escalate` writes now use this same boundary, with assignment eligibility fenced. This is strictly shared authority hardening. The service still returns `Promise<void>` and the Safety controller response bug is intentionally unchanged for P-PR2. Its controller file was not edited. Authorized Safety service writes still commit; affected HTTP success paths still exhibit the known post-commit response failure.

## F. Inactive Branch policy

| Operation | Active own Branch | Inactive own Branch | Foreign Branch |
| --- | --- | --- | --- |
| Task create/assign/start/complete/cancel | Allowed when otherwise eligible | 403, no target/history commit | Existing concealed/denied scope |
| Generic approval decisions/delegation | Allowed with policy and CAS | 403, no decision/history commit | 404 for concealed targets |
| Generic requester resubmission | Allowed for eligible owner and revision | 403 | Concealed/denied scope |
| Shared Safety assign/resolve/escalate | Service mutation allowed when eligible | 403 | Existing concealed/denied scope |
| Existing scoped read endpoints | Existing authorization retained | Existing read policy retained | Existing Branch boundary retained |

No global read middleware change was made. Existing scoped dashboard/list/detail/history reads remain accessible on an inactive Branch when the current account/role/read permission allows them; they confer no write authority. The new regression explicitly preserves inactive-Branch task detail access. This preserves the existing read contract without declaring every dashboard visibility policy production-complete. Catalog/Enrollment/Room/Timetable policies remain unchanged.

## G. Concurrency proof

[Permanent authority tests](D:/SchoolManagementSystem/backend/tests/principal-commit-authority.security.test.ts) run real Mongo replica-set transactions. Hooks coordinate independently committed database mutations at precise boundaries, not artificial sleeps or an in-process authorization lock.

| Scenario | Result and persisted state |
| --- | --- |
| Approval actor transferred/demoted/disabled/deleted before target write | 403; entire approval document unchanged, including history/revision/timestamps |
| Approval login revoked/deleted before target write | 401; entire target unchanged |
| Approval permission removed during write | 403; no decision/history |
| Approval transfer after provisional target update | Transaction rolls back; 403; entire target unchanged |
| Task actor/session/permission/Branch changes | 401/403 as applicable; target/history unchanged |
| Task transfer after provisional update | 403; previous task state/history retained |
| Task create loses actor authority or assignee Branch after provisional insert | 401/403; zero inserted tasks |
| Inactive own Branch create/start/complete/cancel/approve | 403; no target/history mutation |
| Foreign active/inactive Branch targets | 404; original targets unchanged |
| Delegation recipient transfer/delegator demotion | 403; no delegation/decision history added |
| Approval authority policy removed during target write | 403; no committed decision |
| Stale target revision | 409; no overwrite/history append |
| Two concurrent approval decisions | One 200 and one 409; one decision/history entry |
| Two concurrent task completions | One 200 and one 409; one completion/history entry |
| Principal resubmission loses Branch during write | 403; previous changes-requested document/history retained |
| Shared Safety actor/session/permission/inactive-Branch race | 401/403; entire alert/history unchanged |
| Shared Safety assignee transfer | 403; no assignment/history persisted |

Valid approval actions, task transitions, creation and requester resubmissions pass. The unchanged approval suite also exercises financial limits, requester separation, expired/legacy delegation, expiry while queued at MongoDB, concurrent resubmission and stale business snapshots.

The new suite compares complete target documents after rejected races, rather than accepting an error status as proof of rollback. No side-effectful external notification/media call occurs in these transaction callbacks.

## H. Files changed

These are the complete application/test/document changes for P-PR1. Existing mixed patches in these files were retained; this is not a list of every pre-existing dirty file.

| File | Reason |
| --- | --- |
| [principal-write-access.service.ts](D:/SchoolManagementSystem/backend/src/services/principal-write-access.service.ts) | Shared transaction, Branch/User/Session write fences, final token/permission validation, related-staff fence and replica-set failure semantics |
| [approval-request.service.ts](D:/SchoolManagementSystem/backend/src/services/approval-request.service.ts) | Wrap existing decision/delegation CAS; fence delegate/delegator and recheck policy/references |
| [approval-resubmission.service.ts](D:/SchoolManagementSystem/backend/src/services/approval-resubmission.service.ts) | Protect owner resubmission with existing CAS and authenticated role/session |
| [principal-task.service.ts](D:/SchoolManagementSystem/backend/src/services/principal-task.service.ts) | Transactional task insert/actions and assignment eligibility fencing |
| [safety-alert.service.ts](D:/SchoolManagementSystem/backend/src/services/safety-alert.service.ts) | Shared authority/assignee boundary only; preserve void return and defer response fix |
| [request-validation.ts](D:/SchoolManagementSystem/backend/src/utils/request-validation.ts) | Carry the server-read Bearer token in internal write scope, including Safety; never serialize it |
| [approval-request.controller.ts](D:/SchoolManagementSystem/backend/src/controllers/approval-request.controller.ts) | Pass authenticated Bearer token into decision service |
| [approval-resubmission.controller.ts](D:/SchoolManagementSystem/backend/src/controllers/approval-resubmission.controller.ts) | Pass authenticated token into requester mutation |
| [principal-commit-authority.security.test.ts](D:/SchoolManagementSystem/backend/tests/principal-commit-authority.security.test.ts) | New permanent 70-case security/concurrency/rollback suite |
| [approval-authority.security.test.ts](D:/SchoolManagementSystem/backend/tests/approval-authority.security.test.ts) | Upgrade owned Mongo fixture to replica set for transactional writes; assertions unchanged |
| [principal-authorization.security.test.ts](D:/SchoolManagementSystem/backend/tests/principal-authorization.security.test.ts) | Upgrade owned fixture to replica set; assertions unchanged |
| [principal-write.security.test.ts](D:/SchoolManagementSystem/backend/tests/principal-write.security.test.ts) | Upgrade owned fixture to replica set; assertions unchanged |
| [This closure report](D:/SchoolManagementSystem/docs/P-PR1-commit-authority-closure.md) | Scope, architecture, acceptance matrix, results and limitations |

Supporting configs/scripts/logs/results are under `.validation-p-pr1/`; they are validation artifacts, not application features. The Principal task controller has no incremental change: its existing write-scope spread now carries the token. No frontend source, schema, role grant, navigation, deployment configuration or media code changed.

## I. Security regression results

| Suite | PASS | FAIL |
| --- | ---: | ---: |
| New commit-authority suite | 70 | 0 |
| Existing approval authority | 47 | 0 |
| Existing Principal authorization | 47 | 3 |
| Existing Principal writes | 41 | 8 |
| **Security total** | **205** | **11** |

The new acceptance suite is fully green. The 11 existing-suite failures are the same failures established before P-PR1: **10 Safety response-path failures** and **one stale Super Admin permission snapshot**. No permission was broadened and no test assertion was suppressed. All three original suites changed only their Mongo fixture topology.

## J. Broader regression results

| Suite | PASS | FAIL |
| --- | ---: | ---: |
| Academic Setup, including Rooms | 57 | 0 |
| StudentEnrollment | 58 | 0 |
| TeacherAssignment administration | 20 | 0 |
| Timetable/Rooms/substitutions | 91 | 0 |
| Staff self-service/leave and generic resubmission integration | 39 | 0 |
| Teacher auth/role/Branch scope | 59 | 0 |
| **Broader total** | **324** | **0** |
| **All 10 suites, 540 unique tests** | **529** | **11** |

Original `auth.test.ts` loads dotenv and connects to a configured database, so it was not run against user data. Relevant authentication/session regressions were exercised through the isolated Principal authorization, Teacher scope and new session-race suites instead. No production database was accessed.

Scoped backend application TypeScript: **FAIL only at the known `safety-alert.controller.ts:47 TS2322`**. Additional scoped checking including the new permanent test also reports only that same existing controller error. Scoped ESLint of the 12 changed application/test files: **PASS, 0 errors / 0 warnings**. `git diff --check`: **PASS**. Frontend TypeScript was not required because no frontend file changed.

Commands/logs:

- `node .validation-p-pr1/run-backend.cjs` runs isolated suites with `node --import tsx --test --test-reporter=tap`; suite logs and initial structured counts are retained.
- Final security run: `node --import tsx --test --test-reporter=tap tests/principal-commit-authority.security.test.ts tests/principal-write.security.test.ts tests/principal-authorization.security.test.ts tests/approval-authority.security.test.ts`, from backend; [security-final.log](D:/SchoolManagementSystem/.validation-p-pr1/security-final.log) records **205 PASS / 11 FAIL**.
- Final standalone new suite: [70-case TAP log](D:/SchoolManagementSystem/.validation-p-pr1/principal-commit-authority.security.test.ts.log).
- [Final suite results](D:/SchoolManagementSystem/.validation-p-pr1/final-results.json), [compiler output](D:/SchoolManagementSystem/.validation-p-pr1/test-types.log), [ESLint output](D:/SchoolManagementSystem/.validation-p-pr1/lint.log), [preservation evidence](D:/SchoolManagementSystem/.validation-p-pr1/preservation.json).

## K. Known unrelated failures / boundaries

The Safety controller still serializes a void service result after a valid committed operation. The known TS2322 and resulting HTTP 500 are not hidden or fixed here. A valid Safety service mutation is tested directly; that is not a claim that its HTTP response contract passes. Rejected authority races return safe 401/403 before serialization and leave no committed state.

The stale permission test must be reconciled with intended grants in its own scope, not fixed by expanding permissions. No new TypeScript or lint failure was introduced. Deployment readiness still depends on P-PR2 and the existing replica-set requirement; no running deployment was inspected or changed.

## L. Remaining Principal gaps — P-PR2 onward

- P-PR2: Safety response/TypeScript repair and remaining release fixture/snapshot cleanup.
- P-PR3: Student admission and persistent profile administration.
- P-PR4: Result publication return queue and refreshed capabilities.
- P-PR5: Canonical Principal attendance oversight.
- P-PR6: Substitution management and effective Teacher availability conflicts.
- P-PR7: Teacher directory/task recipient handoffs and notice visibility contracts.
- P-PR8: Principal navigation/state/permission presentation, including granular dashboard data grants and inactive-context action presentation.
- P-PR9: Branch reports and scoped audit/export workflows.

These are the previously audited backlog, not additions implemented by this security pass. Existing approval/task frontend handlers already stop loading, show the backend error and refresh authoritative data after failures; no UI redesign was needed.

## M. Worktree preservation

The prior audit's SHA-256 baseline was verified against this worktree: **477 baseline files, 11 explicitly authorized existing files changed, 466 other files unchanged**. The new permanent test and this report are additive. Existing unrelated patches remain byte-for-byte unchanged in the baseline. See preservation evidence for the allowlist and branch/index checks.

No reset, restore, clean, staging, commit or push was performed. The index remains empty and the branch remains `feture`. No P-PR2 response fix, Student/result/attendance feature, navigation redesign, ZEGO credentials/client/media test, recording or R2 change was made. Work stops at this P-PR1 implementation and closure report.
