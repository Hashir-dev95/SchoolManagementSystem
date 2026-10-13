# T-PR4: period attendance

## Compatibility and canonical grain

Legacy `Attendance` remains daily (`branchId + studentId + date`) and its Principal/admin summaries are unchanged. Historical daily rows are neither migrated nor interpreted as period marks. There is no existing attendance editor or encrypted mobile draft store. Supported statuses remain `present`, `absent`, `late`, `leave`; half-day is not introduced.

The legacy unique index uses the exact stored `Date` value; its schema does not normalize that value to a civil-day boundary. Existing summary code uses server-local day ranges. Those legacy semantics are preserved, not presented as the new period attendance contract.

New period attendance uses `branch + AttendanceSession + student`. An `AttendanceSession` identifies an immutable timetable period definition, its effective version, and one school civil date. A unique occurrence index prevents concurrent lazy creation from duplicating that identity. Approved substitution changes responsibility for that occurrence, not its identity or general Teacher assignment authority.

## Operational source and eligibility

All queue, session detail, and writes consume T-PR3's authorized timetable occurrence resolver. Highest effective approved revision, start-inclusive/end-exclusive windows, intentional earlier-approved fallback, approved replacement room/time, school timezone and original/substitute responsibility rules remain unchanged.

Today's and past approved school-date occurrences are eligible; future civil dates cannot open attendance. Eligibility is date-based, not an automatic period-end job. The default pending queue covers the current school date; its optional `date` selects a past/current date. Past sessions can also be opened from timetable period detail. No rollover automatically finalizes or marks anything.

`GET /api/teacher/attendance/pending?date=YYYY-MM-DD` returns `{date, timezone, total, sessions}`. Each entry contains the authorized period context, nullable session ID, state, and revision. An eligible occurrence without a stored session is an open obligation. Submitted sessions disappear from this queue. Pending is a workflow condition, never an absence count.

Future Home invariant: **Attendance Pending count = this same authorized queue's total**. No dashboard predicate or fabricated count is added.

`GET /api/teacher/attendance/occurrences/:periodId?date=YYYY-MM-DD` lazily opens/resolves a session. `GET /api/teacher/attendance/sessions/:sessionId` reloads it. Opening may create session metadata; it never creates student marks. GET bodies and unknown query fields are rejected.

## Roster and privacy

Roster membership requires current Student branch/class/section/isActive plus a current active student-role User in that branch. One scoped aggregate joins a minimal identity projection. Student rows expose exactly `studentId`, `fullName`, `admissionNumber`, and explicit `status` or null.

The SHA-256 `rosterVersion` hashes deterministically ordered student IDs, identity IDs, names, and admission numbers. Snapshot storage retains IDs and the hash, not private profiles. Any membership/display identity change requires review. Internal identity IDs, fence counters, operation fingerprints, raw audit and private Student/User fields are excluded from Teacher DTOs.

Finalized history remains immutable even if enrollment later changes. Detail flags `rosterChanged` and displays current enrollment with missing marks as Unmarked; newly enrolled students do not receive historical automatic marks. Submitted obligations are not reopened automatically. Historical corrections and administrative attendance reporting are later work.

## Explicit marks, draft and submission

States are `open -> draft -> submitted`, with repeated draft revisions permitted. `PeriodAttendanceRecord` has required explicit status and **no absent default**. Missing record always means Unmarked. Clearing a mark explicitly deletes that record.

`POST /api/teacher/attendance/sessions/:sessionId/draft` and `/submit` accept exactly:

```json
{
  "revision": 0,
  "rosterVersion": "64-lowercase-hex-character-hash",
  "clientOperationId": "attendance_operation_0001",
  "marks": [{"studentId": "24-character-object-id", "status": null}]
}
```

Every request supplies the complete editor roster; draft permits null. Submit requires a nonempty roster and an explicit supported status for every member. Unknown/duplicate students or unsupported statuses are rejected. No omitted student is synthesized as absent. Marks, session transition, revision and operation audit commit atomically; failures preserve the previous state.

## Authorization, races and replay

Only current active authenticated Teachers with `teacher.attendance.view` and, for writes, `teacher.attendance.manage` may use this domain. T-PR3 timetable view remains a prerequisite for resolving operational responsibility. Same branch or a shared assignment tuple without period responsibility is insufficient. Actor/branch are server-derived; body spoof fields are rejected. Unavailable scoped IDs use concealed 404; malformed IDs use 400.

An approved substitute may access attendance roster **only for their authorized occurrence**. This does not add Classes/Roster/student-object authority. Original Teacher access is removed while approved substitution is effective.

Attendance reuses T-PR3 `mutateOccurrence` transactions/fences; the only shared helper change exports its existing guard with a typed generic result. Identity, branch, version, period, academic references, direct assignments or substitute authority are fenced/revalidated. Attendance additionally fences registered login-session rows and scoped enrollment/User records. Supporting counters use native internal writes; rejected transactions roll them back with all records/audit.

Trusted `createStudent` now shares the branch publication fence inside a transaction. A fresh document with stable ID is instantiated per retry. Existing records moving out conflict with enrollment fences. There is currently no enrollment transfer/reactivation/deletion API. **Any future enrollment mutation that can introduce a member must acquire the same branch fence (both branches for transfers, ordered consistently), with enrollment changes in that transaction.** Direct database administration bypasses application mutation protocols and is not a supported concurrent enrollment workflow.

Revision or roster mismatch returns 409 requiring review. Submitted state rejects new edits. A mutation invalidated before acquiring its supporting locks rejects with zero domain writes. A concurrent invalidation arriving after those locks waits, so the authorized attendance commit precedes withdrawal; both cannot commit in the opposite unsafe order.

Operation ID format is `[A-Za-z0-9_-]{16,80}`. Unique identity is server branch + actor + operation ID. Fingerprint includes session, action, supplied revision, roster hash and sorted explicit marks. Same key/same payload returns its original revision/state without another mark/audit transition; changed payload returns 409. Replays still require current occurrence/session authority. Distinct operations use new IDs. Atomic audit retains actor/time/revision/action and status changes; it is not returned to Teacher screens.

## Frontend and offline boundary

Home adds an honest Attendance Pending shortcut; period detail adds Open attendance. Teacher stack parameters contain period ID and civil date only. Home routing and the five primary destinations remain intact.

Queue uses existing focus/pull refresh and generation guards. Editor uses the same Hira DashboardShell/Card/SectionCard/ScreenHeading/Button/StatusBadge/theme presentation. Unmarked is visible separately from Absent; bulk Present is an explicit button followed by individual overrides.

Edits remain in memory. Focus/pull refresh cannot silently replace dirty marks: authoritative data appears in a review panel and saving is blocked until explicit acceptance. 401/403/404/409 mutation responses reconcile capabilities while retaining the failure and local edits. Unsaved navigation warns; navigation during a write waits for server confirmation.

A submission workflow captures one operation ID. Uncertain failures retain marks and ID for unchanged retries. Intentional edits/action/context changes use a new identity. Confirmed success clears the operation and reloads current server state. No optimistic success is shown. No roster is persisted to plaintext local storage.

Future encrypted offline replay must retain session/occurrence, operation ID, revision, roster hash and minimal explicit marks, then use these same endpoints with **current** assignment/session reauthorization. Revoked offline authority must fail; missing rows never mean absence. Secure local persistence and a sync engine are follow-ups.

## Deployment, indexes and limits

Existing transaction-capable MongoDB replica set/sharded-cluster prerequisite remains mandatory; standalone is unsupported. Startup establishes attendance occurrence/row/operation unique indexes and the active scoped enrollment index before listening. Index/topology failure fails closed. No legacy attendance index or data is dropped.

Queries load one authorized school date, batched timetable references, one scoped roster aggregate and that session's explicit marks. Writes permit at most 2,000 roster rows. No guardian population or per-student authorization query is added. Supporting roster fences use batched writes. Branch fences serialize publication, lazy opening and attendance writes within a branch; ordinary queue/session-detail reads remain unfenced. Monitor contention before higher-scale rollout.

Attendance correction approvals, reminders/escalation, analytics, encrypted offline storage, and full Home aggregation are intentionally deferred.

## Validation at T-PR4 implementation

- Backend: 324/324 (Teacher scope/roster 59, timetable 53, attendance 49, bootstrap 17, approvals/resubmission 47, Principal authorization 50, Principal writes/tasks/safety 49).
- Frontend: 174/174 across 16 suites, including 29 attendance UI tests and four attendance service tests. One concurrent cold run hit the existing Principal-task native-render timeout; the idle rerun passed with its original timeout and assertions.
- Security tests use real Express middleware, MongoDB replica-set transactions, actual indexes and controlled concurrency. Rejected staged writes assert zero records/audit and rolled-back fences.
- Regression isolation overlays unrelated safety and frontend working-tree files with committed HEAD contents in memory; no user's files are restored or edited for testing.
- Repository TypeScript: HEAD 29, isolated T-PR4 29, full working tree 30. The sole extra full-tree diagnostic is the unrelated safety service/controller `void`/`ISafetyAlert` mismatch. Backend source and scoped Teacher frontend diagnostics are zero in isolation.
- Changed-file lint and whitespace checks pass. Pre-existing file bytes and Git index remain unchanged. Nothing is staged, committed or pushed.
