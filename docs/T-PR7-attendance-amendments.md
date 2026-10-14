# T-PR7: student leave and submitted attendance corrections

Submitted attendance remains immutable. Original status, actor, submission timestamps, roster evidence and session revision are preserved. `effectiveAttendance` combines each original record with its latest valid approved correction; pending and rejected requests have no effect.

## Workflows and authority

Teacher Classes ? Timetable ? Period ? Attendance ? student review. Open/draft attendance still supports explicit pre-marking and can request student leave. Submitted attendance offers correction/history, never an editable draft. Reasons require 10–500 characters, statuses use the existing present/absent/late/leave domain, and no-op corrections fail server validation.

Student leave is a separate date-range authorization record. Approving leave never rewrites attendance. A post-submission change to `leave` requires an approved leave covering that student/date and a separate approved correction. No Parent leave portal is added.

Teacher actions revalidate current DB identity, registered session, branch, active assignment and effective substitute occurrence. The normal Teacher has no simultaneous authority when a substitute owns the occurrence. Submitted roster IDs and original records establish student membership; same-branch class moves do not erase historical evidence.

Principal review reuses the existing approval inbox and trusted `PRINCIPAL_APPROVAL_AUTHORITY` configuration. Deployments must explicitly grant the authorized Principal `attendance_correction` and/or `leave` in their existing branch-bound `types` list. Default is deny. No grant is inferred from role alone. Generic approval/delegation endpoints cannot resolve these typed entities; decisions must use the transactional attendance handler. No changes-requested/resubmission or delegation policy is introduced for attendance.

## API

All routes are under `/api`, require a registered authenticated current active identity, and return minimal DTOs. Teacher routes require Teacher; review routes require Principal. Foreign objects are concealed; request bodies and query parameters are allowlisted. Responses have `Cache-Control: no-store`.

- `GET /teacher/attendance/sessions/:sessionId/students/:studentId/review?offset=0`
- `POST /teacher/attendance/sessions/:sessionId/students/:studentId/corrections`
- `POST /teacher/attendance/sessions/:sessionId/students/:studentId/leaves`
- `GET /attendance-review/:approvalId`
- `POST /attendance-review/:approvalId/decision`

Creation and decisions require stable `clientOperationId` (16–80 ASCII letters/digits/underscore/hyphen). Same operation/payload replays the existing result; changed payload conflicts. Corrections require submitted and effective revision; decisions require request revision. A single pending correction per session/student and a unique approved effective version are enforced by startup indexes.

Transactions fence current source authority, users, registered sessions, occurrence, submitted session and student; decisions also fence the reviewer and any approved leave proof. Request + approval records, terminal decisions + generic audit history + downstream suppression commit together. Racing decisions produce one terminal state. The replica-set transaction requirement is unchanged from T-PR3/T-PR4.

## Correction-safe downstream boundary

The repository has no absence-notice producer, Catch-up domain or delivery worker. This phase adds delivery **intents**, not a new messaging/task module or outbound sender.

`ATTENDANCE_ABSENCE_GRACE_MINUTES` is optional trusted configuration (integer 0–10080). Absent configuration disables intent staging. When configured, only explicitly submitted effective `absent` marks stage versioned `absence_notice` / `catch_up` intents. Missing/unmarked attendance creates neither student absences nor these intents. Every intent starts with independent approval pending; elapsed grace alone never authorizes sending.

An approved correction suppresses all pending intents for that student/session atomically. Old version intents cannot pass `absenceIntentIsCurrent` even if stale work is requeued. Trusted future workers must check effective status/version, independent approval and grace immediately before delivery, and implement atomic claiming/delivery coordination before enabling outbound sending. This phase sends no notifications or catch-up tasks and cannot recall already delivered messages. No public endpoint can enqueue/approve/dispatch intents. Original Teacher reminder/coordinator workflows remain untouched.

## UI and deployment checks

Screens reuse Hira DashboardShell, SectionCard, Card, StatusBadge, AdminSelect/AdminDateField, AdminDialog, feedback, typography and theme colors. Confirmation includes student/current/requested/reason; Principal rejection requires a review note. Failed requests preserve entered fields, and focus/retry refreshes clear sensitive context while reauthorizing. Route/auth changes invalidate old asynchronous results.

Configure explicit Principal authority and optional grace policy before rollout. Repeat native Android visual/accessibility QA on a connected device; automated component coverage is not native visual acceptance. Exclude validation artifacts and unrelated worktree changes when preparing a commit.
