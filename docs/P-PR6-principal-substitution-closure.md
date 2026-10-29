# P-PR6 — Principal substitution management

Implementation and re-audit, 25 October 2026. Branch `feture`. This report covers P-PR6 additions to the existing mixed worktree; P-PR1–P-PR5 were not redesigned.

## A. Verdict

Final verification results are recorded below after the validation runs finish.

## B. Existing substitution architecture and initial review

| Classification | Existing component | Finding / disposition |
|---|---|---|
| KEEP | Immutable TimetableVersion and TimetablePeriod | Highest approved version wins per school civil date; retain original Teacher and academic tuple. |
| KEEP | SubstituteAssignment | Existing date/period overlay, draft/approved/retired lifecycle, original/replacement Teachers, approved and retired actors/timestamps, acknowledgement. No second domain introduced. |
| KEEP | Partial unique index | One approved substitution per period/date, retained as database protection. |
| KEEP | Teacher timetable / attendance / occurrence-bound delivery / live lessons | Existing consumers already authorize by effective occurrence. General roster/Class access continues to require permanent TeacherAssignment. |
| PARTIAL | Legacy substitution create/approve/retire | Room checks and publication locks existed; Teacher and Section overlap checks were missing. Session commit authority was weaker than P-PR1. Hardened these same paths. |
| MISSING | Principal dated overview and candidates | Added within existing Timetable Scheduling navigation and API router. |
| MISSING | Atomic Principal replacement/cancellation workflow | Added revision-protected operations using existing approved/retired records. |
| BROKEN | Occupied Teacher could be selected | Reproduced against saved baseline module: request returned 201 where the permanent regression expects 409. |
| PARTIAL | Temporary evidence authority | Historical timetable visibility existed; attendance/delivery mutations could use an old substitution date. Added date-bound mutation checks and matching capabilities. |
| DUPLICATE | GET options/version route registrations | Removed unreachable duplicate registrations; retained the first authoritative contracts. |

Baseline proof: `.validation-p-pr6/baseline-reproduction.log`. A validation-only loader used a saved `git show HEAD:backend/src/services/timetable-admin.service.ts` module in an isolated test process. It did not replace working source or change assertions. That file was clean at task start. The reproducer schedules the replacement Teacher in a different Room at overlapping clock times, then calls the existing substitute endpoint. The baseline fails with **201 != 409**; the final Teacher timetable suite includes the same regression.

## C. Final substitution model

One approved SubstituteAssignment replaces one TimetablePeriod occurrence on one school date. Period.teacherId and permanent TeacherAssignment remain unchanged. The effective Teacher/time/Room projection is shared through `effectiveTimetableOccurrence`; version selection uses `operationalTimetableVersions`, now also supporting transaction sessions. Teacher timetable, availability and conflict checks reuse these helpers. Attendance and delivery continue through the existing Teacher occurrence authorization path. P-PR5 retains its existing batch aggregation and submitted-history projection.

Assignment creates an approved overlay atomically. Replacement retires the previous approved overlay and creates its successor in the same transaction. Cancellation retires the overlay and restores the base occurrence only if that original Teacher/Section/Room is still available. Records are never deleted. Existing legacy override times and Rooms survive replacement; cancellation explicitly displays and restores the original time/Room. A new bounded operational reason enum is stored; no free-text HR details are introduced.

## D. Candidate eligibility policy

The authoritative pre-existing contract is `docs/T-PR3-timetable.md`: a substitute **does not require an ordinary tuple assignment for temporary duty**. This is preserved, not replaced with an invented exact-Subject or emergency-exception policy. UI and candidate DTO explicitly disclose that permanent Subject assignment is not required.

Candidates must be persisted, active Teachers in the Principal's active Branch, different from the original and current replacement, and free during the effective window. The target must still have valid original TeacherAssignment, Class, Section, Subject, ClassSubject and active academic context. Operational eligibility does not depend on the candidate having a login session. Candidate results contain only id, name and eligibility text. Search is escaped literal text (80 characters maximum); pages return at most 30 results with validated offsets. Teacher collections are not downloaded to mobile.

## E. Availability and conflicts

Actual half-open clock overlap is checked (`start < other.end && other.start < end`), including own timetable lessons and approved substitutions on the selected date. Only the winning approved timetable participates. Each candidate request loads one batch of day occurrences/overrides, then performs one bounded Teacher query; there is no per-candidate schedule query.

Commit validation rejects Teacher, Class/Section and Room overlaps. Sections are the existing scheduling unit: distinct Sections of one Class may legitimately run concurrently. Room identity uses canonical IDs, retaining existing legacy name comparison only where IDs are absent. A justified Branch/date/period/status index supports the calendar/history lookup; the approved occurrence uniqueness index remains intact.

## F. Temporary authority

Substitutes gain only the matching date/period/Class/Section/Subject occurrence. No TeacherAssignment or account role is created or modified. Existing general roster access remains assignment-scoped. Historical timetable and authorized submitted-attendance evidence remain readable under existing policy. New attendance and lesson-delivery mutations derived from temporary duty require the occurrence's school date, including a second check before commit; they cannot be used on a later date. Same-day evidence recording remains permitted under existing attendance/delivery semantics. Live lessons retain their existing occurrence/time checks. No cleanup job is required for expiry.

## G. Principal workflow

Timetable Scheduling → Substitutions → school date → View Lesson → Assign/Replace Substitute → server-derived available Teachers → bounded reason → AdminDialog confirmation → authority/revision/academic/conflict revalidation → atomic commit → authoritative overview refresh.

The Principal can inspect retained history and cancel a future substitution. New operational actions close once the lesson starts. Legacy administrative revocation of an obsolete historical substitution remains supported: because it restores no winning operational occurrence, it must not require the obsolete version to win again.

## H. Concurrency proof

Permanent real-replica-set tests run two distinct valid Principals against the same occurrence: exactly one succeeds, the other gets 409, and only one history record exists. Two overlapping lessons racing for the same replacement Teacher likewise produce one success, one 409, and one substitution. Every participating mutation writes the shared Branch document before reading dependencies. MongoDB conflict retries re-read the winning state; this is not an in-process mutex.

The occurrence revision includes school date, winning version, immutable period, relevant original assignments, and all substitution identities/statuses. Cancellation cannot return the revision to its initial value (ABA test). Stale approved-version or academic responsibility changes fail closed. The partial unique index provides an additional same-occurrence constraint.

## I. Commit-time authority proof

Principal writes reuse `withPrincipalWriteAuthority`: signed login/token validation and persisted active actor, role, Branch, session and permission fences. The provisional substitution and history roll back on Branch transfer, role demotion, account disable, session revocation, permission removal or Branch deactivation. Permanent tests inject all six changes during the request and assert zero persisted substitution/history records. Branch deactivation is injected immediately before acquisition of the shared Branch write fence; later deactivation serializes against that fence.

## J. P-PR5 attendance integration

Effective responsibility changes immediately for new operational occurrence access. The original Teacher loses that occurrence from the operational queue; the replacement receives it. Submitted attendance continues to pin its recorded responsible Teacher/substitution/version and does not rewrite historical evidence when later schedules change. The P-PR5 overview and attendance/amendment regressions are included. No attendance redesign was performed.

## K. Teacher timetable / live / delivery

Teacher timetable retains date/period visibility and acknowledgement behavior. Approved replacements remove the original Teacher's operational occurrence. Delivery and live services continue to consume existing occurrence authority. Only temporary evidence expiry and its exposed capability were tightened; no recording, transcript or Teacher roadmap work was started.

## L–M. UI/UX and Hira reuse

The overview includes school date/timezone, Class/Section, Subject, original/replacement Teacher, time, Room, reason, status and retained history. Loading, empty, error/retry, candidate loading/empty/error, search/pagination, confirmation/cancel, success, conflict, stale revision, actor change and permission-loss behaviors are covered by UI tests.

Server responses own timetable state. Local state holds IDs, filters and form choices. Refresh hides old data; changed date/actor/revision remounts temporary form state. Successful and failed writes close stale dialogs and refetch. No optimistic substitution is persisted locally.

Reuses DashboardShell, ScreenHeading, SectionCard, Button, StatusBadge, AdminDateField, AdminSelect, AdminDialog, AdminFeedback and shared typography/spacing/colors. No new UI library, theme, platform alert or desktop table. Hira dialogs provide scrolling, keyboard avoidance and native Back handling. Teacher names/context use wrapping Text rather than fixed row widths. Safe-area behavior comes from DashboardShell. **No physical Android/device certification is claimed**; review and automated rendering tests were performed.

## N. Files changed for P-PR6

| File | Reason |
|---|---|
| `backend/src/models/timetable.ts` | Reason enum and calendar query index; preserves pre-existing P-PR5 edits. |
| `backend/src/routes/timetable.routes.ts` | Dated Principal endpoints, token forwarding, duplicate read route removal. |
| `backend/src/services/principal-substitution.service.ts` | Bounded overview/candidates, revisions, atomic assign/replace/cancel. |
| `backend/src/services/timetable-admin.service.ts` | Shared replacement validation, overlap engine, P-PR1 commit fences and safe cancellation on existing paths. |
| `backend/src/services/timetable-occurrence.service.ts` | Transaction-aware winning version selection and shared effective projection; extends the pre-existing untracked P-PR5 file. |
| `backend/src/services/teacher-timetable.service.ts` | Shared projection and temporary evidence write expiry; retains P-PR5 work. |
| `backend/src/services/teacher-attendance.service.ts` | Expired temporary-duty canSave capability. |
| `backend/src/services/lesson-delivery.service.ts` | Expired temporary-duty canRecord capability. |
| `backend/tests/principal-substitution.security.test.ts` | Permanent authorization, availability, history, stale, race and expiry tests. |
| `backend/tests/teacher-timetable.security.test.ts` | Legacy endpoint double-booking regression/reproducer. |
| `src/services/principal/substitutionService.ts` | Typed DTOs and whitelisted occurrence mutation payloads. |
| `src/screens/principal/PrincipalSubstitutionsScreen.tsx` | Hira Principal workflow and authoritative refresh. |
| `src/screens/admin/TimetableAdminScreen.tsx` | Discoverable Principal Substitutions entry. |
| `src/navigation/PrincipalNavigator.tsx` | Substitutions route, preserving existing P-PR5 routes. |
| `__tests__/principal-substitutions.test.tsx` | UI state, confirmation, conflict, cancellation and authority tests. |
| `__tests__/principal-substitution-service.test.ts` | Query encoding and mutation payload boundary tests. |
| `__tests__/principal-approval-context.test.tsx` | Expected navigation list includes the new route, retaining existing edits. |
| `docs/P-PR6-principal-substitution-closure.md` | This architecture, policy and closure evidence report. |

Generated validation-only files are under `.validation-p-pr6/`: launch scripts, TypeScript scopes, baseline source/loader, exact suite logs and JSON result summaries. Existing Mongo test launcher writes owned instance diagnostics under `.validation-p-pr4/`. These are evidence artifacts, not production code. An empty `backend/.validation-p-pr6/` directory was also created during initial launcher setup.

## O–P. Exact tests and broader regression

Final counts and static-check results are appended after completion. Earlier failure logs are retained: the intentional baseline failure, sandbox startup failure, corrected fixture/validator issues, navigation assertion, Room error priority, and obsolete historical revocation. None were hidden or suppressed. The sandbox profile lookup failed before tests; isolated MongoDB tests were then run with approved execution outside the sandbox. No configured/application database was used.

## Q. Remaining Principal gaps

P-PR7 onward remains outside this change: Teacher directory/task-recipient/notice redesign, Branch reports, broad Principal navigation cleanup and Teacher recording/transcripts. No later phase was started.

## R. Worktree preservation

No reset, restore, clean, staging, commit or push was performed. The `feture` branch and mixed worktree were preserved. Existing P-PR1–P-PR5 and unrelated edits were not reverted, staged, or folded into a commit. Modifications to shared files were limited to the P-PR6 changes described above.
