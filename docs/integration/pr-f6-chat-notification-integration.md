# F6 — Chat → Notification Event Integration

Implemented against integration/team-merge, committed F5 baseline 527efc9649318a9cee9a837384d9e271a050467c. Changes remain unstaged.

## Transaction and authority

A genuinely new authorized ChatMessage now creates its canonical Notification in the same MongoDB transaction. The awaited producer call is backend/src/services/chat-persistence.service.ts:288, after ChatMessage.create at :273 and after the existing replay return at :258. It is before the unchanged final F3 and token checks in backend/src/services/chat-write-authority.service.ts:115–124. The existing transaction commits at backend/src/services/academic-catalog-lock.service.ts:12–16 with snapshot/majority semantics.

The new backend-only createChatMessageNotification is backend/src/services/notification.service.ts:61. It requires an active transaction (:67), reads the persisted ChatMessage in that session (:68), checks sender/recipient/Branch against canonical context, reuses authorizeChatRecipient (:81), and verifies the conversation in the same session (:94). It starts no session or nested transaction and adds no recipient resolver.

The producer derives the exact recipient and Branch from the message and current F3 authority. Conversation membership is an integrity check only, never delivery authority. Existing assignment/enrollment/Parent-link/User/Branch/session fences remain unchanged. No client notification metadata is accepted; send still uses its strict body/clientOperationId contract.

Event identity (:103):
- sourceType chat_message
- sourceId canonical message ID
- sourceRevision 1
- eventType chat_message_created
- recipient canonical persisted/F3-authorized message recipient
- deepLinkType chat_conversation
- deepLinkTargetId canonical conversation ID

The existing Notification model and notification_event_recipient_unique index are retained. New event content is SHA-256 fingerprinted, matching event reuse returns the existing row, and conflicting reuse fails 409 (:123). Existing createInternalNotification behavior, compatibility fingerprints, own-inbox reads and notification-read operations are preserved; its implementation is only shifted down by the new function.

No message commit means no notification commit: insertion failures or final authority/clock rejection abort the message, sequence and notification together. A lost HTTP response after commit is safe: same clientOperationId replay returns the existing message before production. Concurrent duplicate sends converge through existing transaction fencing and message uniqueness. Historical messages are never backfilled by replay, GET or reconciliation.

No new store, index, outbox, worker, post-commit side effect, socket or external delivery was added. Existing startup already initializes Notification indexes; backend/src/server.ts is unchanged.

## Public content and privacy

backend/src/services/notification.service.ts:110 constructs fixed content:
```json
{
  "category": "communication",
  "title": "New message",
  "body": "Open Messages to view your conversation.",
  "priority": "normal",
  "source": {
    "type": "chat_message",
    "revision": 1
  },
  "deepLink": {
    "type": "chat_conversation",
    "targetId": "<conversationId>"
  }
}
```

availableAt is the persisted message.createdAt; notification createdAt comes from the canonical model. notificationDTO (:483) preserves its explicit safe fields: notificationId, category, title, body, priority, createdAt, availableAt, readAt, source and deepLink.

Message ID is internal source identity only. The public DTO contains no message body/preview, sender display name, phone/email, child identity, Branch internals, witness IDs, Session IDs, clientOperationId or relationship records. Parent delivery is exact-recipient delivery with generic text, not donor fanout.

Only two model enum values were added (backend/src/models/notification.ts:22 and :37). The frontend reference union is extended at src/services/notifications/inboxService.ts:15. No public sourceId/messageId field was added.

## Notification → chat navigation

- src/screens/notifications/NotificationInboxScreen.tsx:45 handles only a chat_conversation reference with a canonical ObjectId-shaped target and maps Student/Parent to their own existing Chat route.
- NotificationInbox still fetches owned detail immediately before invoking the allowlist (:190); cached list data cannot authorize navigation. It does not mark a chat message read.
- src/screens/teacher/TeacherNotificationsScreen.tsx:32 adds the TeacherChat case; notice/timetable/catch-up handling is preserved.
- Existing TeacherChat/StudentChat/ParentChat routes now take an optional conversationId (src/navigation/TeacherNavigator.tsx:53, StudentNavigator.tsx:14, ParentNavigator.tsx:9).
- src/screens/chat/ChatWorkspaceScreen.tsx:21 passes the target to the shared workspace. Its identity/remount key includes target, User, token, role and Branch. Parameter/identity changes remove the previous private screen and invalidate obsolete callbacks.
- src/screens/chat/useChatWorkspace.ts:241 accepts an ID for detail revalidation without fabricating a conversation DTO or requiring that target in the current inbox page. History and composer wait for success. Pending outbox content is also hidden until authority succeeds.
- The selected ID is independent of an unvalidated DTO. Network failure can retry the same target (:449). Current 403/404 clears protected state and disables sending; 401 uses canonical logout. Focus/request/selection fences are preserved (:107).
- Same-Branch generic notifications can remain after relationship revocation; F4 detail/history/read still reject. Branch transfer conceals old-Branch notification and chat records without deleting them.

No new NavigationContainer, frontend-created event, sender-facing read receipt or message-read coupling was introduced. Route-target remounts intentionally clear private in-memory screen state; no durable/offline outbox was added.

## Faraz boundary

Donor root D:/Faraz-Reference, inspected at 293966bf7f477bd430133e91d9a87d75523782f4. Donor file references below are relative to that root.

| Capability | Exact donor evidence | Decision | F6 result |
|---|---|---|---|
| Message → notification socket behavior | backend/src/chatRoutes.js:460, :474 | REJECT | Notification is a same-transaction canonical insert, not best-effort publication. Chat-notification producer in donor: NOT FOUND. |
| Donor fanout recipient resolution | backend/src/chatRealtime.js:125–151 | REJECT | No fanout to a Student's Teacher/parents; only exact canonical message recipient. |
| Canonical recipient derivation | backend/src/chatRoutes.js:430 uses donor access; canonical backend/src/services/chat-authority.service.ts:172 resolves exact recipient/witness | ALREADY_CANONICAL | Reuse F3 and persisted message context; do not copy donor authority. |
| Dedupe | backend/src/chatRoutes.js:76, :441 | ALREADY_CANONICAL | Preserve canonical message operation uniqueness and Notification event key. Donor notification-event dedupe: NOT FOUND. |
| Generic payload snapshot | backend/src/notificationService.js:52–64 | REJECT | No recordSnapshot, preview or sender details. |
| Generic target references | backend/src/notificationService.js:58 | REJECT | Explicit chat_conversation enum plus canonical conversation ID. Donor typed chat ref: NOT FOUND. |
| Owned-detail navigation mechanism | src/mobileApp/shared/notifications/InboxNotifications.jsx:81–91; canonical src/screens/notifications/NotificationInboxScreen.tsx:190 | ALREADY_CANONICAL | Extend canonical owned-detail allowlist and F4 revalidation. Donor notification→chat dispatch: NOT FOUND. |
| Realtime/socket coupling | backend/src/chatRoutes.js:47; backend/src/chatRealtime.js:158 | REJECT | No socket runtime or event bus. |
| Push/external delivery | donor chat route/service/realtime notification integration: NOT FOUND | REJECT | No FCM/APNs/SMS/email. |

No donor auth, session, runtime, socket code or dependencies were imported.

## Tests and claims checked against code

All transaction/race integration tests use the existing real MongoMemoryReplSet fixture at backend/tests/helpers/student-workspace.fixture.ts:48, an owned ephemeral replica set with real HTTP requests and MongoDB writes. Barriers pause real persistence; relationship authority itself is not mocked.

New backend/tests/chat-notification.security.test.ts covers:
- :95 all four supported send edges → one exact-recipient event per message.
- :120 five simultaneous duplicates plus replay → one message/event; conflicting body/conversation operation reuse remains 409.
- :139 failure after actual notification insert → message, notification and sequence rollback; retry succeeds.
- :157 assignment clock expiry after actual notification insertion → final authority failure rolls back both.
- :179/:227 revoked/expired assignment, closed/transferred enrollment, revoked/unverified Parent link and Branch transfer: ordinary rejection plus a real revoke-wins barrier for every case. Existing membership grants neither record.
- :277 cross-Branch, unsupported pair/role and out-of-scope Student attempts → no records.
- :349 exact safe DTO and correct internal message/public conversation reference; sender cannot read recipient's notification.
- :399 successful send then revocation retains records but chat detail/history/read fail.
- :428 client recipient/Branch/notification metadata rejected.
- :445 raw historical message plus replay creates no retroactive notification.
- :468 chat/canonical notification GET snapshots and message read create no event. A real published Teacher notice reconciles exactly once and produces no additional chat event.
- :520 Branch transfer conceals old-Branch chat/notification while retaining both.
- :546 session-bound producer replay/fingerprint conflict; :584 rejects calls outside a transaction.

backend/tests/chat-persistence.security.test.ts retains every existing assertion, adds notification index initialization and extends revoke/expiry/read checks with notification counts. Its existing zero-write collection snapshot still covers chat/domain/notification/session collections.

Frontend additions:
- __tests__/notification-inbox.test.tsx:437 onward: Student/Parent routing only from fresh owned detail, malformed target/unsupported role rejection, stale account/token/role/Branch detail cannot navigate.
- __tests__/teacher-notifications.test.tsx:15 onward: fresh chat target navigation and invalid target rejection; existing Teacher behavior assertions preserved.
- __tests__/chat-workspace.test.tsx:692 onward: target outside loaded inbox page, detail network retry, revoked 403/404 concealment, stale target response, stale account/token/role/Branch history.
- __tests__/chat-navigation.test.tsx:140 onward: each role's real shared screen consumes route target via F4 detail and never loads history after denial. Existing single-root/navigation regressions pass.

The legacy Teacher GET exception is explicit: school-notice reconciliation is existing behavior, not a universal zero-write endpoint. F6 never creates chat events from GETs; canonical own-inbox/chat GET paths stay zero-write.

## Approved file scope and self-check

Modified only these 16 approved existing files:
- backend/src/models/notification.ts
- backend/src/services/notification.service.ts
- backend/src/services/chat-persistence.service.ts
- src/services/notifications/inboxService.ts
- src/screens/notifications/NotificationInboxScreen.tsx
- src/screens/teacher/TeacherNotificationsScreen.tsx
- src/navigation/TeacherNavigator.tsx
- src/navigation/StudentNavigator.tsx
- src/navigation/ParentNavigator.tsx
- src/screens/chat/ChatWorkspaceScreen.tsx
- src/screens/chat/useChatWorkspace.ts
- backend/tests/chat-persistence.security.test.ts
- __tests__/notification-inbox.test.tsx
- __tests__/teacher-notifications.test.tsx
- __tests__/chat-workspace.test.tsx
- __tests__/chat-navigation.test.tsx

Created only backend/tests/chat-notification.security.test.ts and this report. All 18 files were reopened for review. F3, chat-write-authority, auth/session, startup, API client, dependencies and native configuration are unchanged. Existing production changes are limited to the approved F6 producer/typed navigation scope.

Index remains empty; all changes are unstaged. HEAD remains 527efc9649318a9cee9a837384d9e271a050467c on integration/team-merge. No commit/push/merge/reset/clean/restore/force-push, dependency changes, sockets/push/external delivery or final F-series audit.

## Validation evidence

Commands run from D:/SchoolManagementSystem unless backend working directory is specified. Each output block is the raw last 20 lines, or all available lines when shorter. Empty output is stated; no numeric diagnostic count is invented.

### Required backend suites — exit 0

Working directory D:/SchoolManagementSystem/backend.
```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests/chat-notification.security.test.ts tests/chat-persistence.security.test.ts tests/chat-authority.security.test.ts tests/notification-foundation.security.test.ts tests/notification-inbox.security.test.ts tests/teacher-notification.security.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-f6-backend-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```
```text
✔ logout revokes current session and invalidates later authorization (71.5907ms)
✔ internal notification DTO claims no external delivery (83.9477ms)
✔ Student and Principal cannot access Teacher notification data (74.4417ms)
✔ read operation ID cannot be reused across notifications (104.7817ms)
✔ preference retries replay while conflicting operation reuse fails (87.3838ms)
✔ AI and external-channel preference fields are rejected (74.1438ms)
✔ published Teacher notice reconciles once and remains visible during quiet hours (116.8941ms)
✔ shared-device identity switch never returns the previous Teacher data (92.9106ms)
✔ concurrent mark-read requests converge on one server timestamp (207.5743ms)
✔ concurrent notice reconciliation creates one recipient event (192.271ms)
✔ stale preference revision cannot overwrite the confirmed revision (81.9041ms)
✔ revoked secondary session fails its next protected request (108.8682ms)
ℹ tests 214
ℹ suites 0
ℹ pass 214
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 100767.6619
```

### Required frontend/regression suites — exit 0

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/chat-service.test.ts __tests__/chat-workspace.test.tsx __tests__/chat-navigation.test.tsx __tests__/notification-inbox.test.tsx __tests__/notification-inbox-service.test.ts __tests__/notification-service.test.ts __tests__/teacher-notifications.test.tsx __tests__/teacher-navigation.test.tsx __tests__/student-workspace.test.tsx __tests__/student-workspace-service.test.ts __tests__/parent-workspace.test.tsx __tests__/auth-session.test.tsx __tests__/developer-preview.test.tsx __tests__/teacher-communications.test.tsx __tests__/teacher-communication-service.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-f6-frontend-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```
```text
PASS __tests__/chat-workspace.test.tsx
PASS __tests__/teacher-notifications.test.tsx
PASS __tests__/chat-navigation.test.tsx
PASS __tests__/teacher-communications.test.tsx
PASS __tests__/parent-workspace.test.tsx
PASS __tests__/student-workspace.test.tsx
PASS __tests__/developer-preview.test.tsx
PASS __tests__/teacher-navigation.test.tsx
PASS __tests__/auth-session.test.tsx
PASS __tests__/notification-service.test.ts
PASS __tests__/student-workspace-service.test.ts
PASS __tests__/teacher-communication-service.test.ts
PASS __tests__/chat-service.test.ts
PASS __tests__/notification-inbox-service.test.ts

Test Suites: 15 passed, 15 total
Tests:       190 passed, 190 total
Snapshots:   0 total
Time:        10.863 s
Ran all test suites matching /__tests__\\chat-service.test.ts|__tests__\\chat-workspace.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\notification-inbox.test.tsx|__tests__\\notification-inbox-service.test.ts|__tests__\\notification-service.test.ts|__tests__\\teacher-notifications.test.tsx|__tests__\\teacher-navigation.test.tsx|__tests__\\student-workspace.test.tsx|__tests__\\student-workspace-service.test.ts|__tests__\\parent-workspace.test.tsx|__tests__\\auth-session.test.tsx|__tests__\\developer-preview.test.tsx|__tests__\\teacher-communications.test.tsx|__tests__\\teacher-communication-service.test.ts/i.
```

### Backend TypeScript — exit 0

Working directory D:/SchoolManagementSystem/backend.
```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-f6-backend-ts-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```
Raw output: empty.

### Mobile TypeScript — exit 0

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-f6-mobile-ts-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```
Raw output: empty. This is the existing mobile-scoped source/test configuration.

### Scoped ESLint — exit 0

Covers every changed production source and test file, with --max-warnings=0.
```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 backend/src/models/notification.ts backend/src/services/notification.service.ts backend/src/services/chat-persistence.service.ts backend/tests/chat-persistence.security.test.ts backend/tests/chat-notification.security.test.ts src/services/notifications/inboxService.ts src/screens/notifications/NotificationInboxScreen.tsx src/screens/teacher/TeacherNotificationsScreen.tsx src/screens/chat/ChatWorkspaceScreen.tsx src/screens/chat/useChatWorkspace.ts src/navigation/TeacherNavigator.tsx src/navigation/StudentNavigator.tsx src/navigation/ParentNavigator.tsx __tests__/notification-inbox.test.tsx __tests__/teacher-notifications.test.tsx __tests__/chat-workspace.test.tsx __tests__/chat-navigation.test.tsx 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-f6-eslint-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```
Raw output: empty.

### Tracked diff check — exit 0

```powershell
git diff --check 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-f6-diff-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```
```text
warning: in the working copy of '__tests__/chat-navigation.test.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of '__tests__/chat-workspace.test.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of '__tests__/notification-inbox.test.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of '__tests__/teacher-notifications.test.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/src/models/notification.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/src/services/chat-persistence.service.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/src/services/notification.service.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'backend/tests/chat-persistence.security.test.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/navigation/ParentNavigator.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/navigation/StudentNavigator.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/screens/chat/ChatWorkspaceScreen.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/screens/chat/useChatWorkspace.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/screens/notifications/NotificationInboxScreen.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/screens/teacher/TeacherNotificationsScreen.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/services/notifications/inboxService.ts', LF will be replaced by CRLF the next time Git touches it
```
Only Windows line-ending conversion warnings were printed; no whitespace errors. New untracked source/report files are checked explicitly in the final review below.

## Earlier validation attempts and corrections

No assertion was weakened. The initial backend failure came from an incorrect fixture assumption: the Parent helper also enrolls the second Student. The test now explicitly closes that membership before checking the intended denial. Initial frontend failures came from list fixtures with null deep links (no Open button exists); fixtures now supply a typed reference. Backend TypeScript required literal enum typing for the new payload; as-const annotations fixed this without changing runtime behavior.

### Initial F6/F4 run — exit 1

Actual summary: tests 65, pass 64, fail 1. Raw last 20 lines:
```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests/chat-notification.security.test.ts tests/chat-persistence.security.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-f6-backend-initial.log" | Select-Object -Last 20; exit $LASTEXITCODE
```
```text

✖ failing tests:

test at tests\chat-notification.security.test.ts:133:1
✖ cross-Branch guessed targets and unsupported pairs/roles create neither record (280.6296ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  200 !== 403

      at TestContext.<anonymous> (D:\SchoolManagementSystem\backend\tests\chat-notification.security.test.ts:137:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 200,
    expected: 403,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

### Isolated failing fixture test — exit 1

Working directory backend. The run diagnosed the same fixture mistake; it preceded the correction.
```powershell
.\node_modules\.bin\tsx.cmd --test --test-name-pattern='cross-Branch guessed' tests/chat-notification.security.test.ts 2>&1 | Select-Object -Last 24; exit $LASTEXITCODE
```
```text
✖ failing tests:

test at tests\chat-notification.security.test.ts:276:1
✖ cross-Branch guessed targets and unsupported pairs/roles create neither record (1430.7436ms)
  AssertionError [ERR_ASSERTION]: Teacher to Student without active enrollment must be rejected

  200 !== 403

      at TestContext.<anonymous> (D:\SchoolManagementSystem\backend\tests\chat-notification.security.test.ts:298:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:960:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 200,
    expected: 403,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

### Initial affected frontend run — exit 1

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/chat-workspace.test.tsx __tests__/chat-navigation.test.tsx __tests__/notification-inbox.test.tsx __tests__/teacher-notifications.test.tsx 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-f6-frontend-initial.log" | Select-Object -Last 20; exit $LASTEXITCODE
```
```text
      489 |     });
      490 |     if (change === 'account') mockUser = { ...mockUser!, id: 'other-user' };

      at __tests__/notification-inbox.test.tsx:487:65
      at asyncGeneratorStep (node_modules/@babel/runtime/helpers/asyncToGenerator.js:3:17)
      at _next (node_modules/@babel/runtime/helpers/asyncToGenerator.js:17:9)
      at node_modules/@babel/runtime/helpers/asyncToGenerator.js:22:7
      at node_modules/@babel/runtime/helpers/asyncToGenerator.js:14:12
      at Object.<anonymous>.process.env.NODE_ENV.exports.act (node_modules/react/cjs/react.development.js:814:22)
      at __tests__/notification-inbox.test.tsx:484:14
      at asyncGeneratorStep (node_modules/@babel/runtime/helpers/asyncToGenerator.js:3:17)
      at _next (node_modules/@babel/runtime/helpers/asyncToGenerator.js:17:9)

PASS __tests__/chat-navigation.test.tsx

Test Suites: 1 failed, 3 passed, 4 total
Tests:       7 failed, 93 passed, 100 total
Snapshots:   0 total
Time:        11.286 s
Ran all test suites matching /__tests__\\chat-workspace.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\notification-inbox.test.tsx|__tests__\\teacher-notifications.test.tsx/i.
```

### Initial TypeScript

Backend exit 1, mobile exit 0. Commands:
```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-f6-backend-ts-initial.log" | Select-Object -Last 20; exit $LASTEXITCODE
```
```text
src/services/notification.service.ts(138,9): error TS2488: Type 'never' must have a '[Symbol.iterator]()' method that returns an iterator.
src/services/notification.service.ts(139,5): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Type '{ recipientUserId: ObjectId; sourceType: "chat_message"; sourceId: ObjectId; sourceRevision: number; eventType: string; branchId: ObjectId; recipientRole: "parent" | ... 1 more ... | "teacher"; ... 8 more ...; operationId: string; }[]' has no properties in common with type '{ createdAt?: DateQueryTypeCasting | undefined; updatedAt?: DateQueryTypeCasting | undefined; _id?: ObjectIdQueryTypeCasting | undefined; ... 16 more ...; fingerprint?: string | ... 1 more ... | undefined; }'.
```
```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-f6-mobile-ts-initial.log" | Select-Object -Last 20; exit $LASTEXITCODE
```
Mobile raw output: empty.

After corrections, an intermediate full run passed 212 backend tests and 189 frontend tests; later review added two backend tests and one frontend target-retry test. Final command tails above are the actual results for the final code: 214 backend tests and 190 frontend tests. Static commands were rerun successfully for final code. Validation logs remain in the host TEMP directory and are not staged/project artifacts.

## Final review and Git evidence

The final tracked diff check exited 0; only the Windows line-ending warnings shown above were emitted. Plain git diff --check excludes untracked files, so both new files were also checked explicitly:

```powershell
$taskFailure=0
foreach($taskFile in @('backend/tests/chat-notification.security.test.ts','docs/integration/pr-f6-chat-notification-integration.md')) {
  $taskOutput=@(git -c core.autocrlf=false diff --no-index --check -- NUL $taskFile 2>&1)
  if($LASTEXITCODE -gt 1 -or $taskOutput.Count){$taskFailure++;$taskOutput}
}
'New files checked: 2; whitespace failures: {0}' -f $taskFailure
exit $taskFailure
```

Exit 0, raw output:

```text
New files checked: 2; whitespace failures: 0
```

The first additional report whitespace check caught space-only blank lines copied from failed assertion output. They were normalized; diagnostic text was preserved. No source/test whitespace fix was required. A no-index comparison can exit 1 merely for file differences; the aggregate command fails on diagnostics or an actual comparison error, not on expected new-file differences.

All changed source/test/configuration files and this report were reopened. A manifest check compared tracked changes and untracked files to the approved exact file list:

```text
Approved changed files: 18; unexpected files: 0
Index: empty
```

The index was checked with git diff --cached --quiet (exit 0) and git diff --cached --name-only (empty). Only 16 approved tracked files are modified; the new security suite and this report are the only untracked paths. package.json, package-lock.json, yarn.lock, server.ts, chat-authority.service.ts and chat-write-authority.service.ts have no diff.

Final branch integration/team-merge; HEAD 527efc9649318a9cee9a837384d9e271a050467c. Changes remain unstaged. No commit, push, merge, reset, clean, restore, force-push, dependency change, socket/external delivery or final F-series audit was performed.

DONE — F6 chat notification event integration fully implemented and verified.
