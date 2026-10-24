AS-PR2 — Class-Subject Mapping + Downstream Enforcement

Implemented on `feture` above AS-PR1 commit `5688e3fc99b27ece7b4532abae5831a7d90c9bbc`. The index remains empty. No staging, commit, push, reset, restore, cleanup, production migration or AS-PR3 work was performed.

**A. ClassSubject architecture.** Added a distinct `ClassSubject` model with immutable Branch, AcademicPeriod, Class and Subject identity; active status; revision; createdBy/updatedBy; and timestamps. TeacherAssignment remains the teaching-responsibility authority, while ClassSubject defines curriculum availability. A mapping is not inferred from an assignment.

**B. Authority/invariants.** Mapping writes require an active Branch, active Class, the Class's exact Branch-owned active AcademicPeriod, and a same-Branch active Subject. The period is derived from the Class, never a submitted year/period claim. Query/body allowlists reject injected authority fields. Class and Subject IDs alone cannot authorize a relationship. New downstream writes resolve the exact active mapping through the shared context validator. `AcademicPeriod.status === active` remains the current-period authority.

**C. Principal ownership.** Reuses AS-PR1's database actor/Branch authorization. Principal role, active account and server-side permissions are reloaded; Branch authority comes from User.branchId. Mapping transactions fence the actor and registered login session and repeat authorization after acquiring the persisted Branch fence. Foreign Branch queries and foreign Class/Subject contexts are concealed; supplied Branch/period/year/body authority fields are rejected.

**D. Super Admin ownership.** Global Super Admin may view/manage mappings by explicitly choosing a target Branch, consistently with AS-PR1 setup policy. Sharing the route does not weaken Principal scope. Existing Syllabus governance roles are unchanged.

**E. ClassSubject lifecycle.** Create, list, deactivate and reactivate; no generic edit/reparent/delete. Positive current revision is required for lifecycle changes. Identity stays reserved across deactivation, and reactivation updates the same record. Mapping mutations require an active Class/current period, matching AS-PR1 catalog policy. Closed/archived contexts remain readable and read-only. Unsafe deactivation returns 409 for any isActive TeacherAssignment, published Syllabus, or current/future approved TimetableVersion containing the exact Class/Subject tuple. Upcoming/expired but unreleased isActive assignments must be explicitly revoked. Draft Syllabuses do not block deactivation, but their subsequent edit/publication must revalidate availability. Timetable retirement and Syllabus retirement remain available without requiring an active mapping. Historical dependencies are never cascade-deleted.

**F. Duplicate/concurrency safety.** The database unique index reserves `{branchId, academicPeriodId, classId, subjectId}` across active and inactive mappings. It is explicitly created by the existing startup index bootstrap, including when autoIndex is disabled. Concurrent API creates produce 201/409 and one row. A separate direct-writer test proves the unique index itself rejects duplicates without the service fence. Creation cannot silently duplicate or replace an inactive entry.

**G. TeacherAssignment enforcement.** NEW assignment creation retains Teacher/Branch/Class/Section/Subject/date/Principal validation and additionally requires the exact active ClassSubject under the Class's authoritative active period. Validation occurs inside the existing Branch transaction. Arbitrary active Branch Subjects and wrong-Class/foreign/inactive mappings are insufficient. No mapping is created by this operation. Assignment options now show current-period Classes and only mapped active Subjects for the selected Class.

**H. Legacy TeacherAssignment compatibility.** Existing assignment/history/Teacher scope readers deliberately do not gain retroactive mapping checks. Existing records can still be inspected and revoked. A replacement/new assignment requires explicit curriculum. Classes without AcademicPeriod cannot support new assignment/curriculum work until a reviewed period migration exists. Production data is not automatically backfilled. Regression fixtures now explicitly define their owned period/curriculum data before calling NEW-write APIs; that helper is under tests only and is never imported by production.

**I. Assignment-vs-deactivation race verdict: PASS.** Uses AS-PR1's real persisted Branch document increment inside a MongoDB transaction, not a process-local mutex. Both writers acquire that same fence before reading references. In two separate Node/API processes against one temporary replica set: assignment-first produces assignment 201/deactivation 409; deactivation-first produces deactivation 200/assignment 409. No active assignment can commit against a concurrently deactivated mapping. Tests verify persisted status/count, not just HTTP success. Reuses AS-PR1's supported transaction topology and failure behavior; no unsafe nontransactional fallback is introduced.

**J. Timetable enforcement.** New version creation and approval revalidate exact TeacherAssignment tuples and active curriculum; mapping checks are repeated inside the persisted Branch fence. Version creation and all its periods now commit atomically in one transaction. Substitute creation/approval also recheck mapping while fenced. Availability is not assumed to remain valid merely because an assignment once passed validation. There is no mutable-version update API; new versions are the existing change mechanism.

**K. Timetable historical compatibility.** Existing Teacher timetable/period readers are unchanged and do not retroactively filter by ClassSubject. A focused test confirms an already-approved version remains readable after simulating imported mapping inconsistency. Mapping deactivation independently checks current/future approved versions after assignments are revoked; retirement resolves that dependency and retains periods/history. Old retired versions are not deleted.

**L. Syllabus enforcement.** New creation, draft editing and publication require an exact active mapping after acquiring the existing Branch/Class/Subject transaction fences. Creation derives academicYear from the authoritative period code and rejects an inconsistent Class compatibility snapshot. Existing version uniqueness, publication replacement, revisions and retirement behavior are retained. Unmapped/inactive/foreign-context authoring cannot invent curriculum combinations. Two-process publication/deactivation races verify that publication-first blocks mapping deactivation, while deactivation-first blocks publication.

**M. Syllabus historical compatibility.** Read paths and retirement do not acquire a new mapping requirement. Tests prove legacy published records remain readable even without a mapping or Class period migration, and retired syllabus history remains readable after mapping deactivation. Existing T-PR8 version/publication/retirement regressions pass. No historical year or version is rewritten.

**N. AcademicPeriod integration.** ClassSubject stores the exact period identity. New downstream checks resolve period through the Class and require active status; free-form academicYear is not accepted as curriculum authority. Legacy academicYear remains a Syllabus compatibility snapshot derived/validated against period.code. No automatic legacy-Class period migration is implemented.

**O. RBAC.** Added `academic.classSubjects.view` and `academic.classSubjects.manage` to central backend/frontend declarations. Principal receives both for its DB Branch. Super Admin receives both through existing role defaults. Teacher/Student receive no setup grants and are denied by explicit backend role gates even independently of UI visibility. Middleware and service permission checks are both present. Existing role-policy architecture has no separate per-user permission seed to update.

**P. API/DTO.** Repository-consistent endpoints:

```text
GET  /api/academic-setup/classes/:classId/subjects
GET  /api/academic-setup/classes/:classId/subjects/options
POST /api/academic-setup/classes/:classId/subjects
POST /api/academic-setup/classes/:classId/subjects/:mappingId/deactivate
POST /api/academic-setup/classes/:classId/subjects/:mappingId/reactivate
```

Principal omits Branch authority; Super Admin supplies the explicit Branch query. Create accepts only subjectId; lifecycle accepts only revision. Lists/options are bounded to 50 with offset/nextOffset. DTOs provide mapping ID, Subject summary, active status/revision and contextual Class/period summaries. They expose no actors, login/session data or fence/audit internals. Inactive mapping identities are excluded from Add options and are reactivated from their existing row. Foreign/inactive catalog Subjects and already-added Subjects are not normal selectable options.

**Q. Principal Academic Setup UI.** Classes now offer `Subjects for <Class>` beside the existing Sections flow. Selecting it opens contextual Class Subjects under the existing destination, with Class name/code, Academic Period, mapped Subject rows, active/inactive status, Add Subject, confirmation-based deactivate and supported reactivation. Branch Subject creation remains in the separate catalog. Principal Home and Teacher navigation were not changed.

**R. UI/theme quality.** Reuses DashboardShell context, SectionCard/Card, Button, StatusBadge, AdminSelect, AdminDialog, AdminFeedback and existing theme typography/colors/spacing. Includes list/option loading, no mappings, exhausted choices, permission/concealed/network errors, duplicate/dependency/stale-revision conflicts, retry/reload and pending state. A reload action fetches the authoritative revision after conflicts. Duplicate submits are blocked by a ref plus busy state. Success appears only after server confirmation; unmount suppresses stale completion feedback. IDs are transport/selector values, not displayed labels. Verified using rendered component tests; no native-device visual run is claimed.

**S. Backend focused tests.** 24/24 curriculum tests pass in `.validation-as-pr2/backend-curriculum-final.log`. Coverage includes authentication/roles/two permissions; DB-derived Principal Branch/current account changes; foreign Class/Subject/period/body injection; inactive/closed contexts; duplicate/native unique-index arbitration; revisions/reactivation/history/options; new assignment/mapping rules and legacy reads; timetable creation/approval/history/active-future dependency guards; syllabus authoring/publication/retirement/history; and assignment/publication races against mapping deactivation across separate Node processes. One newly added direct-model legacy fixture initially omitted required unit/topic order fields; it was corrected and the full 24-test curriculum suite rerun successfully. No production fix was needed for that fixture error.

**T. TeacherAssignment regression.** Teacher assignment administration and Teacher scope/security/roster regressions pass. Existing lookup DTO contracts and provisioning behavior remain covered. Fixtures for NEW-write tests explicitly establish curriculum; read compatibility is additionally tested without any mapping.

**U. Timetable regression.** The complete existing Teacher timetable suite passes, including creation, approval, substitutions, acknowledgements, issues, conflicts and transaction/authorization regressions. Attendance tests also pass with the new fixture curriculum and fenced timetable creation.

**V. Syllabus regression.** Existing academic/Syllabus and lesson-delivery suites pass, including publishing, replacement/version ordering, retirement and historical reads. Syllabus-driven Homework/Quiz, evidence/reviews, Catch-up and Results regressions pass. Final regression coverage is 391 passing tests across the AS-PR1 setup/assignment/Syllabus group (102) and the broader downstream group (289). Logs: `backend-first.log`, `backend-focused-final.log` and `backend-regression.log` under `.validation-as-pr2`. The combined focused/integration run's only failure was the new fixture omission described above; its other 102 regression tests passed, and the corrected full curriculum suite is separately green. This is evidence across those runs, not a claimed single 415-test invocation.

**W. Frontend tests.** New ClassSubject suites contain 15 passing tests. Focused AS-PR1 + AS-PR2 run: 34/34 pass across five suites (`frontend-focused-final.log`). Full frontend run: 44 suites, 410/410 pass (`frontend-all.log`). Tests exercise selected-Class navigation, available choices, empty/loading states, add validation/double-submit/server confirmation, duplicate/403/404/network failures, confirmation/dependency conflicts, reactivation, closed/Teacher management visibility and stale-state reload.

**X. TypeScript/lint/diff.** Frontend scoped TypeScript passes. Changed-file ESLint passes across all 27 source/test files with zero warnings/errors. `git diff --check` passes. Backend TypeScript retains only the known unrelated `backend/src/controllers/safety-alert.controller.ts:47` TS2322 (`void` versus `ISafetyAlert`); it was not edited. The broader root configuration also includes pre-existing backend-test diagnostics; no new ClassSubject/UI/helper diagnostic remains. Evidence logs: `frontend-types.log`, `backend-types.log`, `root-types.log`, `eslint.log`, `diff-check.log`. The generated real-repository-path source patch also passes `git apply --cached --check`; that read-only check did not stage anything.

**Y. Exact AS-PR2 source/test files (27).**

```text
backend/src/constants/permissions.ts
backend/src/constants/rolePermissions.ts
backend/src/models/classSubject.ts
backend/src/routes/academic-setup.routes.ts
backend/src/services/academic-setup.service.ts
backend/src/services/class-subject-context.service.ts
backend/src/services/class-subject.service.ts
backend/src/services/syllabus.service.ts
backend/src/services/teacher-assignment-admin.service.ts
backend/src/services/teacher-assignment.service.ts
backend/src/services/timetable-admin.service.ts
backend/tests/academic-setup.security.test.ts
backend/tests/academic-work.security.test.ts
backend/tests/academic.security.test.ts
backend/tests/class-subject.security.test.ts
backend/tests/helpers/curriculum-fixtures.ts
backend/tests/lesson-delivery.security.test.ts
backend/tests/teacher-assignment-admin.security.test.ts
backend/tests/teacher-attendance.security.test.ts
backend/tests/teacher-scope.security.test.ts
backend/tests/teacher-timetable.security.test.ts
src/constants/permissions.ts
src/screens/admin/AcademicSetupScreen.tsx
src/screens/admin/ClassSubjectsPanel.tsx
src/services/admin/classSubjectService.ts
__tests__/class-subject-service.test.ts
__tests__/class-subject.test.tsx
```

This report is an additional documentation artifact. `.validation-as-pr2` contains baseline/evidence/scripts and the precise real-path review patch `as-pr2-source.patch`; none is staged. Existing regression fixture changes are limited to an explicit curriculum seed call/import before new-write setup, plus AS-PR1 dependency-race expectations now accounting for active mapping guards. Tests isolating unrelated legacy dependency guards disable their fixture mappings first so the guard under test cannot pass for the wrong reason.

**Z. Mixed files.** None. No file already dirty at AS-PR2 start was edited for this feature. The four files mixed during AS-PR1 remain entirely outside the AS-PR2 source changes.

**AA. Exact AS-PR2 hunks in mixed files.** Not applicable: mixed-file set is empty. `as-pr2-source.patch` contains the exact AS-PR2 changes with real repository paths, excluding all pre-existing user-owned hunks. It is suitable for review and passed an index applicability check, but was not applied to the index.

**AB. Unrelated work preserved.** Baseline captured all 391 tracked files before edits and the initial dirty status/diff. All 22 initially dirty files remain byte-identical: `.gitignore`; Principal task and school-notice controllers; permission middleware; approvalRequest, attendance, safetyAlert, schoolClass, schoolNotice, section, session, student, subject and teacherAssignment models; safety-alert and teacher-work services; blueprint; SuperAdminNavigator; PrincipalDashboard and SuperAdminDashboard; adminService; apiClient. All other non-feature tracked files also match their original hashes. Existing untracked docs, patches, top-level services, editor/Gradle folders and older validation directories were not edited. See `.validation-as-pr2/preservation.json` and `baseline.json`. HEAD is still AS-PR1 and the index is empty.

**AC. Remaining AS-PR3 gap.** Enrollment history, promotion, transfer, graduation and Student class-history migration are not implemented. Explicit migration of legacy Classes to authoritative periods remains a separate reviewed prerequisite for NEW work on those Classes. No T-PR14/live lesson/recording/AI scope was introduced. Rollout requires Principal to explicitly configure curriculum for period-backed Classes before creating new downstream work; existing records are not fabricated into mappings.

**AD. Final verdict**

`READY FOR REVIEW`
