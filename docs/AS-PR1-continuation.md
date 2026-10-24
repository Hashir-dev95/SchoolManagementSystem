AS-PR1 continuation report — 18 October 2026

**A. Already present.** Continued the existing `feture` tree. AcademicPeriod model, catalog routes/service, eight permissions, startup index creation, Branch transaction fence, assignment integration, Principal drawer entry, Super Admin Settings entry, shared Academic Setup screen and API service were present. No AS-PR1 test files existed. Installed React Native 0.86.2 / React 19.2.3 were preserved. Initial source contents and the initial Git diff were captured in `.validation-as-pr1/continuation-baseline.json` and `initial.patch` before editing. The earlier `.validation-tpr8/baseline-status.txt` also identifies pre-existing user-owned dirty files; it is historical evidence, not a complete pre-AS-PR1 content snapshot.

**B. Completed here.** Corrected period closure/archive so used catalogs can be retained through rollover; added route permission middleware alongside service authorization; made actor reads session-aware; removed parallel queries from assignment transactions; fenced actor/Teacher changes and required active authoritative periods for new assignments; revalidated Student enrollment inside its existing Branch transaction fence; specified snapshot/majority transaction options and deterministic unsupported-topology rejection; started Super Admin on the Academic Period tab; added focused tests and updated two affected regression fixtures/assertions. No implementation restart, dependency/version change, stage, commit, push, reset, restore or clean.

**C. AcademicPeriod design.** Branch-owned immutable identity/code, name, validated YYYY-MM-DD start/end dates, status, revision, creator/updater and timestamps. Names are descriptive; uppercase codes are unique per Branch. Dates require start before end and reject impossible calendar dates. Safe DTOs expose only the public record fields. No delete endpoint exists.

**D. Lifecycle/current invariant.** `draft → active → closed → archived`, with `draft → archived` cancellation. Draft fields can be edited; active/closed/archived dates cannot. No reopening. An active period must be closed before another activation; a partial unique Branch index arbitrates simultaneous activations. `status === 'active'` alone defines current, regardless of calendar date. Close/archive retains Classes and history; new Class/Section writes and new period-backed assignments/enrollments require an active period. Existing operational/history reads remain available. Positive revisions are mandatory on mutations; stale writes return 409. Required unique indexes are established before accepting traffic; index failure prevents startup.

**E. Principal ownership.** Every request resolves the active actor from the database. Principal Branch comes from that actor; an optional foreign Branch query is rejected, and a Branch body field is rejected. Class period and Section parent are validated against that Branch. Mutations repeat scope validation inside the transaction. Role/identity and registered login session writes fence concurrent authority changes.

**F. Super Admin governance.** Only a global Super Admin can mutate periods, even if a period-manage grant is accidentally added to Principal. The Super Admin explicitly selects a named active Branch. Principal can read only its own Branch's periods.

**G. Class administration.** List/detail/create/edit/deactivate/reactivate with revisions. The authoritative period is required at creation; `academicYear` is derived from its code. Uniqueness is Branch/period/code, with the existing legacy Branch/year/code index retained. Legacy Classes remain readable and explicitly read-only; AS-PR1 performs no implicit migration.

**H. Section administration.** Contextual list/detail/create/edit/deactivate/reactivate under a selected Class. Exact Branch/Class relationship and the Class's authoritative active period are checked. Inactive/legacy Classes cannot receive Section mutations. Branch/Class/code uniqueness is enforced by MongoDB.

**I. Subject administration.** Branch catalog list/detail/create/edit/deactivate/reactivate. Existing whitespace normalization and case-insensitive Branch/name uniqueness are retained. Revisions protect updates. ClassSubject mapping is deferred.

**J. Transaction/race safety verdict: PASS.** Each setup mutation and assignment create performs a real increment on the same persisted Branch document before reading references. MongoDB write conflicts force a competing transaction to retry with a new snapshot. If assignment creation wins, deactivation sees its reference and returns 409. If Subject/Section deactivation wins, assignment creation sees inactivity and returns 404. Class deactivation is already blocked by its retained Section, so an assignment cannot lose its parent Class. Independent transaction sessions exercise both orderings with a barrier after the actual database fence write; no production process-local mutex is used. Student enrollment uses the existing timetable Branch fence and now repeats reference validation within it; both enrollment/deactivation orderings pass too. Rollback restores both domain data and fence metadata. Transactions use primary reads, snapshot read concern and majority commit acknowledgment. Startup already required a replica set/sharded cluster; its message now names setup/assignment requirements. Standalone writes fail closed with 503 and no partial write. The legacy Teacher scope fixture now uses an ephemeral replica set. Tests are deterministic transaction/session tests, not a multi-host load test.

This safety conclusion follows MongoDB's documented write-conflict behavior and its requirement for a genuine write when taking a transaction fence. Sequential operations inside an assignment transaction follow the driver/Mongoose restriction on parallel transaction operations. See [MongoDB transaction considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/) and [Mongoose transaction guidance](https://mongoosejs.com/docs/8.x/docs/transactions.html).

**K. Lifecycle dependency guards.** Classes retain child Sections. Catalog deactivation rejects any direct reference in Student, TeacherAssignment, TimetablePeriod, Attendance/AttendanceSession, Syllabus, LessonPlan/LessonDelivery, Homework, Quiz, AcademicResult, CatchUpItem, TeacherNotice and AssignedWork collections. The policy deliberately retains references from inactive/history records too: existing historical endpoints can still resolve active catalog objects. Attendance/Homework/Results are historical descendants, but receive conservative direct guards for that compatibility reason. No historical cascade or hard deletion occurs. Syllabus writes already fence Branch/Class/Subject and validate within their transaction. Timetable creation requires a TeacherAssignment; retaining even revoked assignment references prevents a catalog-deactivation phantom through that path. Unsafe deactivation is a deterministic 409. Closing a period changes period governance state without deactivating catalog references.

**L. RBAC.** Eight centrally defined permissions: `academic.{periods,classes,sections,subjects}.{view,manage}`. Existing middleware recognizes them through the central Permission union and role map. Routes now invoke it explicitly, and services independently enforce the grants. Super Admin receives all eight; Principal receives period view and the six catalog grants; Teacher/Student receive none. There is no separate database permission seed to update in this repository's role-default policy. All eight denial cases are tested.

**M. Principal navigation.** Existing drawer → Academic Setup → Academic Period / Classes / Subjects. Selecting a Class opens its contextual Sections list and displays Class name, code and period. The stack keeps PrincipalWorkspace as its initial route. Teacher navigation contains no setup route.

**N. UI consistency.** Reuses DashboardShell, ScreenHeading, Card, SectionCard, Button, StatusBadge, AdminSelect, AdminDateField, AdminDialog, AdminFeedback, theme typography, spacing and colors. Includes loading, empty, inactive, client validation, confirmation, 403/404/409/network failure, retry and pagination states. IDs are transport values, not displayed labels. Mutation feedback waits for confirmed server success. Component tests cover the interactions; no native-device visual run was performed in this continuation.

**O. Super Admin bootstrap.** Settings → Academic Setup → Branch selector → Create Academic Period → Activate. The page starts on Academic Period for Super Admin. Creating/activating the first period is tested end to end at the API and at the component level; it does not require a database insertion.

**P. Home.** Principal and Super Admin Home were left byte-for-byte unchanged from continuation start. Neither contains new setup CRUD entries. The existing Principal drawer and Super Admin Settings provide entry points.

**Q. Backend focused tests.** 29/29 pass in `backend-focused.log`: authentication, wrong role, all permission denials, DB Branch scope/reassignment, Principal period mutation denial even with an accidental grant, DTO allowlist, bootstrap, date validation, duplicates/concurrent duplicates, single-active invariant, lifecycle/revisions, legacy compatibility, Class/Section/Subject CRUD constraints, direct dependency guards, six assignment race orderings, two Student race orderings, rollback and standalone failure.

**R. Backend regression.** Nine suites exercised: Teacher Assignment administration, Teacher scope, Timetable, Academic/Syllabus, Teacher provisioning, Attendance, Communications, Home and Notifications. First combined run: 307 pass and 59 Teacher scope fixture failures because it still used standalone MongoDB. After changing only that fixture's import/type/startup to a replica set, all 59/59 scope tests pass. Effective final coverage: 366/366 passing across those suites; this is the union of the unchanged passing suites and the corrected scope rerun, not a claimed second monolithic run. Logs: `backend-regression.log`, `backend-scope-regression.log`.

**S. Frontend focused tests.** 18/18 pass across the three new Academic Setup suites: navigation isolation/drawer/Settings, period read-only/bootstrap, Class loading/empty/create/edit/conflict/retry/inactive/deactivation, contextual Section CRUD, Subject CRUD, permission/network failures and confirmed-success contracts.

**T. Frontend regression.** Full suite: 42 suites, 394/394 tests pass. An existing exact Principal route-list assertion was updated by adding only `AcademicSetup`. Teacher navigation and the previous Teacher feature suites pass in this run. Log: `frontend-all.log`.

**U. Static validation.** Frontend scoped TypeScript passes (`tsconfig.frontend.json` includes current frontend source/tests and excludes backend/old validation trees). Backend TypeScript reports only the known pre-existing `backend/src/controllers/safety-alert.controller.ts:47` TS2322 (`void` vs `ISafetyAlert`), also recorded before this task in `.validation-tpr8/backend-types-final.log`; left unchanged as requested. The repository-root config additionally includes backend tests and old validation trees, so its broad check still reports existing diagnostics; no current AS-PR1 source/test diagnostic remains. Changed-file ESLint passes across all 27 source/test files. `git diff --check` passes. CRLF conversion notices are Git warnings, not whitespace-check failures.

**V. Exact AS-PR1 files.** 27 source/test files; the report and `.validation-as-pr1` evidence are additional artifacts.

```text
backend/src/models/academicPeriod.ts
backend/src/routes/academic-setup.routes.ts
backend/src/services/academic-catalog-lock.service.ts
backend/src/services/academic-setup.service.ts
backend/src/app.ts
backend/src/constants/permissions.ts
backend/src/constants/rolePermissions.ts
backend/src/models/schoolClass.ts
backend/src/models/section.ts
backend/src/models/subject.ts
backend/src/server.ts
backend/src/services/teacher-assignment.service.ts
backend/src/services/teacher-scope.service.ts
backend/src/services/student.service.ts
backend/tests/academic-setup.security.test.ts
backend/tests/teacher-scope.security.test.ts
src/constants/permissions.ts
src/navigation/PrincipalNavigator.tsx
src/navigation/SuperAdminNavigator.tsx
src/screens/principal/PrincipalWorkspaceScreen.tsx
src/screens/superAdmin/SuperAdminSettingsScreen.tsx
src/screens/admin/AcademicSetupScreen.tsx
src/services/admin/academicSetupService.ts
__tests__/academic-setup.test.tsx
__tests__/academic-setup-service.test.ts
__tests__/academic-setup-navigation.test.tsx
__tests__/principal-approval-context.test.tsx
```

**W. Mixed files.** At continuation start, 13 of those tracked files were already dirty: app, both backend permission files, three catalog models, server, assignment service, frontend permissions, both administrative navigators, PrincipalWorkspace, and SuperAdminSettings. Treat them as mixed when preparing a later commit. Four also appear in the older user-dirty baseline: SchoolClass, Section, Subject and SuperAdminNavigator. Their unrelated formatting must not be attributed to AS-PR1. The two inherited untracked services, model, router, screen and API service were retained and extended as needed.

**X. Exact AS-PR1 hunks in mixed files.** Line numbers refer to the final tree; exclude unrelated formatting. `mixed-as-pr1-hunks.patch` isolates the four historically user-dirty files using review-only synthetic pre-AS copies; it is not a claim that a full original pre-AS snapshot exists. `continuation.patch` separately records exactly what changed during this continuation against the captured start, including previously clean/new files.

| File | AS-PR1 hunk ownership |
| --- | --- |
| backend/src/models/schoolClass.ts | Lines 5–6: optional period/revision interface fields; 17–19: legacy comment and period/revision schema fields; 64–67: partial unique period/code index. |
| backend/src/models/section.ts | Lines 5 and 16: revision interface/schema fields only. |
| backend/src/models/subject.ts | Lines 4 and 20: revision interface/schema fields only. Existing normalization/index and formatting remain user-owned. |
| src/navigation/SuperAdminNavigator.tsx | Lines 2, 12, 26: setup import, route type and Stack.Screen only. |
| backend/src/app.ts | Lines 29, 65, 103: setup import, API mount and parser-error mount. |
| backend/src/constants/permissions.ts | Eight ACADEMIC_* constants at the beginning of PERMISSIONS. |
| backend/src/constants/rolePermissions.ts | Seven Principal ACADEMIC_* grants at the beginning of its defaults. Super Admin inherits all eight through the existing defaults. |
| backend/src/server.ts | Lines 12, 31: setup index import/call; 46: expanded existing topology requirement message. |
| backend/src/services/teacher-assignment.service.ts | Session/period/lock imports; optional session argument on provisioningActor; createTeacherAssignment's transaction, actor/Teacher fences, sequential reference validation, active-period check and transactional insert (lines 44–74). Revocation behavior retained. |
| src/constants/permissions.ts | Eight constants, eight Super Admin grants, seven Principal grants. |
| src/navigation/PrincipalNavigator.tsx | Setup import/route/screen and explicit PrincipalWorkspace initialRouteName. |
| src/screens/principal/PrincipalWorkspaceScreen.tsx | Permission import; line 234 empty-search condition includes setup; line 279 permission-filtered drawer destination. |
| src/screens/superAdmin/SuperAdminSettingsScreen.tsx | Navigation/Button imports, typed useNavigation and line 39 Settings destination button. |

Previously clean files changed here have wholly AS-PR1 diffs: session-aware actor query in teacher-scope service; Student transactional revalidation; the replica-set fixture adjustment; and the single Principal route assertion. All four newly added test files are AS-PR1-owned.

**Y. Unrelated files preserved.** SHA-256 audit confirms all 17 captured unrelated dirty files are unchanged: `.gitignore`; permission middleware; approvalRequest, attendance, safetyAlert, schoolNotice, session, student and teacherAssignment models; school-notice controller; safety-alert and teacher-work services; PrincipalDashboard and SuperAdminDashboard; adminService; apiClient; blueprint. The pre-existing principal-task file, untracked services/patches/docs, editor files and other validation directories were not edited. In particular, the existing API host, notice-controller changes and user dashboard changes were preserved. Evidence: `preservation.json`. No Git index or history mutation was performed.

**Z. AS-PR2/AS-PR3 gaps.** ClassSubject mapping, explicit legacy-period migration, student promotion/rollover automation and downstream adoption of period identities remain outside AS-PR1. This continuation does not claim a complete period migration for historical academic endpoints. No unresolved AS-PR1 implementation gap was found. The known unrelated Principal safety TypeScript diagnostic remains.

**AA. Final verdict: `READY FOR REVIEW`.**
