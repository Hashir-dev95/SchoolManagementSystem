# PR-F2 — Canonical Notification Inbox

## Baseline and decisions (recorded before implementation)

Branch `integration/team-merge`; HEAD `ae44f9b2c196a5edd8668bf4712f862377bbad3b` (`f1`). Worktree and index clean; no merge in progress. Root TypeScript baseline: 76 diagnostics. No staging, commit, push, branch change or donor merge is authorized in F2.

F1's Notification collection, NotificationReadOperation idempotency ledger, persisted actor/current Branch checks, safe DTO, own detail and transactional mark-read remain authoritative. No second store or producer is needed.

| Capability | Current implementation | Donor behavior | Decision | F2 action |
| --- | --- | --- | --- | --- |
| Own notification list API | Teacher-only list; generic detail/read only | Role-specific lists with weaker scope | MISSING_MVP | Add `/api/notifications/me`; delegate Teacher compatibility list |
| Pagination | Teacher offset, fixed 50 | Fixed limited list | HARDEN | Strict offset/limit, default 25, max 100; explicit metadata |
| Stable ordering | Teacher availableAt DESC, _id DESC | Basic newest-first | COMPLETE | Preserve canonical order in shared list |
| Read/unread filtering | Missing | Read decoration only | MISSING_MVP | Validate all/unread/read on canonical readAt |
| Unread count | Teacher server count | Client decrements after read | HARDEN | Shared server count across visible own scope, independent of page/filter |
| Own-item detail | F1 safe ownership primitive | Raw record snapshots | COMPLETE | Preserve F1 DTO/ownership |
| Mark read | F1 transactional, idempotent | Timestamp mutation | COMPLETE | Reuse canonical operation ID contract |
| Student inbox | No navigation; PDF p50 requires own alerts | Student inbox/drawer | MISSING_MVP | Shared inbox and typed workspace entry; legitimate empty state |
| Parent inbox | No navigation; PDF p66 requires account alerts | Parent inbox/drawer | MISSING_MVP | Own account inbox independent of selected child |
| Teacher inbox | Existing list, preferences, sessions; no paging/filter UI | No equivalent canonical Teacher authority | HARDEN | Reuse shared inbox panel, preserve preferences/sessions and existing producer |
| Finance inbox | F1 backend role supported; no current event producer or inbox navigation | Finance inbox and raw finance snapshots | DEFER | Backend-ready shared read only; no dedicated screen/producer |
| Principal inbox | F1 backend role supported; no current event producer or inbox navigation | No applicable evidence | DEFER | Backend-ready shared read only; no dedicated screen/producer |
| Notification detail navigation | Teacher typed links; other role sources have no deep link | Raw detail drawer/arbitrary navigation | HARDEN | Re-fetch own detail; allow only existing typed Teacher destinations; domain API reauthorizes |
| Bulk mark-read | Absent | No necessary canonical behavior | DEFER | No bulk endpoint/action |
| Notification preferences | Teacher-only existing configuration | Broader settings | COMPLETE | Preserve Teacher configuration; defer expansion |
| Push/realtime | No provider/realtime delivery | Optional donor UI/runtime | DEFER | No implementation |

Super Admin remains unsupported: F1 requires a supported persisted branch role and active Branch. No branchless/global inbox policy is invented.

## Product and donor evidence

Existing authoritative Hira School App Features PDF: Teacher p32, Student p50, Parent p66. F2 adds own inbox access, not producers or child-record access. Finance/Principal navigation and producer searches found no current dedicated inbox exposure.

Read-only donor inspection: `D:/Faraz-Reference`, branch `faraz-audit`, HEAD `293966bf7f477bd430133e91d9a87d75523782f4`, clean. Inspected InboxNotifications.jsx, NotificationDrawer.jsx and F1's recorded notification API/service findings. ADAPT_NOW: readable list, unread indication, loading/empty/retry and request generation. DUPLICATE: own list/detail/read concepts already owned by F1. LATER: optional delivery/configuration. REJECT: donor auth/identity/store, raw snapshots, recipient selectors, arbitrary navigation and client-derived authoritative unread counts. No wholesale code copy.

## Supported roles and UI

| Role | Backend | Frontend decision |
| --- | --- | --- |
| Teacher | Shared canonical own list/detail/read; legacy route delegates | Existing Notifications & Preferences screen reuses the shared inbox panel; preferences/quiet hours/device sessions retained |
| Student | Shared canonical own list/detail/read | Typed StudentNotifications route and workspace button |
| Parent | Shared canonical own list/detail/read | Typed ParentNotifications route and account-level workspace button, available even without a selected verified child |
| Finance / Principal | F1 supported branch roles use the same list | Backend-ready; dedicated UI deferred until product producers/navigation justify it |
| Super Admin | 403, unsupported F1 role | Deferred; no invented global/branchless policy |

Student/Parent may have an empty inbox until later event integration. No sample deliveries, fake unread counts or new event producers were added.

## Canonical API and pagination contract

`GET /api/notifications/me` is registered before `/:notificationId`. It uses canonical authenticateToken (JWT, registered non-revoked Session, active persisted matching-role User), then F1 readContext/current active Branch. Cache-Control remains no-store.

Only `status=all|unread|read`, `offset` and `limit` are accepted. Defaults: all, 0, 25. Limit is 1–100; offset is 0–10000, preserving the existing bounded Teacher offset convention. Repeated/array/object, negative, fractional, exponential, empty and unsupported query fields fail with 400. Client userId/branchId/arbitrary sort selectors are rejected. Teacher compatibility keeps its legacy default limit 50, supports the same validated fields and runs its existing authorized notice reconciliation before the single canonical list read. The generic GET has no producer/reconciliation side effect.

Response envelope: `{ success: true, data: { items, status, offset, limit, total, unread, nextOffset } }`.

- `items` uses exactly F1 notificationDTO: notificationId, category, title, body, priority, createdAt, availableAt, readAt, source type/revision, typed deepLink or null.
- `total` counts the selected read filter; `unread` counts the entire visible own inbox, independent of page/filter.
- Visible scope: authenticated persisted User ID, current active Branch, availableAt <= request time. Historical recipientRole is not a new ownership selector.
- Sort: immutable availableAt DESC, _id DESC. One primary aggregation/facet produces the page and counts with the same match and time cutoff; no count queries with differing scopes.
- Unread: null/missing readAt. Read: BSON date readAt. NotificationReadOperation remains idempotency bookkeeping only.
- `nextOffset` is null at the end or beyond the permitted offset window. No unbounded response or cross-request cursor/snapshot was introduced.
- Offset pages have deterministic ordering for unchanged data. Concurrent deliveries/read-state changes may shift offsets under the existing offset model; the UI replaces pages and resets to page zero after its own read mutation rather than appending mixed snapshots.

F1 `GET /api/notifications/:notificationId` and `POST /api/notifications/:notificationId/read` state machine, safe missing/foreign semantics and transactional operation IDs are unchanged. List/detail/read use the same DTO.

## Frontend behavior and stale-response isolation

One shared NotificationInbox component and canonical typed service provide loading, empty/filter-empty, unread/read indicators, server unread count, All/Unread/Read filters, previous/next pages, retry, network errors, safe 401/403 and unavailable-reference states. Existing canonical DashboardShell, SectionCard, WorkspaceTabs, Button, StatusBadge and DashboardStateCard are reused. There is no second design system/store.

Account ID, token, role and Branch changes remount all inbox data/operation state immediately. Focus/request generations invalidate late list, filter, page, detail and mark-read responses, errors and finally handlers; blur/unmount invalidates requests. Filters clear old page data before loading. Synchronous in-flight fencing prevents duplicate taps. Retries for an unconfirmed read reuse the same operation ID. Only a confirmed server response triggers membership/count refresh; frontend never derives authoritative unread from a page.

Teacher uses a compatibility transport over the same shared panel/DTO, retaining existing preference/category/quiet-hours and device-session behavior. Its enclosing settings component is also keyed by account/token/role/Branch, so another session does not inherit preference/session state.

## Historical records and navigation safety

No delivery is deleted or rewritten. Revoked assignment/enrollment/verified ParentStudentLink does not itself delete legitimately delivered metadata. Branch transfer conceals old-Branch records. Parent lists only its own User's delivery records, never its child's inbox, and passes no child/recipient selector.

Opening a linked item first re-fetches canonical own notification detail. Only explicit typed Teacher destinations are allowed: inbox_notice → TeacherNotice, teacher_timetable → TeacherTimetable, catch_up_item → TeacherCatchUp. Existing destination APIs reauthorize current domain scope; Teacher notice detail handles published school notices through the existing canonical service. Unsupported attendance/submission references and Student/Parent references without a supported destination show safe unavailable behavior. No raw source objects or protected domain detail are cached in notifications. There are no arbitrary URLs or donor route strings.

## Security guarantees

Frontend visibility is not authorization. Each inbox request requires Session/JWT → persisted active matching-role User → supported role → active current Branch → own available Notification scope. No client-selected recipient or Branch, foreign child/class/Branch fallback, notification-created domain access or financial/academic writes exist. A database snapshot test compares every collection before/after generic list/filter/page reads, including delivery, operation, session and domain records. F1 mutation/delivery security and idempotency tests remain intact.

## Files changed (18; all unstaged)

| Category | Paths |
| --- | --- |
| Backend source (3) | backend/src/routes/notification.routes.ts; backend/src/services/notification.service.ts; backend/src/services/teacher-notification.service.ts |
| Frontend source (8) | src/navigation/StudentNavigator.tsx; src/navigation/ParentNavigator.tsx; src/screens/student/StudentWorkspaceScreen.tsx; src/screens/parent/ParentWorkspaceScreen.tsx; src/screens/teacher/TeacherNotificationsScreen.tsx; src/services/teacher/notificationService.ts; src/screens/notifications/NotificationInboxScreen.tsx (new); src/services/notifications/inboxService.ts (new) |
| Permanent tests (6) | backend/tests/notification-inbox.security.test.ts (new); __tests__/notification-inbox.test.tsx (new); __tests__/notification-inbox-service.test.ts (new); __tests__/student-workspace.test.tsx; __tests__/parent-workspace.test.tsx; __tests__/teacher-notifications.test.tsx |
| Report (1) | docs/integration/pr-f2-notification-inbox.md (new) |

No models, dependencies, native configuration, API base URL, domain workflow, shared RBAC or ignore policy changed. Validation outputs remain under the already-ignored `.validation-principal-audit/notification-f2/` directory.

## Permanent tests and validation

New backend coverage: 33 tests, including own/foreign scope, supported/unsupported roles, active account/Session/Branch, expiry/revocation, strict bounds/selectors, stable ties/pages, read filters/null/missing, unread count, future concealment, history, Teacher delegation, identical DTO and zero database writes.

New frontend coverage: 21 inbox UI tests plus 1 service contract test; 2 additional Student/Parent navigation action tests. Existing route-list assertions now explicitly include new inbox routes and retain all old routes. Existing Teacher tests only gain the detail service mock needed by the new current-detail check; no assertions were removed or weakened.

| Validation group | PASS | FAIL |
| --- | ---: | ---: |
| F1 foundation | 24 | 0 |
| New F2 backend inbox | 33 | 0 |
| Existing Teacher notification security | 33 | 0 |
| Teacher scope / communications | 101 | 0 |
| Student self | 17 | 0 |
| Parent scope | 14 | 0 |
| Finance authorization/workflow | 65 | 0 |
| Principal authorization | 50 | 0 |
| **Backend total** | **337** | **0** |
| New inbox UI / service | 21 / 1 | 0 |
| Teacher notifications / notification service | 8 / 1 | 0 |
| Student workspace / service | 11 / 9 | 0 |
| Parent workspace | 14 | 0 |
| Teacher communications / service | 23 / 5 | 0 |
| Auth Session | 3 | 0 |
| Developer Preview | 11 | 0 |
| **Frontend total (11 suites)** | **107** | **0** |
| **Combined total** | **444** | **0** |

Backend TypeScript and scoped mobile source/test TypeScript: PASS. Root TypeScript: baseline 76, final 76, introduced 0; inherited diagnostics remain unfixed. Scoped ESLint: 17 changed source/test files, 0 errors, 0 warnings. git diff --check: PASS. No dependency/native/assets changes, so Android/iOS build is not required.

Validation uses existing local tsx/node:test isolated MongoDB replica-set fixtures and Jest --runInBand. Initial frontend route expectations correctly failed on the additional routes; assertions were updated to require the new contract and navigation actions. Root comparison caught widened enum types in new test seeds; typed seeds fixed all introduced diagnostics. Final results above supersede those intermediate failures. No assertions, timeout or authority checks were weakened.

## Deferred scope

Chat conversations/messages/typing/presence (F3–F5), new domain event producers (F6), push/FCM/APNs, SMS/email/WhatsApp delivery, WebSocket/realtime, preference expansion, bulk read/campaigns, Finance/Principal dedicated inbox screens, branchless Super Admin, helpdesk expansion, AI, Applications, Payroll, Expenses and Batch Payments remain deferred. No later phase was started.

## Final Git state and disposition

Branch remains `integration/team-merge`; HEAD remains `ae44f9b2c196a5edd8668bf4712f862377bbad3b`. Index clean (0 staged files). Twelve tracked modifications and six new files (18 total), all F2 work left unstaged for review. No merge in progress. No staging, commit, push, merge, cherry-pick, reset, restore, clean, stash or branch switch occurred. Faraz remains read-only donor/reference.

PR-F2 disposition: **READY FOR REVIEW**.
