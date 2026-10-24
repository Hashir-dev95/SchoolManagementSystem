# AS-PR3 — Student Enrollment History + Promotion + Transfer

Implemented on `feture` above `69c3f29aa70d7e0c170688cb52f576b3266cb387`. No staging, commit, push, reset, restore, cleanup, production migration or T-PR14 work was performed.

**A. Student vs Enrollment architecture.** Student remains the permanent identity/profile and retains admission number, User/guardian links and Branch. `StudentEnrollment` owns the immutable Student/Branch/AcademicPeriod/Class/Section tuple, effective interval, lifecycle, revision, audit actors and predecessor reference. Transfer/promotion create another enrollment for the same Student rather than another Student. `EnrollmentOperation` is a durable actor-scoped retry receipt, not another academic authority.

**B. Enrollment lifecycle.** Minimal states: active, transferred, promoted, withdrawn. Transfer/promotion atomically close the active source and create an active successor; withdrawal closes the source only. Source effectiveTo, closing reason, updatedBy and revision are retained alongside its original placement and opening reason. No generic reparent, hard delete or history overwrite API exists. All operations are immediate decisions, not client-supplied backdated/future scheduling.

**C. Current Enrollment authority.** `currentEnrollment` resolves the single active StudentEnrollment for the exact Student and Branch. Managed roster/audience reads use the corresponding enrollment membership aggregation, match Class/Section and its exact Class-owned period, and never fall back to Student snapshots once any enrollment history exists. A withdrawn managed Student has no current membership, even though Student.classId/sectionId retain their last compatibility values. Student snapshots are updated only by the controlled admission/enrollment paths; there is no generic HTTP Student placement-edit endpoint in the inspected routing.

**D. Legacy compatibility.** Existing Student records with no enrollment history keep their profile and stored placement. Principal detail marks these as legacy, shows recorded placement separately and reports no authoritative current enrollment or invented history. Teacher read/roster and audience compatibility retains the old snapshot predicate only for Students with zero enrollment records; this transitional fallback ends for that Student on explicit enrollment and never resumes after withdrawal. This is an explicit rollout policy, not a claim that all legacy data is migrated. Existing legacy operational eligibility remains during the transition; see X for the required migration/setup before treating the entire installation as enrollment-authoritative.

**E. Principal ownership.** Administrative enrollment routes require a registered authenticated session, current active DB Principal role and narrow central permission. Branch comes from current User.branchId. Student and its Student-role User must belong to that Branch; target period, Class and Section are independently revalidated against it. Class must belong to the exact period and Section to the exact Class. Foreign/guessed contexts are concealed with 404; injected authority fields are rejected. Mutations fence the Branch, Principal, login Session, Student and Student User and repeat DB authorization before committing.

**F. Super Admin ownership.** Global Super Admin may explicitly target a Branch through the same scoped APIs. Omitting the target Branch fails; Branch-bound Super Admin cannot acquire global enrollment authority. Shared APIs do not weaken Principal scope. The new screen is a Principal destination; this change does not alter the user-owned Super Admin dashboard/navigation.

**G. Initial enrollment.** Principal explicitly chooses an existing eligible Student and active target period/Class/Section, with a reason and operation ID. The server derives/validates relationships, rejects conflicting current membership and records the first known enrollment without inferring prior years. Trusted internal `createStudent` provisioning also creates its intentional initial enrollment atomically and now requires a current DB-authorized admission creator plus a same-Branch active Student identity. It cannot provision a Teacher identity as a Student or use a period-less legacy Class. That internal function has no new public HTTP admission route; the enrollment screen manages existing permanent Student identities.

**H. Duplicate/concurrency protection.** Startup explicitly creates enrollment indexes through the existing pre-traffic Academic Setup bootstrap, including autoIndex=false deployments. Partial unique indexes reserve Student globally and Student+AcademicPeriod while status=active, so conflicting active periods are also impossible. Historical transfer/readmission records may coexist. A unique Branch+Student+actor+operationId index protects retry receipts. Payload fingerprint mismatch returns 409; identical retries replay the original operation receipt. Every receipt replay still requires current authorization and Student context. Receipts describe the original operation result; clients refresh authoritative current state afterward.

**I. Section transfer.** Only within the same active period and same Class, to a different active Section of that Class/Branch. A stale source/revision conflicts. The source retains transferred status, interval and reason; successor has its own identity and links to its predecessor. Student compatibility Section changes in the same transaction. Same-period Class transfer is deliberately not exposed as a generic update.

**J. Promotion.** Requires an active source enrollment in a closed/archived prior period and a later active target period with valid active Class/Section. Later means a later period start date and a distinct period ID; no grade-name arithmetic or marks-based eligibility is inferred. Principal makes a reasoned operational decision. Source becomes promoted, successor becomes active, Student identity remains stable. No results, dues, fee assignments or published audience records are rewritten. Bulk promotion is deferred.

**K. Withdrawal/readmission.** Withdrawal requires its own permission, source/revision, reason and operation ID. It closes membership without deleting/deactivating the permanent Student/User. Transfer/promotion cannot operate without current enrollment. Readmission is supported through explicit enroll into the active target context after withdrawal: a fresh linked record is created, preserving the withdrawn record. No generic reactivation erases history.

**L. History preservation.** Immutable placement identities, separate effective intervals and predecessor links preserve multiple Sections within one period and multiple academic years. History is paged independently of current membership. Closed memberships remain visible to authorized administrators even after withdrawal. Academic descendants keep their original references; historical access retains each existing module's Branch, identity, assignment, release/date and entitlement policies rather than granting unrestricted access.

**M. Race safety — PASS.** Real persisted Branch increments and MongoDB transactions serialize writers across API instances; no process-local mutex supplies correctness. Sixteen two-process race cases exercise both orderings for enrollment/enrollment, transfer/transfer, promotion/promotion, promotion/withdrawal, Section deactivation/enrollment, Class deactivation/promotion, Section deactivation/transfer, and transfer/promotion. Assertions inspect committed active counts and active parents, not only HTTP statuses. Class deactivation may already fail because AS-PR1 conservatively retains Classes containing Sections; tests explicitly account for this stronger existing guard. Independent focused tests verify the new active-enrollment guard even when compatibility fields drift. An injected failure after source closure proves complete rollback of history, snapshot projection and operation receipt. Production still requires the supported replica-set/sharded transaction topology.

**N. Academic Setup lifecycle integration.** Class and Section deactivation now check active StudentEnrollments under the same Branch fence before existing conservative legacy-reference guards. Enrollment/transfer/promotion acquire that fence before checking parent state. Period closure retains memberships/history; it freezes transfer/new placement into the old period and permits explicit promotion into a later active period. This does not redesign AS-PR1 catalog retention or AS-PR2 curriculum authority.

**O. Teacher roster integration.** Teacher tuple authorization is unchanged. The roster's existing single aggregate now resolves managed membership against the exact assigned Class/Section and Class period, independent of forged Student compatibility fields. Active Student/User identity and Branch checks remain. A focused real endpoint test confirms a promoted/withdrawn Student disappears from the old current Teacher roster while historical records remain accessible.

**P. Attendance compatibility.** New/open/draft roster validation uses enrollment membership and the existing Branch/Student/User fences. Current-day membership is live at request time; past-date membership uses the final school-local civil date interval. A same-day transfer changes the live roster and requires normal roster review; this change does not backdate enrollment or invent a pre-migration interval. Submitted attendance continues to use its stored roster IDs/status/context. Amendment draft eligibility uses the same effective membership resolver; submitted corrections retain their original roster rule. Focused tests cover effective historical intervals and actual submitted-attendance reads after promotion/withdrawal. No historical attendance record is rewritten. Period identity remains recoverable through its original immutable Class context.

**Q. Homework/Submissions/Catch-up.** New Homework/Quiz and notice audiences use managed current enrollment, with the explicitly documented legacy fallback for unmigrated Students. Publication still snapshots recipients and fences the Branch. Existing published entitlements remain the authority for old Student work and submissions; promotion does not retroactively remove them. Catch-up items retain original Student/work/absence context. A focused test reads actual Student work, Homework evidence and Catch-up endpoints after promotion and withdrawal, starts an entitled historical Quiz attempt, and verifies stored records remain unchanged. Old entitled obligations may remain accessible under their existing release/due-date policies after withdrawal; withdrawal blocks new current membership, not historical academic access.

**R. Results compatibility.** T-PR12 result creation remains tied to authorized immutable work/evidence/review context, not a Student's new Class snapshot. Results already retain Student, Branch, Class/Section/Subject/year and revision context. Promotion never changes marks, moderation state or publication. Focused tests read real previously published Student results after promotion/withdrawal and compare persisted records byte-for-value; full result regressions pass.

**S. Finance compatibility.** Fee records retain Student ID, Branch and academicYear; Branch summaries aggregate Fee documents independently of current Class/Section. Neither enrollment mutation nor projection synchronization edits them. A focused test preserves an actual partial Fee record and its 900 outstanding balance through promotion/withdrawal, without duplicate invoices or charges. Existing Principal fee-summary flows remain unchanged. New-year fee assignment is explicitly deferred. No Parent role/linked-child portal is implemented in the inspected backend role/routing foundation; guardian/profile fields are untouched and no unimplemented Parent flow is claimed as tested.

**T. RBAC.** Added central backend/frontend `students.enrollment.view`, `.manage`, `.promote` and `.withdraw`. Principal receives own-Branch authority; global Super Admin has intended explicit-target oversight; Teacher/Student have no administrative enrollment grants. Existing Teacher roster permissions remain separate. Both middleware and service check permissions/current DB role. Returned action booleans also account for Student eligibility, membership, and source-period lifecycle; UI visibility is never authorization.

**U. API/DTO.** Repository-consistent, no-store APIs:

```text
GET  /api/students?search=&status=&offset=
GET  /api/students/enrollment-options?classId=&offset=
GET  /api/students/:studentId/enrollments?offset=
POST /api/students/:studentId/enrollments
POST /api/students/:studentId/enrollments/:enrollmentId/transfer
POST /api/students/:studentId/enrollments/:enrollmentId/promote
POST /api/students/:studentId/enrollments/:enrollmentId/withdraw
```

Global Super Admin supplies branchId; Principal may omit it. Writes accept only the action's allowlisted reason, operationId, revision and target fields. List search is literal, not client regex. Student/history/Class pages are bounded to 50; Section choices are bounded to 200 under the selected Class. DTOs expose needed identity/name/admission and academic summaries, lifecycle, dates/reason/revision and action availability. No credentials, actor internals, fence state or transaction metadata. No generic Student placement CRUD/delete route.

**V. Principal UI/navigation.** Inspected existing Principal workspace/navigation; there was no dedicated coherent Students area. Added one permission-filtered drawer destination, Students & Enrollment, and its typed stack route. No Home cards were added and no existing Home/user-owned navigation file was modified. Supports search/status filter, paged Student list, current membership, legacy recorded-placement note, paged history and server-authorized actions. Promotion and Section transfer remain distinct workflows.

**W. UI/theme quality.** Uses existing DashboardShell, typography/colors/spacing, cards, badges, inputs, searchable selectors, dialogs and feedback. Confirmations name the Student/admission number, current period/Class/Section, target and reason. Mutation refs prevent duplicate submit; request generations prevent stale detail/options responses. Network retries retain the same frozen operation identity/payload. Success appears only after server confirmation; a post-save refresh failure is reported as saved with refresh guidance. Includes empty/loading, retry, concealed 404, 403, 409 and authoritative refresh states. Rendered component tests were run; no native-device visual QA is claimed.

**X. Migration/rollout requirement.** No runtime backfill or production migration was executed. Inventory trusted Student/User Branch and Class/Section relationships and Class-owned period references. Period-less Classes need a separately reviewed AS-PR1 period migration. Administrators can explicitly establish one known current baseline enrollment per Student in the active period through this flow; this does not create prior-year history. If a controlled offline migration is chosen later, it must record only verified baseline placement/effective date and audit provenance, respect unique indexes and exclude ambiguous records for review. Legacy Students otherwise retain the documented snapshot compatibility behavior. Migrate/confirm the full roster before claiming installation-wide enrollment authority; snapshots are never a fallback for managed history. Backdated migration tooling is not supplied by this PR.

**Y. Focused backend tests — PASS, 45/45.** `backend-focused-complete.log`: authentication/roles/narrow permissions, current DB Branch/account/session, foreign Student/period/Class/Section and mismatched relationships, authority injection, inactive parents, DB uniqueness, idempotency, actor-scoped receipt, history, effective intervals, sixteen two-instance races, rollback, real portal/submission/attendance/result/Catch-up retention, and real Fee/balance preservation. Earlier failing historical-membership fixture exposed a malformed aggregation variable expression, which was corrected before the full passing runs.

**Z. Backend regression — PASS, 518/518.** `backend-regression-final.log`: AS-PR1 setup, AS-PR2 mapping, assignment administration, academic/Syllabus, Teacher scope/roster, timetable, Attendance, attendance amendments, Homework/Quiz, evidence/reviews/submissions, Catch-up, Results, communications and lesson delivery. The AS-PR1 trusted-admission race fixture now uses a real Student identity and an authorized creator; the Attendance admission fixture supplies that creator. No guard expectation was weakened. These 518 regressions and 45 focused tests ran separately, for 563 passing backend tests across the two runs.

**AA. Frontend tests — PASS.** Focused: 2 suites, 14/14 (`frontend-focused-final.log`). Full: 46 suites, 424/424 (`frontend-all-final.log`). Covers Principal navigation, list/search/current/history, enrollment, transfer, promotion, withdrawal, confirmations, permission/conflict/network failures, stable retry identity, pending double-submit protection, server-confirmed success and historical display. The existing exact-route navigation test was extended with StudentsEnrollment.

**AB. TypeScript/lint/diff.** Frontend scoped TypeScript PASS; changed-file ESLint with zero warnings PASS; `git diff --check` PASS. Backend TypeScript retains only the known unrelated `backend/src/controllers/safety-alert.controller.ts(47,49)` TS2322: void is not assignable to ISafetyAlert. That controller and all surrounding user-owned safety changes are unchanged. Evidence: `frontend-types-final.log`, `backend-types-final.log`, `eslint-final.log`, `lint-focused.log`, `diff-check-final.log`. Real-path feature patch passes read-only `git apply --cached --check`; it was not staged/applied.

**AC. Exact AS-PR3 source/test files (25).** Every path below was clean before this task; every change is AS-PR3-only relative to the captured pre-AS-PR3 baseline. This report and validation artifacts are additional unstaged documentation/evidence.

- `__tests__/principal-approval-context.test.tsx` — clean AS-PR3-only
- `__tests__/student-enrollment-service.test.ts` — clean AS-PR3-only
- `__tests__/student-enrollment.test.tsx` — clean AS-PR3-only
- `backend/src/app.ts` — clean AS-PR3-only
- `backend/src/constants/permissions.ts` — clean AS-PR3-only
- `backend/src/constants/rolePermissions.ts` — clean AS-PR3-only
- `backend/src/models/studentEnrollment.ts` — clean AS-PR3-only
- `backend/src/routes/student-enrollment.routes.ts` — clean AS-PR3-only
- `backend/src/services/academic-setup.service.ts` — clean AS-PR3-only
- `backend/src/services/academic-work.service.ts` — clean AS-PR3-only
- `backend/src/services/attendance-amendment.service.ts` — clean AS-PR3-only
- `backend/src/services/enrollment-membership.service.ts` — clean AS-PR3-only
- `backend/src/services/student-enrollment.service.ts` — clean AS-PR3-only
- `backend/src/services/student.service.ts` — clean AS-PR3-only
- `backend/src/services/teacher-attendance.service.ts` — clean AS-PR3-only
- `backend/src/services/teacher-notice.service.ts` — clean AS-PR3-only
- `backend/src/services/teacher-roster.service.ts` — clean AS-PR3-only
- `backend/tests/academic-setup.security.test.ts` — clean AS-PR3-only
- `backend/tests/student-enrollment.security.test.ts` — clean AS-PR3-only
- `backend/tests/teacher-attendance.security.test.ts` — clean AS-PR3-only
- `src/constants/permissions.ts` — clean AS-PR3-only
- `src/navigation/PrincipalNavigator.tsx` — clean AS-PR3-only
- `src/screens/principal/PrincipalWorkspaceScreen.tsx` — clean AS-PR3-only
- `src/screens/principal/StudentEnrollmentScreen.tsx` — clean AS-PR3-only
- `src/services/admin/enrollmentService.ts` — clean AS-PR3-only

**AD. Mixed files — NONE.** No AS-PR3 source/test path intersects the 22 original dirty paths. In particular, Student model, Principal/Super Admin dashboards, SuperAdminNavigator, permission middleware, apiClient and unrelated services retain their original bytes.

**AE. Exact AS-PR3 hunks in mixed files.** Not applicable: mixed set is empty. The complete real-repository-path AS-PR3-only review patch is `.validation-as-pr3/as-pr3-source.patch`; no snapshot path is treated as a repository path.

**AF. Unrelated work preserved.** Captured hashes for all 400 initially tracked files, relevant text content, original status and full original diff before editing. All 22 originally dirty files are SHA-256-identical; every other tracked non-feature file also matches baseline. Evidence: `.validation-as-pr3/baseline.json`, `initial-status.txt`, `initial.patch`, `preservation.json`, `final-status.txt`. Index empty; HEAD and origin/feture remain `69c3f29aa70d7e0c170688cb52f576b3266cb387`. Older validation directories, docs, patches, Gradle/editor artifacts and unrelated top-level services remain outside this change. Their retrospective content hashes were not captured, so no untracked-directory byte-proof is claimed; no task operation edited or removed them.

Original modified files, intentionally untouched:

- `.gitignore`
- `backend/src/controllers/principal-task.controller.ts`
- `backend/src/controllers/school-notice.controller.ts`
- `backend/src/middleware/permission.middleware.ts`
- `backend/src/models/approvalRequest.ts`
- `backend/src/models/attendance.ts`
- `backend/src/models/safetyAlert.ts`
- `backend/src/models/schoolClass.ts`
- `backend/src/models/schoolNotice.ts`
- `backend/src/models/section.ts`
- `backend/src/models/session.ts`
- `backend/src/models/student.ts`
- `backend/src/models/subject.ts`
- `backend/src/models/teacherAssignment.ts`
- `backend/src/services/safety-alert.service.ts`
- `backend/src/services/teacher-work.service.ts`
- `blueprint`
- `src/navigation/SuperAdminNavigator.tsx`
- `src/screens/principal/PrincipalDashboardScreen.tsx`
- `src/screens/superAdmin/SuperAdminDashboardScreen.tsx`
- `src/services/admin/adminService.ts`
- `src/services/api/apiClient.ts`

**AG. Remaining deferred gaps.** Bulk promotion/preview and partial-failure policy; cross-Branch/school transfer; same-period Class transfer; graduation/completion workflows; backdated/future-effective membership scheduling and migration tooling; marks-based eligibility; new-year fee assignment; Parent/linked-child portal integration (no existing backend role/flow to extend); Super Admin enrollment UI beyond its authorized API; native-device visual QA. None is silently simulated. T-PR14 Staff Self-Service was not started.

**AH. Final verdict**

`READY FOR REVIEW`
