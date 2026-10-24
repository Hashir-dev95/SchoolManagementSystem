# Timetable Class selector targeted fix

## 1. Exact root cause

The first failing layer was the frontend Class-options loader/derivation. Manage Timetable did not request the branch Class catalog. Instead, `TimetableAdminScreen` built Class rows from `options.tuples`, disabled Class until a Teacher was selected, and cleared Class when changing Teacher. Those tuples describe one Teacher's currently effective, exact assignment responsibilities; they are not a Class catalog.

`GET /timetables/options?branchId=...` intentionally returns `tuples: []` without a teacherId. With a Teacher, the service calls getTeacherScope, whose Class query is restricted to assignment classIds; then requireClassSubject removes invalid operational tuples. Existing valid Classes without a selected Teacher/current eligible assignment were consequently absent. This was a misuse of the assignment contract, not evidence of absent MongoDB Classes or an incorrect branch filter.

Two additional defects prevented the required search: tuples supplied className but no Class code, and shared AdminSelect search did not trim leading/trailing whitespace.

## 2. Data-path evidence

Before:

`Manage Timetable → service.options(token, {branchId, teacherId, offset}) → GET /timetables/options → authenticateToken/session/current DB actor → timetable.manage/role/branch scope → optional getTeacherScope → assignment-restricted Class query → {success:true,data:{...,tuples:[{classId,className,...}]}} → response.data → tuples.map({id:classId,label:className}) → AdminSelect search(label/detail) → rendered assignment-only Class rows`.

No independent Class query occurred when Teacher was empty. There was no `_id`/`id`, response nesting, name-field or branch-ID normalization bug. Timetable route params are undefined; Principal branch is server-derived, while Super Admin selects a branch and the keyed editor remounts on a branch change.

After:

`Manage Timetable → branch-keyed classes resource → timetableAdminService.classes → existing academicSetupService.list(token,'classes',{branchId,offset}) → GET /academic-setup/classes?branchId=<canonical-id>&offset=0 → authenticateToken (registered non-revoked session, active DB user/current role) → academic Classes view permission → academicSetupScope → SchoolClass.find({branchId}) → existing catalogDTO → {success:true,data:{items:[{id,name,code,isActive,legacy,academicPeriodId,periodStatus,...}],nextOffset,...}} → existing academicSetupService unwrapping → all pages → derived eligible Class options → label name/code, value id → trimmed case-insensitive search → rendered rows`.

The regression fixture returns existing own-branch `{id:<class8>,name:'Class 8',code:'8',isActive:true,legacy:false,periodStatus:'active'}` plus other branch Classes independently of Teacher selection. A foreign branch Class is excluded. Tests use owned ephemeral MongoDB; no claim is made about the user's production records or device state.

## 3. Class architecture compatibility

Reused the same Academic Setup service/list contract that AcademicSetupScreen uses. No new endpoint, Class model, server query implementation, mirrored local classOptions state or fake record was introduced. The resource is the single catalog source; its derived options use canonical `id`, `name` and optional `code`. All pages are loaded so Classes beyond the first 50 remain searchable. A non-progressing cursor is rejected.

The existing read contract retains inactive/legacy/history records and exposes eligibility metadata. The timetable picker offers active, non-legacy Classes attached to an active Academic Period, consistent with requireClassSubject at the scheduling write boundary. Existing but ineligible records produce a distinct explanation rather than “no Classes configured”. Legacy Classes still require the repository's explicit Academic Period migration; this fix does not weaken that rule.

Class browsing no longer requires a Teacher. Scheduling still requires that Teacher's exact Class/Section/Subject tuple and valid ClassSubject. Changing Class clears Section/Subject. Changing Teacher preserves the independent Class selection and clears Teacher-dependent Section/Subject. Branch changes remount the editor, reload catalog/options and reset selections/draft state. Focus/retry/refresh use the existing generation-guarded resource hook; Refresh timetable and successful writes also refresh the Class catalog.

## 4. Files changed in this follow-up

| File | Purpose |
| --- | --- |
| src/screens/admin/TimetableAdminScreen.tsx | Use independent existing Class catalog; display name/code; keep tuple authority downstream; safe loading, empty, ineligible and error states; refresh/reset behavior. |
| src/services/admin/timetableAdminService.ts | Small paginated adapter to existing academicSetupService.list, preserving its DTO and authentication contract. |
| src/components/hiraDashboard/AdminForm.tsx | Trim search input before existing case-insensitive label/detail matching. Existing unrelated date-field patch preserved. |
| __tests__/timetable-admin.test.tsx | Add 11 regressions covering actual rendered Class search rows, canonical IDs, assignment independence, dependent resets, failure/loading/empty/ineligible states and branch changes; supply catalog fixtures to existing tests. |
| __tests__/timetable-admin-service.test.ts | Add 2 tests for existing endpoint/DTO, all-page loading, URL/auth scope, propagated errors and invalid pagination. |
| backend/tests/teacher-timetable.security.test.ts | Add 3 API regressions for existing Class catalog DTO, Principal/Super Admin branch authority and retained eligibility metadata; existing tests unchanged. |
| docs/timetable-class-selector-fix.md | This trace, architecture and validation report. |

Local snapshots, logs, preservation checks and the verification script are retained under `.validation-timetable-class/`; the previous task's report and validation artifacts were preserved.

## 5. Search behavior

Class rows display `Class 8 — G8` when a code is available. Real rendered AdminSelect tests search `Class 8`, `G8`, mixed-case `cLaSs 8`, and surrounding-whitespace `  g8  `, then click the rendered Class row and assert canonical value `c`. Unrelated rows are filtered out. Selection never stores display labels as IDs.

Loading is distinct from configured-empty. Catalog 401/403 produces an authorization message; other failures produce a safe retry message and never masquerade as “No Classes configured”. Raw server diagnostics are not displayed. A successful empty catalog and an existing but entirely ineligible catalog have separate messages.

## 6. Security

No backend implementation or permission was changed. Principal reads are constrained by the current DB actor's branch; requesting another branch is denied with the existing concealed 404 contract. Super Admin must supply an explicit valid active target branch. Missing authentication is 401 and Teacher access is 403. Existing active-period/ClassSubject/TeacherAssignment validation remains authoritative at timetable creation/approval. Showing a catalog Class never grants scheduling authority.

No Live Lesson, ZEGO, T-PR15, recording, R2, attendance or safety source was changed.

## 7. Tests and checks

| Check | PASS | FAIL |
| --- | ---: | ---: |
| Timetable admin frontend UI/service (22 UI + 4 service) | 26 | 0 |
| Academic Setup and Teacher Assignment frontend UI/service | 63 | 0 |
| Total frontend: 6 suites | 89 | 0 |
| Backend teacher-timetable.security | 61 | 0 |
| Backend academic-foundation.security | 15 | 0 |
| Backend academic-setup.security | 49 | 0 |
| Backend class-subject.security | 36 | 0 |
| Total backend: 4 test files | 161 | 0 |

Scoped frontend TypeScript (including new tests/navigator dependency graph): PASS, zero diagnostics. Scoped backend timetable dependency graph TypeScript: PASS, zero diagnostics. Scoped ESLint on all six modified source/test files: PASS, zero errors/warnings. `git diff --check`: PASS. Full backend release compilation was not claimed; the prior known safety release gate remains outside this task.

Commands: `node node_modules/jest/bin/jest.js --runInBand --testTimeout=20000` with timetable-admin, timetable-admin-service, academic-setup, academic-setup-service, teacher-assignment-admin and teacher-assignment-service tests; `node --import tsx --test --test-concurrency=1` with the four backend test files above; TypeScript `--noEmit` using the existing saved scoped configs; scoped ESLint; `git diff --check`. An initial frontend run caught an accidental duplicate service insertion and incorrect new renderer selectors; both were corrected before the final passing run. The longer CLI timeout avoids cold-run native-module initialization timing out existing tests.

## 8. Worktree preservation

Branch remains `feture`. All 67 snapshotted files outside the six targeted edits match their initial SHA-256 hashes. In-memory comparison confirms the shared AdminForm differs from its starting content only by the search trim, and the backend test file differs only by the three inserted regressions. Original snapshots of the six targeted files are retained for review. No previous validation artifact or unrelated untracked file was changed.

No reset, restore, clean, staging, commit or push. The index remains empty.
