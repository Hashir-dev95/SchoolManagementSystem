# Principal audit checkpoint review

Review date: 29 October 2026. Branch: feture. Local checkpoint only.

## Audit state

| Phase | State | Evidence |
|---|---|---|
| P-PR1 | CLOSED | Committed commit-authority closure report and permanent race tests |
| P-PR2 | CLOSED | Committed safety/release closure report and tests |
| P-PR3 | CLOSED | Committed admission/profile closure report and tests |
| P-PR4 | CLOSED | Result publication closure plus pending Branch-scoped Subject lookup and security/UI follow-up tests |
| P-PR5 | CLOSED | Attendance oversight closure; period-session model, effective corrections and enrollment history |
| P-PR6 | IMPLEMENTED BUT NEEDS REVALIDATION | Workflow and permanent tests exist; closure report has no final verdict/counts. Checkpoint does not close the phase |

## Product alignment

No original School App/MVP PDFs are available in this checkout. docs/principal-production-audit.md explicitly records the same missing-PDF limitation. Direct PDF parity is unverified. The reviewed changes fit the repository blueprint Principal responsibilities, academic setup, attendance, result and security workflows.

P-PR5 uses approved timetable occurrences joined to AttendanceSession/PeriodAttendanceRecord and effective corrections, preserving submitted history. Unmarked is distinct from absent. There is no fallback to legacy daily attendance in the new oversight domain.

P-PR6 retains TeacherAssignment as permanent responsibility and SubstituteAssignment as dated occurrence overlay. Candidates and commits validate own Branch and academic references on the server. Clock overlap checks cover Teacher, Section and Room; shared Branch transaction fences serialize writes. Temporary evidence authority expires by school date; historical read visibility remains intentional. The established T-PR3 contract permits temporary duty without a permanent exact Subject assignment. No new assignment or role is created. Full phase closure is not asserted by this checkpoint.

## Path classification

Each initially dirty/untracked status path is classified below. Directory rows cover every descendant; generated logs are listed individually where Git reported them individually.

| Path | Category / decision |
|---|---|
| __tests__/marks.test.tsx | B tests |
| __tests__/principal-approval-context.test.tsx | B tests |
| backend/src/app.ts | A source |
| backend/src/controllers/principal-dashboard.controller.ts | A source |
| backend/src/controllers/principal-task.controller.ts | G: no content diff (metadata/line-ending-only status); excluded untouched |
| backend/src/models/attendanceAmendment.ts | A source |
| backend/src/models/timetable.ts | A source |
| backend/src/routes/timetable.routes.ts | A source |
| backend/src/services/academic-result.service.ts | A source |
| backend/src/services/attendance-effective.service.ts | A source |
| backend/src/services/enrollment-membership.service.ts | A source |
| backend/src/services/lesson-delivery.service.ts | A source |
| backend/src/services/principal-dashboard.service.ts | A source |
| backend/src/services/teacher-attendance.service.ts | A source |
| backend/src/services/teacher-timetable.service.ts | A source |
| backend/src/services/timetable-admin.service.ts | A source |
| backend/tests/academic-result.security.test.ts | B tests |
| backend/tests/principal-authorization.security.test.ts | B tests |
| backend/tests/teacher-timetable.security.test.ts | B tests |
| docs/P-PR4-result-publication-closure.md | C closure documentation |
| src/constants/permissions.ts | A source |
| src/hooks/usePrincipalDashboardData.ts | A source |
| src/navigation/PrincipalNavigator.tsx | A source |
| src/screens/admin/TimetableAdminScreen.tsx | A source |
| src/screens/principal/PrincipalDashboardScreen.tsx | A source |
| src/screens/principal/PrincipalWorkspaceScreen.tsx | A source |
| src/services/api/apiClient.ts | G local LAN override |
| src/services/principal/principalService.ts | A source |
| .gradle-user/ | E local tooling |
| .validation-academic-foundation/ | D generated |
| .validation-academic-history/ | D generated |
| .validation-academic-setup-fix/ | D generated |
| .validation-as-pr1/ | D generated |
| .validation-as-pr2/ | D generated |
| .validation-as-pr3/ | D generated |
| .validation-assignment/ | D generated |
| .validation-checkpoint/ | D generated |
| .validation-git-transfer/ | D generated |
| .validation-home-fixes/ | D generated |
| .validation-home/ | D generated |
| .validation-p-pr1/ | D generated |
| .validation-p-pr2/ | D generated |
| .validation-p-pr3/ | D generated |
| .validation-p-pr4-completion/ | D generated |
| .validation-p-pr4/mongo-10092.log | D generated |
| .validation-p-pr4/mongo-1012.log | D generated |
| .validation-p-pr4/mongo-10180.log | D generated |
| .validation-p-pr4/mongo-10216.log | D generated |
| .validation-p-pr4/mongo-10312.log | D generated |
| .validation-p-pr4/mongo-10328.log | D generated |
| .validation-p-pr4/mongo-10944.log | D generated |
| .validation-p-pr4/mongo-11216.log | D generated |
| .validation-p-pr4/mongo-11288.log | D generated |
| .validation-p-pr4/mongo-11332.log | D generated |
| .validation-p-pr4/mongo-11460.log | D generated |
| .validation-p-pr4/mongo-11500.log | D generated |
| .validation-p-pr4/mongo-1164.log | D generated |
| .validation-p-pr4/mongo-11832.log | D generated |
| .validation-p-pr4/mongo-11952.log | D generated |
| .validation-p-pr4/mongo-11964.log | D generated |
| .validation-p-pr4/mongo-12224.log | D generated |
| .validation-p-pr4/mongo-12264.log | D generated |
| .validation-p-pr4/mongo-12316.log | D generated |
| .validation-p-pr4/mongo-12636.log | D generated |
| .validation-p-pr4/mongo-12676.log | D generated |
| .validation-p-pr4/mongo-12844.log | D generated |
| .validation-p-pr4/mongo-12860.log | D generated |
| .validation-p-pr4/mongo-13128.log | D generated |
| .validation-p-pr4/mongo-13236.log | D generated |
| .validation-p-pr4/mongo-1328.log | D generated |
| .validation-p-pr4/mongo-13316.log | D generated |
| .validation-p-pr4/mongo-13560.log | D generated |
| .validation-p-pr4/mongo-13576.log | D generated |
| .validation-p-pr4/mongo-13584.log | D generated |
| .validation-p-pr4/mongo-1436.log | D generated |
| .validation-p-pr4/mongo-14400.log | D generated |
| .validation-p-pr4/mongo-14548.log | D generated |
| .validation-p-pr4/mongo-14764.log | D generated |
| .validation-p-pr4/mongo-15088.log | D generated |
| .validation-p-pr4/mongo-15184.log | D generated |
| .validation-p-pr4/mongo-15216.log | D generated |
| .validation-p-pr4/mongo-15292.log | D generated |
| .validation-p-pr4/mongo-1584.log | D generated |
| .validation-p-pr4/mongo-1760.log | D generated |
| .validation-p-pr4/mongo-1804.log | D generated |
| .validation-p-pr4/mongo-1900.log | D generated |
| .validation-p-pr4/mongo-2104.log | D generated |
| .validation-p-pr4/mongo-2336.log | D generated |
| .validation-p-pr4/mongo-2364.log | D generated |
| .validation-p-pr4/mongo-2464.log | D generated |
| .validation-p-pr4/mongo-2728.log | D generated |
| .validation-p-pr4/mongo-2980.log | D generated |
| .validation-p-pr4/mongo-2996.log | D generated |
| .validation-p-pr4/mongo-3024.log | D generated |
| .validation-p-pr4/mongo-3084.log | D generated |
| .validation-p-pr4/mongo-3104.log | D generated |
| .validation-p-pr4/mongo-3188.log | D generated |
| .validation-p-pr4/mongo-3408.log | D generated |
| .validation-p-pr4/mongo-3460.log | D generated |
| .validation-p-pr4/mongo-4316.log | D generated |
| .validation-p-pr4/mongo-5264.log | D generated |
| .validation-p-pr4/mongo-5280.log | D generated |
| .validation-p-pr4/mongo-5612.log | D generated |
| .validation-p-pr4/mongo-5724.log | D generated |
| .validation-p-pr4/mongo-5848.log | D generated |
| .validation-p-pr4/mongo-6180.log | D generated |
| .validation-p-pr4/mongo-6288.log | D generated |
| .validation-p-pr4/mongo-6724.log | D generated |
| .validation-p-pr4/mongo-6784.log | D generated |
| .validation-p-pr4/mongo-6996.log | D generated |
| .validation-p-pr4/mongo-7172.log | D generated |
| .validation-p-pr4/mongo-8004.log | D generated |
| .validation-p-pr4/mongo-8256.log | D generated |
| .validation-p-pr4/mongo-8284.log | D generated |
| .validation-p-pr4/mongo-8448.log | D generated |
| .validation-p-pr4/mongo-8880.log | D generated |
| .validation-p-pr4/mongo-9092.log | D generated |
| .validation-p-pr4/mongo-9132.log | D generated |
| .validation-p-pr4/mongo-928.log | D generated |
| .validation-p-pr4/mongo-9328.log | D generated |
| .validation-p-pr4/mongo-9332.log | D generated |
| .validation-p-pr4/mongo-9352.log | D generated |
| .validation-p-pr4/mongo-9392.log | D generated |
| .validation-p-pr4/mongo-9408.log | D generated |
| .validation-p-pr4/mongo-944.log | D generated |
| .validation-p-pr4/mongo-9828.log | D generated |
| .validation-p-pr4/mongo-9832.log | D generated |
| .validation-p-pr4/mongo-9868.log | D generated |
| .validation-p-pr4/tmp/tsx-Laptop Valley/ | D generated |
| .validation-p-pr5/ | D generated |
| .validation-p-pr6/ | D generated |
| .validation-pr7/ | D generated |
| .validation-principal-audit/ | D generated |
| .validation-rooms/ | D generated |
| .validation-timetable-audit/ | D generated |
| .validation-timetable-class/ | D generated |
| .validation-timetable-targeted/ | D generated |
| .validation-timetable-teacher/ | D generated |
| .validation-tpr14/ | D generated |
| .validation-tpr15-final/ | D generated |
| .validation-tpr15a/ | D generated |
| .validation-tpr15b/ | D generated |
| .validation-tpr15c/ | D generated |
| .validation-tpr8/ | D generated |
| .vscode/ | E local tooling |
| __tests__/principal-attendance-service.test.ts | B tests |
| __tests__/principal-attendance.test.tsx | B tests |
| __tests__/principal-substitution-service.test.ts | B tests |
| __tests__/principal-substitutions.test.tsx | B tests |
| backend/.validation-principal-audit/ | D generated |
| backend/src/routes/principal-attendance.routes.ts | A source |
| backend/src/services/principal-attendance.service.ts | A source |
| backend/src/services/principal-substitution.service.ts | A source |
| backend/src/services/timetable-occurrence.service.ts | A source |
| backend/tests/principal-attendance.security.test.ts | B tests |
| backend/tests/principal-substitution.security.test.ts | B tests |
| docs/P-PR5-principal-attendance-oversight.md | C closure documentation |
| docs/P-PR6-principal-substitution-closure.md | C closure documentation |
| schoolNotice-full.patch | F backup |
| services/ | G empty stray |
| src/screens/principal/PrincipalAttendancePatternsScreen.tsx | A source |
| src/screens/principal/PrincipalAttendanceScreen.tsx | A source |
| src/screens/principal/PrincipalAttendanceSessionScreen.tsx | A source |
| src/screens/principal/PrincipalSubstitutionsScreen.tsx | A source |
| src/screens/principal/principalAttendanceUi.tsx | A source |
| src/services/principal/attendanceOversightService.ts | A source |
| src/services/principal/substitutionService.ts | A source |
| tpr5-staged-backup.patch | F backup |

A source: occurrence-based attendance oversight, effective correction aggregation, enrollment membership, substitution workflow/authority, result Subject Branch scoping, dashboard permission/navigation wiring. B tests: permanent security and UI/service regressions for those domains. C documentation: P-PR4 follow-up, P-PR5 closure and P-PR6 implementation evidence (not a completed closure).

D validation artifacts, E editor/Gradle files, F patch backups, G LAN API address and empty services/principal.service are preserved and excluded. No ignore rules were changed to hide them. A fully clean worktree is incompatible with preserving these excluded dirty files; the checkpoint will leave a clean index and report the remaining worktree explicitly.

The .env.example deletion was not supported by any setup/domain change. Only this tracked template was restored. Real .env was never read or modified.

## Validation

Fresh focused results are recorded after runs finish. Prior P-PR5/P-PR6 logs are corroborating evidence, not counted as fresh checkpoint results. No test assertion or application behavior was changed during checkpoint review.

## Git discipline

Explicit reviewed file paths only. No reset, clean, whole-tree restore, broad staging, Faraz import/merge, push or new Principal phase. Next recommended step, not executed: create/check out a separate local Faraz-Work audit branch from origin/Faraz-Work.

## Fresh checkpoint validation results

| Suite | PASS | FAIL |
|---|---:|---:|
| Result publication security | 86 | 0 |
| Principal attendance security | 59 | 0 |
| Principal substitution security | 30 | 0 |
| Principal authorization security | 50 | 0 |
| Teacher timetable security | 92 | 0 |
| Seven frontend Principal/result/service suites | 92 | 0 |

Backend total: **317 PASS / 0 FAIL / 0 skipped**. Frontend total: **92 PASS / 0 FAIL**. Full backend TypeScript, scoped frontend TypeScript, scoped backend-test TypeScript, scoped ESLint, working diff check and staged diff check passed. Ordinary Git LF/CRLF notices are not whitespace errors. Evidence remains excluded under .validation-checkpoint/.

Checkpoint scope: **46 files: 31 source, 11 permanent tests, 4 documentation**. Commit message: chore: checkpoint principal audit progress. P-PR5 preserved and green; P-PR6 implemented but full closure is not asserted. Missing original PDFs remain a verification limitation.
