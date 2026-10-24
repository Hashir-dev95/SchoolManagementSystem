# AS-PR2 final closure review

Reviewed on branch `feture`, above `5688e3fc99b27ece7b4532abae5831a7d90c9bbc`. This review made no index changes, commits, pushes, resets, restores or cleanup. AS-PR3 was not implemented.

The implementation report was checked against production services/routes/models, actual diffs, focused tests, regression fixtures and baseline hashes. Closure added twelve backend test cases, strengthened existing foreign-read and inactive-Subject UI assertions, and corrected stale Branch catalog copy. No production authorization change was necessary.

**A. ClassSubject architecture — PASS.** `ClassSubject` independently answers whether a Subject belongs to a Class curriculum in a Branch and AcademicPeriod. Its immutable identity is Branch + AcademicPeriod + Class + Subject. It neither provisions teaching responsibilities nor embeds Sections, syllabus structure or timetable slots. Those remain separate authorities.

**B. Principal branch security — PASS.** Every mapping endpoint uses registered-session authentication, current active DB identity, Principal/Super Admin role middleware and explicit central permission middleware. Services independently reload current DB role/permission/Branch. Principal Branch comes from User.branchId; a contradictory branchId is concealed with 404. Class, Class-owned period and Subject must belong to that exact Branch. Mutations fence User and the registered non-revoked Session, then repeat authorization inside the Branch transaction. Foreign reads/options/create, foreign Subject/Class/period, injected authority, guessed mapping IDs, wrong-Class lifecycle IDs and wrong-period mappings are covered. Missing/inactive/changed-role identities fail closed. No branch escape found.

**C. AcademicPeriod integrity — PASS.** Create accepts only subjectId; lifecycle accepts only revision. Neither may submit a period/year/Class override. Period is resolved from the selected Class and verified against its Branch. Exact mapping lookup includes that period ID. Wrong-period mappings cannot authorize assignments or syllabuses. New downstream writes require an active period. Legacy Classes without a period remain explicitly unavailable for new curriculum work. Syllabus derives its compatibility academicYear from period.code and rejects inconsistent Class snapshots.

**D. Uniqueness/index — PASS.** A non-partial unique database index reserves the entire immutable tuple across active and inactive records. `ensureAcademicSetupIndexes`, called before server traffic, explicitly creates it even with autoIndex disabled. Concurrent API creates yield 201/409 and exactly one record; independent direct model writers prove database duplicate arbitration without service prechecks. Duplicate-key errors become deterministic 409. Inactive identity requires reactivation rather than a second row.

**E. Lifecycle — PASS.** Explicit create/deactivate/reactivate only; no delete or generic identity edit route. Positive current revision is mandatory and stale writes return 409. Deactivated rows remain listed, preserve identity/history and cannot authorize new assignment, timetable or syllabus writes. Reactivation retains the same row and requires active parents. Closed-period/legacy/inactive-Class mapping contexts remain readable and read-only.

**F. Dependencies — PASS.** Deactivation checks the exact Branch/Class/Subject tuple in the transaction. Any isActive TeacherAssignment reserves curriculum, including future/expired assignments until explicitly revoked. Any published Syllabus blocks deactivation until retirement. Any approved TimetableVersion with effectiveUntil later than schoolToday and a matching period blocks deactivation; this deliberately includes current and future versions. The independent timetable guard is tested after assignment revocation. Draft syllabuses do not block deactivation, but editing/publication revalidate. Retirement removes the operational dependency without deleting history. No descendant Attendance, Homework, Quiz, review, Catch-up or Result cleanup is required by this mapping guard.

**G. Multi-instance race safety — PASS.** Participating writers perform a real increment on the same persisted Branch document inside MongoDB transactions before authoritative mapping reads. Write conflicts retry against the winner; no process-local mutex supplies correctness. Tests run two actual Node/API processes against one owned temporary replica set, coordinate both arrival orderings and inspect persisted state:

| Race / first fence owner | Committed result |
| --- | --- |
| Assignment first | assignment 201; deactivation 409; mapping active |
| Deactivation before assignment | deactivation 200; assignment 409; no active assignment |
| Timetable create first or deactivation first | timetable 201; deactivation 409; mapping active |
| Timetable approval first or deactivation first | approval 200; deactivation 409; mapping active |
| Syllabus create/update first | draft write 200 then deactivation 200; later publication 409 |
| Deactivation before syllabus create/update | deactivation 200; draft write 409 |
| Syllabus publication first | publication 200; deactivation 409 |
| Deactivation before publication | deactivation 200; publication 409; draft retained |

Timetable races intentionally have an active teaching assignment, independently reserving curriculum; their expected deactivation failure is asserted as an assignment dependency. They do not claim to isolate a timetable-only guard. A separate approved-timetable dependency test removes the assignment and proves the timetable guard itself. Unmapped/inactive mapping create/approval tests prevent these races from being the sole enforcement proof. Existing AS-PR1 standalone-database fail-closed and multi-process parent races also pass. Production requires a supported MongoDB transaction topology.

**H. TeacherAssignment enforcement — PASS.** New assignments check exact active Branch/Class/period/Subject/mapping inside the Branch transaction, in addition to existing Teacher, Section, date and role constraints. An arbitrary active Branch Subject or a legacy assignment is insufficient. Assignment options use current-period Classes and active mappings for the selected Class. All production assignment creation goes through this boundary.

**I. Legacy TeacherAssignment — PASS.** Existing scope/history readers do not acquire a retroactive ClassSubject requirement. The only existing mutation besides create is revoke, which removes authority. There is no extension, edit or copy route; explicit API tests verify these are unavailable. Revoke-and-replace must pass new-create mapping validation. No operational mutation is grandfathered merely because the source assignment is old.

**J. Timetable enforcement — PASS.** New versions check mapping and teaching responsibility before and again inside the shared transaction; version and periods commit atomically. Approval repeats checks under the publication Branch fence. There is no mutable-version edit endpoint: changes require a new validated version. Substitute create and approval also validate active mapping under the Branch fence. Approved status is the existing publication/activation authority; no separate bypass endpoint was found.

**K. Legacy Timetable — PASS.** Teacher timetable readers remain unchanged and a focused test verifies approved history without active mapping. Imported legacy draft approval fails without mapping; PATCH cannot edit it into current authority. Retire is mapping-exempt and retains periods/history. Existing date, assignment and parent access rules still apply; this is not a new unrestricted historical-data access grant.

**L. Syllabus enforcement — PASS.** Create, draft update, new version and publish require exact active mapping inside the existing Branch/Class/Subject transaction fences. Existing version uniqueness, publication replacement and revision checks remain. No copy/replacement path can establish arbitrary curriculum. Retirement is mapping-exempt because it removes authority. Create/update/publication race cases cover both orderings.

**M. Legacy Syllabus — PASS.** Existing read paths do not consult mappings. A raw published legacy fixture without mapping or Class period remains readable. Raw legacy draft edit/publish and new version creation fail without mapping. Retirement/history tests preserve data. No runtime rewriting of old syllabus years or versions occurs.

**N. Parent lifecycle — PASS within existing access policy.** New mapping and operational writes require active Branch/Class/Subject and the Class's active period. Focused tests deactivate each academic parent and verify new assignment/timetable/syllabus denial while mapping history remains listed. Class/Subject catalog deactivation is itself blocked by active mappings. Period closure retains data and freezes new work. Existing historical reader authorization already requires certain active parents and current assignment scope; AS-PR2 does not relax those rules or add retroactive mapping filters. Retention does not promise every old Teacher endpoint remains accessible after parent deactivation.

**O. RBAC — PASS.** `academic.classSubjects.view` and `.manage` are centrally declared on backend/frontend. Principal receives own-Branch view/manage; global Super Admin must explicitly target a Branch under AS-PR1 policy. Branch-bound Super Admin is denied mapping governance. Teacher/Student have no mapping grants, and server role gates independently enforce exclusion. Internal downstream validation does not require a Teacher to gain administrative mapping permission.

**P. API/DTO privacy — PASS.** List/options/create and explicit lifecycle routes expose only mapping ID, Subject summary/status, mapping active status/revision and contextual Class/period summaries, with bounded pagination. Actor, token, transaction, fence and audit internals are absent. Query/body allowlists reject extra authority. IDs remain necessary transport identifiers; the UI displays names/codes.

**Q. Principal UI — PASS.** Existing Academic Setup → Classes → selected Class → Subjects flow uses shared theme, cards, badges, selectors, dialogs and feedback. Rendered tests prove selected-Class scoping, loading, empty options, permission/concealed errors, duplicate/dependency/stale conflicts, network retry, confirmation, pending double-submit protection and server-confirmed success. Stale conflicts can reload the authoritative revision. Native-device visual QA was not performed; component/rendered behavior and static checks were verified.

**R. Home non-cluttering — PASS.** No Principal Home or Teacher navigation feature edits. Existing user-owned Principal/Super Admin dashboards and SuperAdminNavigator remain byte-identical to the pre-AS-PR2 baseline. No ClassSubject CRUD home card was introduced.

**S. Subject selector — PASS.** Server options return only active Subjects in the exact Branch and omit every already-mapped identity, including inactive rows that must instead be reactivated. Foreign/inactive Subjects cannot be added by crafted requests. Separate Branch catalog creation remains separate; no hidden Subject creation. Names are displayed, IDs are not rendered as labels. Exhausted choices and inactive catalog reactivation restrictions are tested. Stale catalog text describing mapping as a future feature was corrected during closure.

**T. No fabricated migration — PASS.** Runtime mapping creation exists only in the explicit authorized mapping service. No inference/backfill from assignments, timetables, syllabuses or seeds. The curriculum fixture helper is test-only, deliberately imported by regression tests making NEW writes; production never imports it. Legacy-read tests deliberately omit mappings so compatibility is not concealed by seeded fixtures.

**U. Production rollout/readiness note.** An existing installation with zero mappings retains existing read behavior, but new protected writes correctly start failing. Before enabling those workflows: inventory Class-to-period relationships and inconsistent snapshots; perform a separately reviewed migration for legacy Classes lacking authoritative periods; have authorized administrators explicitly confirm each period-backed Class's intended Subjects; resolve inactive parents and duplicates; establish startup indexes on a replica set/sharded deployment; then verify assignment, timetable and syllabus workflows against configured curriculum. Do not derive official availability automatically from historical operational records. This administration/migration prerequisite is real deployment work, not data supplied by this PR. No production migration was run.

**V. Focused backend tests — PASS, 36/36.** Final `closure-focused-final.log` has zero failures/skips. Twelve new closure cases cover guessed identities, all parent write gates, legacy assignment mutation boundaries, imported legacy drafts, four timetable and four syllabus draft race orderings. Existing foreign tests also now explicitly exercise reads/options. Total multi-process mapping races: twelve (assignment 2, timetable 4, syllabus create/update/publication 6).

**W. Backend regression — PASS, 391/391, zero failures/skips.** Fresh closure run covers Academic Setup, assignment administration, Syllabus, Teacher scope/Classes, timetable/substitutes, Attendance, Homework/Quiz, lesson delivery, evidence/reviews, Catch-up and Results. Evidence: `closure-backend-regression.log`. This is a fresh complete regression run; the focused 36 tests were run separately, for 427 passing backend tests across the two runs.

**X. Frontend tests — PASS.** Final full run: 44 suites, 410/410 tests. Final focused AS-PR1 + AS-PR2 run: 5 suites, 34/34. Logs: `closure-frontend-final.log`, `closure-frontend-focused.log`. Existing Principal/Teacher navigation tests are included. The UI assertion now actually verifies disabled reactivation when the catalog Subject is inactive.

**Y. TypeScript/lint/diff.** Frontend scoped TypeScript PASS; all 27 changed source/test files ESLint PASS; `git diff --check` PASS. Backend TypeScript retains exactly the known unrelated `backend/src/controllers/safety-alert.controller.ts(47,49)` TS2322: void is not assignable to ISafetyAlert. That controller and its surrounding user-owned safety work were not edited. This is a known repository-wide build limitation, not an AS-PR2 diagnostic. Logs: `closure-frontend-types.log`, `closure-backend-types.log`, `closure-eslint.log`, `closure-diff-check.log`. The exact real-path source patch passes read-only `git apply --cached --check`; it was not applied.

**Z. Exact AS-PR2 files.** All 27 below are clean AS-PR2-only relative to the pre-AS-PR2 working tree. This list includes regression fixture updates needed to make NEW-write tests explicit about curriculum. Documentation and validation evidence are additional unstaged artifacts, outside this source/test boundary.

- `backend/src/constants/permissions.ts backend/src/constants/rolePermissions.ts backend/src/routes/academic-setup.routes.ts backend/src/services/academic-setup.service.ts backend/src/services/syllabus.service.ts backend/src/services/teacher-assignment-admin.service.ts backend/src/services/teacher-assignment.service.ts backend/src/services/timetable-admin.service.ts backend/tests/academic-setup.security.test.ts backend/tests/academic-work.security.test.ts backend/tests/academic.security.test.ts backend/tests/lesson-delivery.security.test.ts backend/tests/teacher-assignment-admin.security.test.ts backend/tests/teacher-attendance.security.test.ts backend/tests/teacher-scope.security.test.ts backend/tests/teacher-timetable.security.test.ts src/constants/permissions.ts src/screens/admin/AcademicSetupScreen.tsx __tests__/class-subject-service.test.ts __tests__/class-subject.test.tsx backend/src/models/classSubject.ts backend/src/services/class-subject-context.service.ts backend/src/services/class-subject.service.ts backend/tests/class-subject.security.test.ts backend/tests/helpers/curriculum-fixtures.ts src/screens/admin/ClassSubjectsPanel.tsx src/services/admin/classSubjectService.ts` — clean AS-PR2-only

**AA. Mixed files — NONE.** The feature set has no intersection with the original dirty set. There are no hidden mixed hunks. Closure-source changes are confined to the existing feature files `backend/tests/class-subject.security.test.ts`, `__tests__/class-subject.test.tsx` and `src/screens/admin/AcademicSetupScreen.tsx`.

**AB. Unrelated work preservation — PASS.** All 22 original dirty files match their pre-AS-PR2 SHA-256 hashes. Every other tracked file outside the feature set also matches baseline. Evidence: `.validation-as-pr2/baseline.json`, `initial-status.txt`, `closure-start.json`, `closure-preservation.json`, and the real-path review patch `as-pr2-source.patch`. The preservation JSON records both original/current hashes per dirty file, all marked unchanged. The index is empty and HEAD/origin/feture remain the AS-PR1 commit. No unrelated untracked path was edited or removed; pre-AS-PR2 content hashes for those untracked directories were not recorded, so no retrospective hash proof is claimed for them.

Original dirty files, intentionally unstaged:

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

Unrelated existing untracked paths, intentionally outside the feature: `.gradle-user/`, `.validation-as-pr1/`, `.validation-assignment/`, `.validation-home-fixes/`, `.validation-home/`, `.validation-pr7/`, `.validation-tpr8/`, `.vscode/`, `docs/AS-PR1-closure-review.md`, `docs/AS-PR1-continuation.md`, `docs/T-PR5-communications.md`, `schoolNotice-full.patch`, `services/`, `tpr5-staged-backup.patch`. AS-PR2 documentation and `.validation-as-pr2/` also remain unstaged.

**AC. Remaining AS-PR3 scope.** StudentEnrollment, promotion, transfer, graduation and Student AcademicPeriod history remain unimplemented. Legacy Class period migration and deliberate production curriculum setup require separate review; no enrollment/history work was smuggled into this change.

**AD. Remaining blocker/gap — No AS-PR2 correctness/security blocker found.** Known unrelated backend build diagnostic and deployment prerequisites are separately recorded above. No native visual-run claim is made.

**AE. Final verdict**

`READY TO COMMIT`
