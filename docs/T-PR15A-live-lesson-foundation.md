# T-PR15A — Live Lesson Foundation

Branch: `feture`. Backend foundation only. No staging, commit or push.

## A. Repository discovery

`teacher-timetable.service.ts` is the existing operational occurrence authority:
highest approved version per civil day, immutable periods, approved exact-day
substitutions, and replacement removing the original Teacher's operational access.
`mutateOccurrence` fences User, Branch, timetable version/period, catalog objects,
substitute and applicable TeacherAssignments, then revalidates current authority.
Publishers share persisted Branch/period fences. `withAcademicCatalogLock` supplies
the same Branch fence for enrollment/curriculum mutations. Replica-set transactions
are already a deployment requirement. These are reused, not replaced.

`requireClassSubject` owns managed Class/AcademicPeriod/curriculum validation.
`currentAcademicActor` reloads the DB account. Existing role permissions are shared
by route middleware and services. Sessions are persisted and revocable. Startup
explicitly installs indexes before listening. Configuration uses server environment
variables. Existing roster membership deliberately permits zero-enrollment legacy
fallback; live lesson authorization cannot safely use that reader.

## B–C. Domain and lifecycle

`LiveLessonSession` stores Branch, AcademicPeriod, timetable version/period/date,
Class/Section/Subject, scheduled Teacher, actual host, optional substitute, provider,
opaque room, scheduled instants, lifecycle timestamps, revision and transition history.
One logical session per immutable period/date. There are no contradictory booleans.

Start lazily creates `scheduled`, transitions through `starting` to `live`, and returns
the credential after transaction commit. All three history entries persist together.
Only `live → ended` is currently callable; repeated end returns the same metadata.
`cancelled` and `failed` are reserved terminal states, with no endpoints granting
arbitrary transitions. Credential/configuration failure aborts the entire transaction:
no falsely-live session, no committed partial starting record. A retry can recover.
For an already-live retry, signer failure leaves that existing state intact.
Here `live` means the application authorized opening the lesson; it is not proof
that a provider participant connected. Provider presence belongs to later phases.

## D–F. Occurrence, Teacher and substitute authority

Client supplies only period ID and civil date. Class, Section, Subject, scheduled
Teacher and replacement are resolved from existing timetable authority. Current
DB role/account/Branch, current Teacher scope, effective assignment, approved
winning timetable version, weekday and catalog are revalidated under existing fences.
Managed curriculum is required, with active AcademicPeriod and occurrence date in
its half-open `[startDate, endDate)` range. The provider receives no academic decisions.

The approved occurrence-specific substitute policy is reused unchanged: the
replacement must be the current actor, exact period/date and approved; its effective
clock replaces the original clock. A substitute is not required to hold an extra
ordinary assignment to that class, consistent with existing timetable policy.
Original Teacher operational access is removed while that replacement is approved.
The session pins its host/substitute context; replacement changes after start deny
further credentials rather than silently transferring an existing room's host.
The stored active host may end their session even after timetable retirement or
assignment revocation. This avoids trapping a session behind retired operational context.

## G–H. Student authority and legacy enrollment

User → active Student profile → explicit StudentEnrollment. User and profile Branch
must match. Enrollment must exactly match stored Branch/AcademicPeriod/Class/Section,
have active status, valid effectiveFrom at or before now, and no effectiveTo.
No Student.classId/sectionId fallback exists. Stale legacy projections do not override
managed membership. Legacy-only students require an explicit managed-enrollment
migration before they can receive credentials. Withdrawal, transfer and promotion
remove current access. The current host occurrence/curriculum is revalidated too.

## I. RBAC

New narrow permissions: `liveLesson.view`, `.start`, `.join`, `.end`.
Teacher receives view/start/end; Student receives view/join. Principal receives none.
Super Admin's broad permission enumeration explicitly excludes the entire namespace.
Services enforce current DB role and permissions in addition to route middleware.
Mutation login checks verify the JWT again and fence the exact unrevoked persisted
session and account. Identity fields in request payloads are rejected.

## J–L. Provider boundary and secure ZEGOCLOUD tokens

`RtcProvider` exposes only room derivation and local participant signing. A factory
isolates concrete provider selection; academic service code depends on that boundary.
Signers must be side-effect-free and network-free because transactions can retry.
Tests inject a fake provider; production defaults lazily to `ZegoRtcProvider`.

The adapter implements the documented Token04 encrypted wire format using Node's
crypto primitives, without adding a media SDK or copying an SDK's logging behavior.
The room-bound payload grants login to both roles and publish only to the host.
Student credentials are receive-only for this foundation; future student publishing
requires an explicit policy change. These grants do not confer School-App end or
administrative action authority. The adapter uses fresh IV/nonce and per-participant
tokens. TTL defaults to 300 seconds, configured between 30 and 600 seconds, and is
clamped to the scheduled end (so final credentials may be shorter than 30 seconds).
No class-wide token cache exists. Tests decrypt synthetic Token04 credentials to
check the envelope, room, identity, expiry and grants; no external provider is called.

References checked during implementation:
[ZEGOCLOUD authentication documentation](https://www.zegocloud.com/docs/video-call/token?platform=web&language=javascript),
[official server assistant and privilege payload](https://github.com/ZEGOCLOUD/zego_server_assistant),
[official Token04 wire implementation](https://github.com/ZEGOCLOUD/zego_server_assistant/blob/master/token/java/token04/src/im/zego/serverassistant/utils/TokenServerAssistant.java).
Deployment must enable provider room-login/publish privilege validation; the backend
fails closed unless the configuration explicitly acknowledges this prerequisite.

## M. Provider identity and PII

Rooms and users use scoped HMAC-derived opaque identifiers. Room derivation includes
the globally unique session identity; participant derivation includes session and
authenticated actor identity. Branches, years and recurring days cannot share a
room accidentally. Names, email, phone, admission number and raw account IDs are
not sent as provider identities. Existing rooms retain their stored identity across
secret rotation; rotation needs normal provider operational coordination.

## N–O. Idempotency and concurrency

Database uniqueness on period/date and provider/room is explicitly installed before
traffic. Start/start serializes through the existing persisted Branch/period fences,
including across Node processes. Retrying the same authorized host returns the
same session/room with a fresh bounded credential, without additional lifecycle entries.
Terminal sessions cannot restart or create a replacement for the same occurrence.

Current authority and credential construction happen inside existing occurrence
transactions. AcademicPeriod/ClassSubject and Student/User/Enrollment/Login/session
documents are additionally fenced where applicable. Enrollment and timetable
publishers share the Branch fence, preventing phantom replacements/memberships.
End/join also serialize through that fence. Tests hold a real DB transaction in one
process and confirm another reaches the fence before committing revocation, then
verify denial after retry. No in-memory lock establishes correctness.

Authorization is linearized at successful transaction commit. Already-issued RTC
tokens remain valid until their short expiry; this foundation does not remotely
evict participants or revoke provider credentials. Ending stops new issuance.
Media teardown and provider-side revocation are deferred, as requested.

## P. Historical reads

Metadata reads use stored session context, not the current winning timetable or
active curriculum. Current active Teacher account in the same Branch may read its
stored scheduled/host sessions. An active Student in the same Branch needs an
explicit enrollment covering the stored scheduledStart, including properly closed
historical membership. Legacy fallback remains denied. Retiring a timetable or
closing a period does not remove authorized history. DTOs never return history
fences, provider secrets, connection tokens or unrelated participant PII.

## Q. Callback boundary

`RtcProviderEvent` defines provider-neutral room/participant and future recording
event names with event identity, room and occurrence instant. There is no callback
HTTP endpoint, invented provider payload, or unverified public ingestion. Future
adapters must add real provider authenticity verification, mapping and persisted
deduplication before any callback can alter lifecycle. Recording processing is deferred.

## R–S. APIs and DTOs

All routes are authenticated, role/permission checked and `Cache-Control: no-store`:

| Method | Path | Input / purpose |
| --- | --- | --- |
| POST | `/api/live-lessons/from-timetable/:periodId/start` | `{date: "YYYY-MM-DD"}`; host credential and session |
| POST | `/api/live-lessons/:id/join-token` | `{}`; Student credential and session |
| POST | `/api/live-lessons/:id/end` | `{}`; idempotent host end |
| GET | `/api/live-lessons/:id` | metadata, including historical reads |

Unknown query/body fields are rejected. No arbitrary room creation or generic CRUD.
Session DTO: ID, period/date, academic/class/section/subject IDs, scheduled times,
status/revision, startedAt/endedAt. Read adds school timezone. Credential response:
provider, public AppID, opaque room/user IDs, role, token and expiresAt. Credential
responses never include permanent secrets. Unexpected errors are sanitized.

## T. Configuration

Only `backend/.env.example` changes; real `.env` is untouched.

| Variable | Behavior |
| --- | --- |
| `LIVE_LESSON_ENABLED` | Exact `true` required for production credentials; defaults disabled |
| `ZEGOCLOUD_APP_ID` | Positive uint32 public app identifier |
| `ZEGOCLOUD_SERVER_SECRET` | Server-only 32-byte printable ASCII Token04 secret |
| `ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED` | Exact `true`, acknowledging provider privilege checks are enabled |
| `LIVE_LESSON_TOKEN_TTL_SECONDS` | Default 300; integer 30–600 |
| existing `SCHOOL_TIMEZONE` | Civil timetable conversion; defaults Asia/Karachi |

Configuration is checked lazily after authorization, so an optional unconfigured
provider does not crash unrelated application startup. Missing/invalid provider
configuration returns sanitized 503. Signing failure returns sanitized 503 and
rolls back new-session changes. Validation/state/window failures return 400/409;
authentication/permission failures return 401/403; unavailable scoped resources 404.
Host start is permitted from 15 minutes before scheduledStart until scheduledEnd;
Student join requires live state in the same window. No post-end issuance.
School time conversion round-trips civil instants, failing closed for nonexistent
DST times. The early-start policy is one named central service constant.

## U. Indexes

`unique_live_lesson_occurrence`: unique periodId/date.
`unique_live_lesson_room`: unique provider/providerRoomId.
Branch/AcademicPeriod/status/scheduledStart index supports lifecycle lookup.
`ensureLiveLessonIndexes()` runs from server bootstrap before listening, including
when autoIndex is disabled. Focused tests exercise real uniqueness constraints.

## V–X. Validation

Final focused suite: **42 passed / 42**, including separate-process start/start,
retirement, assignment revocation, substitute revocation, withdrawal and transfer races.
The original 305/308 regression result was blocked by an accidental concurrent
attendance-history import typo. The explicitly authorized recovery corrected only
that import, retaining all existing formatting. The three previously failing tests
now pass **3/3**, and the focused suite was rerun successfully **42/42**.
Full regression recovery results are recorded in the A–P recovery report below.
Changed-file ESLint and `git diff --check` pass. Backend TypeScript now reports only
the known `safety-alert.controller.ts:47` TS2322, classified as an
**UNRELATED RELEASE GATE**, not a T-PR15A implementation blocker.
Original local evidence is in `.validation-tpr15a/`:
focused-final.log, regression.log, regression-recheck.log, typescript-final.log,
lint-final.log, lint-rbac.log, before.patch and before-status.txt.
No tests require a real provider secret, paid room, media minutes or external
provider network request. The owned MongoDB replica-set binary is cached locally.
Frontend files are untouched, so frontend TypeScript is not applicable.

## Y. Exact implementation files

New:

- `backend/src/models/liveLessonSession.ts`
- `backend/src/services/live-lesson.service.ts`
- `backend/src/services/rtc/rtc-provider.ts`
- `backend/src/services/rtc/provider-factory.ts`
- `backend/src/services/rtc/zego-rtc-provider.ts`
- `backend/src/routes/live-lesson.routes.ts`
- `backend/tests/live-lesson.security.test.ts`
- `backend/tests/helpers/live-lesson-worker.ts`
- `docs/T-PR15A-live-lesson-foundation.md`

Existing clean-at-baseline integration files:

- `backend/src/constants/permissions.ts`: four permission constants.
- `backend/src/constants/rolePermissions.ts`: Super Admin namespace exclusion;
  Teacher view/start/end and Student view/join grants.
- `backend/src/app.ts`: router import and `/api/live-lessons` mount.
- `backend/src/server.ts`: index helper import and awaited bootstrap installation.
- `backend/.env.example`: seven-line optional configuration block.
- `backend/tests/approval-authority.security.test.ts`: exclude `liveLesson.*`
  from the existing exact Super Admin permission expectation.

## Z–AB. Mixed files and preservation

No initially dirty file was edited for T-PR15A; there are no T-PR15A mixed-file hunks.
The six existing integration/test files above were clean at the captured baseline.
`before.patch` preserves the initial full binary diff; `before-status.txt` records
tracked/untracked state. No reset, restore, clean, staging, commit or push was used.
The baseline patch SHA-256 is
`677779CAA16080F8E0E7CF3E748F4D2D2146783E2978BF1D6D73FF795E18BDE2`.
The index remains empty, as it was at discovery.
Unrelated files continued changing externally while this task ran, including
temporary automation and attendance-history import errors. Those edits were not
repaired or rolled back. This report claims preservation of agent-unmodified work,
not that concurrent external work remained byte-identical throughout execution.

## AC. Deferred scope

T-PR15B/C/D were not begun. No media SDK/UI, preview, native media permissions,
waiting room, admission, moderation, chat, presence, reconnect UX, recording control,
callback processing or recording library is implemented. Android visual/RTL/device
QA, iOS staff file opening, and legacy enrollment migration remain separate gates.

## AD–AE. Final review result

The attendance-history import blocker has been safely recovered under the follow-up
request's explicit authorization. The known safety-controller TS2322 remains an
unrelated compiled-release gate. No T-PR15A implementation was changed during recovery.
The current validation and verdict are recorded in the recovery report below.

## Validation blocker recovery — A–P report

### A–C. Root cause, baseline comparison and recovery classification

**A — accidental concurrent typo / mechanical drift.** At HEAD
`489d8a536afdb4658e1e069e0659baec00035f62`, the historical attendance reader imports
`scheduleWeekday`. The original baseline status and full binary patch contain no
change to this file, so its pre-T-PR15A baseline equals HEAD. The captured baseline
patch still matches SHA-256
`677779CAA16080F8E0E7CF3E748F4D2D2146783E2978BF1D6D73FF795E18BDE2`.
There is no dirty semantic change to this file in that baseline to reconstruct.

The current pre-recovery file had been reformatted from 66 to 157 lines and its
import at line 12 renamed to nonexistent `scheduleWeekdays`, while line 41 still
called `scheduleWeekday`. Formatting both versions with the repository's Prettier
configuration proves they are identical after correcting just that import. Thus
the import change occurred after baseline capture and is unrelated to Live Lessons.
No other semantic change was found; the concurrent formatting is preserved.

Exact recovery hunk:

```diff
-import { scheduleWeekdays } from './school-date.service';
+import { scheduleWeekday } from './school-date.service';
```

No whole-file restore was used. `recovery/attendance-history.before.ts` and
`recovery/before.patch` preserve the pre-recovery contents. The audit confirms the
edited file is byte-identical to that copy after the single import replacement.

### D–G. Validation

The three original failing attendance-history tests pass **3/3**:

- Managed Section transfer changes the new roster without rewriting submitted attendance.
- Submitted attendance remains readable after authorized timetable retirement.
- Promotion/withdrawal retains Student portal work, submissions, results, catch-up and attendance.

T-PR15A focused security/concurrency suite: **42/42 PASS**.
Full eight-suite regression result: **308/308 PASS** (one complete recovery run).
Suites: Teacher scope, Teacher timetable/substitution, StudentEnrollment,
TeacherAssignment administration, academic foundation, bootstrap/auth,
approval authority/RBAC, and staff self-service.
Changed-file ESLint: **PASS**, including the recovery file and all T-PR15A source/tests.
`git diff --check`: **PASS**. Backend TypeScript: exactly one diagnostic,
`safety-alert.controller.ts(47,49) TS2322: Type 'void' is not assignable to type 'ISafetyAlert'`.
No T-PR15A or attendance-history diagnostic remains. Frontend code is untouched.

Recovery evidence is under `.validation-tpr15a/recovery/`:
`attendance-three.log`, `focused.log`, `regression.log`, `typescript.log`, `lint.log`,
`diff-check.log`, `comparison.json`, `before-hashes.json`, `preservation.json`,
`attendance-history.before.ts`, `before.patch`, `before-status.txt` and `audit.cjs`.
Tests use local owned replica sets and fake/synthetic RTC credentials. No provider
account, paid media, network provider request, device or media SDK is required.

### H. Security recheck

The 42 passing focused tests and source review reconfirm foreign/wrong Teacher
denial; explicit matching StudentEnrollment with no legacy class/section fallback;
approved exact-occurrence substitutes and original Teacher displacement; duplicate
start convergence across Node processes; bounded room/user-scoped credentials;
server-only permanent secrets; no automatic Principal/Super Admin participation;
history independent of current timetable authority; and ended-session join denial.
Real database races against timetable/assignment/substitute/enrollment changes pass.

### I. Token04 review

Rechecked against the official
[ZEGOCLOUD Token04 server assistant](https://github.com/ZEGOCLOUD/zego_server_assistant/blob/master/token/java/token04/src/im/zego/serverassistant/utils/TokenServerAssistant.java)
and [official privilege payload documentation](https://github.com/ZEGOCLOUD/zego_server_assistant).
The adapter uses positive uint32 AppID, a 32-byte ASCII server secret, expiry in Unix
seconds, user identity below the 64-character limit, encrypted room-bound payload,
login grant 1 for both roles and publish grant 1/0 for host/Student. AES-256-CBC,
16-byte IV, int64 big-endian expiry, length-prefixed IV/ciphertext, base64 and `04`
prefix match the reference. Node crypto supplies a fresh random nonce and IV.
Configured TTL is 30–600 seconds, default 300, capped at lesson end. Source review
finds no token/secret logging and no frontend reference to the server secret.
Synthetic decryption tests verify claims, grants, identity and expiry offline.
No adapter change was required.

### J. Deployment prerequisites

Valid provider AppID and server secret; provider project room-login/publish privilege
validation enabled; `LIVE_LESSON_ENABLED=true` and
`ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED=true`; transaction-capable MongoDB; indexes
installed before accepting traffic; and explicit StudentEnrollment migration for
legacy-only students. These remain deployment prerequisites, not feature code blockers.

### K–M. Exact files, mixed files and preservation

The exact T-PR15A feature file list remains section Y above. No feature source,
adapter, route, permission, model or test was changed during recovery. The only
additional source edit is the separately authorized one-line attendance-history
repair above; this report was updated. The recovery file contains pre-existing
concurrent formatting and that one recovery hunk, so it must be reviewed as a
separate mixed repair, not included as wholesale T-PR15A feature work.
There are still no mixed T-PR15A implementation files.

SHA-256 snapshots cover all tracked regular files and new T-PR15A source/tests.
Only the attendance-history import and this report changed during recovery;
all unrelated tracked work and T-PR15A implementation bytes are preserved.
The original baseline patch is untouched. The index remains empty. Nothing was
staged, committed or pushed. No T-PR15B/C/D media, waiting room, presence/reconnect,
recording, or callback ingestion endpoint was added.

### N–P. Release gate, code blockers and verdict

The safety controller has no working-tree diff from HEAD (raw byte differences are
line endings), and its hash is unchanged from the recovery snapshot. Its existing
TS2322 is **UNRELATED RELEASE GATE** for a compiled backend release. It is not assigned
to T-PR15A and was not modified. No demonstrated T-PR15A code/security/data-integrity
blocker was found. The previously failing tests pass 3/3, focused suite passes
42/42, and full requested regression set passes 308/308.

**READY TO COMMIT**
