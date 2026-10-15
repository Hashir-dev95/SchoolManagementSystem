# T-PR8 Lesson Plan & Syllabus — Phase 1 Foundation

Implementation/review report, 15 October 2026. Branch: `feture`. Nothing staged, committed or pushed.

## A. Existing academic-domain audit

Backend audit:

- `SchoolClass` owns branch, code and a required `academicYear` string. Its unique key includes branch/code/year. `Section` belongs to a branch and class. No separate academic-year/session entity exists; `Session` stores authentication tokens and revocations.
- `Subject` is an active/inactive branch catalogue. No class-subject curriculum catalogue exists. `TeacherAssignment` provides an explicit teacher/branch/class/section/subject tuple with effective timestamps and revocation.
- TimetableVersion, TimetablePeriod and SubstituteAssignment already represent approved schedules and date-specific substitutions. Their occurrence authority is separate from permanent TeacherAssignment authority.
- No existing curriculum, syllabus, lesson-plan, delivery or coverage model was found. `coordinator_follow_up` is an AssignedWork source type, not an Academic Coordinator user role. Existing roles are Super Admin, Principal, Teacher and Student.
- Principal approvals have typed categories, independent-reviewer checks, delegation and server-configured `PRINCIPAL_APPROVAL_AUTHORITY`. Their source-reference validation has no lesson-plan entity/category. Existing attendance correction/leave workflows have dedicated typed handling. A new generic approval engine is unnecessary.
- Existing academic services use primary reads, strict request contracts, safe DTOs, optimistic revisions, unique operation IDs, MongoDB replica-set transactions and document fences. Phase 1 reuses `withTeacherCommunication`, which fences the authenticated session, current user, branch, assignment and academic references and revalidates scope before completion.

Frontend audit:

- Teacher Classes previously opened the roster directly. Roster and timetable already have separate stack routes. The workspace owns Home/Classes/Tasks/Inbox/Me navigation.
- Principal academic work uses existing workspace/task/approval routes; there is no lesson-review workspace. Super Admin administration already supports academic reference and teacher-assignment administration, but no syllabus editor/publication flow.
- Hira supplies DashboardShell, ScreenHeading, SectionCard, Button, StatusBadge, AdminSelect, AdminDateField, AdminDialog and AdminFeedback. `useTeacherResource` already protects asynchronous loads against stale focus/context responses and clears stale academic data during revalidation.

## B. Academic-year/session decision

Reuse `SchoolClass.academicYear`, copied by the server into syllabus/lesson records and validated against the current class. Do not reuse authentication Session or invent a duplicate academic-year model. The existing year string has no start/end dates; Phase 1 does not infer calendar boundaries from its label. A later academic calendar migration must preserve existing versioned references.

## C. Subject/class mapping decision

The syllabus is the minimum explicit branch/class/subject/year curriculum relation. Administration must deliberately choose an active class and active subject in the same active branch. A branch subject is never assumed to apply to every class. Section authority remains on TeacherAssignment, without duplicating syllabuses per section.

## D. Syllabus architecture

`Syllabus` stores branch/class/subject/year, title, immutable version, optimistic revision, lifecycle, audit actors/timestamps, and embedded ordered units/topics. Units and topics have stable ObjectIds; learning outcomes are optional explanatory strings under a topic. Lesson plans reference IDs, never submitted labels. References are version-qualified through syllabusId; optional outcome text is not a separate objective identity.

Limits: 100 units, 100 topics per unit, 30 outcomes per topic, bounded text. Teacher DTOs expose the academic hierarchy without administrative actor IDs or unrelated private data.

## E. Publication/versioning lifecycle

`draft → published → retired`. Only draft title/structure can be edited. Each management mutation quotes its revision. Branch-fenced publication atomically retires the previous publication and publishes the new version. A unique partial index permits one published syllabus per branch/class/subject/year; a second unique index reserves version numbers. Published structures survive retirement. Publication cannot roll back below any previously published version, including a retired version.

Production establishes syllabus and lesson indexes before listening, including when automatic index creation is disabled. MongoDB replica-set/sharded transactions remain a deployment requirement already present in this application.

## F. Syllabus management authority

Super Admin plus the explicit `syllabus.manage` permission. The current role grants contain no Principal syllabus-management permission, so existing exam/approval powers are not treated as publication authority. No Academic Coordinator role was added. Principal branch-scoped publication requires a deliberate future permission/policy decision.

Management reads and all mutations share `assertManagedSyllabusContext`, reusing the existing active-branch guard. Missing/inactive Branch returns 403; missing/inactive Class or Subject, foreign branch references, and mismatched academic year return concealed 404. The persisted syllabus branch/year must agree with the current active Class, and Subject must be active in that Branch. Mutations revalidate after acquiring the existing transaction fences. Super Admin remains system-wide; an internally inconsistent foreign-branch tuple is denied, without inventing a branch restriction on a valid Super Admin context. Teacher authorization is unchanged.

There is no syllabus management list endpoint. The audited management read is `GET /api/syllabuses/:syllabusId`; creation, draft update, publication/replacement and retirement use the same context policy. Persisted versions cannot be read through this endpoint after their academic context becomes inactive. No archival endpoint or archival permission is introduced.

Management API, authenticated as Super Admin:

| Method | Path | Contract |
|---|---|---|
| POST | `/api/syllabuses` | classId, subjectId, version, title, units |
| GET | `/api/syllabuses/:syllabusId` | Retrieve selected syllabus version only within its current active academic context |
| PATCH | `/api/syllabuses/:syllabusId` | revision, title, units; draft only |
| POST | `/api/syllabuses/:syllabusId/publish` | revision |
| POST | `/api/syllabuses/:syllabusId/retire` | revision |

Unit input is `{id?, title, topics: [{id?, title, outcomes?}]}`. Omitted IDs are generated by the server; management DTO unitId/topicId values can be supplied as `id` on draft edits. Array position determines order. Branch and year are derived from the selected class. Management publication is API-based in this phase; no new administrative UI was requested/added.

## G. Teacher syllabus authorization

Live session → active current Teacher → active current branch → effective active TeacherAssignment → exact class/section/subject → current class academic year → published syllabus. Primary reads and fresh scope lookup prevent cached authority after revocation. Wrong tuple, branch, guessed syllabus and unpublished/retired IDs return concealed 404s; non-Teacher roles receive 403. No-store headers and strict body/query field allowlists apply.

Substitute policy: an occurrence alone grants no syllabus/planning authority. A substitute needs a normal effective TeacherAssignment for the exact tuple. This does not change timetable or attendance substitute behavior.

Teacher APIs under `/api/teacher/academic`:

| Method | Path | Contract |
|---|---|---|
| GET | `/contexts` | Current authorized assignment tuples |
| GET | `/context` | Exact classId/sectionId/subjectId query; context plus current published hierarchy or null |
| GET | `/syllabuses/:syllabusId` | Same exact query; current published ID must match |
| GET | `/lessons` | Same query; latest 100 owned plans in this tuple |
| POST | `/lessons` | Exact tuple, syllabusId, clientOperationId, mapped lesson details |
| PATCH | `/lessons/:lessonId` | revision, clientOperationId, editable lesson details |
| POST | `/lessons/:lessonId/submit` | revision, clientOperationId |

## H. Class-context UI

Classes opens TeacherAcademic with class, section, subject, Teacher name and academic year. Its compact workspace exposes Roster, Timetable, Syllabus and Lessons. Roster retains the exact tuple. Timetable opens the existing teacher timetable. TeacherWorkspace remains the initial stack destination, and the five bottom destinations are unchanged. Teacher Home has no new lesson/syllabus cards.

## I. Syllabus UI

Published title/version badge, ordered units, topics and outcomes. Loading, empty publication, failure/retry and refresh behavior use existing patterns. There are no completion percentages or inferred coverage indicators.

## J. LessonPlan architecture

An owned lesson stores branch, Teacher, original assignment, exact class/section/subject, academic year, immutable syllabus ID, unit/topic IDs, civil teaching date, objectives, teaching activities, resources, notes, lifecycle, revision, audit actors/timestamps, operation identities and submitted snapshots. Tuple/year/syllabus/assignment cannot be rebound through the update contract.

Free date-based planning only. Current authority and date-effective assignment overlap are required, using the configured school civil timezone. No timetable occurrence is accepted, and no schedule authority follows from a plan. A revoked-and-replaced assignment cannot silently rebind an existing lesson.

## K. Lesson lifecycle implemented

`draft → submitted`. Teachers edit only their own currently authorized drafts against the current publication. Submission requires valid mapped content and freezes the plan. UI confirmation summarizes Teacher, class/section, subject, date, syllabus/unit/topics and objectives, and explains that review is not yet available. No approved, scheduled or delivered state is fabricated.

## L. Revision/concurrency model

Every draft update/submission quotes the revision. A transaction serializes writes, checks state/revision and appends an operation receipt; stale writes return 409. Creation has a unique Teacher/operation index. Matching retries return the existing result; operation reuse with different content conflicts. Submission atomically appends an immutable content snapshot with actor/time/revision and freezes the current record. No submitted-content update API exists. Draft operation receipts are bounded at 500.

The form fences duplicate taps, retains values on failure and uses stable operation IDs for unchanged retries. Even unchanged saves contact the server. Confirmed server content/revision replaces local saved state. Conflicts retain local input and require reopening the latest plan before applying changes. Parent unit changes clear topics; context changes remount the editor; resource generations reject stale option responses.

## M. Principal review integration decision

Deferred deliberately. Existing category and source-reference validators do not support lesson plans; extending them safely requires typed lesson references, branch-bound authority grants, atomic snapshot decisions and resubmission semantics. Phase 2 should extend that engine rather than build a second generic one. Submission currently creates no Principal approval request, sends no review notification, and promises no active review queue. Independent-review/self-review rules remain intact.

## N. LessonDelivery design/readiness

`lessonDelivery.contract.ts` defines a separate future evidence contract: authenticated actor/assignment/context, syllabus and topic IDs, optional frozen plan revision and validated timetable occurrence, explicit partial/completed evidence, operation identity and evidence revision. It is a TypeScript contract, not an activated persistence model or API. Delivery must require an explicit action; dates and plan status are never evidence.

## O. Future coverage design

Coverage is a future projection over accepted delivery evidence scoped by branch/class/section/subject/year and syllabus version/topic. Absent evidence is pending. Partial/completed require topic evidence; corrections append evidence revisions and invalidate projections. No coverage engine or percentage is implemented. Homework/quiz may use lessonPlanId plus syllabusTopicId with the frozen syllabus context; submissions retain their source; catch-up uses delivered topics; marks may reference stable topic/objective IDs; AI grounding must respect published syllabus and approved/delivered context. None of those future domains was implemented.

## P. Backend tests/results

35 HTTP/database academic security tests pass against an owned ephemeral MongoDB replica set, on both the selective feature tree and current dirty tree. The original 18 cover assigned publication reads; unassigned/branch/section/subject/guessed-ID concealment; draft/retired policy; owned mapped drafts; foreign class/syllabus/topic and cross-unit attacks; stale writes; concurrent duplicate operations; session/assignment revocation; replacement assignment binding; explicit substitute policy; Student/Principal denial; safe DTOs; publication immutability; submission snapshots; date boundaries; domain permission removal.

The closure fix adds 17 tests: active management detail; eleven invalid context cases comparing read/mutation status and error message with unchanged persisted publication/revision; Teacher/Principal management-read exclusion; administrator identity/session/permission checks; the draft-update/publish/replace/retire workflow; retained historical data concealed after context deactivation; and unchanged Teacher denial for inactive academic references. Before the fix, the inactive Branch/Class/Subject regressions failed because management GET returned 200. After the shared-context fix, all 35 pass.

## Q. Frontend tests/results

All 26 suites / 297 tests pass with `jest --runInBand --testTimeout=30000`. The academic suite has eight tests, also rerun after the final server-reconciliation adjustment. Coverage includes contextual entry/header, hierarchy without fake progress, loading/empty/error/retry, Lessons/create, parent clearing, validation, confirmed saves, failure retention/retry identity, duplicate taps, confirmation/frozen submission, conflicts and stale responses. Existing navigation, Home, roster, timetable, attendance and Principal suites pass. No emulator/device visual QA was performed.

## R. Regression/static results

- Original broad-run evidence: bootstrap/auth-session checks, Teacher scope/provisioning/assignment administration, timetable/substitute, attendance, communications, Home, amendments, approval authority, Principal authorization and Principal writes. Combined per-suite results were **500 pass / 10 baseline failures across 510 existing tests**, plus the original 18 academic tests. The initial broad run exposed two permission-expectation assertions, updated to exclude the new Teacher-only grants; affected suites were rerun. Dirty-tree Principal writes were 42/49 with seven baseline safety failures. These historical validation logs remain unchanged.
- All ten remaining failures were reproduced against an isolated copy of the starting worktree, preserving its dirty safety implementation: seven Principal-write safety cases and three Principal-authorization safety cases. Baseline source copies/junction were removed after validation; evidence logs remain.
- Backend TypeScript: the existing `safety-alert.controller.ts:47` void/ISafetyAlert error remains. No new source diagnostics.
- Frontend-only TypeScript (src, frontend tests, App): passes. Default repository TypeScript also includes backend tests and retains 30 baseline diagnostics: one safety-controller error, 28 Principal-authorization fixture errors, one Principal-write history-shape error. No new files report errors.
- All 22 changed TypeScript files: ESLint passes with zero warnings. Repository-wide lint retains six errors in admin/auth/branch controllers and branch middleware, plus 60 baseline warnings, mostly compiled backend/dist output. These files were left untouched.
- `git diff --check` passes. Legacy `auth.test.ts`/`userModel.test.ts` load dotenv and mutate the configured database, so they were not executed; isolated security suites cover auth/session behavior safely.

Fresh closure-fix validation: all 35 academic tests pass on both selective and current trees. The selective tree also passes 242 existing regressions: bootstrap/auth-session (17), Teacher scope/assignments (59), assignment administration (20), approval authority (47), Principal authorization (50), and Principal writes (49). Selective backend and scoped frontend TypeScript have zero diagnostics; the dirty backend retains only the known safety-controller error. Changed-file lint has zero warnings and `git diff --check` passes. Source overlays and check results stayed in memory/tool output; no new validation artifacts were written.

Evidence and exact source allowlist are in `.validation-tpr8/`. This directory is validation output, not feature source for a future commit.

## S. Exact files changed

Modified initially clean files:

1. `backend/src/app.ts`
2. `backend/src/constants/permissions.ts`
3. `backend/src/constants/rolePermissions.ts`
4. `backend/src/server.ts`
5. `backend/tests/approval-authority.security.test.ts`
6. `backend/tests/principal-write.security.test.ts`
7. `src/navigation/TeacherNavigator.tsx`
8. `src/screens/teacher/TeacherClassesScreen.tsx`
9. `src/screens/teacher/TeacherWorkspaceScreen.tsx`
10. `__tests__/teacher-navigation.test.tsx`
11. `__tests__/teacher-screens.test.tsx`

New feature/report files:

12. `backend/src/models/syllabus.ts`
13. `backend/src/models/lessonPlan.ts`
14. `backend/src/models/lessonDelivery.contract.ts`
15. `backend/src/routes/academic.routes.ts`
16. `backend/src/services/syllabus.service.ts`
17. `backend/src/services/lesson-plan.service.ts`
18. `backend/tests/academic.security.test.ts`
19. `src/services/teacher/academicService.ts`
20. `src/screens/teacher/TeacherAcademicScreen.tsx`
21. `src/screens/teacher/TeacherLessonScreen.tsx`
22. `__tests__/teacher-academic.test.tsx`
23. `docs/T-PR8-phase-1.md`

## T. Mixed files requiring selective staging

None of the Phase 1 files overlap the pre-existing dirty-file set. Existing dirty files still require exclusion from any future feature staging. This report does not authorize staging.

## U. Exact mixed hunks

None. The Phase 1 semantic hunks in previously clean tracked files are: academic router mounting/parser handling; three permission constants and Teacher-only exclusions/grants; startup indexes; two stack routes/types and explicit initial destination; optional Classes academic callback and workspace wiring; navigation expectations; and two backend permission-expectation exclusions. New feature files are wholly Phase 1.

## V. Unrelated files preserved

SHA-256 verification confirms all 18 tracked files originally reported by `git diff --name-only` remained byte-identical. Initial status additionally flagged `principal-task.controller.ts`, which was never edited and had no content diff. The complete original dirty-status list was:

- `.gitignore`
- `backend/src/controllers/principal-task.controller.ts`
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
- `src/navigation/SuperAdminNavigator.tsx`
- `src/screens/principal/PrincipalDashboardScreen.tsx`
- `src/screens/superAdmin/SuperAdminDashboardScreen.tsx`
- `src/services/admin/adminService.ts`
- `src/services/api/apiClient.ts`

Original untracked `.gradle-user/`, `.vscode/`, `.validation-assignment/`, `.validation-home-fixes/`, `.validation-home/`, `.validation-pr7/`, `docs/T-PR5-communications.md`, `schoolNotice-full.patch`, `services/` and `tpr5-staged-backup.patch` were left untouched. LAN host, formatting leftovers, safety defect and unrelated Principal/Super Admin edits were preserved. Git index remains empty.

## W. Remaining gaps for T-PR8 Phase 2

Typed Principal review and controlled needs-revision/resubmission; explicit delivery persistence/actions/evidence corrections; real coverage projection; occurrence-linked planning with timetable revalidation if introduced; durable paginated lesson history beyond the current 100-item list; optional administrative syllabus browser/editor and explicit Principal publication grants; academic-calendar dates if the domain later introduces them. Historical plans remain readable in an authorized tuple but cannot be edited against a retired publication. Replaced-publication drafts need a new draft; no automatic migration/rebinding exists. Optional outcome text is not yet an independently identified objective domain.

## X. Final verdict

READY FOR REVIEW

Phase 1 meets its functional/security definition of done. Repository-wide green validation is limited by the independently reproduced baseline safety/static/lint defects above; those are not absorbed into this feature.

Closure correction: management reads now enforce the same active-context policy as writes through one validator. Only `backend/src/services/syllabus.service.ts`, `backend/tests/academic.security.test.ts`, and this report change for the correction; the feature boundary remains 23 files. No validation artifacts, unrelated files, frontend code or Phase 2 scope are changed.

## Y. Next recommendation

YES — proceed to T-PR8 Phase 2 Lesson Delivery & Coverage after Phase 1 commit

The commit remains a future user-controlled action. No staging, commit or push was performed.
