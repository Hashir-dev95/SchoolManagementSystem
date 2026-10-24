# Principal role — production audit and authoritative completion backlog

Audit date: **24 October 2026, Asia/Karachi**. Workspace: `D:\SchoolManagementSystem`; branch: `feture`.

This is an **audit, not an implementation pass**. Application code, original tests, permissions, data and previous patches were not edited. Findings describe the checked-out mixed worktree, not a certified deployed build.

## A. Executive verdict

**PRINCIPAL MODULE CORE WORKFLOWS INCOMPLETE**

Substantial real functionality exists: Branch-scoped academic catalogs, Rooms, immutable timetable publication, exact TeacherAssignment eligibility, existing-Student enrollment, typed attendance/lesson/result reviews, generic approval authority/delegation, tasks and published-notice reads. Screens were not treated as proof of completion.

Release cannot be approved because:

1. **P0 — commit-time authority:** generic approvals can commit after the Principal is transferred, demoted or has the session revoked during the request. Task completion can commit after a Branch transfer. Reproduced beyond normal request-entry RBAC checks.
2. **P0 — inactive Branch:** legacy operational APIs allow an inactive Branch's dashboard read and task creation. Academic/Room/enrollment/timetable APIs apply stronger active-Branch checks.
3. **P0 — false failure after committed Safety mutation:** resolving an alert returns 500 after persisting `resolved` and history. The service returns `void` while its controller serializes the result. This is the known TypeScript gate with proven runtime impact, not just a build failure.
4. **P1 — admission/profile management:** Principal cannot create/edit Student identities through a reachable API/UI. `createStudent` is an internal service, not a routed admission API. Existing enrollment placement must be preserved.
5. **P1 — attendance oversight:** Home uses legacy daily Attendance; current Teacher marking/corrections use timetable attendance sessions/records. No Principal marked/unmarked/session-exception workspace exists.
6. **P1 — substitutions:** management is API-only; a replacement Teacher can be approved while already teaching elsewhere at the same time. Room conflicts alone do not protect staffing availability.
7. **P1 — results:** approved/unpublished results lack a discoverable return queue after leaving pending approvals. A component probe reproduced stale Publish capabilities surviving authoritative refresh.

Ordinary forged foreign-Branch requests are generally denied in tested families. This does **not** establish safety at commit time, inactive-Branch safety or product completeness.

### Product basis and audit limits

The repository contains `blueprint`: Principal responsibilities, sections 13.1–13.16, Student Management, Admissions and Academic Setup. No original product PDF was present in the repository or this attachment. This report maps code against that blueprint and the supplied requirements; it does not claim parity with an unseen PDF.

The blueprint initially deferred Student/Admissions until after Principal foundations. The current request explicitly requires their Principal integration, so those gaps belong here. Advanced HR/Finance execution, transport, hostel, library systems, recording, AI, OMR and media hardening are excluded.

No production database was accessed. Experiments use owned ephemeral MongoDB and test users. Device rendering/accessibility and release binaries were not certified.

## B. Completion scorecard

`COMPLETE` means complete for the stated existing contract, not a blanket production verdict. `API ONLY` requires an existing route: an internal function alone is a foundation, not an API. No isolated dummy/UI-only workflow was proven. Embedded screens count as reachable when dispatched by a real parent.

Evidence IDs resolve in the source index at the end. Priorities: P0 authority/security/data integrity/impossible workflow; P1 core workflow; P2 important product/UX; P3 later policy/polish.

### Dashboard and navigation

| Feature | Status | Evidence | Gap | Priority |
| --- | --- | --- | --- | --- |
| Principal login/role stack | COMPLETE | E01–02 | Persisted account/role checked at request entry | — |
| Branch Home overview | PARTIAL | E03 | Legacy attendance; no academic/timetable operational exceptions | P1 |
| Dashboard active-Branch restriction | SECURITY GAP | Inactive-Branch probe | Returns 200 with isActive:false | P0 |
| Dashboard granular data grants | SECURITY GAP | Subgrant probe, E03 | Finance/attendance/safety data returned after grants removed | P1 |
| Drawer/three-dot interaction | COMPLETE | E01 | Existing modal/search/swipe; device acceptance pending | — |
| Drawer destination search | PARTIAL | E01 | Tasks, Safety, Teacher Assignments not indexed | P2 |
| Academic Administration placement | COMPLETE | E01 | Academic Setup, Rooms, Manage Timetable grouped coherently | — |
| Student management navigation | COMPLETE | E01 | Students & Enrollment in Student Administration | — |
| Teacher Assignment entry | PARTIAL | E01, E09 | Home/timetable remediation only, absent from drawer | P2 |
| Home action hierarchy | PARTIAL | E03 | Long-form Assignment management card lacks exception context | P2 |
| Back consistency | PARTIAL | E01, E12 | AttendanceReview has neither visible Back nor native header | P2 |
| Unique route registration | COMPLETE | E01 | Fifteen unique routes; no duplicate stack | — |
| Drawer footer count | BROKEN | E01 | Counts only three tabs while claiming all role pages | P3 |
| Principal notifications center | MISSING | E26 | Existing notification API is Teacher-only | P2 |

### Academic Administration

| Feature | Status | Evidence | Gap | Priority |
| --- | --- | --- | --- | --- |
| AcademicPeriod visibility | COMPLETE | E04 | Principal reads; global SA governs lifecycle | — |
| Principal create/activate/close Period | OUT OF PRINCIPAL SCOPE | E04 | Deliberate server role ownership | — |
| Create/edit Class | COMPLETE | E04 | Active period, revision and Branch checks | — |
| Sections/exact parent | COMPLETE | E04 | Branch/Class parent and dependency checks | — |
| Branch Subject catalog | COMPLETE | E04 | Scoped CRUD and case-insensitive uniqueness | — |
| ClassSubject mappings | COMPLETE | E04 | Per-Class panel and lifecycle checks | — |
| Legacy Class migration UI | PARTIAL | E04 | Explicit read-only legacy state, no automatic migration | P3 |
| Physical Room CRUD/search/status | COMPLETE | E05 | Canonical catalog, controlled type, name/code search | — |
| Referenced Room retirement | PARTIAL | E05 | Any retained reference blocks deactivation by policy | P3 |
| Academic selectors/loading/errors/races | COMPLETE | E04–06 | Canonical IDs/catalogs, guards and explicit states | — |
| Whole-chain readiness guidance | PARTIAL | E01, E04–06 | No cross-tool readiness/exception view | P2 |

### Teacher administration

| Feature | Status | Evidence | Gap | Priority |
| --- | --- | --- | --- | --- |
| Select active Branch Teachers | COMPLETE | E09 | Scoped assignment options | — |
| Principal Teacher directory/profile/status | PARTIAL | E09–10 | Picker is not a directory; inactive account discovery weak | P2 |
| Principal provision Teacher account | OUT OF PRINCIPAL SCOPE | E10 | Actual provisioning is global SA-only | — |
| Principal edit/disable Teacher account | MISSING | E10 | No workflow; decide ownership before adding it | P2 |
| Teacher-account permission catalog | PARTIAL | Permission drift | Principal create/update grant names do not authorize SA-only route | P1 |
| Create exact TeacherAssignment | COMPLETE | E09 | Exact Branch/Class/Section/Subject and academic checks | — |
| Assignment change/revocation/history | COMPLETE | E09 | Immutable assignments use revoke/replacement | — |
| Expired/future/inactive explanations | COMPLETE | E06, E09 | Scheduling diagnostic states and history | — |
| Future-only timetable assignment planning | PARTIAL | E06 | Current assignment policy intentionally excludes it | P3 |

### Student administration — mandatory area

| Feature | Status | Evidence | Gap | Priority |
| --- | --- | --- | --- | --- |
| Student list/name/admission search | COMPLETE | E07 | Paginated Branch enrollment-focused list | — |
| Enrollment detail/history | COMPLETE | E07 | Current and retained prior placements | — |
| Full permanent Student profile | PARTIAL | E07–08 | Model exists; guardian/contact/profile workspace absent | P1 |
| Principal Create Student | MISSING | E08 | Internal admission function, no route/UI/orchestration | P1 |
| Principal edit Student identity | MISSING | E08 | No routed profile-update workflow or screen | P1 |
| User → Student admission orchestration | MISSING | E08 | Public registration creates User only | P1 |
| Enroll existing Student | COMPLETE | E07 | Active period targets, confirmation and idempotency | — |
| Class/Section placement selection | COMPLETE | E07 | Canonical parent/period validation | — |
| Same-Class/period Section transfer | COMPLETE | E07 | Explicit supported transition | — |
| Same-period Class transfer | MISSING | E07 | Transfer explicitly requires same Class | P1 |
| Withdraw enrollment | COMPLETE | E07 | Permanent identity/history retained | — |
| Promote to later active period | COMPLETE | E07 | Prior closed/archived period; later target | — |
| Automatic promotion eligibility | OUT OF PRINCIPAL SCOPE | E07 | Not supplied by placement transition | — |
| Cross-Branch Student transfer | OUT OF PRINCIPAL SCOPE | E07 | Current transfer is own-Branch Section transfer | — |
| Identity separate from enrollment | COMPLETE | E07–08 | User/Student identity; authoritative Enrollment lifecycle | — |
| Applicant/review/rejection Admissions pipeline | MISSING | Blueprint, E08 | Expanded Admissions needs separate scope decision | P2 |
| Identity vs enrollment status labels | PARTIAL | E03, E07 | Home counts identities, not current enrollments | P2 |

### Timetable and substitutions

| Feature | Status | Evidence | Gap | Priority |
| --- | --- | --- | --- | --- |
| Stage/edit/remove local periods | COMPLETE | E06 | Grouped form and complete draft | — |
| Save immutable draft | COMPLETE | E06 | Server validates scoped 1–500 periods | — |
| Exact current Teacher eligibility | COMPLETE | E06, E09 | No arbitrary Teacher fallback | — |
| Canonical physical Room allocation | COMPLETE | E05–06 | Active same-Branch ID, server snapshot | — |
| Day/time/timezone semantics | COMPLETE | E06 | HH:mm, school dates, positive same-day interval | — |
| Master Teacher/Class/Section/Room conflicts | COMPLETE | E06 | Creation/publication checks; suite green | — |
| Review/approve full version | COMPLETE | E06 | Actor/reference checks and Branch transaction | — |
| Revise full schedule | COMPLETE | E06 | New immutable draft copy | — |
| Effective winning-version context | COMPLETE | E06 | Highest approved version per date, no merge | — |
| Unsaved edits/Branch/Back guards | COMPLETE | E06 | Existing hardening retained | — |
| Saved draft edit/archive lifecycle | PARTIAL | E06 | Append-only copies; no withdrawal UI | P2 |
| Version retirement | API ONLY | E06 | No UI; retirement may reveal older approved version | P2 |
| Substitution create/approve/retire UI | API ONLY | E06 | Existing protected endpoints, no destination | P1 |
| Temporary replacement scope/duty delivery | COMPLETE | E06 | Active Branch Teacher, exact dated duty, no general roster expansion | — |
| Substitute Room conflicts/concurrency | COMPLETE | E06 | Canonical Room override checks and publication fencing | — |
| Substitute Teacher availability | BROKEN | Substitution probe | Occupied Teacher approved in different Room | P1 |
| Substitute Class/Section conflicts | PARTIAL | E06 | No full effective-occurrence collision solver | P1 |

### Attendance and learning oversight

| Feature | Status | Evidence | Gap | Priority |
| --- | --- | --- | --- | --- |
| Legacy daily Home summary | COMPLETE | E11 | Correct for its daily collection/marked denominator | — |
| Current timetable attendance Home integration | BROKEN | E11 | Writes PeriodAttendanceRecord; Home reads Attendance | P1 |
| Marked/unmarked/submitted Branch overview | MISSING | E11 | No Principal attendance workspace | P1 |
| Unmarked distinct from absent in marking | COMPLETE | E11 | Null/unmarked and explicit submission; not media participation | — |
| Attendance correction review | COMPLETE | E12 | Typed context/revision/decision/history | — |
| Student leave review | COMPLETE | E12 | Typed approval with attendance authority | — |
| Staff leave decisions/status history | COMPLETE | E13 | Teacher DTO derives linked approval state | — |
| Leave calendar/substitute handoff | PARTIAL | E13, E06 | No operational staffing calendar/automatic coverage | P2 |
| Absence patterns/date-range oversight | MISSING | E11 | No Principal reporting/read model | P2 |
| Consistent school-date Home semantics | PARTIAL | E03, E11 | Server-local summary vs device-local label | P2 |
| Principal syllabus edit/publication | OUT OF PRINCIPAL SCOPE | E14 | SA authoring, Teacher contextual reads | — |
| Lesson review/revision decisions | COMPLETE | E14 | Reachable embedded typed screen and real backend | — |
| Lesson history/per-context coverage | COMPLETE | E14 | Approvals → Lesson History & Coverage | — |
| Branch curriculum coverage dashboard | MISSING | E14 | Current coverage is reviewed-lesson context | P2 |
| Homework/quiz/marking oversight lists | MISSING | E14–15 | Teacher/Student workflows exist, no Principal Branch surface | P2 |
| Edit Teacher content as Principal | OUT OF PRINCIPAL SCOPE | E14 | Do not solve read oversight by granting editing roles | — |
| Result moderation backend/actions | COMPLETE | E15 | Revision checks, explicit publication and history | — |
| Reopen approved/unpublished results | UNREACHABLE | E15–16 | Backend supports it by ID; pending inbox drops approved record | P1 |
| Result refresh/capability state | BROKEN | UI audit probe | Cached current shadows refreshed resource | P1 |
| Exam/paper administration | MISSING | Route/model inventory | Grant/enum alone is not an implemented workflow | P2 |

### Communications, approvals, operations and reports

| Feature | Status | Evidence | Gap | Priority |
| --- | --- | --- | --- | --- |
| School notice read UI | PARTIAL | E17 | Real reads; publication/expiry detail policy inconsistent | P1 |
| Notice publication visibility | SECURITY GAP | Draft/future probes | Detail returns draft/future records; list lacks publishedAt cutoff | P1 |
| Principal announcement authoring | MISSING | E17 | No producer API/UI/grant; ownership decision required | P2 |
| Principal direct Teacher/Parent messaging | OUT OF PRINCIPAL SCOPE | E18 | Teacher-only communication is not Principal impersonation authority | — |
| AssignedWork producer | API ONLY | E18 | Principal create/cancel endpoints; no authoring/review screen | P2 |
| Principal task tracking/status/history | PARTIAL | E19 | Working UI; Branch/commit authority gaps | P0 |
| Teacher receives assigned PrincipalTask | PARTIAL | E18–19 | Separate models; no Teacher PrincipalTask consumer found | P1 |
| Safety list/detail/officer discovery | COMPLETE | E20 | Scoped reads and capability DTOs | — |
| Safety action response contract | BROKEN | Committed-state probe | State/history commit, then 500 serializing void | P0 |
| Pending approval search/type filters | COMPLETE | E16 | Real authority-filtered data | — |
| Missing authority configuration feedback | PARTIAL | E16, E21 | Filtered into empty list, no setup explanation | P2 |
| Generic decisions/delegation | PARTIAL | E16, E21 | Policy/state/history exist, actor/session commit fence absent | P0 |
| Duplicate/stale request protection | COMPLETE | E16 | Atomic request snapshot/version/expiry checks | — |
| Generic linked business execution | PARTIAL | E16, E21 | Decision metadata does not execute refund/payroll/certificate | P2 |
| Paper/purchase approval entities | PARTIAL | E21 | Enum exists, reference allowlist fails closed, producer absent | P2 |
| Per-entity operational history | COMPLETE | E07, E09, E12–16, E19–20 | Enrollment/assignment/review/task/Safety history | — |
| Unified Principal audit/report destination | MISSING | E22 | No Branch report/audit UI/API despite grant | P2 |
| Finance summary | COMPLETE | E03 | Scoped totals; subgrant gap separately listed | — |
| Advanced Finance/HR/transport/hostel/library/media | OUT OF PRINCIPAL SCOPE | Request exclusions | Not part of this completion effort | — |
| Branch export workflow/permission | MISSING | E22 | No explicit contract/policy/UI | P2 |
| Release regression maintenance | BROKEN | Section M | Stale Room fixtures and hard-coded snapshots weaken release signal | P1 |

## C. Navigation and architecture map

```text
Root role selection → PrincipalNavigator (one native stack)
  PrincipalWorkspace
    Home → PrincipalDashboardScreen
      Tasks → Tasks → TaskDetail / AssignTask
      Safety → SafetyOverview → SafetyDetail
      Teacher Assignment card → AssignTeacher
      Approval shortcut → embedded Approvals tab
      Notice shortcut → embedded Inbox tab
    Approvals → PrincipalApprovalsScreen
      academic_result → ResultModeration
      attendance_correction / student_leave → AttendanceReview
      lesson_plan → ApprovalDetail wrapper → PrincipalLessonReviewScreen
      other supported entities → Generic ApprovalDetail (+ delegation form)
      Lesson History & Coverage → lesson-review history/context
    Inbox → PrincipalInboxScreen → NoticeDetail
    Drawer → Home / Approvals / Inbox
      Student Administration → StudentsEnrollment
      Academic Administration → AcademicSetup / Rooms / TimetableAdmin
    Timetable remediation → AssignTeacher / Rooms
```

The fifteen routes are Rooms, TimetableAdmin, StudentsEnrollment, AcademicSetup, PrincipalWorkspace, AttendanceReview, ApprovalDetail, NoticeDetail, Tasks, TaskDetail, AssignTask, SafetyOverview, SafetyDetail, AssignTeacher, ResultModeration. Home/Approvals/Inbox are embedded tabs, not additional stacks.

No duplicate route or nested navigation container was found. ClassSubjectsPanel and Rooms' reuse of AcademicSetup are intentional component reuse. PrincipalLessonReviewScreen is reachable through ApprovalDetail; absence of a separate route is **not** an unreachable-screen defect.

Missing destinations: admission/profile editing, staff directory, substitutions, retirement, operational attendance, result publication queue, AssignedWork management, Principal notifications and Branch reports/audit/export. Tasks, Safety and AssignTeacher are mainly Home actions and not indexed by drawer search. The Assignment Home card is an IA issue to review, not a reason to delete functionality. Operational approval/notice shortcuts are useful duplicates of destinations, not duplicate route implementations.

AttendanceReview inherits headerShown:false and has no visible Back. Android hardware Back does not establish good cross-platform navigation. ResultModeration has a native header. The footer counts three tab definitions while claiming all role pages live there.

### Server architecture

Authenticated routes check persisted User identity/role, then role/permission gates. Academic services re-resolve actor and active Branch, validate canonical parents and use shared Branch catalog/publication fencing. These cover Academic Setup, Rooms, TeacherAssignments, StudentEnrollment and Timetable.

Legacy Principal operations use requireBranchScope: it derives persisted User Branch but does not verify Branch activity. Generic approval/task writes use application actor checks and atomic target conditions without the academic modules' commit-time User/Session/Branch fences. This distinction explains the reproduced failures.

## D. Security / RBAC findings

### SEC-01 — P0: actor/session changes do not fence generic approval/task commits

The audit pauses at ApprovalRequest.findOneAndUpdate after authorization, changes only the owned fixture actor's Branch, role or session, then resumes the actual write. All three return **200 and persist approved**. Task completion at its atomic write likewise returns **200 and persists completed** after actor transfer. These are commit-window failures, not evidence that ordinary foreign-ID requests bypass entry gates.

Root: target-document CAS protects request/task revision/state, not continuing actor authority. authorizedActor/principalWriteActor execute before the write. Use the established transaction/fencing pattern, including relevant source/assignee authority; retain request CAS, separation rules, limits and delegation expiry conditions.

Evidence: `.validation-principal-audit/probe-evidence.json`: approval_commit_branch, approval_commit_role, approval_commit_session, task_commit_branch.

### SEC-02 — P0: inactive Branch is inconsistently fail-closed

With an inactive fixture Branch, dashboard returns **200**, and task creation returns **201** with a persisted task. requireBranchScope validates User but not Branch. Academic/enrollment/Room/timetable services already apply active-Branch checks. Decide historical-read exceptions explicitly; an inactive Branch must not accept operational writes.

### SEC-03 — P1: dashboard bypasses granular view-grant revocation

Retain dashboard permission but remove finance.view, attendance.view and principal.safety.view. Dashboard still returns one invoice, one attendance record and one alert. Approval visibility already has a separate guard; the other blocks do not. Define the composite-dashboard permission contract, then withhold unauthorized blocks. Broad default role grants do not justify ignoring revocation.

### SEC-04 — P1: published-only notice contract is inconsistent

Same-Branch draft and future-published notices each return **200** through detail. Detail filters only ID/Branch; list filters status/expiry but not future publishedAt. Frontend describes and types published notices. This is not foreign-Branch leakage, but it exposes unpublished content relative to the advertised contract. Apply one explicit Principal publication/expiry policy to list/detail without inventing author privileges.

### SEC-05 — P1: permission catalog/presentation drift

Twenty backend Principal grants are absent from its frontend role map: assigned_work.manage; students.view/create/update; dashboard/approvals/tasks/safety grants; teachers.view/create/update; attendance.view/manage; exams.view/manage; results.view; finance.view; reports.view. No frontend-only grant was found. Some constants exist but are not assigned to Principal; others are unused by current UI. This is drift, not evidence that all twenty actions should be exposed.

Actual Teacher provisioning is SA-only despite legacy Principal create/update grant names. Internal Student admission checks enrollment.manage, while students.create is not used by an admission endpoint. Reconcile ownership/gates before adding APIs; do not broaden Teacher/SA privileges to satisfy a card.

### Forged-request matrix

| Boundary | Evidence/result |
| --- | --- |
| Foreign Student enrollment/detail | Existing enrollment suite, isolated final 58/58; persisted own-Branch scope |
| Arbitrary enrollment ID/revision/parent | Lifecycle/period/idempotency tests deny invalid references and stale actions |
| Foreign Teacher/TeacherAssignment | Assignment 20/20; provisioning 28/28 includes Principal denied SA creation |
| Foreign Room mutation / invalid scheduling Room | Catalog 57/57 and timetable 91/91 |
| Foreign timetable/Class, wrong Section/ClassSubject | Catalog/foundation/curriculum/timetable suites pass |
| Arbitrary unassigned Teacher | Timetable exact-assignment mismatch denied |
| Unauthorized/self/over-limit/delegated approval | Authority 47/47; commit races remain separately reproduced |
| Role/session revoked before next request | Persisted-auth tests deny; does not cover changes during commit |
| Actor transferred during generic write | **FAIL**, approval/task commit reproduced |
| Inactive Branch operational write | **FAIL**, task creation reproduced |

No protected Student-create endpoint exists to certify. Absence is a workflow gap, not a passed creation-security test.

## E. Student Administration findings

- **Can Principal create Student? No, through the app/API.** No create route/controller/screen exists. Internal createStudent requires an existing active same-Branch student User, active period-backed Class/Section and admission actor; it transactionally creates Student plus initial StudentEnrollment. Reuse this foundation rather than inventing another enrollment model.
- **Can Principal edit Student? No complete identity-edit workflow.** Enrollment does not expose guardian/contact/birth/profile updates.
- **Can Principal enroll existing Student? Yes.** Scoped search/list, detail/history, active targets, confirmation and idempotency exist.
- **Can Principal change Class/Section? Section transfer yes, within same active period and Class.** Same-period Class transfer is rejected. Promotion moves from a closed/archived prior period to a later active target and cannot substitute for moving Class midyear.
- **Identity separated from placement? Yes.** User login and permanent Student remain; StudentEnrollment owns period/Class/Section/status/history. Compatibility placement fields do not override managed enrollment history. Withdrawal retains identity and prior academic data.
- **Discoverable? Existing enrollment yes, through the drawer. Admission/editing is absent.** A protected admission must orchestrate identity → Student → initial enrollment with exact parent validation, without collapsing the records.

Public auth/register creates a student User in an active Branch, not a Student admission/enrollment. It does not escalate to Principal/Teacher, and it is not a replacement for protected Principal admission. Full applicant/review/rejection Admissions is a separate product decision.

## F. Academic Administration findings

The chain exists: **SA-governed active Period → Principal Class → Section → Subject/ClassSubject → current TeacherAssignment → active Room → full draft → approval**. Current catalog/Room/timetable suites pass. Principal cannot bootstrap AcademicPeriod by design; UI explains the SA dependency.

Legacy Classes are read-only pending explicit migration. Physical Room management is implemented. Room deactivation blocks any retained canonical schedule/substitution reference. Times remain HH:mm, weekdays 0–6, school civil dates and configured school timezone. No new schedule/time model is needed.

Missing: cross-tool readiness guidance and operational exceptions. Preserve current canonical services, selectors, guards, errors and transaction fences; do not build another catalog.

## G. Teacher Administration findings

Principal selects active Branch Teachers, creates/revokes exact assignments and reads assignment history/future/expired states. Timetable eligibility must remain the exact current Branch/Class/Section/Subject responsibility with account/catalog checks.

A full directory/profile/account-status surface is absent. Account provisioning is global SA-owned. Reconcile legacy Principal grant names with that policy instead of bypassing the SA service. Assignment changes use revoke/replacement rather than editing historical records. Future-only timetable planning is intentionally unsupported.

Prior October 22 database findings are historical evidence only. This audit did not re-read that database or assert current staff configuration.

## H. Timetable and substitution findings

Master scheduling is the strongest completed management workflow: context-first selectors, canonical Room, staged edit/remove, draft save, explicit review/approval, immutable revision, per-date winner, unsaved guards and server Teacher/Class/Section/Room overlaps. **91/91 tests pass. Do not rewrite it.**

Gaps: saved draft withdrawal/retirement UI and fallback policy; substitution UI; full effective-occurrence Teacher/Class/Section collisions. Canonical Room substitution conflicts and concurrent reservations already work.

The audit created a valid two-Teacher schedule in different Rooms. It substituted the first period to the second Teacher, already occupied at that time, in a third Room. Creation/approval succeeded. `substitution-evidence.json` records approvalStatus:200. This is separate from the working Room solver. Preserve temporary substitute scope: an active same-Branch replacement need not hold the original master assignment, and a dated duty must not widen general roster access.

## I. Attendance / academic oversight

Teacher attendance uses AttendanceSession, PeriodAttendanceRecord and effective correction/leave history. Home reads older daily Attendance with server-local day boundaries. No bridge or explicit dual-source policy exists. Marked-only percentages do not describe all expected sessions/students. Zero marked and true zero presence require distinct labels. Unmarked must not become absent; media participation must stay separate.

Typed correction/Student leave reviews pass **49/49**. Missing: Branch marked/unmarked/submitted oversight, absence patterns, staffing exceptions and Home drilldown.

Syllabus authoring is SA-owned. Principal lesson review/history and actual delivery coverage are reachable through ApprovalDetail and Lesson History & Coverage; approval does not fabricate delivery. Missing: Branch-wide coverage/homework/quiz/review summaries under explicit read-only scope, not Teacher editing grants.

Result backend passes **39/39**. Publication is separate, but pending approvals are the only normal result entry. Once approved, leaving the screen removes a normal return path to an unpublished result. Add an authorized publication queue/history. Also `current ?? resource.data` retains obsolete local result/capability state after refresh. The UI probe fetched authoritative published state and still displayed Publish Result. This is a reproduced state defect, not a backend authorization bypass.

## J. Approval findings

Real workflows exist:

- Lesson plans: submitted revision, typed review/reason, actual Teacher delivery and coverage.
- Attendance corrections/Student leave: typed current/historical context and revisioned decision.
- Results: typed moderation and explicit Student-visible publication.
- Staff leave: linked leave request with generic approval; Teacher status/history derives from it.
- Supported generic user/student/fee requests: decision/delegation/history, separation of duties, scoped references, policy types/limits and request CAS.

PRINCIPAL_APPROVAL_AUTHORITY is trusted actor+Branch policy. Missing configuration fails closed. The inbox filters unauthorized/unconfigured requests to an empty list, safe for disclosure but poor operational feedback. Expose an authority/configuration capability message without revealing hidden requests or inventing default grants.

Generic approval does not execute refunds/payroll/certificate issuance. UI explicitly says business execution is separate. Paper/purchase enum values are not implemented entities; unsupported reference categories fail closed. Do not call these domains complete merely because an enum/card exists.

Keep stale-request, duplicate and delegation protections while fixing actor/session commit fencing. Only lessons have a normal history list; general resolved-approval history and result publication return paths remain incomplete.

## K. Ranked UI/UX findings

1. **P1:** missing Student admission/profile and result publication return paths prevent core completion.
2. **P1:** Safety failure after successful mutation creates misleading uncertain outcomes/retries.
3. **P1:** result local current state shadows refreshed context/capabilities; reset on record/auth changes and revalidation.
4. **P1/P2:** dashboard/legacy lists retain loaded rows while displaying errors/loading. usePrincipalDashboardData does not clear old sensitive data on missing token, refresh or failed authorization. Newer academic resources do clear data. Standardize Branch/auth changes and denied refresh handling.
5. **P2:** Assignment is a Home management card; Tasks/Safety/Assignments are absent from drawer search. Reuse existing IA; keep Home focused on operational awareness.
6. **P2:** AttendanceReview needs visible cross-platform Back; hardware Back alone is insufficient.
7. **P2:** legacy task/notice/approval queries are unbounded with client search. New catalogs/enrollment are paginated. Approval reference validation/serialization also scales per item.
8. **P2:** missing authority configuration looks like no approvals; timetable/catalog error distinctions are substantially stronger. Do not convert request failures into empty data.
9. **P2:** Home attendance source/denominator is unclear; identity counts differ from enrollment; device/server days differ from school date.
10. **P3:** footer says three screens/all pages; menu tap target is 40×40 and needs platform/device acceptance.

Reuse Hira cards/forms, safe areas, keyboard avoidance, searchable modals and confirmations. No aesthetic redesign is justified. Renderer/source review cannot certify Android/iOS keyboard, hardware Back, VoiceOver/TalkBack, small screens or slow networks.

## L. Backend/API findings

- Reuse canonical Academic Setup/ClassSubject/enrollment/assignment/Room/timetable services; no duplicate catalog/schedule model is needed.
- New academic modules enforce active Branch, persisted actor and transactional references; old Principal operations do not share all guarantees.
- Add protected admission around existing foundations. Identity, Student and initial enrollment need one explicit orchestration/compensation policy. Never accept client createdBy/role/unrestricted Branch authority.
- PrincipalTask tracking and Teacher AssignedWork are separate domains. Principal can create/cancel AssignedWork by API, but its UI creates PrincipalTask. Teacher readers consume AssignedWork, not PrincipalTask. Decide the recipient contract; do not add a third task model.
- Principal school-notice reads exist, school-announcement producer does not. Do not expose Teacher composition by granting Teacher permissions to Principal.
- Enforce publication/expiry consistently and define dashboard subdomain permission composition.
- Retain typed-review transaction/idempotency/history contracts. Generic target CAS is not actor fencing.
- Known build failure remains safety-alert.controller.ts:47 TS2322. It was not fixed. Its runtime false-error consequence is a direct Principal backlog dependency.

## M. Exact test evidence

Original source/tests were not changed to obtain results.

### Existing frontend

Initial 20 suites: **274 PASS / 1 FAIL**. Marks/result-service suites added for the new publication concern: **9 PASS / 0 FAIL**. Unique existing total: **283 PASS / 1 FAIL — 284 tests, 22 suites**.

The failure is a hard-coded route list omitting the already-added Rooms/TimetableAdmin routes. It is a stale expectation, not duplicate navigation. Original file unchanged.

### Existing backend

| Suite | PASS | FAIL |
| --- | ---: | ---: |
| Principal authorization | 47 | 3 |
| Principal writes | 41 | 8 |
| Approval authority | 47 | 0 |
| Academic Setup / Rooms | 57 | 0 |
| Academic Foundation | 15 | 0 |
| ClassSubject | 36 | 0 |
| StudentEnrollment, isolated final rerun | 58 | 0 |
| TeacherAssignment administration | 20 | 0 |
| Timetable / Room / substitutions | 91 | 0 |
| Teacher attendance, original unmodified suite | 0 | 51 |
| Attendance amendments / Principal review | 49 | 0 |
| Academic lesson/syllabus security | 35 | 0 |
| Academic result moderation/publication | 39 | 0 |
| Teacher provisioning role/security | 28 | 0 |
| Communications / AssignedWork | 42 | 0 |
| Staff self-service / leave | 39 | 0 |
| **Final unique existing total** | **644** | **62** |

Initial parallel run: 643 PASS/63 FAIL. One enrollment hook encountered a temporary local Mongo monitor timeout; the unchanged isolated suite passed 58/58. Final totals replace the original run rather than double-counting it.

The 62 remaining failures:

- **51 attendance setup failures:** old schedule fixtures send only Room text; the canonical write contract returns 400 before attendance cases execute. An audit-only copy supplying canonical Room IDs passes **51/51**, with original attendance assertions untouched. This establishes fixture incompatibility, not 51 separate attendance defects. Original suite still needs repair.
- **10 Safety-path failures:** seven Principal-write and three authorization cases reach post-commit serialization failure. Candidate/detail tests containing later action steps fail at that action contract; initial reads should not be described as broken.
- **1 stale permission snapshot:** hard-coded Super Admin expectations predate current catalog/intentional role exclusions. Do not broaden permissions to satisfy it.

### Audit-only red assertions

- Principal boundary/contract probes: **0 PASS / 10 FAIL**, reproducing inactive Branch read/write, subgrant data, three approval commit races, task transfer race, Safety post-commit 500 and draft/future notice visibility.
- Substitution availability probe: **0 PASS / 1 FAIL**, occupied replacement Teacher approved in a different Room.
- Result refresh UI probe: **0 PASS / 1 FAIL**; six copied original tests skipped by the audit name filter. Publish remains after authoritative refresh.

These **12 failing audit assertions** are separate from original-suite totals. They reproduce findings; no application change introduced them. The additional contract-adapted attendance experiment is 51 PASS/0 FAIL and does not turn the unmodified original suite green.

### Static checks and artifacts

- Scoped frontend TypeScript: **PASS**.
- Scoped backend Principal/domain graph TypeScript: **FAIL**, only known safety-alert.controller.ts:47 TS2322.
- Scoped ESLint: **FAIL**, one existing unused catch variable at backend/src/middleware/branch.middleware.ts:58; zero warnings. Exact file list is lint-targets.json. No fixes applied.
- git diff --check: **PASS**.

Artifacts under `.validation-principal-audit/`: frontend-results.json, marks-results.json, backend-results.json, isolated enrollment/attendance logs, probe-evidence.json, substitution-evidence.json, marks-probe-results.json, scoped configs and compiler/lint logs. Copied backend probes are under `backend/.validation-principal-audit/`.

run-backend.cjs records the 16 suite names and writes a TAP log for each. Existing frontend command/output is in frontend.log and marks.log. Backend commands use node --import tsx --test --test-reporter=tap against owned databases. No configured database or ZEGO/media testing was used.

## N. Recommended implementation PR sequence

Proposed scopes only. No PRs or commits were created.

| PR | Priority/dependency | Scope | Required acceptance |
| --- | --- | --- | --- |
| **P-PR1 Authority at commit** | P0, first | Fence generic approval/task actor/session/Branch changes; active-Branch operational gate; review Safety's shared actor helper. Preserve CAS, limits, separation and historical-read policy. | All authority/Branch probes green; foreign IDs denied; no partial unauthorized commits. |
| **P-PR2 Safety response + release signal** | P0/P1 | Return/serialize confirmed Safety state; address known TS gate as a direct dependency. Repair route/permission snapshots, canonical Room attendance fixtures and existing lint issue without broadening roles. | No 500 after committed success; action/history/concurrency green; original attendance cases execute; no masked compile/lint gate. |
| **P-PR3 Student admission/profile** | P1 after authority baseline | Protected own-Branch admission and permanent profile view/edit, initial enrollment reuse; explicit same-period Class-move semantics. | Own-Branch flow works; arbitrary User/Branch/parent/enrollment denied; identity survives withdrawal; safe retries/duplicates. |
| **P-PR4 Result publication completion** | P1 | Return queue for approved/unpublished results; reset local state on refresh/auth/record change; stable operation identity for uncertain retries. | Approve → leave → reopen → publish; authoritative refresh removes obsolete capability; stale requests denied server-side. |
| **P-PR5 Attendance oversight** | P1 | Define daily-vs-period source and school date; expected/marked/unmarked/submitted read model, Branch drilldowns and amendment integration. | Teacher submissions/corrections reflected; unmarked never absent; physical attendance never media participation. |
| **P-PR6 Substitution completion** | P1 | Principal dated-duty UI; effective Teacher/Class/Section conflicts alongside Room; no recommendation engine. | Occupied replacement rejected even in different Room; concurrent proposals safe; scoped dated duty and retirement clear. |
| **P-PR7 Staff/communication handoffs** | P1/P2, ownership first | Branch Teacher directory/status; explicit PrincipalTask/AssignedWork recipient integration; notice visibility; school-announcement ownership decision. | One documented recipient source; no impersonation/cross-Branch account authority; publication visibility tests green. |
| **P-PR8 IA and state hardening** | P2 after endpoints | Drawer/search management destinations, Home exceptions, permission mapping, authority feedback, pagination, old-data clearing and Back. | All supported actions discoverable; errors distinct; Branch/auth switch discards old data; device acceptance. |
| **P-PR9 Branch reports/audit** | P2, explicit report/export scope | Scoped operational report/history read models; narrow export policy, not organization-wide audit powers. | Own Branch only; canonical source/denominator/date labels; permission-checked exports/history. |

P3 later decisions: future-only assignment planning, legacy migration assistance, referenced-resource retirement/archive policy and harmless footer polish. None justifies weakening authority or rewriting completed foundations.

## O. Definition of Done

1. Supported Principal inventory/ownership is accepted against actual PDF/blueprint. Deferred/SA-only domains are explicit, not misleading cards.
2. P0 probes pass with real transactions/competing requests; inactive Branch writes fail; persisted role/session/Branch changes cannot commit unauthorized decisions. All forged reference boundaries remain denied.
3. Protected Student admission/profile and enrollment work end-to-end, keeping identity separate from placement. Missing configuration is actionable.
4. Academic selectors, Rooms, exact assignments, immutable schedules/conflicts/publication remain intact. Substitution UI/availability is complete.
5. Attendance uses documented authoritative source/school date and distinct unmarked/submitted/absent states, with correction/leave drilldown and no media conflation.
6. Typed lessons/results retain real evidence/revision review; unpublished approved results are rediscoverable; refresh/auth/record changes discard obsolete capabilities.
7. Communications/tasks have explicit producer/recipient ownership and publication rules. Supported reports/history/export/notifications are delivered or explicitly excluded.
8. Original relevant suites are green, not merely copied/adapted experiments. Findings have permanent regressions. TS/ESLint/release build gates pass or have explicit owner-approved waivers, never hidden failures.
9. Android/iOS small-screen, keyboard, Back, slow-network, search, confirmation, accessibility and Branch/role-switch acceptance is complete.

No completion percentage is assigned from file/screen counts: that would conceal P0 issues and overstate readiness.

## P. Worktree preservation

A SHA-256 baseline captured **477 existing tracked/relevant untracked files**, including mixed patches and prior reports. All are rechecked unchanged at audit completion. Additions are this report and audit-only scripts/copies/logs under `.validation-principal-audit/` and `backend/.validation-principal-audit/`.

No reset, restore, clean, staging, commit or push. Index remains empty. No source/original test/existing document/configured-database modification. Academic Foundation, ClassSubject, enrollment, assignment, Rooms, timetable, Teacher Home and Live Lesson work is preserved. No implementation PR or media testing started.

## Source evidence index

Evidence IDs link to the inspected source; findings and exact probe outputs are retained in the validation directory.

- **E01:** [src/navigation/PrincipalNavigator.tsx](D:/SchoolManagementSystem/src/navigation/PrincipalNavigator.tsx), [src/screens/principal/PrincipalWorkspaceScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalWorkspaceScreen.tsx).
- **E02:** [backend/src/middleware/auth.middleware.ts](D:/SchoolManagementSystem/backend/src/middleware/auth.middleware.ts), [backend/src/middleware/branch.middleware.ts](D:/SchoolManagementSystem/backend/src/middleware/branch.middleware.ts), [backend/src/middleware/permission.middleware.ts](D:/SchoolManagementSystem/backend/src/middleware/permission.middleware.ts), [backend/src/routes/principal.routes.ts](D:/SchoolManagementSystem/backend/src/routes/principal.routes.ts).
- **E03:** [src/screens/principal/PrincipalDashboardScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalDashboardScreen.tsx), [src/hooks/usePrincipalDashboardData.ts](D:/SchoolManagementSystem/src/hooks/usePrincipalDashboardData.ts), [backend/src/services/principal-dashboard.service.ts](D:/SchoolManagementSystem/backend/src/services/principal-dashboard.service.ts).
- **E04:** [src/screens/admin/AcademicSetupScreen.tsx](D:/SchoolManagementSystem/src/screens/admin/AcademicSetupScreen.tsx), [src/screens/admin/ClassSubjectsPanel.tsx](D:/SchoolManagementSystem/src/screens/admin/ClassSubjectsPanel.tsx), [backend/src/routes/academic-setup.routes.ts](D:/SchoolManagementSystem/backend/src/routes/academic-setup.routes.ts), [backend/src/services/academic-setup.service.ts](D:/SchoolManagementSystem/backend/src/services/academic-setup.service.ts), [backend/src/services/class-subject.service.ts](D:/SchoolManagementSystem/backend/src/services/class-subject.service.ts), [backend/src/services/academic-catalog-lock.service.ts](D:/SchoolManagementSystem/backend/src/services/academic-catalog-lock.service.ts).
- **E05:** [src/screens/admin/RoomsScreen.tsx](D:/SchoolManagementSystem/src/screens/admin/RoomsScreen.tsx), [backend/src/models/room.ts](D:/SchoolManagementSystem/backend/src/models/room.ts), [backend/src/models/timetable.ts](D:/SchoolManagementSystem/backend/src/models/timetable.ts).
- **E06:** [src/screens/admin/TimetableAdminScreen.tsx](D:/SchoolManagementSystem/src/screens/admin/TimetableAdminScreen.tsx), [src/services/admin/timetableAdminService.ts](D:/SchoolManagementSystem/src/services/admin/timetableAdminService.ts), [backend/src/routes/timetable.routes.ts](D:/SchoolManagementSystem/backend/src/routes/timetable.routes.ts), [backend/src/services/timetable-admin.service.ts](D:/SchoolManagementSystem/backend/src/services/timetable-admin.service.ts), [backend/src/services/teacher-timetable.service.ts](D:/SchoolManagementSystem/backend/src/services/teacher-timetable.service.ts), [backend/src/services/school-date.service.ts](D:/SchoolManagementSystem/backend/src/services/school-date.service.ts).
- **E07:** [src/screens/principal/StudentEnrollmentScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/StudentEnrollmentScreen.tsx), [src/services/admin/enrollmentService.ts](D:/SchoolManagementSystem/src/services/admin/enrollmentService.ts), [backend/src/routes/student-enrollment.routes.ts](D:/SchoolManagementSystem/backend/src/routes/student-enrollment.routes.ts), [backend/src/services/student-enrollment.service.ts](D:/SchoolManagementSystem/backend/src/services/student-enrollment.service.ts), [backend/src/services/enrollment-membership.service.ts](D:/SchoolManagementSystem/backend/src/services/enrollment-membership.service.ts), [backend/src/models/studentEnrollment.ts](D:/SchoolManagementSystem/backend/src/models/studentEnrollment.ts).
- **E08:** [backend/src/services/student.service.ts](D:/SchoolManagementSystem/backend/src/services/student.service.ts), [backend/src/services/auth.service.ts](D:/SchoolManagementSystem/backend/src/services/auth.service.ts), [backend/src/models/student.ts](D:/SchoolManagementSystem/backend/src/models/student.ts), [backend/src/models/user.ts](D:/SchoolManagementSystem/backend/src/models/user.ts), [backend/src/routes/auth.routes.ts](D:/SchoolManagementSystem/backend/src/routes/auth.routes.ts), [backend/src/routes/admin.routes.ts](D:/SchoolManagementSystem/backend/src/routes/admin.routes.ts), [backend/src/app.ts](D:/SchoolManagementSystem/backend/src/app.ts).
- **E09:** [src/screens/admin/TeacherAssignmentAdminScreen.tsx](D:/SchoolManagementSystem/src/screens/admin/TeacherAssignmentAdminScreen.tsx), [src/services/admin/teacherAssignmentService.ts](D:/SchoolManagementSystem/src/services/admin/teacherAssignmentService.ts), [backend/src/routes/teacher-assignment.routes.ts](D:/SchoolManagementSystem/backend/src/routes/teacher-assignment.routes.ts), [backend/src/services/teacher-assignment-admin.service.ts](D:/SchoolManagementSystem/backend/src/services/teacher-assignment-admin.service.ts), [backend/src/services/teacher-assignment.service.ts](D:/SchoolManagementSystem/backend/src/services/teacher-assignment.service.ts), [backend/src/services/teacher-scope.service.ts](D:/SchoolManagementSystem/backend/src/services/teacher-scope.service.ts).
- **E10:** [backend/src/routes/admin.routes.ts](D:/SchoolManagementSystem/backend/src/routes/admin.routes.ts), [backend/src/services/teacher-provisioning.service.ts](D:/SchoolManagementSystem/backend/src/services/teacher-provisioning.service.ts), [backend/src/constants/permissions.ts](D:/SchoolManagementSystem/backend/src/constants/permissions.ts), [backend/src/constants/rolePermissions.ts](D:/SchoolManagementSystem/backend/src/constants/rolePermissions.ts), [src/constants/permissions.ts](D:/SchoolManagementSystem/src/constants/permissions.ts).
- **E11:** [backend/src/services/attendance.service.ts](D:/SchoolManagementSystem/backend/src/services/attendance.service.ts), [backend/src/services/teacher-attendance.service.ts](D:/SchoolManagementSystem/backend/src/services/teacher-attendance.service.ts), [backend/src/services/attendance-history.service.ts](D:/SchoolManagementSystem/backend/src/services/attendance-history.service.ts), [backend/src/models/attendance.ts](D:/SchoolManagementSystem/backend/src/models/attendance.ts), [backend/src/models/periodAttendance.ts](D:/SchoolManagementSystem/backend/src/models/periodAttendance.ts).
- **E12:** [src/screens/principal/PrincipalAttendanceReviewScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalAttendanceReviewScreen.tsx), [backend/src/routes/attendance-amendment.routes.ts](D:/SchoolManagementSystem/backend/src/routes/attendance-amendment.routes.ts), [backend/src/services/attendance-amendment.service.ts](D:/SchoolManagementSystem/backend/src/services/attendance-amendment.service.ts).
- **E13:** [backend/src/routes/staff-self-service.routes.ts](D:/SchoolManagementSystem/backend/src/routes/staff-self-service.routes.ts), [backend/src/services/staff-self-service.service.ts](D:/SchoolManagementSystem/backend/src/services/staff-self-service.service.ts), [backend/src/models/staffSelfService.ts](D:/SchoolManagementSystem/backend/src/models/staffSelfService.ts).
- **E14:** [src/screens/principal/PrincipalLessonReviewScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalLessonReviewScreen.tsx), [src/screens/principal/PrincipalApprovalsScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalApprovalsScreen.tsx), [src/screens/principal/ApprovalDetailScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/ApprovalDetailScreen.tsx), [backend/src/routes/academic.routes.ts](D:/SchoolManagementSystem/backend/src/routes/academic.routes.ts), [backend/src/services/lesson-review.service.ts](D:/SchoolManagementSystem/backend/src/services/lesson-review.service.ts), [backend/src/services/syllabus-coverage.service.ts](D:/SchoolManagementSystem/backend/src/services/syllabus-coverage.service.ts).
- **E15:** [src/screens/principal/PrincipalResultModerationScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalResultModerationScreen.tsx), [src/services/principal/resultModerationService.ts](D:/SchoolManagementSystem/src/services/principal/resultModerationService.ts), [backend/src/routes/academic-result.routes.ts](D:/SchoolManagementSystem/backend/src/routes/academic-result.routes.ts), [backend/src/services/academic-result.service.ts](D:/SchoolManagementSystem/backend/src/services/academic-result.service.ts).
- **E16:** [src/screens/principal/PrincipalApprovalsScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalApprovalsScreen.tsx), [src/screens/principal/ApprovalDetailScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/ApprovalDetailScreen.tsx), [src/screens/principal/ApprovalDelegationForm.tsx](D:/SchoolManagementSystem/src/screens/principal/ApprovalDelegationForm.tsx), [backend/src/routes/approval-request.routes.ts](D:/SchoolManagementSystem/backend/src/routes/approval-request.routes.ts), [backend/src/services/approval-request.service.ts](D:/SchoolManagementSystem/backend/src/services/approval-request.service.ts).
- **E17:** [src/screens/principal/PrincipalInboxScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalInboxScreen.tsx), [src/screens/principal/NoticeDetailScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/NoticeDetailScreen.tsx), [backend/src/controllers/school-notice.controller.ts](D:/SchoolManagementSystem/backend/src/controllers/school-notice.controller.ts), [backend/src/services/school-notice.service.ts](D:/SchoolManagementSystem/backend/src/services/school-notice.service.ts).
- **E18:** [backend/src/routes/teacher-communication.routes.ts](D:/SchoolManagementSystem/backend/src/routes/teacher-communication.routes.ts), [backend/src/services/teacher-work.service.ts](D:/SchoolManagementSystem/backend/src/services/teacher-work.service.ts), [backend/src/services/teacher-notice.service.ts](D:/SchoolManagementSystem/backend/src/services/teacher-notice.service.ts), [backend/src/models/assignedWork.ts](D:/SchoolManagementSystem/backend/src/models/assignedWork.ts), [backend/src/models/principalTask.ts](D:/SchoolManagementSystem/backend/src/models/principalTask.ts).
- **E19:** [src/screens/principal/PrincipalTasksScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalTasksScreen.tsx), [src/screens/principal/PrincipalTaskDetailScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalTaskDetailScreen.tsx), [src/screens/principal/AssignPrincipalTaskScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/AssignPrincipalTaskScreen.tsx), [backend/src/controllers/principal-task.controller.ts](D:/SchoolManagementSystem/backend/src/controllers/principal-task.controller.ts), [backend/src/services/principal-task.service.ts](D:/SchoolManagementSystem/backend/src/services/principal-task.service.ts), [backend/src/services/principal-write-access.service.ts](D:/SchoolManagementSystem/backend/src/services/principal-write-access.service.ts).
- **E20:** [src/screens/principal/PrincipalSafetyOverviewScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalSafetyOverviewScreen.tsx), [src/screens/principal/PrincipalSafetyDetailScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/PrincipalSafetyDetailScreen.tsx), [backend/src/controllers/safety-alert.controller.ts](D:/SchoolManagementSystem/backend/src/controllers/safety-alert.controller.ts), [backend/src/services/safety-alert.service.ts](D:/SchoolManagementSystem/backend/src/services/safety-alert.service.ts), [backend/src/services/safety-overview.service.ts](D:/SchoolManagementSystem/backend/src/services/safety-overview.service.ts).
- **E21:** [backend/src/services/approval-authority.policy.ts](D:/SchoolManagementSystem/backend/src/services/approval-authority.policy.ts), [backend/src/services/approval-scope.service.ts](D:/SchoolManagementSystem/backend/src/services/approval-scope.service.ts), [backend/src/models/approvalRequest.ts](D:/SchoolManagementSystem/backend/src/models/approvalRequest.ts).
- **E22:** [backend/src/app.ts](D:/SchoolManagementSystem/backend/src/app.ts), [src/navigation/PrincipalNavigator.tsx](D:/SchoolManagementSystem/src/navigation/PrincipalNavigator.tsx), [backend/src/constants/permissions.ts](D:/SchoolManagementSystem/backend/src/constants/permissions.ts).
- **E26:** [backend/src/routes/teacher-notification.routes.ts](D:/SchoolManagementSystem/backend/src/routes/teacher-notification.routes.ts), [backend/src/services/teacher-notification.service.ts](D:/SchoolManagementSystem/backend/src/services/teacher-notification.service.ts).
