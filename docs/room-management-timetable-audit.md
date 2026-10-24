# Room management and timetable integration audit

## A. Executive verdict

**ROOM MANAGEMENT ARCHITECTURE SOUND — TARGETED COMPLETION DONE**

Physical Room management, canonical allocation and server conflict enforcement are implemented using the existing Academic Setup and timetable architecture. All Room-related checks pass. Physical-device acceptance remains outstanding; the unrelated Teacher Home fixture failure and safety TypeScript gate remain unchanged.

## B. Current-state classification

Before this pass: **classification 3 + 4, with compatibility implications from 8** — timetable/substitution text fields and string conflict checks, without a canonical physical Room catalog or management API/UI.

Evidence:

- Repository-wide Room/roomId/classroom/location/venue searches found no physical Room model, catalog endpoint, management screen or navigation destination. Room-named media components belong to a separate realtime domain.
- `backend/src/models/timetable.ts` required immutable `room: string` on periods and substitutions.
- `timetable-admin.service.ts` compared `a.room === b.room` for master schedule overlaps, permitting spelling/case aliases to represent the same physical space.
- Academic Setup kinds were periods/classes/sections/subjects, with no Rooms.
- Commit `178261e` introduced the text-room timetable/substitution architecture. `5688e3f` introduced Academic Setup without Rooms. `aabfec2` concerns media Room integration, not physical resources. No code was reverted.
- Read-only inspection on 22 October 2026 at **17:02:41 Asia/Karachi** found zero physical Room records, zero timetable periods and zero substitutions in the configured database. No migration or database write was performed. This is not proof of the running app's database/build binding.

Search results and read-only database evidence are retained in `.validation-rooms/`.

## C. Existing and completed data model

Previously, physical Room identity was only a required, trimmed string of at most 120 characters. Teacher timetable/Home and attendance history display that saved string. It was unrelated to the realtime provider's Room ID.

The new minimal `Room` catalog contains canonical ID, immutable Branch ID, normalized name, uppercase code, controlled category, active state, revision, createdBy/updatedBy and timestamps. Categories: Classroom, Science Lab, Computer Lab, Library, Hall, Other. Names are limited to 80 characters and codes to 20. Case-insensitive names and uppercase codes are unique per Branch, including inactive records. Another Branch can reuse the same name/code. No capacity, inventory, location or notes fields were invented.

Existing Academic Setup CRUD handles Rooms; no parallel API architecture was added. Narrow new grants are `academic.rooms.view` and `academic.rooms.manage`, available to Principal and global Super Admin according to the existing catalog ownership pattern. Startup's existing `ensureAcademicSetupIndexes` now establishes Room uniqueness indexes. Sparse Room-reference indexes support retention checks on timetable/substitution history.

## D. Every file changed

| File | Reason |
| --- | --- |
| `backend/src/models/room.ts` | New minimal physical Room catalog and Branch-scoped uniqueness. |
| `backend/src/models/timetable.ts` | Optional immutable canonical Room references and sparse lookup indexes; retain required historical text snapshots. |
| `backend/src/constants/permissions.ts` | Central Room view/manage grants. |
| `backend/src/constants/rolePermissions.ts` | Principal Room ownership; global Super Admin retains centrally derived grants. |
| `backend/src/services/academic-setup.service.ts` | Reuse catalog CRUD/scope/transactions for Rooms; safe DTO, literal search, category validation, audit, retention and index setup. |
| `backend/src/routes/academic-setup.routes.ts` | Register Rooms in existing generic CRUD; existing Branch discovery delegates its permission check to the persisted-actor service. |
| `backend/src/services/timetable-admin.service.ts` | Canonical allocation, batched active Room validation, authoritative name snapshot, publication checks and physical Room conflicts for master schedules/substitutions. |
| `src/constants/permissions.ts` | Matching frontend Room grants and role ownership. |
| `src/services/admin/academicSetupService.ts` | Extend existing catalog contracts with Rooms/category and literal search query. |
| `src/services/admin/timetableAdminService.ts` | Paginated Branch Room catalog, optional historical Room reference and canonical write payload without client display text. |
| `src/screens/admin/RoomsScreen.tsx` | Permission-gated destination reusing the academic catalog screen in Room mode. |
| `src/screens/admin/AcademicSetupScreen.tsx` | Room name/code/type forms, Branch context, server search, lifecycle confirmations, Room-specific feedback and independent loading without AcademicPeriod reads. |
| `src/screens/admin/TimetableAdminScreen.tsx` | Independent active Room selector, search/type/code details, loading/empty/error/retry/stale states, canonical selection, local identity conflicts and legacy revision validation. |
| `src/navigation/PrincipalNavigator.tsx` | Native Rooms route/header/back navigation. |
| `src/navigation/SuperAdminNavigator.tsx` | Same Rooms route within existing administration stack. |
| `src/screens/principal/PrincipalWorkspaceScreen.tsx` | Searchable Academic Administration drawer entry. |
| `src/screens/superAdmin/SuperAdminDashboardScreen.tsx` | Rooms action alongside Manage Timetable under Administration → Academic Management. |
| `__tests__/academic-setup.test.tsx` | Room CRUD/type/refresh, validation, failure/retry, search races and unauthorized-role cases. |
| `__tests__/timetable-admin.test.tsx` | Canonical Room selection/search/payload, independent loading, failure/empty distinctions, retry and legacy-copy guard; update scheduling fixtures. |
| `__tests__/timetable-admin-service.test.ts` | Canonical Room payload and all-page catalog contract. |
| `__tests__/timetable-navigation.test.tsx` | Both Room destinations, role-owned route registration and native header/back availability. |
| `backend/tests/academic-setup.security.test.ts` | Eight Room catalog/security/uniqueness/lifecycle/pagination regressions. |
| `backend/tests/teacher-timetable.security.test.ts` | Canonical fixtures plus ten Room identity/conflict/history/publication/concurrency regressions. |
| `backend/tests/academic-foundation.security.test.ts` | Allocate a Room explicitly in owned schedule fixtures; preserve existing foundation assertions. |
| `backend/tests/class-subject.security.test.ts` | Same fixture adaptation for curriculum/timetable regressions. |
| `docs/room-management-timetable-audit.md` | This audit report. |

Snapshots, scripts, scoped compiler configurations, diffs, read-only evidence and logs are under `.validation-rooms/`. No other source/test files were intentionally changed.

## E. Navigation and mobile UX

- **Principal:** existing navigation drawer → **Academic Administration → Rooms**, alongside Manage Timetable.
- **Super Admin:** existing **Administration → Academic Management → Rooms**, alongside Manage Timetable.
- Native stack headers provide the existing Back behavior. Teacher stack has no Rooms route; direct component mounting fails closed without the view grant.
- No Home shortcut or new navigation paradigm was added.

Rooms reuses Hira cards, buttons, searchable selectors, keyboard-avoiding layout, scrolling catalog, status labels and confirmation dialogs. Name/code search is server-paginated at 50 per page and escaped literally. Resource generations discard stale search/Branch responses. Existing mutation refs prevent duplicate submissions and keep forms/Branch controls disabled while saving. Success refreshes the visible list. Room code/name/type/status are displayed without audit/internal identifiers.

Scheduling loads Rooms by Branch independently of Teacher/Class/Section selection. The selector searches name/code/category details and offers only active records. It distinguishes loading, no configured Rooms, no active Rooms, failure/unauthorized and unavailable selected Room. Errors have a local retry; an empty catalog links safely to the existing Rooms route. No fake Room options are injected.

Source and React Native component behavior were reviewed; no physical Android/iOS keyboard, screen-reader or device rendering acceptance is claimed.

## F. Timetable integration and time/version semantics

New period payloads use `roomId`. The backend derives `room` from the active same-Branch Room name; client-supplied Room display text cannot override it. Both canonical ID and immutable display snapshot are stored. Admin schedule reads return optional Room ID plus saved text. Teacher/Home contracts retain their existing `room: string` display field.

New substitution writes also require a canonical Room and capture the server-derived snapshot. No media Room is created, named or addressed by this model.

The existing time/version model is preserved: weekday 0–6 (Sunday–Saturday), strict `HH:mm`, same-day positive intervals, school timezone semantics, inclusive effective start/exclusive end, immutable complete-Branch versions and highest approved revision per date. Drafts do not create published occurrences; overlapping versions are not merged.

## G. Conflict and concurrency proof

Within a master version, overlapping periods on the same weekday reject the same canonical Room even when Teacher and Section differ. Different Rooms with different Teachers/Sections can run simultaneously. Teacher and Class/Section conflict checks remain in place. Adjacent nonoverlapping intervals retain the existing exclusive-end semantics.

Imported/copied/revised drafts cannot bypass approval checks. Two concurrent approvals of an imported same-Room collision both return 409 and leave the version a draft. Concurrent creation versus Room deactivation yields either a valid draft plus blocked deactivation, or successful deactivation plus rejected draft.

Substitution Room checks compare the replacement against other effective periods and their approved overrides on that date in the winning version. Two simultaneous substitute approvals competing for one Room serialize on Branch: exactly one succeeds and the other returns 409. These checks run in the existing persisted Branch publication/catalog transactions, not an in-memory lock.

Room reads for a master version are batched rather than queried once per period.

## H. Security proof

Catalog endpoints enforce authentication, current persisted actor, role/central permission, active Branch, explicit valid global-Super-Admin target and own-Branch Principal authority. Principal foreign mutations return 403; foreign/unavailable read targets follow concealed 404 conventions. Client role/Branch fields cannot grant authority. Existing revision/session/actor transaction checks are reused.

New timetable/substitution writes reject foreign, nonexistent and inactive Room IDs server-side. New text-only period writes fail with 400; imported text-only drafts cannot publish and return an actionable 409. All existing Class/Section/ClassSubject/AcademicPeriod/TeacherAssignment checks and publication fencing remain enforced. No Teacher fallback, timing relaxation or client-authoritative occurrence was introduced.

## I. Historical compatibility and deactivation policy

Optional Room references allow existing approved periods and substitutions to remain readable without migration. Their saved text remains unchanged. Renaming a Room does not rewrite old timetable snapshots. Reads do not require the catalog Room to remain active or present, so history is not corrupted by imported/legacy inactive data.

New drafts and substitutions require canonical allocation. An old draft must be revised, its Rooms explicitly selected and a new version saved before approval. A copied legacy period is visibly invalid until corrected; no name-based automatic mapping or silent migration occurs.

Consistent with existing Academic Setup retention, **any canonical timetable/substitution reference blocks Room deactivation with 409**, including draft or historical references. Unused Rooms can deactivate/reactivate with revision checks. No hard-delete endpoint exists. This conservative policy is stated on the Rooms screen. Legacy text cannot be reliably inferred as a canonical reference; it stays an immutable display value. Text alias reconciliation is deliberately manual through revision.

Backend/frontend deployment must be coordinated: older clients that send only text cannot create new schedules against this stricter write contract. Existing read contracts remain compatible. No production schedules or assignments were created during validation.

## J. Exact validation results

| Final unique coverage | PASS | FAIL |
| --- | ---: | ---: |
| Frontend: Academic Setup/Rooms screen | 40 | 0 |
| Frontend: Academic Setup service/navigation | 7 | 0 |
| Frontend: Timetable admin screen/service | 56 | 0 |
| Frontend: Timetable/Room navigation | 7 | 0 |
| Frontend: Teacher timetable screen/service | 22 | 0 |
| Frontend: Teacher Home | 25 | 0 |
| Frontend: existing preview screen/API | 16 | 0 |
| Frontend: Teacher Assignment administration | 20 | 0 |
| **Frontend total, 12 suites** | **193** | **0** |
| Backend: Academic Setup/Rooms | 57 | 0 |
| Backend: timetable/substitutions, final complete run | 91 | 0 |
| Backend: Academic Foundation | 15 | 0 |
| Backend: ClassSubject | 36 | 0 |
| Backend: existing Live Lesson binding/security fixtures | 77 | 0 |
| Backend: Teacher Home | 46 | 1 |
| **Backend total** | **322** | **1** |

The only final backend failure is the previously documented `pre-marking remains allowed but future sessions stay outside Pending`: its legacy fixture lacks current AcademicPeriod/ClassSubject setup and receives 409 instead of 200. This predates Room work; preceding baseline reproduction is retained in `.validation-timetable-audit/home-baseline.log`. Attendance was not changed to suppress it.

The combined first focused backend run had 197 PASS/1 FAIL because a new spoofed-display fixture accidentally omitted its canonical Room ID. The fixture now supplies the ID while forging the label; final complete timetable run passes 91/91. Unique totals above use that final run in place of the earlier timetable group. Temporary UI iterations were fixed before the final complete frontend pass.

Scoped frontend TypeScript (including Rooms and modified UI tests): PASS. Scoped backend timetable/Academic Setup dependency graph TypeScript: PASS. Scoped ESLint on all 25 changed source/test files: PASS, zero warnings/errors. `git diff --check`: PASS. Full backend TypeScript reproduces only the known `safety-alert.controller.ts:47 TS2322`; that file remains untouched.

Commands and artifacts:

- Frontend: `node node_modules/jest/bin/jest.js --runInBand --testTimeout=20000 --json --outputFile=.validation-rooms/frontend-results.json` followed by the 12 named test suites; full command appears in `frontend-final.log`.
- Backend catalog/foundation/curriculum: `node --import tsx --test --test-concurrency=1 tests/academic-setup.security.test.ts tests/teacher-timetable.security.test.ts tests/academic-foundation.security.test.ts tests/class-subject.security.test.ts`; then final complete timetable rerun in `backend-timetable-final.log`.
- Existing occurrence-binding regressions: `node --import tsx --test --test-concurrency=1 tests/teacher-home.security.test.ts tests/live-lesson.security.test.ts`. These use isolated fixtures and test providers; they are not ZEGO/media tests.
- Structured per-suite counts: `test-counts.json` and `frontend-results.json`.

## K. Genuine remaining Room-related gaps

1. Physical-device acceptance for keyboard/modal/back, TalkBack/VoiceOver and large Room lists remains outstanding.
2. The configured database has no Rooms. An authorized administrator must configure real resources before creating canonical schedules; no data was invented.
3. Legacy text allocation must be explicitly mapped when revising schedules. There is no automatic alias migration, and old text-only clients must be updated for new writes.
4. Referenced-Room retirement/archival is intentionally unavailable under the conservative catalog retention policy. Substitution administration remains API-only as before; its physical Room allocation/conflicts are enforced by the updated API.

No other Room-functional failure remains in the focused validation. Capacity, maps, inventory and generalized bookings are outside the reviewed model and were not added.

## L. Worktree preservation

Branch remains `feture`. The baseline captured 89 existing dirty/source/report files. All **73 files outside the 16 deliberately extended baseline files** match their original SHA-256 values. Existing versions of targeted dirty files are retained for review; changes to previously clean files are limited to the listed Room work. Git index remains empty.

No reset, restore, clean, staging, commit or push. No configured-database writes, deletes or migration. Unrelated dirty patches and prior validation directories are preserved. No ZEGO credentials/client, recording, R2, Student flow, attendance or safety source changed. No ZEGO/media testing was started.
