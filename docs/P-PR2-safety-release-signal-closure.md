# P-PR2 — Safety response and Principal release signal

Workspace: `D:\SchoolManagementSystem`; branch: `feture`. Date: 24 October 2026. Changes are incremental to the existing mixed worktree and the closed P-PR1 implementation.

## A. Verdict

**P-PR2 COMPLETE — SAFETY RESPONSE AND RELEASE SIGNAL CLOSED**

All named release-signal defects are repaired. Backend: **780 PASS / 0 FAIL across 17 suites**. Frontend: **83 PASS / 0 FAIL across 6 suites**. No skipped tests. Full backend TypeScript, scoped frontend TypeScript, scoped ESLint and `git diff --check` pass. P-PR3 was not started.

## B. Safety root cause

`processSafetyAlertAction` committed its conditional target/history mutation through the P-PR1 authority transaction but discarded the callback result and returned `Promise<void>`. The controller then passed that undefined result into `serializeSafetyAlerts`. Serialization failed after the database commit, producing HTTP 500. Its incompatible argument also caused `safety-alert.controller.ts:47 TS2322`.

Simply returning a Mongoose document and retaining a fallible identity lookup after commit would fix the immediate undefined value while leaving another post-commit failure path. The response projection now happens within the same transaction as the mutation, and the controller performs no post-commit database lookup.

## C. Correct response contract

The service returns the existing public `SafetyAlertDTO`. Its target data comes from the actual conditional update result; its scoped display identities are read using the same Mongo session. DTO construction happens before commit so lookup failure aborts the mutation. The transaction helper exposes the DTO to the caller **only after successful commit**. No provisional result is sent to the client.

All three existing actions keep the compatible envelope:

```json
{"success":true,"message":"Safety alert action completed successfully","data":null,"alert":{}}
```

Here `alert` is the complete existing whitelisted detail DTO, not an empty object: public alert ID/type/title/description/status/severity, scoped assignee display identity, timestamps, resolved time where applicable, public history and capabilities. It contains no token/session, raw Mongoose state, Branch ID, raw performer authority reference, email or password. Public history entry IDs and display names retain the existing contract.

| Action | Successful committed result | Identical retry |
| --- | --- | --- |
| assign | `in_progress`, eligible officer and one assignment history entry | 409 when already assigned to that officer in progress |
| resolve | `resolved`, resolved timestamp and one resolution history entry | 409 because the alert is final |
| escalate | `in_progress`, `critical` severity and one escalation history entry | 409 when already critical/in progress |

Assignment to a different eligible officer remains a legitimate new action. Existing target status/severity/assignee/timestamp/revision CAS remains unchanged; stale concurrent snapshots cannot overwrite newer state. No new idempotency system or client revision contract was introduced.

Three new HTTP contract cases compare response status, timestamps, assignee and history against persisted state and the ordinary detail endpoint. Each repeats its action, asserts 409 and compares the complete persisted document to prove no second mutation. Another new test forces DTO identity lookup failure after the provisional update: HTTP 500 is sanitized and the complete target/history remains unchanged. Thus response preparation errors no longer leave a committed mutation behind.

## D. P-PR1 preservation

The shared authority helper and the permanent P-PR1 suite are byte-for-byte unchanged. All **70 P-PR1 tests pass**, including Safety Branch transfer, account/role/session/permission loss, inactive Branch, and assignee transfer. Rejected races retain the entire previous alert document and history.

Safety still uses the same active-Branch, persisted User, role, permission, exact Session and assignee write fences. The conditional Safety update/history write and related-staff validation remain inside that boundary. No request-entry gate, CAS filter, authority policy or role grant was removed.

## E. TypeScript result

- **Full backend TypeScript: PASS**, using `node backend/node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json`.
- **Scoped frontend TypeScript: PASS**, including the repaired navigation test, Principal navigator and Safety service/screen dependencies.
- TS2322 is fixed by the real typed service result, not a cast or suppression. No new unrelated backend failure appeared. Compiler strictness and DTO field types were not weakened.

Compiler output is retained in [backend-types.log](D:/SchoolManagementSystem/.validation-p-pr2/backend-types.log) and [frontend-types.log](D:/SchoolManagementSystem/.validation-p-pr2/frontend-types.log).

## F. Route test repair

The existing Principal navigator intentionally registers `Rooms` and `TimetableAdmin` before `StudentsEnrollment`; the hard-coded test inventory omitted them. Added those two expected names in their existing order. The unique-name assertion and single-stack/no-nested-container checks remain intact.

The unchanged timetable-navigation suite verifies Principal management/drawer access, Super Admin Administration access, route ownership, and Rooms/native Back configuration. All **7 navigation tests** pass; all **8 Principal approval-context tests** pass. No navigator, route, menu or dashboard implementation changed.

## G. Permission test repair

The Super Admin permission snapshot omitted two existing exclusions: `liveLesson.*` and `teacher.assessments.*`. The actual server role map already intentionally excludes them. Live Lesson routes admit only Teacher/Student and assign their different capabilities; Teacher result/assessment writes operate in authenticated Teacher scope. Super Admin administration does not imply Teacher impersonation or permission to start/end a Teacher's lesson.

Updated only the stale test expectation. Added explicit assertions that assessment view/manage and Live Lesson start/end belong to Teacher and remain absent from Principal, Super Admin and Student. Existing Student view/join grants and Principal Safety ownership are unchanged. The frontend permission mirror likewise supplies no Super Admin Live Lesson or assessment execution grant; broader pre-existing mirror differences were not redesigned here.

The backend permission constants, backend role map and frontend permission mirror are all verified byte-for-byte unchanged. No privilege broadening occurred. Principal write/permission suite: **53 PASS / 0 FAIL**; relevant academic result security: **39 PASS / 0 FAIL**.

## H. Attendance fixture repair

The original Teacher attendance suite's setup sent free-text `room` when creating timetable periods/substitutions, so canonical Room validation rejected setup before attendance assertions could execute.

The original fixture now creates active canonical Rooms for own-Branch base periods, own-Branch substitutions and foreign-Branch test periods, clears those fixture records between tests, and sends `roomId`. Room display names remain `Room 8` and `Approved revised room`, preserving the original display assertions. No legacy text write or fallback was added to the production timetable API.

**All 143 original `assert.*` calls are unchanged in content and order**, verified using TypeScript AST extraction against the captured pre-edit file. All original **51 attendance tests pass, zero skipped**, with no Room setup failures. Session/PeriodAttendanceRecord, roster, marking/unmarked behavior, submission, historical reads and concurrency assertions execute again. The separate attendance-amendment/Principal-review suite passes **49/49**. Physical attendance and live participation remain separate; no media/attendance implementation was changed.

## I. Lint repair

Changed `catch (error)` to `catch` in Branch middleware because the variable was unused. The same sanitized status/body is returned; behavior is unchanged. No broader Branch policy/refactor was introduced.

Scoped ESLint of all **7 changed application/test files**: **PASS, 0 errors / 0 warnings**, with no suppression. Whitespace check: **PASS**.

## J. Files changed

| File | Reason |
| --- | --- |
| [safety-alert.service.ts](D:/SchoolManagementSystem/backend/src/services/safety-alert.service.ts) | Return typed safe mutation DTO through the existing transaction; prepare it before commit |
| [safety-overview.service.ts](D:/SchoolManagementSystem/backend/src/services/safety-overview.service.ts) | Reuse existing serializer with optional transaction session; export its inferred DTO type |
| [safety-alert.controller.ts](D:/SchoolManagementSystem/backend/src/controllers/safety-alert.controller.ts) | Send the committed service DTO directly; remove undefined/post-commit serialization path |
| [branch.middleware.ts](D:/SchoolManagementSystem/backend/src/middleware/branch.middleware.ts) | Remove unused catch variable, with identical error behavior |
| [principal-write.security.test.ts](D:/SchoolManagementSystem/backend/tests/principal-write.security.test.ts) | Repair stale permission expectation; assert ownership; add 3 response/retry cases and 1 projection-failure rollback case |
| [teacher-attendance.security.test.ts](D:/SchoolManagementSystem/backend/tests/teacher-attendance.security.test.ts) | Canonical Room fixture records/IDs only; preserve all original behavioral assertions |
| [principal-approval-context.test.tsx](D:/SchoolManagementSystem/__tests__/principal-approval-context.test.tsx) | Include the two intentional existing routes in the expected inventory |
| [This closure report](D:/SchoolManagementSystem/docs/P-PR2-safety-release-signal-closure.md) | Evidence-based P-PR2 closure and boundaries |

Validation-only configs, captured pre-edit files, hash evidence, runners and logs are under `.validation-p-pr2/`. No frontend production file changed. The existing frontend Safety service consumes `response.alert`; the screen applies it on success, clears loading in `finally`, and shows errors/reloads authoritative detail on failure. Its 20 UI and 10 service tests pass without an implementation change.

## K. Exact test counts

### Backend

| Suite | PASS | FAIL |
| --- | ---: | ---: |
| P-PR1 commit authority | 70 | 0 |
| Principal authorization | 50 | 0 |
| Principal writes, permission and Safety response contracts | 53 | 0 |
| Approval authority | 47 | 0 |
| Academic Setup / Rooms | 57 | 0 |
| Academic Foundation | 15 | 0 |
| ClassSubject | 36 | 0 |
| StudentEnrollment | 58 | 0 |
| TeacherAssignment administration | 20 | 0 |
| Timetable / Room / substitutions | 91 | 0 |
| Original Teacher attendance | 51 | 0 |
| Attendance amendment / Principal review | 49 | 0 |
| Academic lesson/syllabus security | 35 | 0 |
| Academic result security | 39 | 0 |
| Teacher provisioning | 28 | 0 |
| Teacher communications | 42 | 0 |
| Staff self-service / leave | 39 | 0 |
| **17 suites** | **780** | **0** |

### Frontend

| Suite | PASS | FAIL |
| --- | ---: | ---: |
| Principal approval context/navigation inventory | 8 | 0 |
| Timetable navigation | 7 | 0 |
| Principal Safety UI | 20 | 0 |
| Principal Safety service | 10 | 0 |
| Principal tasks UI | 31 | 0 |
| Principal task service | 7 | 0 |
| **6 suites** | **83** | **0** |
| **Combined unique tests** | **863** | **0** |

No skipped, deleted, expected-failing or suppressed tests. Repeated verification runs are not double-counted. The final 53-case Principal write rerun includes the additional positive Teacher-only permission assertions.

The 62 backend failures retained before P-PR2 (51 attendance fixture failures, 10 Safety response-path failures and 1 stale permission snapshot) and the stale frontend route failure are now resolved. All passing claims refer to the listed scoped suites; this does not claim every repository test or device flow was run.

Evidence: [structured results](D:/SchoolManagementSystem/.validation-p-pr2/final-results.json), [backend runner](D:/SchoolManagementSystem/.validation-p-pr2/run-backend.cjs), [frontend log](D:/SchoolManagementSystem/.validation-p-pr2/frontend.log), [lint output](D:/SchoolManagementSystem/.validation-p-pr2/lint.log). Backend suites run `node --import tsx --test --test-reporter=tap` against owned ephemeral MongoDB fixtures; no configured/production database was used. Frontend runs the six listed files through Jest with `--runInBand --watch=false --runTestsByPath`.

## L. Remaining Principal gaps — P-PR3 onward

- P-PR3: Student admission/profile administration and explicit same-period Class movement policy.
- P-PR4: Result publication return queue and authoritative refresh behavior.
- P-PR5: Principal attendance oversight using canonical period/session data.
- P-PR6: Substitution UI and effective replacement-Teacher availability conflicts.
- P-PR7: Teacher directory, task-recipient handoffs and notice visibility.
- P-PR8: Navigation/state hardening, granular dashboard grants and permission presentation.
- P-PR9: Scoped Branch reports/audit/export.

These remain the prior audit backlog. No P-PR3+ feature or additional architecture was implemented.

## M. Worktree preservation

Captured and verified **480 baseline files**: **7 authorized existing files changed; 473 others remain byte-for-byte unchanged**. This report and validation artifacts are additive. The closed P-PR1 authority helper/suite and all production permission files are unchanged. Existing mixed patches in touched files were retained; the baseline is the pre-P-PR2 worktree, not HEAD.

[Preservation evidence](D:/SchoolManagementSystem/.validation-p-pr2/preservation.json) records the changed-file allowlist, unchanged assertion comparison, unchanged permission/P-PR1 files, branch `feture` and empty index.

No reset, restore, clean, staging, commit or push. No unrelated Student/result/attendance feature, navigation redesign, ZEGO credential/client/media test, recording or R2 change. Work stops after P-PR2 validation and this report.
