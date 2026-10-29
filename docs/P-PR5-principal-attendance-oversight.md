# P-PR5 — Principal attendance oversight

Workspace: `D:\SchoolManagementSystem`; branch: `feture`. Implementation and closure review: 25 October 2026 (Asia/Karachi).

## A. Verdict

**P-PR5 COMPLETE — PRINCIPAL ATTENDANCE OVERSIGHT CLOSED**

## B. Existing attendance architecture and initial gap reproduction

| Classification | Current-PC finding | Decision |
| --- | --- | --- |
| Current canonical | Approved timetable occurrences, AttendanceSession open/draft/submitted state, PeriodAttendanceRecord explicit marks, AttendanceOperation receipts/history | Preserve and consume |
| Current canonical | StudentEnrollment membership predicate, submitted roster snapshots, effective approved-correction projection, configured school civil date/timezone | Reuse unchanged domain semantics |
| Legacy | Daily Attendance model and getBranchAttendanceSummary helper | Retain data/helper for historical compatibility; remove from Principal operational Home |
| Partial | Principal already had typed attendance-correction/Student-leave review with existing authority and transactional writes | Link to existing screen/service; do not rebuild writes |
| Missing | Branch expected-session workspace, filters/drilldown, exceptions and bounded absence/late pattern visibility | Implement focused read models and Hira screens |
| Broken | Principal Home used legacy daily marks/percentage while Teacher wrote period records | Replace the source and denominator |

Permanent tests were first run against the old application. The overview request returned 404; Home's expected-session count was undefined despite an approved scheduled occurrence. Both failures are retained in `.validation-p-pr5/reproduction.log`. Correct existing Teacher/amendment flows were preserved.

## C. Final source of truth

Principal operational attendance now uses the same approved timetable/version domain as Teacher attendance, joined to AttendanceSession and PeriodAttendanceRecord. Home calls the same Principal attendance summary used by the workspace. It reports expected, submitted, unmarked, in-progress and attention counts, with school date/timezone. It does not calculate a Student percentage from incomplete submissions.

Shared version selection was extracted mechanically from Teacher timetable into `operationalTimetableVersions`; highest approved version per school date wins, with inclusive effectiveFrom and exclusive effectiveUntil. Teacher queries retain their existing behavior. Effective attendance is expressed once as a reusable aggregation projection, also used by the existing effectiveAttendance API, oversight and patterns. Original marks remain immutable after submission.

## D. Expected-session model and statuses

Scheduled mode starts from winning approved timetable periods for the requested weekday, not from existing attendance rows. Therefore periods with no session cannot disappear.

- Unmarked: expected occurrence, no attendance session opened.
- In Progress: an existing open/draft session, not submitted. Missing/null marks remain unmarked.
- Submitted: authoritative session state is submitted.
- Needs Attention: a separate flag, which can overlap any base state. The UI explicitly explains this; submitted + unmarked + in-progress equals expected, while attention is not an additional denominator.

Reliable flags include overdue unsubmitted attendance, partially marked/open rosters, missing eligible roster, invalid academic/curriculum references, unavailable Teacher/assignment, pending correction/leave, approved-leave mismatch, reported timetable issue and a changed responsible Teacher. Detail computes exact roster counts; leave context never silently rewrites marks.

Retired/draft/non-effective timetable versions are excluded from operational expectation. The model has no separate per-period cancellation state; retirement/non-effectiveness uses existing semantics. Approved substitutes supply the current effective Teacher/time/Room. Historical snapshots resolve their recorded substitute instead of a newer replacement.

## E. Principal overview architecture and bounded APIs

Existing Principal drawer or Home -> Attendance -> summary/filters/session cards -> Attendance Session -> existing Attendance Review. Submitted History is a separate view, retaining genuine submitted evidence from approved/retired schedules without adding it to the operational expected-session denominator. Absence & Late Patterns is a focused read screen carrying the selected academic/Teacher scope.

Read-only endpoints under `/principal/attendance`:

- GET `/`: school date, scheduled/history mode, state, Class/Section/Subject/effective Teacher, search and offset; 20 session summaries per page.
- GET `/filters`: searchable own-Branch Class/Section/Subject/Teacher options; 20 per page.
- GET `/occurrences/:periodId`: date/mode and independent roster/history offsets; 50 Students and 20 amendment summaries per page, with aggregate counts and latest 20 save/submission operations.
- GET `/patterns`: inclusive range of at most 31 school dates, academic/Teacher/optional Student scope and offset; 20 Student aggregates per page.

Patterns count absent/late submitted periods, not absent days or predictive risk. Approved corrections are applied. Unsubmitted sessions and unmarked Students do not generate absence. Advanced analytics, trend prediction and BI remain later work.

## F. StudentEnrollment authority

Unsubmitted/no-session rosters use the existing enrollmentMembership predicate: own Branch, correct Class/Section and Academic Period, applicable active membership or valid historical membership interval. Managed Students never fall back to compatibility class/section fields. Legacy placement compatibility applies only to Students without managed enrollment, exactly as before.

A shared predicate builder now also accepts trusted parent-period aggregation bindings, so overview roster-existence flags and detail use the same rules. This changes no lifecycle/eligibility policy. Submitted sessions retain their frozen rosterStudentIds as genuine historical evidence after promotion/withdrawal, with own-Branch Student/User identities. Historical context does not authorize new marking or an amendment write.

## G. Correction and leave integration

Session detail shows paginated correction/leave state and links to the existing PrincipalAttendanceReviewScreen. Link capability requires approval-view permission and existing configured category authority. The existing review endpoint independently validates full authority and current context; oversight permission alone grants no review mutation.

Existing amendment decisions, revision checks, history, original records, downstream intent suppression and transaction fences remain in their original service. Approved corrections update the single effective projection. Approved leave is shown separately; a mismatched absence stays explicit and flagged until the existing correction flow changes it. Focus/refetch after review reloads the session and overview.

## H. School-date semantics

Today is resolved by the backend school-date service using SCHOOL_TIMEZONE (default Asia/Karachi). Requests use validated YYYY-MM-DD school civil dates. Timetable weekday/window selection, enrollment date membership, overdue comparison, Home date labels and pattern ranges use that architecture. Frontend Today sends no device-derived date; it displays the server date/timezone. Timestamps are formatted using the returned school timezone. UTC-boundary and configured-timezone tests are permanent.

## I. Security proof

Every read derives a persisted active Principal and own active Branch, requiring ATTENDANCE_VIEW. HTTP authentication also validates the exact login/session and current persisted role. Teacher, Student and Super Admin cannot use these Principal-only routes. Missing permission, demotion, disable, revoked session and inactive Branch are denied. Forged Branch query fields are rejected; foreign Class/Section/Subject/Teacher IDs are concealed. Section/Class cross-products are checked.

Academic/Teacher/Student names are joined only within the derived Branch. Invalid references yield safe configuration feedback rather than foreign names. DTOs explicitly project needed attendance information; credentials, session state, private reasons, operation fingerprints and full enrollment/profile objects are omitted. GET responses are no-store. No Principal direct-marking endpoint was added.

P-PR5 adds reads; it does not invent write transactions. Existing correction/leave writes retain their secure authority path. No role or management grant was broadened. The frontend adds only the existing attendance.view key to Principal navigation visibility; the server remains authoritative.

## J. Frontend ownership and mobile UI review

Overview, detail, filter options and patterns use the existing generation-guarded resource hook. No local duplicate full attendance record is maintained. Auth/Branch/record boundaries are keyed; filters/date replace the overview resource; refresh clears old operational data; failed refresh leaves no stale roster/review links; late responses cannot restore older states. Home now also clears prior data during refresh and hides data owned by a previous auth context.

Reviewed actual component code and rendered-test behavior: two-column Hira summary cards, vertical wrapping academic/Teacher text, status badges, scrolling card lists, paginated searchable filter dialogs, keyboard-persistent search controls and shared dialog keyboard handling. Native stack headers provide visible Back for overview, detail, patterns and the existing review screen; Android modal Back closes the Hira filter dialog. Safe-area handling reuses DashboardShell and the existing Principal shell.

States distinguish loading, no schedule, no submissions, filtered misses, no pattern marks, missing roster/configuration, permission failure and backend error/retry. A stale read conflict produces safe retry feedback rather than a fabricated empty day. Physical-device/emulator visual certification was not performed and is not claimed.

## K. Hira reuse

Uses DashboardShell, ScreenHeading, SectionCard, StatGrid/StatCard, StatusBadge, Button, AdminDialog, AdminFeedback, AdminDateField, formStyles and existing theme typography/spacing/semantic colors. No attendance theme, UI library, alert framework, desktop table or navigation system was introduced.

## L. Legacy and Live/media policy

Daily Attendance data and the legacy summary helper are retained untouched for historical compatibility and existing tests. There is no automatic migration, deletion, dual write or silent fallback. Principal operational Home no longer calls that helper; repository inspection found no remaining production caller of the legacy summary. Teacher current attendance continues writing only its canonical period model.

LiveLessonPresence and recording/media activity are not inputs to this physical attendance read model. A permanent test creates connected/admitted Live Lesson presence and verifies physical marks remain unmarked, with zero inferred presence/absence and no pattern entry. The current application has no recording-completion model used by this attendance flow; no such inference or integration was added.

## M. Files changed in P-PR5

| File | Reason |
| --- | --- |
| backend/src/services/principal-attendance.service.ts | Scoped canonical overview/detail/filter/pattern read models, roster counts and exceptions |
| backend/src/routes/principal-attendance.routes.ts | Strict Principal-only read API and safe/no-store error handling |
| backend/src/app.ts | Mount the focused attendance read router |
| backend/src/services/timetable-occurrence.service.ts | Shared winning approved-version selection |
| backend/src/services/teacher-timetable.service.ts | Consume the extracted selector without changing Teacher semantics |
| backend/src/services/attendance-effective.service.ts | One reusable effective-correction aggregation shared with existing consumers |
| backend/src/services/enrollment-membership.service.ts | Reuse the same eligibility predicate for correlated overview roster checks |
| backend/src/services/principal-dashboard.service.ts | Replace legacy daily percentage with canonical operational summary; withhold when permission/Branch unavailable |
| backend/src/controllers/principal-dashboard.controller.ts | Prevent cached operational Home data |
| backend/src/models/timetable.ts | Branch/version/weekday calendar query index |
| backend/src/models/attendanceAmendment.ts | Scoped session correction/leave oversight indexes |
| backend/tests/principal-attendance.security.test.ts | Gap reproduction and permanent authority, occurrence, enrollment, counts, amendment, history, pagination, timezone and live-separation matrix |
| backend/tests/principal-authorization.security.test.ts | Update legacy-card expectations to the new canonical/permission-gated contract while preserving authorization assertions |
| src/services/principal/attendanceOversightService.ts | Typed read contracts, encoded filters/pagination and safe error messages |
| src/services/principal/principalService.ts | Canonical optional Home attendance DTO |
| src/screens/principal/PrincipalAttendanceScreen.tsx | Summary, date/context/status/search filters, scheduled/history list and drilldown |
| src/screens/principal/PrincipalAttendanceSessionScreen.tsx | Counts, paginated roster, amendment review links and history |
| src/screens/principal/PrincipalAttendancePatternsScreen.tsx | Small bounded absent/late period-count view |
| src/screens/principal/principalAttendanceUi.tsx | Shared Hira context/status/read-state and paginated filter controls |
| src/screens/principal/PrincipalDashboardScreen.tsx | Canonical counts, server date and Attendance entry; remove misleading percentage |
| src/screens/principal/PrincipalWorkspaceScreen.tsx | Attendance in the existing drawer and Home route wiring |
| src/navigation/PrincipalNavigator.tsx | Three native stack destinations and review Back header |
| src/hooks/usePrincipalDashboardData.ts | Clear stale refresh data and bind resource ownership to auth context |
| src/constants/permissions.ts | Existing attendance.view permission for Principal navigation visibility |
| __tests__/principal-attendance.test.tsx | Mobile component, state, navigation, filter, detail, Home and stale-refresh tests |
| __tests__/principal-attendance-service.test.ts | Read API encoding and sanitized error contract tests |
| __tests__/principal-approval-context.test.tsx | Extend the unique native stack inventory |
| docs/P-PR5-principal-attendance-oversight.md | Architecture decisions, closure re-audit and evidence |
| .validation-p-pr5/* | Owned validation runner/configs/logs/structured results; not application code |

New indexes are established through existing awaited startup index initialization. Queries paginate/project on MongoDB; none materializes an entire Branch attendance collection in application memory. Detail uses server facets for roster counts/pages; patterns skip operational-card joins and aggregate effective submitted marks on the server. Roster existence checks stop at the first eligible identity. No per-Student network/API calls are introduced.

## N. Exact tests and quality checks

Final backend: **1025 PASS, 0 FAIL, 0 skipped across 23 suites**. Final frontend: **701 PASS, 0 FAIL, 0 skipped across 62 suites**. The final Principal attendance subset is **59 PASS, 0 FAIL**. A final combined attendance/enrollment run passed all 116 cases before the additional historical-substitute test; the final isolated attendance run includes that test and all 59 pass. Subset/repeated runs are not added to the totals.

Full backend TypeScript, scoped frontend TypeScript, scoped backend-test TypeScript, scoped ESLint and git diff --check all exited 0. No suppressed failures, disabled assertions or increased test timeouts. Initial red gap reproductions are retained; an early frontend harness failed to locate the native Pressable wrapper, then passed using the rendered accessibility/onPress contract. Its navigation assertion remains in place. ESLint findings were fixed without suppression.

Structured evidence: .validation-p-pr5/backend-final-results.json, frontend-final.json and final-summary.json. Validation uses owned temporary replica sets, not a configured production database.

## O. Broader regression

The required P-PR1 commit-authority, P-PR2 Safety/release, P-PR3 admission/profile, P-PR4 result publication, Principal authorization/writes, approval authority, Teacher attendance, StudentEnrollment, timetable, amendments/leave, Academic Setup, ClassSubject, TeacherAssignment and relevant academic/frontend/navigation suites are included. All passed.

| Backend suite | PASS | FAIL |
| --- | ---: | ---: |
| principal-attendance | 59 | 0 |
| principal-commit-authority | 70 | 0 |
| principal-authorization | 50 | 0 |
| principal-write | 53 | 0 |
| approval-authority | 47 | 0 |
| student-admission | 50 | 0 |
| student-enrollment | 58 | 0 |
| academic-setup | 57 | 0 |
| class-subject | 36 | 0 |
| teacher-assignment-admin | 20 | 0 |
| teacher-timetable | 91 | 0 |
| teacher-attendance | 51 | 0 |
| attendance-amendment | 49 | 0 |
| academic-foundation | 15 | 0 |
| academic | 35 | 0 |
| academic-work | 16 | 0 |
| academic-evidence | 13 | 0 |
| lesson-delivery | 30 | 0 |
| catch-up | 30 | 0 |
| teacher-provisioning | 28 | 0 |
| teacher-communications | 42 | 0 |
| staff-self-service | 39 | 0 |
| academic-result | 86 | 0 |

## P. Remaining Principal gaps

P-PR6 onward only: substitution management/recommendations, Teacher directory, task-recipient redesign, notice redesign, Branch reports and broad Principal information architecture. Only existing effective substitution data is consumed; none of those features was implemented.

## Q. Worktree preservation

No reset, restore, clean, staging, broad staging, commit, push or force operation. The initial mixed worktree included P-PR4 changes in marks/result tests, academic-result service and P-PR4 closure report, plus unrelated principal-task controller/apiClient changes. Those files were not edited by this phase. Existing untracked PC/laptop work was preserved. Branch remains feture. No production database/deployment operation was performed.
