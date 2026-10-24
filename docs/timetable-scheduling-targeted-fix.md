# Timetable scheduling targeted review and fix

## 1. Root cause

Classification **8**: administrative timetable scheduling UI was absent. Backend support for Day/Start/End already existed, but there was no administrative form or API client to expose it. Teacher timetable screens displayed authorized occurrences and did not edit schedules. Neither Principal nor Super Admin navigation registered an administrative scheduling screen.

Commit `178261e` explicitly excluded a timetable editor and administrative history browser (`docs/T-PR3-timetable.md`, introduction and Administrative provisioning section). Its file list added Teacher screens and administrative APIs, not an administrative editor. Later commit `69c3f29` integrated ClassSubject validation. Existing Academic Setup, Teacher Assignment, substitution APIs, timetable services, navigators, dashboards, route types, date controls, and Live Lesson/Home resolvers were inspected before editing. No reusable time picker or alternate admin timetable form was found. App.tsx → AppNavigator selects the inspected role navigators. A running device/bundle was not inspected; source evidence establishes the missing UI independently of deployment freshness.

## 2. Existing architecture

Reused TimetableVersion, TimetablePeriod, TeacherAssignment, ClassSubject and Class → AcademicPeriod. Existing writes create immutable complete-branch draft versions, approve them and retire them. The highest approved version wins separately on each civil date. Overlapping Teacher, Section or Room slots within a version are rejected. Approved substitutions override exactly one occurrence and become inactive when their original version is superseded.

Added only the administrative editor, explicit frontend contract, scoped read endpoints for eligible assignments and complete saved schedules, and navigational entry points. Editing copies a complete version into a new draft; stored periods remain immutable. No schedule schema, occurrence resolver or Live Lesson implementation was changed.

## 3. Role ownership and entry points

Both roles already possess backend `timetable.manage` in `backend/src/constants/rolePermissions.ts`; `timetable.routes.ts` requires authentication, Principal/Super Admin role and that permission. Service authorization reloads the actor from the database. Principal is scoped to their current active branch. Super Admin chooses an active target branch. Frontend permission visibility now mirrors that existing server permission.

- Principal Home → Timetable Scheduling → Manage Timetable.
- Super Admin → Administration → Timetable Scheduling → Manage Timetable.
- Select Teacher and an eligible Class/Section/Subject assignment, then Day, Start Time, End Time and Room.
- Add all periods, set effective dates, save draft, review and approve.
- To change a schedule, use Revise complete schedule, remove/re-add the changed period, save and approve the new version. The UI warns that a version replaces the entire branch schedule for its effective dates and supersedes substitutions bound to older versions.

## 4. Time model and audit

Unchanged canonical persistence:

- `dayOfWeek`: integer 0 Sunday through 6 Saturday.
- `startTime`/`endTime`: exact zero-padded 24-hour `HH:mm` strings, interpreted in `SCHOOL_TIMEZONE` (default `Asia/Karachi`). No browser/device timezone conversion or locale parsing.
- Version `effectiveFrom` inclusive and `effectiveUntil` exclusive: `YYYY-MM-DD` school civil dates; positive range, at most 366 days.
- Start must precede End on the same day. Overnight periods, equal times, AM/PM strings and invalid clocks are rejected.
- Academic Period is resolved through Class.academicPeriodId and validated with active ClassSubject, not duplicated on a new schedule model. The UI displays the selected assignment's Academic Period.

Existing weekday arithmetic uses UTC civil-date arithmetic, not host-local getters. Teacher Home uses the configured school clock and the existing resolver, not the device clock. Live Lesson converts school civil times through its existing round-trip validated `lessonInstant`. Integration verified `2026-10-13 11:10 Asia/Karachi` → `2026-10-13T06:10:00.000Z`. No start-window checks or timing authority changed.

## 5. Files changed by this task

| File | Reason |
| --- | --- |
| backend/src/services/timetable-admin.service.ts | Authorized, branch-scoped options and paginated complete-version reads; explicit Principal cross-branch denial now 403. |
| backend/src/routes/timetable.routes.ts | Register authenticated, permission-gated GET options/versions with query whitelists. Existing mutation contracts retained. |
| backend/tests/teacher-timetable.security.test.ts | Five focused read/scheduling/integration tests; update explicit cross-branch expectation to 403. |
| src/services/admin/timetableAdminService.ts | Typed existing write contract and new reads; project only allowed slot fields. |
| src/screens/admin/TimetableAdminScreen.tsx | Scheduling entry, scoped selectors, day/clocks, complete drafts/revisions, approval, loading/errors/success, duplicate-submit lock and refetch. Reuse Hira controls and AdminDateField. |
| src/constants/permissions.ts | Mirror existing timetable.manage for both admin roles. |
| src/navigation/PrincipalNavigator.tsx | Typed timetable route and registration. |
| src/navigation/SuperAdminNavigator.tsx | Typed timetable route and registration; existing dirty changes retained. |
| src/screens/principal/PrincipalDashboardScreen.tsx | Scheduling entry beside Teacher Assignment; existing dirty changes retained. |
| src/screens/principal/PrincipalWorkspaceScreen.tsx | Connect dashboard entry to timetable route. |
| src/screens/superAdmin/SuperAdminDashboardScreen.tsx | Scheduling entry in Administration; existing dirty changes retained. |
| __tests__/timetable-admin.test.tsx | Eleven focused form/permission/refresh/revision/duplicate/error/time validation cases. |
| __tests__/timetable-admin-service.test.ts | Two exact-payload/read/approval contract cases. |
| docs/timetable-scheduling-targeted-fix.md | This review and validation report. |

Local validation artifacts added under `.validation-timetable-targeted/`: `before.patch`, `before-hashes.json`, `backend-tests.log`, `frontend-tests.log`, `frontend-new-tests.log` (intermediate diagnostic run), `frontend-types.log`, `backend-types.log`, `backend-scoped-types.log`, `eslint.log`, `diff-check.log`, `diff-check-stderr.log`, `baseline-regressions.log`, `test-counts.json`, `preservation.json`, `tsconfig.json`, `backend-scoped-tsconfig.json`, `baseline-loader.mjs`, `format-and-count.cjs`, `preservation.cjs`. These are local evidence/configuration, not application code.

## 6. Live Lesson integration proof

The new integration test uses HTTP scheduling against an owned ephemeral MongoDB replica set with a frozen school clock:

1. Principal creates version 2 with Tuesday 11:10–11:50 and a valid exact Teacher assignment.
2. Before approval, Teacher Home has no current/next occurrence (the previous version's earlier period has ended).
3. Approval succeeds; `/teacher/timetable` returns the new period with exact date/start/end.
4. `/teacher/home` returns that same periodId as `next`; advancing to 11:20 makes it `current`.
5. Existing preview authorization accepts the period/date and returns public provider metadata. The test provider throws if room identity or credential issuance is attempted.

Existing frontend current/next Go Live tests confirm navigation to `TeacherLiveLesson` with only the server periodId/date. Existing preview screen tests pass. Empty/finished Home keeps the safe empty message and disabled Go Live. No fake occurrence, arbitrary room, real provider credential or media testing was introduced. This is automated contract/integration proof, not a claim of device testing.

## 7. Security verification

The existing authentication, current database actor/role checks, server branch scope, active branch, exact TeacherAssignment tuple, active academic catalog/ClassSubject and period checks remain authoritative. Backend conflict validation and version approval/revalidation remain intact. New reads use the same service authority, explicit safe DTOs and branch filters; they expose no passwords, email, audit identity or unrestricted query scope. Principal cross-branch mutation is now explicitly 403; mismatch/unavailable assignment remains concealed 404; malformed time is 400 and schedule conflict is 409. Teacher/Student cannot schedule. New reads also reject Teacher, missing authentication, spoofed fields and foreign Teacher IDs.

## 8. Tests and checks

| Suite/check | Result |
| --- | --- |
| Frontend: timetable-admin, timetable-admin-service, teacher-timetable, teacher-timetable-service, teacher-home, live-room-screen, live-lesson-api | **PASS: 76/76**, 7 suites; includes 13 new tests. |
| Backend teacher-timetable.security | **PASS: 58/58**, including 5 new tests and existing substitution, conflict, timezone, permission and transaction regressions. |
| Backend live-lesson.security | **PASS: 77/77**, using test providers. |
| Backend teacher-home.security | **46 PASS / 1 FAIL** (47 total). |
| Backend principal-authorization.security | **47 PASS / 3 FAIL** (50 total). |
| Backend principal-write.security | **41 PASS / 8 FAIL** (49 total). |
| Combined backend run | **269 PASS / 12 FAIL** (281 total), no skipped/cancelled tests. |
| Pre-change timetable source comparison for the three failing suites | **134 PASS / 12 FAIL** (146 total), identical failure names. Original timetable route/service loaded in memory; worktree untouched. |
| Scoped frontend TypeScript, including both navigators and new tests | **PASS**, zero diagnostics. |
| Scoped backend TypeScript, timetable route/service dependency graph | **PASS**, zero diagnostics. |
| Full backend TypeScript | **FAIL**, only known `safety-alert.controller.ts:47 TS2322`. |
| Scoped ESLint, all 13 changed source/test files | **PASS**, zero errors/warnings. |
| git diff --check | **PASS**. |

The 12 baseline failures are 11 Principal safety-related cases and one Teacher Home attendance pre-marking fixture (409 versus expected 200). That fixture creates a legacy Class without an Academic Period/ClassSubject, while its attendance write now calls requireClassSubject. No unrelated safety/attendance code or fixture was changed. Detailed names and assertions are retained in the logs.

Commands used: frontend `node node_modules/jest/bin/jest.js --runInBand` with the seven named test files; backend `node --import tsx --test --test-concurrency=1` with the five named security suites; workspace/backend TypeScript `--noEmit` with the saved scoped configs; ESLint on the 13 changed source/test files; `git diff --check`. The initial restricted backend runner failed during Windows OS-user lookup; the authorized run with ephemeral MongoDB completed. No production database was accessed.

## 9. Remaining timetable/UI gaps

- Administrative substitution create/approve/retire and timetable retirement remain API-only; this change targets weekly period configuration.
- Go Live discovery remains current school-day only. A tomorrow-only schedule correctly does not become today's current/upcoming occurrence.
- Only currently effective assignments can be scheduled by the existing authority resolver. Creating future-only Teacher assignments does not make them immediately eligible.
- The checked-out changes have not been deployed or verified on a physical device.

## 10. Worktree preservation

Branch remains `feture`. No reset, restore, clean, staging, commit or push. All 61 initially dirty tracked files verified against initial SHA-256 values: 58 unchanged; for the three intentionally extended dirty files, removing only this task's exact inserted lines in memory restores the original hash (with newline normalization when necessary). Existing untracked files were not modified. The index is empty. No ZEGO credentials/client, recording, R2, unrelated attendance or safety source was changed.
