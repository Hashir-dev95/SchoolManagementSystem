# Phase C: Student canonical read workspace

## Endpoint/data-source map (inspection before implementation)

| Slice | Existing canonical authority | Existing Student read | Integration decision |
| --- | --- | --- | --- |
| Identity | authenticated persisted User → Student.userId | No self-profile route; StudentNavigator has only live lessons | Add GET /api/student/me |
| Placement | StudentEnrollment active, effectiveFrom/effectiveTo; AcademicPeriod, SchoolClass, Section, Branch | Administrative /api/students routes, not Student self-service | Add GET /api/student/me/enrollment; no legacy profile placement fallback |
| Timetable | operationalTimetableVersions, TimetablePeriod, SubstituteAssignment, effectiveTimetableOccurrence | Teacher and Principal reads only | Add GET /api/student/me/timetable?date=YYYY-MM-DD derived from enrollment |
| Physical attendance | AttendanceSession, PeriodAttendanceRecord, effectiveAttendanceStages | Teacher/Principal reads; legacy daily Attendance is not the period authority | Add GET /api/student/me/attendance?date=YYYY-MM-DD, separate from participation/completion |
| Homework/quiz | AcademicWorkAudience, published Homework/Quiz, academic-work.service | /api/student/academic-work and detail routes | Reuse canonical safe DTO readers behind stricter current-enrollment and own-student entitlement checks |
| Results | AcademicResult, academic-result.service publication/revision policy | /api/student/results and detail | Reuse canonical published-result readers behind strict self-scope gate |
| Fees | Fee and branch-level getBranchFeeSummary | No canonical Student ledger/challan/payment-summary API | NOT INTEGRATED — awaiting canonical Finance phase |

Canonical models have no separate School entity/schoolId. School isolation is the existing single-school deployment/database boundary; persisted active Branch and complete enrollment reference validation are the within-deployment authority. Do not invent a new tenant model. Cross-school identifiers supplied by clients are rejected, not used to select scope.

## Donor reference decisions

Inspected faraz-audit StudentDashboard.jsx, StudentFeesPage.jsx, studentService.js, studentDashboardUtils.js, previewData.js and HiraHome.jsx directly through Git. ADAPT NOW: profile/enrollment summary, pane selection, timetable/physical attendance cards, assigned homework/quiz read cards, published result cards and honest load/error/empty states using canonical Hira UI. DUPLICATE: donor cards/hero/theme/buttons (use Phase B components). LATER: submissions, quiz attempts, applications, progress, transport, resources and other feature APIs. REJECT: donor authService/authSession/sessionStorage/apiConfig, server runtime, identity contracts, profile class placement, legacy timetable/attendance/results, fees/payment calculations and preview-data fallbacks.

Production reads must never accept a Student/class/section/branch/school selection. JWT/session middleware and persisted User are retained. Missing/inconsistent current enrollment fails closed; history is never modified. Existing canonical academic write APIs are not exposed by this read workspace. Fees display the explicit blocker rather than fictional amounts.

## Implemented authority and contract

- `student-self-scope.service.ts` reloads persisted active User through currentAcademicActor, validates Student role and active Branch, resolves active Student via userId + persisted Branch, requires exactly one current StudentEnrollment and checks every Branch/Class/Section/AcademicPeriod reference. It never reads legacy Student.classId/sectionId for placement and never changes enrollment history.
- New routes are owned by `student-self.routes.ts`, mounted at `/api/student/me`. Canonical JWT verification, registered-session/revocation checks and role middleware remain unchanged. Every new route applies self-scope validation; unsupported identity/scope query/body/path selections are 403. Inactive/changed/revoked sessions retain canonical 401 semantics.
- Profile and enrollment: GET `/api/student/me` and `/api/student/me/enrollment`.
- Timetable and physical attendance: GET `/api/student/me/timetable` and `/api/student/me/attendance`; optional server-validated `date` query. The UI shows today using the server's school date. Reads require current enrollment and do not reach dates before that enrollment began. Approved winning timetable versions, exact-date substitution overlays, active same-Branch teacher/subject and ClassSubject references are checked. Physical marks use submitted AttendanceSession roster/revision + only the actor's PeriodAttendanceRecord and effectiveAttendanceStages. Draft/missing marks never become absence. Retired-schedule history is not implemented by this daily workspace.
- Academic reads: GET `/api/student/me/homework`, `/quizzes`, and own `/homework/:id`, `/quizzes/:id`. Canonical academic-work DTOs are filtered by the actor's exact Student + User audience entitlement, current enrollment tuple/academic year, published status and matching published revision. Quiz metadata obeys canonical availability windows. No answer keys or submission/attempt controls are returned.
- Results: GET `/api/student/me/results` and `/results/:id` reuse listStudentResults/getStudentResult and their canonical publication, recipient, revision and historical-membership policy after the strict current-enrollment gate. Only safe Student DTOs and released feedback are returned; no Teacher private notes or moderation history. Guessed foreign/unpublished result IDs return 403 through the new self contract.
- Existing academic/evidence/catch-up/live APIs retain their established owners and compatibility policies. This phase adds strict workspace read contracts; it does not globally rewrite legacy compatibility in existing endpoints or replace canonical write workflows.

## Frontend and slice status

`StudentNavigator → StudentWorkspaceScreen → studentWorkspaceService → /api/student/me/...` is the production path. StudentWorkspace becomes the initial route; both existing live-lesson routes are retained. Canonical shared UI is reused without importing donor assets/theme/services. Preview adapters and their sample fixtures are unchanged.

| Slice | Status | Delivered boundary |
| --- | --- | --- |
| Profile | INTEGRATED | Persisted self identity and admission number |
| Enrollment | INTEGRATED | Branch/Class/Section/current AcademicPeriod from StudentEnrollment |
| Timetable | INTEGRATED | Today's authorized approved occurrences and effective Teacher; no weekly/history UI |
| Attendance | INTEGRATED | Today's own submitted effective physical marks; unmarked/in-progress distinct; no participation/completion metric or retired-history UI |
| Homework | PARTIAL | Current assigned published read-only title/instructions/due date; no submission UI |
| Quiz | PARTIAL | Assigned available published metadata/instructions; no questions/answers/attempt UI |
| Results | INTEGRATED | Canonical safe published results and released feedback, including legitimate history allowed by the canonical result policy |
| Fees | BLOCKED | NOT INTEGRATED — awaiting canonical Finance phase |

Submission/attempt services already exist canonically, but their frontend write flows and end-to-end eligibility/retry behavior are not integrated or certified by this read-workspace phase. This is a boundary on completion, not a claim that all existing write services are unsafe. No donor submission/payment implementation was adopted.

Production loading, empty, 401/session, 403/forbidden and network/error-retry states are explicit. No preview fallback is possible. Requests are invalidated on pane/session changes and private Student state is remounted for a different User. Sign out calls canonical logout. Parent/Finance integration is not started.

## Security and regression evidence

New backend tests: **36 passed** across self-profile/enrollment (17), occurrence/attendance (8), academic/publication (11). They cover successful own reads, query/body/URL Student selection, foreign Branch membership, inactive/changed identity, missing/future/ambiguous enrollment, stale profile placement, wrong Section references, direct-service identity tampering, winning approved schedules, exact substitutions, unmarked/draft physical attendance, only own marks with corrections, audience Student/revision corruption, unauthorized/draft homework, quiz answer concealment, draft/pending/approved-but-unpublished results, foreign published results, publication-revision mismatch and private-note exclusion.

Because the canonical schema has no School model, schoolId injection denial is tested as rejection of unsupported tenant selection; this is not a claim of newly implemented multi-school row isolation. No second tenant model was introduced.

Broader backend regression: **289 passed, 0 failed**, using the repository's existing tsx/node:test security runner and isolated ephemeral MongoDB replica sets. Included suites: student-self, student-occurrence, student-academic-read, academic-work, academic-result, teacher-timetable, principal-attendance. No production database was used.

Frontend Jest: **88 passed, 0 failed**, 10 suites. Includes 18 new Student service/screen/navigation checks and unchanged Developer Preview, auth-session, Teacher navigation, shared tabs, academic/timetable navigation and Principal attendance/substitution regressions. Positive quiz/result rendering, self-only service paths, loading/error/forbidden/retry, honest empty states, fee blocker, canonical logout/live navigation and stale-response isolation are covered. All six Developer Preview destinations remain covered. SA/Principal/Teacher navigator files, AuthProvider, API client, models and preview files are unchanged; runtime role screens use the existing navigation tests/mocks rather than a newly claimed physical-device smoke test.

## Static checks and repository discipline

- Backend source TypeScript: PASS, zero diagnostics.
- Mobile source/frontend-test TypeScript: PASS, zero diagnostics.
- Root TypeScript: 85 existing diagnostics on both pre-Phase-C commit `69ec2b87b66e6bce278a9712bc36783149b8ca22` and the new worktree; zero introduced. Baseline comparison used virtual HEAD-source substitution and excluded newly added roots without changing the working tree.
- ESLint for all Phase C changed/new TS/TSX: PASS, zero errors/warnings.
- `git diff --check`: PASS.
- No dependencies, native assets/configuration or lockfiles changed; Android native rebuild was not required/run for this phase.
- Validation logs/configs/scripts stay in the existing locally excluded `.validation-principal-audit/phase-c/` directory. No broad staging, merge, branch switch, reset, clean, push or unrelated role/domain refactor.

Local commits separate identity/enrollment, timetable/attendance, assigned/published academic reads and frontend workspace/report. No push is authorized.
