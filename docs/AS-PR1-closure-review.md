AS-PR1 — Academic Setup Foundation: final closure review

Reviewed on 18 October 2026 against the current `feture` working tree, the actual feature diffs, `docs/AS-PR1-continuation.md`, captured continuation contents, and the earlier user-dirty baseline. This report supersedes the earlier report's test counts and conservative mixed-file classification. This pass changed tests/evidence/documentation only; all 21 AS-PR1 production source files are unchanged from closure start. Nothing was staged, committed, pushed, reset, restored or cleaned.

**A. AS-PR1 architecture verdict: PASS.** The foundation is coherent: Branch-owned AcademicPeriod → period-backed Class → contextual Section, with a separate Branch Subject catalog and existing exact-tuple TeacherAssignment integration. ClassSubject mapping and enrollment history are not implemented. The supplied product chain is supported. No separate product PDF was supplied or found in the workspace, so no claim of page-by-page PDF verification is made.

**B. Super Admin vs Principal ownership: PASS.** Global Super Admin governs period bootstrap/lifecycle and chooses an explicit target Branch. Principal manages Classes, Sections and Subjects in its own current database Branch and reads period state. Teacher has no setup API access. These are server-enforced policies, independently of navigation. Even accidentally granting Principal `academic.periods.manage` cannot bypass the explicit governance role check.

**C. Principal branch-security verdict: PASS.** The API authenticates the registered, non-revoked session and current active DB user/role; the service independently reloads the actor and requires the current server-side permission. Principal Branch comes from `User.branchId`. Supplied foreign Branch queries return concealed 404; body Branch fields return 400. Record queries include exact Branch; Class periods and Section parent Classes are also Branch-validated. Parent/period/academicYear injection on edits is rejected. Foreign Class/Section/Subject update/deactivate/reactivate attempts return 404, and foreign/missing updates have identical response bodies. Mismatched Section/Class detail tuples return 404. New tests also change Branch, role, active status, registered-session state and permissions *after initial authorization*, while the transaction is pending: each rejects the write with no catalog insertion. No branch escape was found.

**D. AcademicPeriod invariant verdict: PASS.** `status === 'active'` is the sole current-period authority. The database guarantees **at most one** active period per Branch; zero is deliberately valid before bootstrap and after closing. It does not guarantee that every Branch always has one. Dates are validated calendar dates with start strictly before end; they do not independently select current. Creation produces a draft. Allowed transitions are draft→active, draft→archived, active→closed and closed→archived. No reopening, hard delete or date editing after draft. Period-backed Class/Section mutations and new assignments/enrollments reject inactive/closed/archived periods. Subject catalog remains Branch-scoped.

**E. Concurrent active-period verdict: PASS.** The partial unique `one_active_academic_period` index on Branch, filtered by active status, arbitrates simultaneous activation at the database. A competing activation returns 409; the persisted count remains one. Unique period code/Branch and revision checks are separately tested. This conclusion does not depend on a find-before-write precheck.

**F. Transaction/fence implementation type.** MongoDB sessions and multi-document transactions with a real persisted Branch `__v` increment, primary reads, snapshot read concern and majority write concern. The same Branch document is written before reference checks by setup mutations and TeacherAssignment creation. Actor and login-session metadata writes protect setup authority. No production process-local mutex exists. Assignment queries within a transaction are sequential.

**G. Multi-instance race-safety verdict: PASS.** Added a second real Node/API process, connected to the same owned ephemeral replica set, with its own Mongoose connection and request handling. Six tests hold the first process after its actual Branch fence write, start the competing operation in the second process, wait for its fence attempt, then release the winner. IPC only observes arrival; MongoDB arbitrates writes.

| Dependency | Assignment wins | Deactivation wins |
| --- | --- | --- |
| Class | Assignment 201; deactivation 409 | Deactivation 409 because its Section is retained; assignment 201 |
| Section | Assignment 201; deactivation 409 | Deactivation 200; assignment 404 |
| Subject | Assignment 201; deactivation 409 | Deactivation 200; assignment 404 |

The original same-process/independent-session race tests also pass. Student enrollment versus Section deactivation passes in both orderings. No invalid assignment commits. The Class case deliberately has a Section, as every valid assignment requires one; the dependency guard is the safe winning outcome, rather than a fabricated successful Class deactivation.

The proof relies on the persisted conflicting write and driver retry, and therefore does not depend on processes sharing memory. MongoDB documents the write-conflict/stale-snapshot behavior; Mongoose documents retry handling and the restriction on parallel transaction operations. See [MongoDB transaction considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/) and [Mongoose transactions](https://mongoosejs.com/docs/transactions.html).

Production startup explicitly requires a replica set or supported sharded cluster before listening. Tests use a replica set. Standalone rejection is tested separately: 503, no callback write and no fence increment. There is no nontransactional fallback. An injected transient error after an insert causes two callback attempts but exactly one committed Subject and one committed Branch increment. An unretryable database failure returns sanitized 500/`success:false`, with no insertion. Abort rollback is separately verified. These tests validate application behavior on supported topology; they do not assert that the user's production deployment was contacted or load-tested.

**H. Class lifecycle verdict: PASS.** New Classes require an exact Branch-owned active AcademicPeriod; academicYear is derived from period code. Safe fields are name/code; identity/Branch/period cannot be reassigned through the API. Updates require positive current revision. Deactivation rejects child Sections and any retained operational/history reference. Reactivation still requires an active authoritative period. Legacy Classes are readable and explicitly read-only pending migration.

**I. Section lifecycle verdict: PASS.** Creation and every mutation revalidate exact Branch→Class→AcademicPeriod. A foreign/inactive/legacy Class or non-active parent period cannot receive a Section mutation. Sections cannot be reparented through updates. Duplicates, revisions, dependency guards and concurrent assignment creation are covered.

**J. Subject lifecycle verdict: PASS.** Subjects are a Branch catalog, with normalized whitespace and case-insensitive Branch/name uniqueness. Safe rename and revisioned lifecycle mutations are available. Foreign IDs and crafted Branch claims fail. Deactivation races and retained dependencies are tested. ClassSubject availability is deferred.

**K. Historical-data preservation verdict: PASS.** No setup hard-delete/cascade route or cleanup is present. The conservative guard blocks references from active *and historical* records, preserving compatibility with readers that resolve active catalog objects. Closing/archiving a period retains its Classes and all history; it freezes catalog governance without deleting operational records.

| Domain | Preservation reasoning |
| --- | --- |
| Student | Direct Class/Section guards; enrollment revalidates after acquiring the shared Branch fence. |
| TeacherAssignment | All retained assignments block catalog deactivation, including revoked assignments. Creation participates in the fence. |
| Timetable | Direct TimetablePeriod references block deactivation. Creation requires a retained exact assignment, which also blocks deactivation. |
| Syllabus | Direct Class/Subject guard; existing writes fence Branch/Class/Subject and revalidate within their transaction. |
| Attendance | Legacy Attendance and AttendanceSession direct guards; period marks/operations descend from retained sessions. |
| Homework/Quiz | Direct source guards; submissions/attempts retain source IDs, tuple identities and revisions. |
| Reviews | Reviews reference retained work/evidence/Student, rather than owning independent mutable Class/Section/Subject links. No review data is altered. |
| Catch-up | Direct tuple guard; original attendance/evidence remains unchanged. |
| Results | Direct tuple guard; assessment provenance, academicYear snapshot and revisions remain intact. |

Narrow guard tests now explicitly include AttendanceSession, Quiz and CatchUpItem as well as the previously covered domains. Existing downstream suites validate source/evidence/review/result reads and workflows. Inactive catalog references cannot pass new assignment/enrollment validation; retained history is not used as permission to create a new assignment against an inactive object.

**L. Index/duplicate/concurrency verdict: PASS.** `ensureAcademicSetupIndexes()` explicitly creates AcademicPeriod, SchoolClass, Section and Subject indexes at server startup, before requests are accepted. Tests disable autoIndex and call the explicit bootstrap. Database uniqueness covers Branch/period code, one active period, Branch/period/Class code, Branch/Class/Section code and normalized case-insensitive Branch/Subject name. Concurrent equivalent creates have one success and one 409. The legacy Branch/Class-code/academicYear uniqueness index remains. Index failure prevents normal startup; existing conflicting data is not silently deleted or repaired.

**M. Legacy academicYear compatibility verdict: PASS.** New Class writes accept `academicPeriodId`, derive academicYear from its Branch-owned period code and reject caller-supplied academicYear. Period identity is immutable. Existing legacy Classes remain readable and existing syllabus code still reads academicYear compatibility values. The syllabus/academic regression suite passes. Explicit legacy migration and broader downstream period-identity adoption remain future work; AS-PR1 does not pretend the entire historical database is migrated.

**N. RBAC verdict: PASS.** Central backend/frontend constants contain eight setup permissions. Backend middleware and services enforce them. Super Admin receives all eight; Principal receives period view plus six catalog grants; Teacher/Student receive none. Authorization architecture stores current role/status/Branch in User and uses the central server role-policy map for permission defaults; there is no per-user database permission-grant model or separate setup seed. DB identity changes invalidate old role claims, and the service rechecks policy during mutation. Tests cover each permission denial, Teacher mutation denial, accidental period-grant broadening and pending-request revocation.

**O. Principal Academic Setup UI verdict: PASS by code/component review.** Existing drawer and stack provide the dedicated destination, with Academic Period / Classes / Subjects and contextual Sections after Class selection. Theme typography, colors, spacing, DashboardShell/cards, existing form fields/selectors, buttons, dialogs and feedback are reused. Loading/empty/validation/403/404/409/network/retry/pending/inactive states are tested or directly verified in the shared resource/form code. The closure pass added explicit concealed-404 mutation feedback coverage. No raw database ID is rendered as a normal-user label. Mutation success awaits the confirmed server response; pending state disables repeat submission. This was not a native-device screenshot/visual run.

**P. Home non-cluttering verdict: PASS.** PrincipalDashboard and SuperAdminDashboard remain byte-identical to closure and continuation start. Neither contains setup CRUD entries. Existing unrelated Home changes remain user-owned.

**Q. Super Admin bootstrap verdict: PASS.** Settings→Academic Setup→named Branch selector→Create Academic Period→Activate is a real supported API/UI path. Super Admin starts on the period tab. Bootstrap is tested through the API and the component flow, independently of fixtures used for other tests. Direct Mongo insertion is not required in production.

**R. Downstream compatibility verdict: PASS.** Fresh closure regression covers TeacherAssignment, Teacher scope/classes, Timetable, Syllabus/academic, Attendance, Homework/Quiz, evidence/reviews, Catch-up and Results. The former standalone Teacher scope fixture now uses the supported replica-set topology. The full frontend suite includes previous Teacher features and Principal navigation. No production source fix was needed during this closure review.

**S. Focused backend tests.** **47/47 pass**, compared with 29 before closure. Added 18 tests: foreign-mutation/injection matrix; current account/session/permission checks; five authorization-change-during-transaction cases; three additional history guards; retry and sanitized-failure tests; six second-Node-process races. Log: `.validation-as-pr1/closure-backend-focused.log`. Helper: `backend/tests/helpers/academic-setup-worker.ts`. Test fixtures use owned temporary databases, do not read dotenv/development connection strings and shut down their child API process.

**T. Backend regression.** Fresh single combined run: **314/314 pass**, with zero failures across these nine suites:

```text
teacher-assignment-admin.security.test.ts
teacher-scope.security.test.ts
teacher-timetable.security.test.ts
academic.security.test.ts
teacher-attendance.security.test.ts
academic-work.security.test.ts
academic-evidence.security.test.ts
catch-up.security.test.ts
academic-result.security.test.ts
```

Log: `.validation-as-pr1/closure-backend-regression.log`. This selection expands direct coverage of Homework/Quiz, reviews, Catch-up and Results; it is a different selection from the earlier 366-test union. Earlier provisioning/communications/Home/notifications passes were reviewed as historical evidence, not presented as fresh closure reruns.

**U. Frontend focused/full tests.** Focused: **19/19 pass** across three Academic Setup suites. Full: **42 suites, 395/395 tests pass**. The additional test is concealed-404 mutation handling. Logs: `closure-frontend-focused.log`, `closure-frontend-all.log` under `.validation-as-pr1`.

**V. TypeScript/lint/diff.** Frontend scoped TypeScript passes. ESLint across all 28 feature source/test files passes with zero warnings/errors. `git diff --check` passes. Backend TypeScript still reports only the known unrelated `backend/src/controllers/safety-alert.controller.ts:47` TS2322 (`void` vs `ISafetyAlert`); it was not modified. The broad root TypeScript configuration also includes existing backend test/old validation diagnostics; final output contains no Academic Setup source/helper/test diagnostic. Logs: `closure-frontend-typescript.log`, `closure-backend-typescript.log`, `closure-root-typescript.log`, `closure-eslint.log`, `closure-diff-check.log`. Initial sandboxed Node startup failed before tests because Windows user lookup returned ENOMEM; the permitted outside-sandbox runs above completed against temporary databases.

**W. Exact AS-PR1-only files.** The following **24 source/test files** have wholly AS-PR1 feature diffs by content review. “AS-PR1-only” describes hunk ownership, not a clean Git status or a claim that every file was clean when the continuation began. The earlier continuation conservatively classified inherited dirty files as mixed; inspecting their full diffs now identifies only AS-PR1 changes in these files. No staging was performed.

```text
backend/src/models/academicPeriod.ts
backend/src/routes/academic-setup.routes.ts
backend/src/services/academic-catalog-lock.service.ts
backend/src/services/academic-setup.service.ts
backend/src/app.ts
backend/src/constants/permissions.ts
backend/src/constants/rolePermissions.ts
backend/src/server.ts
backend/src/services/teacher-assignment.service.ts
backend/src/services/teacher-scope.service.ts
backend/src/services/student.service.ts
backend/tests/academic-setup.security.test.ts
backend/tests/helpers/academic-setup-worker.ts
backend/tests/teacher-scope.security.test.ts
src/constants/permissions.ts
src/navigation/PrincipalNavigator.tsx
src/screens/principal/PrincipalWorkspaceScreen.tsx
src/screens/superAdmin/SuperAdminSettingsScreen.tsx
src/screens/admin/AcademicSetupScreen.tsx
src/services/admin/academicSetupService.ts
__tests__/academic-setup.test.tsx
__tests__/academic-setup-service.test.ts
__tests__/academic-setup-navigation.test.tsx
__tests__/principal-approval-context.test.tsx
```

Exact review artifact: `.validation-as-pr1/closure-as-only.patch`; inventory/provenance: `.validation-as-pr1/closure-feature-boundary.json`. The patch uses read-only HEAD comparisons and synthetic empty snapshots for new files. Documentation artifacts are `docs/AS-PR1-continuation.md` and this report; validation snapshots/logs/scripts are evidence, outside the 28-file source/test count.

**X. Mixed files.** Exactly four known historically user-dirty files contain both feature additions and unrelated pre-existing formatting. Do not treat their entire current diffs as AS-PR1:

```text
backend/src/models/schoolClass.ts
backend/src/models/section.ts
backend/src/models/subject.ts
src/navigation/SuperAdminNavigator.tsx
```

**Y. Exact AS-PR1 hunks in mixed files.** `.validation-as-pr1/mixed-as-pr1-hunks.patch` isolates the following additions; all other differences from HEAD in those four files remain outside AS-PR1.

| Mixed file | Exact AS-PR1-owned additions in final tree |
| --- | --- |
| schoolClass.ts | Interface lines 5–6: optional `academicPeriodId` and `revision`; schema lines 17–19: legacy comment, immutable AcademicPeriod ref, revision default; lines 64–67: partial unique `{branchId, academicPeriodId, code}` index named `class_period_code`. |
| section.ts | Line 5: optional revision interface member; line 16: revision schema default. |
| subject.ts | Line 4: optional revision interface member; line 20: revision schema default. Normalization/case-insensitive index and existing formatting are not new AS-PR1 hunks. |
| SuperAdminNavigator.tsx | Line 2: AcademicSetupScreen import; line 12: AcademicSetup route type; line 26: themed AcademicSetup Stack.Screen. |

The pre-AS copies reconstructed by removing **only** these additions match all four historical `.validation-tpr8/baseline-hashes.json` SHA-256 values exactly. This upgrades the prior report's synthetic-copy caveat with actual hash proof. `.validation-as-pr1/closure-feature-boundary.json` contains both values for each file. The mixed patch is a review artifact and has not been applied to the index.

**Z. Unrelated files preserved.** All 17 unrelated dirty files captured at continuation start still match their original hashes: `.gitignore`; permission middleware; approvalRequest, attendance, safetyAlert, schoolNotice, session, student and teacherAssignment models; school-notice controller; safety-alert and teacher-work services; PrincipalDashboard and SuperAdminDashboard; adminService; apiClient; blueprint. Closure additionally captured 49 existing files; only the two intended test files changed, with one new test helper added. The pre-existing Principal task file, notice changes, API host, dashboard changes, untracked service directory, old patch files, editor files and other historical validation directories were left intact. All 21 feature production source files remain byte-for-byte unchanged during closure. Evidence: `preservation.json`, `closure-start.json`, `closure-feature-boundary.json`. The index is empty; no commit/history operation was performed.

**AA. Deferred AS-PR2 / AS-PR3 scope.** ClassSubject mapping, student enrollment-history model, promotion/rollover automation, explicit legacy migration and broader downstream period-identity adoption remain deferred. Existing exact assignment tuples continue to use the separate Branch Subject catalog. This closure does not introduce a Section-owned Subject model or infer ClassSubject rules.

**AB. Remaining blockers/gaps.** No AS-PR1 correctness/security blocker found. Known non-blocking limits are the separately classified pre-existing Principal safety TypeScript diagnostic, absence of a native-device visual run, and absence of a supplied product PDF for literal document comparison. Supported production transaction topology remains a deployment prerequisite, verified by startup/runtime rejection rather than silently assumed on standalone MongoDB.

**AC. Final verdict**

`READY TO COMMIT`
