# PR-F1 — Canonical Notification Foundation

This is the official communication F1, not a Finance handoff PR. F2 inbox, F3–F5 chat and F6 event integration are not implemented here.

## Baseline and product evidence

- Canonical: `integration/team-merge`, HEAD `af6f947ba08cdbaf6b1e6fe84420c398b8244758`; initial worktree/index clean.
- Donor: `D:\Faraz-Reference`, `faraz-audit`, HEAD `293966bf7f477bd430133e91d9a87d75523782f4`; clean and unchanged.
- Read Hira_School_App_Features.pdf (73 pages): Teacher notifications/preferences p32 (also rendered/visually reviewed), Student own notifications p50, Parent notices/preferences/messages p66, related Parent alerts p55–56 and fee boundaries p63–64. These support recipient ownership, private child/class scope, safe links, read state, retained history and honest confirmation. They do not authorize inventing new Finance/chat/domain event producers in F1.

## Existing architecture and store inventory

| Component | Classification | Authority |
| --- | --- | --- |
| `models/notification.ts:Notification` | CANONICAL | Sole immutable delivered-notification record, now shared across supported roles |
| `NotificationReadOperation` | CANONICAL bookkeeping | Existing read-operation idempotency ledger, not another inbox/delivery store |
| `TeacherNotificationPreference` | CANONICAL configuration | Existing own-Teacher categories/quiet hours; not delivery truth |
| `SchoolNotice`, `TeacherNotice`, `SafetyAlert` | CANONICAL domain records | Authoritative source content/workflow, not alternate notification records |
| `NoticeDelivery` / `NoticeOperation` | CANONICAL domain evidence | Teacher-notice publication acceptance/operation metadata; no unread state, no notification read authority; preserved |
| Teacher screen/resource state | PRESENTATION CACHE | Existing API-derived transient state; no server authority |
| Donor notification collection and recordSnapshot | External reference only | Rejected as canonical authority; not imported |

Before F1, teacher-notification.service.ts owned Teacher-only creation, reads and preferences. Creation upserted arbitrary supplied recipient/source values without validating relationships or checking conflicting fingerprints. Read ownership existed, but the operation ledger and timestamp update were not atomic. Existing Teacher routes, notificationService.ts and TeacherNotificationsScreen.tsx are preserved as compatibility surfaces. There is no other canonical role inbox to migrate.

## One canonical service and supported delivery policies

`backend/src/services/notification.service.ts` is now the sole server-side delivery/read-state authority. The Teacher service delegates creation, DTO, get and mark-read to it; preferences and sessions remain in their existing service.

The producer is backend-only. There is no client create/send endpoint. Future producers must authorize their domain action before calling it; supplying a recipient ID is not authorization. The service validates the expected role/Branch against persisted active User and canonical source relationships.

| Source | Recipient policy | Content/navigation |
| --- | --- | --- |
| `system` | Current Teacher/Principal/Finance Branch role | Fixed generic summary; no link |
| `teacher_assignment` | Exact active, currently valid permanent assignment and canonical class/section/subject references | Fixed generic summary; no link |
| `student_enrollment` | Exact current enrollment and own active Student/User, Branch and academic references | Fixed generic summary; no link |
| `parent_student_link` | Exact verified link, active Parent/child, valid verifier and current child enrollment | Fixed generic summary; no link |
| `school_notice` | Existing Teacher-only published, unexpired Branch audience and notice-view permission | Canonical published title/short summary; typed inbox_notice reference only |

Unknown domain policies fail closed. No homework/result/payment/message producer was wired. Permanent assignment policy does not grant substitute/occurrence authority. Branchless/global recipients and future domain sources need an explicit canonical policy rather than a fallback Branch.

## Stale delivery and safe content

Delivery uses the existing Branch transaction fence and fences recipient User plus the applicable assignment/link, Student/User, verifier and academic-reference documents. It reuses getTeacherScope, resolveStudentReadScope and verifiedChild after those fences. Concurrent authority changes serialize/conflict with delivery. Time-sensitive assignment/notice authority is rechecked after the delivery write; expiry rolls back the new record. A dedicated delayed-write test proves that boundary.

No recipient login is required for trusted backend delivery; an offline recipient may legitimately receive a future inbox record. Active persisted recipient authority is required. User-facing reads/read mutations require canonical JWT/Session authentication.

Generic relationship/staff notifications contain fixed minimal text, not full objects, guardian information, grades, private notes or payment/provider data. School-notice summaries reuse the existing public-to-Teacher Branch publication policy and 280-character summary. Object references are typed canonical IDs, never arbitrary URLs/navigation strings. Opening an object always uses its domain authorization; a notification grants nothing.

## Dedupe and migration compatibility

The existing unique recipient/source/type/revision/event index remains the delivery identity. Same event retries converge on one record; changed intent/fingerprint returns 409. Different events and recipients remain separate. Authority is validated before dedupe, so an old event retry cannot bypass revoked recipient authority. Inconsistent historical Branch/role metadata cannot be returned by dedupe.

Existing Teacher publication fingerprints have a compatibility replay path; no historical content, fingerprint or collection is rewritten. Existing published-notice synchronization skips already-delivered publication identities, preserving old summaries if published content is later edited. Source archival/expiry prevents new delivery, not historical deletion. No migration or new collection/index identity was required.

## Historical retention and own read state

Legitimately delivered records remain stored after assignment/link/enrollment changes. An active owner in the same current Branch can read historical metadata; references still require current domain authority. Moving Branch conceals old-Branch notifications without deleting them. A supported role change does not transfer ownership to another User. Inactive users cannot read or receive new delivery.

F1 adds only:

- `GET /api/notifications/:notificationId`
- `POST /api/notifications/:notificationId/read` with `clientOperationId`

There is no generic list/inbox/send route. Existing Teacher list/get/read/preferences/session routes and UI remain. Foreign recipients/Branches and guessed IDs return safe 404; malformed selectors/body fields fail closed. Future-dated records cannot be opened/marked early, and new scheduled delivery is deliberately unsupported pending a delivery-time policy.

Mark-read atomically persists the existing operation identity and one server timestamp. Same-key retry is idempotent; conflicting operation reuse returns 409. User/Branch/Session are fenced and revalidated, JWT expiry is checked before commit, and failures roll back both operation and read state. Content/recipient/source fields are immutable. Teacher unread counts accept missing/null readAt; marking read never mutates the referenced object or creates another notification.

## Donor inspection

Inspected directly: `backend/src/notificationService.js`, `backend/src/userNotificationRoutes.js`, `src/mobileApp/shared/notifications/InboxNotifications.jsx` and `NotificationDrawer.jsx`. Own-recipient read/readAt semantics: ALREADY EXISTS/ADAPT NOW through canonical ownership. Inbox/drawer UX: DEFER TO F2. Domain event creation: DEFER TO F6. Donor runtime/auth/identity, raw store/API contracts, full recordSnapshot, navigation and generic providers: REJECT.

## Files changed

| Path | Change |
| --- | --- |
| `backend/src/models/notification.ts` | Extend the same model's role/source enums; no duplicate store |
| `backend/src/services/notification.service.ts` | Shared validated transactional delivery and own read-state authority |
| `backend/src/routes/notification.routes.ts` | Authenticated own-item GET/mark-read only |
| `backend/src/services/teacher-notification.service.ts` | Delegate shared authority, preserve preferences/sessions and historical publication behavior |
| `backend/src/routes/teacher-notification.routes.ts` | Supply canonical token and reject read-state query selectors |
| `backend/src/app.ts` | Mount the ownership primitive routes |
| `backend/tests/notification-foundation.security.test.ts` | New authority, stale delivery, history, dedupe, read-state and compatibility tests |
| `docs/integration/pr-f1-notification-foundation.md` | Product/architecture/retention and validation record |

No frontend, dependency, lockfile, native configuration, Finance authority or unrelated role source changed.

## Validation

| Check | Result |
| --- | --- |
| New foundation security tests | 24 PASS, 0 FAIL |
| Existing Teacher notification security | 33 PASS, 0 FAIL |
| Teacher scope/communications | 101 PASS, 0 FAIL |
| Student self | 17 PASS, 0 FAIL |
| Parent scope | 14 PASS, 0 FAIL |
| Finance / Principal authorization | 65 / 50 PASS, 0 FAIL |
| Backend total | 304 PASS, 0 FAIL; eight files |
| Existing notification service / Teacher screen | 1 / 8 PASS, 0 FAIL |
| Auth/session / Developer Preview frontend | 3 / 11 PASS, 0 FAIL |
| Frontend total | 23 PASS, 0 FAIL; four suites |
| Backend source TypeScript | PASS |
| Mobile source/test TypeScript | PASS |
| Root TypeScript comparison | 76 baseline, 76 final, zero introduced |
| Scoped ESLint | Seven TS files; zero errors/warnings |
| git diff --check | PASS |

Validation logs are under the existing ignored `.validation-principal-audit/notification-f1/` directory. Existing Teacher/client assertions are preserved. No dependency/native change; no Android/iOS build required.

## Deferred scope and Git discipline

F2: new role inboxes, pagination/filter UX. F3–F5: chat authority/models/messages/UI. F6: new domain producers/source policies and event integration. No event bus, push/FCM/APNs, SMS/email or automatic historical migration was added. Existing Teacher preferences prepare optional alert behavior but do not hide/delete internal records or claim external delivery.

Final branch/HEAD remain `integration/team-merge` / `af6f947ba08cdbaf6b1e6fe84420c398b8244758`. Four modified tracked files and four new files (including this report) remain unstaged; index is clean. No unrelated initial changes, merge in progress, commit, push, merge, cherry-pick, pull, reset, restore, stash or branch switch. Donor checkout remains unchanged.

Disposition: READY FOR REVIEW.
