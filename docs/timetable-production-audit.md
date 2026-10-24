# Timetable & Scheduling production-readiness audit

## A. Executive verdict

**TIMETABLE MODULE HARDENING REQUIRED — core catalog selection, navigation, draft publication and transaction hardening completed; remaining substitution/planning capabilities and device validation prevent an unconditional production-ready verdict.**

This pass audits the module as an academic administration control plane. It does not replace the existing schedule model or broaden Teacher/Live Lesson authority. The reported Section failure is fixed as part of the whole dependency graph. The previous Class correction is retained.

## B. Architecture map and review evidence

AcademicPeriod (one active per Branch) → SchoolClass.academicPeriodId → Section.classId → active ClassSubject → currently effective exact TeacherAssignment → immutable TimetableVersion/TimetablePeriod draft → administrative approval → highest approved version effective on each school civil date → authorized Teacher timetable → Teacher Home current/next period → existing TeacherLiveLesson preview.

Reviewed Principal/Super Admin stacks, dashboards, drawer/tab patterns, Academic Setup and Teacher Assignment screens/services, shared Hira forms/selectors/date fields, timetable/substitution schemas/routes/admin services, catalog/actor scope helpers, conflict/publication logic, Teacher timetable/Home, Live Lesson binding/time conversion, and their tests. History reviewed includes `178261e`, `5688e3f`, `69c3f29`, `c0428c1`, `8480bcf`, `e153078`, `aabfec2`, `df7ef50`, plus both uncommitted timetable-admin fixes and their reports.

`178261e` deliberately supplied immutable whole-branch versions and trusted administrative substitution APIs without an admin editor or availability solver. Later foundation work added explicit Class→AcademicPeriod and ClassSubject authority. Earlier UI work reused version writes but initially inverted catalog browsing around a selected Teacher. No historical code was reverted.

### Selector contract audit

| Selector | Authoritative source | ID/display | Eligibility and dependencies |
| --- | --- | --- | --- |
| Branch | Existing `/timetables/options`, persisted actor/active Branch | `id`, name | Principal fixed to own Branch; global Super Admin explicitly selects target. |
| Class | `academicSetupService.list('classes', {branchId,offset})` | `id`, name + code | Active, non-legacy Class linked to active AcademicPeriod. All pages collected. |
| Section | `academicSetupService.list('sections', {branchId,classId,offset})` | `id`, name + code | Active Section with exact selected classId. Its AcademicPeriod is inherited from Class; no invented Section period field. |
| Subject | `classSubjectService.list(classId,branchId,offset)` | `subject.id`, Subject name | Active mapping and active Subject, writable active Class/period. Curriculum is Class-scoped in this repository; Section does not have a separate Subject mapping model. |
| Teacher | Existing timetable options read extended with exact `classId,sectionId,subjectId` | `id`, full name | Active same-Branch Teacher with currently effective exact TeacherAssignment. Filter occurs before pagination. All eligible pages collected. |

The Teacher read is a thin eligibility projection, not another catalog API. It reuses existing timetable authority and TeacherAssignment entities. An exact-combination index supports this query; existing startup awaits TeacherAssignment.createIndexes(), including when automatic indexing is disabled.

Every collection has one local resource, not mirrored global/selector state. Class changes reset Section/Subject/Teacher; Section changes reset Subject/Teacher; Subject changes reset Teacher. Branch changes remount the scoped editor after explicit discard confirmation when a draft exists. Parent keys are included in loaded Section/Subject/Teacher envelopes, and request generations ignore older responses. A context-mismatched response cannot populate a newer selection even before the next effect runs.

Loading, configured-empty, ineligible, API failure, forbidden access and stale selection are distinct. Catalog names/codes use the existing trimmed case-insensitive shared search. Pagination cannot loop on a non-progressing cursor. Exact canonical IDs are stored and passed in requests.

## C. Root causes and disposition

### Functional defects fixed

- Sections and Subjects were still derived from the selected Teacher's tuples, so valid catalog records appeared absent and no Section request occurred before Teacher selection.
- Teacher selection listed active accounts instead of only assignments for the chosen academic combination.
- Dependent controls and empty states conflated absent catalog data with absent Teacher authority.
- Draft periods could only be removed/re-added; added explicit edit/update/cancel interactions for unsaved periods.
- Copied/imported invalid periods lacked clear whole-draft client validation. Save now blocks invalid Day/time/Room and overlapping staged periods; server approval also revalidates stored clock/day fields.

### UX/navigation defects fixed

- Removed Principal's standalone Home card and its callback/exported card implementation.
- Integrated Principal discovery into the existing searchable Academic Administration drawer.
- Replaced Super Admin's isolated Hira card with its existing Administration tool-row pattern, grouped as Academic Management.
- Added actual server-derived effective-today version context; approval success no longer falsely promises a future/superseded schedule will appear today.
- Added explicit complete-version review before enabling Approve, exact version/date/count confirmation, and collapsed saved-period details to avoid eagerly rendering every saved version's periods.
- Added unsaved-draft protection for native Back, Branch changes and copying another revision. Parent Branch refresh cannot silently unmount an unsaved draft or an in-flight write.
- Added draft conflict indicators, corrective overlap messages, date validation, and scoped retry/refresh without losing staged periods.

### Security defects fixed

- Initial Principal branch checks were not consistently repeated inside mutation transactions. The persisted actor is now fenced and role/branch authority reloaded inside create, approve, substitute and retirement transactions.
- Base Teacher account/assignment changes could race publication. Relevant Teacher documents and exact assignment documents now participate in transaction fencing; revocation/role/branch changes cannot silently publish stale authority.
- Substitution creation/approval now revalidate the winning approved version, date/day, base responsibility and active same-Branch replacement Teacher within the publication transaction.
- Retirement now participates in the same Branch publication transaction.
- Branch-bound Super Admin accounts no longer bypass the canonical global-administration rule used by Academic Setup.

### Integration findings

No new Live Lesson contract defect was found. The server remains the sole occurrence source; no fake occurrence, room identity, credential or timing bypass was added.

## D. Section selector root cause

Before: `selected Class → filter selected Teacher's options.tuples → Section rows`. There was no Class→Section catalog request. Without a Teacher assignment for the selected Class, the list was empty despite existing Sections. This was neither an `_id`/`id` issue nor a bad Branch/Class schema relationship.

After: canonical Class `id` → `GET /academic-setup/sections?branchId=...&classId=...&offset=...` → authenticated role/academic view permission → DB-backed Branch scope → exact parent Class lookup → Section DTO `{id,classId,name,code,isActive,...}` → active exact-parent filtering → searchable name/code rows → canonical Section ID. Errors cannot become misleading empty dropdowns. A late response for an earlier Class is ignored.

## E. Navigation outcome

- **Principal:** existing overflow/three-dot drawer → **Academic Administration → Manage Timetable**. Academic Setup remains alongside it. No timetable Home shortcut remains.
- **Super Admin:** existing **Administration** tab → **Academic Management → Manage Timetable**, using existing tool-row typography/styles rather than a new navigation pattern.
- Both existing role stacks keep the `TimetableAdmin` route and native Back behavior. Returning preserves the underlying role workspace/tab. Teacher stack has no admin timetable route; direct server requests remain independently authorized.

## F. UI/UX and mobile audit

The editor groups academic context, weekly period entry, complete staged schedule, and saved versions. Context shows Branch, selected Class's AcademicPeriod and the actual published-today version. A period uses Class→Section→Subject→eligible Teacher, Day, Start/End and Room. Whole-branch replacement and version-bound substitution consequences remain explicit.

Saved versions show status as text, effective bounds and period count. Open a complete version before approval. A revision copies every period and both effective dates; changes remain local until Save Draft, and approval is separate. No approved period is edited in place.

Mobile review: shared modal pickers retain searchable content, accessibility labels, modal isolation and Android modal-back dismissal; Hira buttons have 44-point minimum height. Keyboard taps are handled, an iOS KeyboardAvoidingView wraps the screen, and Android already uses `adjustResize`. There is one main page ScrollView and shared modal ScrollViews, not nested independent schedule list scrolling. Native back warns before discarding a draft and is prevented while a write is pending. Confirm buttons use the existing busy UI plus a synchronous duplicate-submit lock. Stale/unmounted responses cannot overwrite a later context.

This is source/component-renderer and behavioral verification, **not physical-device visual QA**. Small-screen keyboard, screen-reader traversal, large 500-period drafts and real-device scroll performance still need device verification. No screenshot/device/media claim is made.

## G. Data contracts

Reused canonical Academic Setup Class/Section DTOs and ClassSubject mapping DTOs, including active/legacy/period metadata and all-page cursors. Subject mapping uses subject.id, not mapping.id, in the period payload. Teacher eligibility extends the existing `/timetables/options` whitelist with an exact academic combination and preserves older callers. No duplicate Class/Section/Subject endpoint, schedule model, design system, state library or API architecture was introduced.

Writes still project only `{branchId,versionNumber,effectiveFrom,effectiveUntil,periods:[{teacherId,classId,sectionId,subjectId,dayOfWeek,startTime,endTime,room}]}`. Display names, mapping IDs and prior period IDs are excluded. Read DTOs contain no private Teacher identity data.

## H. Security verification

Authentication/session checks remain in middleware. Timetable services reload current persisted identity and permission. Principal is restricted to their own active Branch; Super Admin must be global and supply an explicit valid Branch for operations requiring one. Cross-Branch Principal requests fail closed with the existing 403 write contract. Class/Section parent mismatch and unavailable responsibility are denied; ClassSubject and active AcademicPeriod remain required at write boundaries.

New tests force Principal Branch reassignment during create/approve/retire/substitute and verify 403 with no unauthorized mutation. Approval revalidates an assignment revoked between the initial check and transaction fence. Base Teacher/Section/Room overlaps, duplicate periods, inactive references and invalid combinations remain rejected. Conflict responses identify period numbers, time windows and the conflicting resource type, without raw internal IDs.

Substitutes retain their intentionally narrow authority: an approved same-Branch replacement grants only that occurrence and does not require or grant an ordinary catalog tuple. The replacement and current winning schedule are revalidated; Teacher Home/Live Lesson continue resolving through the established server occurrence policy.

## I. Time and version model

- `dayOfWeek`: integer 0 Sunday through 6 Saturday.
- Persisted times: exact zero-padded 24-hour `HH:mm` school civil clocks. Equal/end-before-start/overnight windows are rejected. No locale/AM-PM parsing.
- `SCHOOL_TIMEZONE`: deployment-wide IANA zone, default `Asia/Karachi`; device timezone is not scheduling authority. Existing Live Lesson civil-to-instant conversion is unchanged.
- Effective dates: school `YYYY-MM-DD`, start inclusive/end exclusive, positive range ≤366 days. The admin current-version read uses one school-date snapshot.
- Drafts do not generate occurrences. Highest approved version wins separately per effective civil day; versions are complete Branch schedules and are never merged.
- Stored periods are immutable. Revise copies the whole saved version into a new local draft; saving creates a new immutable draft version. Approval revalidates all periods. Retirement may reveal an older eligible approved version, as the existing architecture specifies.
- Teacher Home current/upcoming remains the current school day, with exclusive period end. Tomorrow-only schedules do not fabricate a Go Live occurrence today.

## J. Integration proof

The owned-MongoDB timetable integration test creates a Principal draft for the assigned Teacher, confirms it is invisible before approval, approves it, verifies exact Day/date/11:10–11:50 in Teacher timetable, and confirms the same periodId in Teacher Home as upcoming then current. `11:10 Asia/Karachi` resolves to `06:10Z` through the existing converter. Existing authorized preview accepts that period/date using a test provider that throws if credentials/room identity are requested during preview.

Frontend Teacher Home current/next tests navigate to the existing `TeacherLiveLesson` route using only the canonical server periodId/date. Existing preview-screen and safe-empty-state tests pass. No production database, actual ZEGO room, credentials or media testing was used.

## K. Files changed in this audit pass

| File | Reason |
| --- | --- |
| src/screens/admin/TimetableAdminScreen.tsx | Catalog-first dependency graph, context/error states, draft editing/validation, review/approval clarity, unsaved guards, mobile keyboard behavior and collapsed version details; remove unused standalone entry card. |
| src/services/admin/timetableAdminService.ts | Reuse paginated canonical Section and mapped Subject reads; collect exact eligible Teachers; current-version DTO. |
| src/screens/principal/PrincipalDashboardScreen.tsx | Remove timetable Home entry and callback. |
| src/screens/principal/PrincipalWorkspaceScreen.tsx | Searchable timetable destination in existing Academic Administration drawer. |
| src/screens/superAdmin/SuperAdminDashboardScreen.tsx | Administration → Academic Management tool entry using existing style. |
| backend/src/routes/timetable.routes.ts | Whitelist exact Class/Section/Subject eligibility query fields. |
| backend/src/services/timetable-admin.service.ts | Exact eligible Teacher read, effective-today version metadata, current actor/assignment/replacement transaction fencing, imported clock/day approval validation, actionable conflicts and transactional retirement. |
| backend/src/models/teacherAssignment.ts | Add exact-combination eligibility query index; preserve previous model patch. |
| __tests__/timetable-admin.test.tsx | Dependency graph, late responses, errors, no eligibility, conflicts/editing, discard/back and stale-context regressions; update earlier tests for canonical flow. |
| __tests__/timetable-admin-service.test.ts | Canonical Section/Subject requests and paginated exact Teacher eligibility contracts. |
| __tests__/timetable-navigation.test.tsx | Both role entry paths, route ownership, native headers and absence of Principal Home shortcut. |
| backend/tests/teacher-timetable.security.test.ts | Exact eligibility, scoped Super Admin, mutation Branch races, assignment revocation, imported invalid clocks, current version and index assertions. |
| docs/timetable-production-audit.md | This production-readiness report. |

Local baselines, logs, scoped config and verification scripts are under `.validation-timetable-audit/`. Existing shared AdminForm, navigator registrations, Live Lesson, attendance, safety, recording and R2 source are preserved.

## L. Test evidence

| Final coverage | PASS | FAIL |
| --- | ---: | ---: |
| Frontend, 14 focused/regression suites | 195 | 0 |
| Backend timetable/substitution, final focused run | 70 | 0 |
| Academic Setup | 49 | 0 |
| Academic Foundation | 15 | 0 |
| ClassSubject | 36 | 0 |
| TeacherAssignment administration | 20 | 0 |
| Live Lesson occurrence/security (test providers) | 77 | 0 |
| Teacher Home | 46 | 1 |
| Unique backend coverage across final suites | 313 | 1 |

The main backend regression log contains 312 PASS/1 FAIL across 313 tests; the final timetable run adds the imported-clock regression and passes 70/70, replacing its earlier 69-case result in the unique totals above. The only failure is `pre-marking remains allowed but future sessions stay outside Pending`: legacy fixture lacks AcademicPeriod/ClassSubject context, returns 409 versus expected 200. A fresh run using pre-change timetable code loaded in memory reproduces **46 PASS/1 identical FAIL**. Attendance was not changed to hide it.

Scoped frontend TypeScript (including new tests and navigators): PASS. Scoped backend timetable dependency graph TypeScript: PASS. Full backend TypeScript: FAIL only at known `safety-alert.controller.ts:47 TS2322`. Scoped ESLint on the 12 modified source/test files: PASS, zero errors/warnings. `git diff --check`: PASS.

Frontend command: `node node_modules/jest/bin/jest.js --runInBand --testTimeout=20000` with timetable-admin, timetable-admin-service, timetable-navigation, academic-setup, academic-setup-service, academic-setup-navigation, teacher-assignment-admin, teacher-assignment-service, teacher-home, teacher-timetable, teacher-timetable-service, live-room-screen, live-lesson-api and teacher-provisioning tests. Backend: `node --import tsx --test --test-concurrency=1` with the seven named security test files; final timetable-only rerun after the last backend validation change. Relevant final frontend suites were rerun after removing the unused entry component (37/37 UI/navigation); overall unique frontend count remains 195. Type/lint outputs and preservation evidence are retained beside the logs.

## M. Genuine remaining gaps

1. **Substitution availability/conflicts:** no full replacement-Teacher/room overlap solver; existing policy relies on trusted administrative review. Admin substitution management and schedule retirement remain API-only.
2. **Future-term planning policy:** eligibility uses currently effective assignments. Future-only assignments cannot be planned through this resolver yet; version windows are not automatically clipped to AcademicPeriod/assignment date ranges. Active academic lifecycle remains enforced, but a date-range planner requires an explicit product/authority policy.
3. **Draft lifecycle:** saved definitions remain append-only; revising a saved draft creates another revision. Withdrawal/archival of obsolete drafts is not exposed. Retirement fallback can restore an older approved schedule and needs an explicit UI when retirement is added.
4. **Device acceptance:** Android/iOS small-screen, keyboard/TalkBack/VoiceOver and maximum-size schedule performance need physical-device validation. Component tests do not substitute for that.

These gaps are why the verdict is not an unconditional production architecture/readiness approval. Core daily scheduling and its approved occurrence path are proven by the focused tests.

## N. Worktree preservation

Branch remains `feture`. Snapshotted 86 pre-existing dirty/source/report files. All **75 files outside the 11 deliberately extended existing files** match their baseline SHA-256 values. In-memory removal of only the new eligibility index restores the original TeacherAssignment model patch exactly. Original versions of targeted files are retained for review. Prior reports/validation artifacts and unrelated untracked files were not modified.

No reset, restore, clean, staging, commit or push. Index remains empty. No ZEGO media testing was started.
