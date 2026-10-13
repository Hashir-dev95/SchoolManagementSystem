# T-PR3 timetable and substitute contract

T-PR3 builds on committed Teacher tuple scope and roster navigation. It adds no attendance editor, operational Home count, timetable editor UI, or Teacher administrative authority.

## Source and effective policy

Four collections separate TimetableVersion, immutable TimetablePeriod slots, SubstituteAssignment, and TimetableIssue. A branch revision contains the entire approved weekly definition, rather than a patch to an earlier revision. A slot has one current Teacher responsibility and exact class/section/subject tuple. Revision creation accepts 1?500 slots and a positive effective window of at most 366 days. Slot times are civil HH:mm within one day; overnight periods are not supported. Room is a bounded label, because the repository has no room model.

Version windows use inclusive effectiveFrom and exclusive effectiveUntil civil date keys. For each requested date, the highest approved versionNumber whose window contains that date is the sole effective version. Overlap is intentionally deterministic; periods from different revisions are never merged. Draft, retired, and expired revisions do not contribute. A future approved version appears for its future selected dates, never prematurely in Today. Retiring a winning version permits the next eligible lower approved version to become effective again. Administrators must retire obsolete lower revisions when fallback is unwanted.

Approved definitions and periods are not edited in place. A new revision preserves old IDs and timestamps. Creation can leave an incomplete draft if inserting slots fails; approval verifies expected periodCount and current assignment/reference integrity before publishing, so that draft cannot become operational. Timetable mutation race-safety uses MongoDB multi-document transactions; startup fails closed before listening if the transaction-capable deployment prerequisite described below is unavailable.

One approved substitution replaces one period occurrence on one civil date, including its exact approved room/start/end. Draft substitutions never affect the queue. A partial unique database index permits one approved substitution per period/date, including concurrent approval attempts. Retired replacements remain history and restore the base occurrence. A replacement bound to a superseded timetable revision is inactive. Approval revalidates the winning revision and current base assignment.

The approved substitute is the sole active responsible Teacher for that occurrence; the original Teacher is excluded from its operational queue. This avoids counting the occurrence for both. An approved replacement grants only that specific period; it does not grant Classes/Roster access. The substitute must remain an active Teacher in the same active branch. It does not require an ordinary tuple assignment for the temporary duty. A normal period always requires the signed-in Teacher's effective exact tuple and matching period.teacherId.

Substitute approval is a trusted administrative scheduling decision. This first source does not implement a full substitute availability/conflict solver or room inventory. Administrative provisioning must review replacement conflicts. Base revision creation does reject overlapping Teacher, section, or room slots within that revision.

## School dates

Branch currently has no timezone field. All branches therefore use the deployment-wide SCHOOL_TIMEZONE IANA setting, default Asia/Karachi. Invalid settings fail closed with a sanitized server error. Date calculation is centralized in school-date.service.ts. Civil weekdays and range arithmetic use UTC solely for arithmetic on already-selected civil keys; server-local date getters never determine the school day. Per-branch timezones can later replace this boundary without changing queue callers.

The Week endpoint is seven inclusive civil dates starting at start, not an implicit Monday-to-Sunday calendar week. Responses include timezone, today, start, and end. A substitute can only acknowledge on its school date; future or historical duties remain viewable by selected date when their approved window and current authorization permit it, but cannot be acknowledged.

## Authorized Teacher API

All routes authenticate DB-backed sessions, enforce Teacher role and current permissions, reload current Teacher/branch/effective assignments, and validate active class/section/subject relationships. Unknown authority fields, GET bodies, arrays and malformed IDs/dates are rejected. Unavailable scoped objects return concealed 404. Responses use Cache-Control: no-store.

- GET /api/teacher/timetable?date=YYYY-MM-DD (date optional, defaults to school Today).
- GET /api/teacher/timetable/week?start=YYYY-MM-DD (start optional).
- GET /api/teacher/timetable/periods/:periodId?date=YYYY-MM-DD.
- POST /api/teacher/timetable/periods/:periodId/acknowledge with {date}.
- POST /api/teacher/timetable/periods/:periodId/issues with {date, reason, clientOperationId}.

Teacher permissions are teacher.timetable.view, teacher.timetable.acknowledge, teacher.timetable.issue. No edit/manage permission is granted to Teacher. Each write also needs current view authorization; UI capabilities are advisory.

The shared getTeacherTimetable query is the source for Today, Week, detail authorization and actions. Future Home should consume this same query, using periods.length for its authorized Today count rather than reproducing filters. Today returns one date; Week returns at most seven effective version metadata records through one bounded aggregate. Periods are Teacher/approved-replacement scoped, with weekday predicates. Substitutions load only relationships involving the actor. Academic display references and own issue statuses are resolved in batches; no student, guardian or per-period User population exists.

Each period DTO has exactly periodId, date, startTime, endTime, room, classId/className, sectionId/sectionName, subjectId/subjectName, approvedVersion (versionId, versionNumber, effectiveFrom, effectiveUntil), isSubstitute, substituteId, substituteStatus, acknowledgedAt, issueStatus, canAcknowledgeSubstitute and canRequestIssue. It contains no student/private information, issue reason, internal audit actor or raw document.

Acknowledgement conditionally writes actor/time once to the still-approved assigned replacement. Duplicate/concurrent acknowledgements are idempotent. Issue reason is trimmed and limited to 1?500 characters. Only the currently visible occurrence can receive an issue; actor/branch are derived server-side. Issue retries are identified by actor/branch/clientOperationId; distinct operations create distinct reports. Open issues do not hide further reporting. This PR stores requests; issue triage/resolution and notifications are not implemented.

## Trusted provisioning

No timetable source existed, so minimal administrative APIs make the feature operational without a whole-school editor. Principal may operate only in their own current active branch; Super Admin supplies an active target branch when creating a version. Both require timetable.manage and DB-backed current identity/session.

- POST /api/timetables/versions: {branchId? (Principal defaults own), versionNumber, effectiveFrom, effectiveUntil, periods:[{teacherId,classId,sectionId,subjectId,dayOfWeek,startTime,endTime,room}]}.
- POST /api/timetables/versions/:id/approve with {}.
- POST /api/timetables/versions/:id/retire with {}.
- POST /api/timetables/substitutes: {periodId,substituteTeacherId,date,startTime,endTime,room}.
- POST /api/timetables/substitutes/:id/approve with {}.
- POST /api/timetables/substitutes/:id/retire with {}.

dayOfWeek uses 0 Sunday through 6 Saturday. Creation returns only the draft identifier/status. Approval returns identifier/status. Approval and retirement actor/timestamps, creation actor/timestamps, acknowledgement and original immutable references remain stored. No Teacher receives draft history. There is no administrative history browser in this PR; history remains retained for a future authorized read contract.

## Frontend and verification

The existing five primary Teacher destinations remain intact. Home has only an Open timetable link without counts. TeacherTimetable and TeacherPeriod belong to the existing native stack; period params are only periodId/date. Timetable uses shared Hira DashboardShell, ScreenHeading, SectionCard, Card, Button, StatusBadge and theme typography/colors/spacing.

Date/week and selected occurrence stay in mounted list state. Focus, Retry and pull-refresh use the existing request-generation hook; pending mutation state has its own synchronous duplicate-click and focus/context generation guard. Server denial clears stale period data. Only server-confirmed actions show success; confirmed actions refresh the record. Failed issue submission retains text. Disappearing selected periods are not kept as stale cards.

Production startup awaits timetable uniqueness and query indexes before accepting traffic, including deployments with automatic index creation disabled. The documented legacy restrictive issue index is replaced only after the new operation index is established. The security suite checks the actual database indexes.

Verification commands:

- node --import tsx --test tests/teacher-timetable.security.test.ts (backend directory; ephemeral MongoDB).
- node node_modules/jest/bin/jest.js --runInBand --no-cache (repository root).
- node backend/node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json.
- Changed-file ESLint and git diff --check.

The user's unrelated safety source currently adds one existing local TypeScript error and affects safety tests. Isolated regressions substitute committed safety source in memory; they never restore or rewrite the working tree. Committed repository-wide TypeScript baseline is 29; isolated T-PR3 retains 29, and the full unrelated working tree has 30 (safety controller/service return mismatch). This PR adds zero diagnostics.


## Mutation consistency and issue operation identity (closure correction)

Issue creation and substitute acknowledgement run in MongoDB transactions.
Transactions make real internal revision-counter writes (not no-op updates) to
the current User, Branch, immutable period/version, academic references, and
the exact assignment or substitute documents supporting authorization. After
acquiring those fences, the existing authoritative queue/scope functions
revalidate committed state for the same occurrence and version; they run again
before commit to check temporal validity and permissions. Failure rolls back
the issue/acknowledgement and all fences. The successful response uses the
validated committed mutation snapshot rather than a post-commit read that could
incorrectly report rejection after a successful write.

Version and substitute approval publish inside transactions sharing the branch
fence (and period fence for substitutes). This prevents phantom winners or new
replacements appearing during a Teacher mutation. Ordinary revocation,
retirement, reference, and account updates conflict with the corresponding
document fences. Internal __v counters can advance; immutable schedule values
and their historical references do not change.

**Deployment prerequisite:** a MongoDB replica set or sharded cluster supporting
transactions. Startup checks topology before accepting traffic; a standalone
MongoDB deployment cannot serve timetable mutations. There is no unsafe
nontransactional fallback. Configure a replica set before deploying this PR.

Issue POST requires clientOperationId matching [A-Za-z0-9_-]{16,80}; actor and
branch always come from server authorization. The unique key is
branchId + createdBy + clientOperationId. Identical retries return the same
logical occurrence result with one persisted issue. Reusing an operation ID
with different period/date/reason returns 409. Distinct operation IDs permit
multiple issues, including repeated reasons, for the same occurrence.
canRequestIssue expresses permission, not whether an earlier report exists.

The form generates a non-secret operation token when submission begins.
Unchanged input after an uncertain failure reuses that token; editing the
reason deliberately starts a different operation. Confirmed completion clears
the token, and a later issue generates a fresh one. The synchronous action
guard excludes duplicate active submissions. Mutation 401/403/404/409 triggers
an authoritative refresh to remove stale capabilities.

### Existing database index reconciliation

No migration framework exists. Before traffic, ensureTimetableIndexes creates
and verifies schema indexes, including teacher_issue_operation (unique actor/
branch/operation with a string-key partial filter), before removing ONLY the
known one_teacher_occurrence_issue index with its expected unique key.
An unexpectedly named restrictive index fails startup rather than silently
leaving the workflow locked. Legacy issue rows without operation IDs are
retained unchanged and excluded from the new partial index; all new API writes
require operation identity. Reconciliation is repeatable; index creation/drop
failure prevents listen. Deploy with writers stopped and one consistent new
application version; old application binaries must not recreate the obsolete
index during a rolling deployment. Back up and inspect indexes before rollout.

Authorization scope and operational queue reads explicitly use the MongoDB primary. This is required for fences to remain valid even when a deployment URI configures secondary reads; the shared Teacher scope change affects read preference only, with tuple policy unchanged.
