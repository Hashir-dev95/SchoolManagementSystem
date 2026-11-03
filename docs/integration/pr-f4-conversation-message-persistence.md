# F4 — Canonical conversation and message persistence

## Baseline, approval and scope

Approved Phase 2 baseline: `integration/team-merge`, HEAD `e2b9aa48abaf5400616f37f58c89d9abe5057577` (F3), clean worktree/index and no merge. F1–F3 source authority and assertions remain unchanged. Only the seven approved files are added/modified. No staging, commit, push, merge, restore, reset, clean or branch switch is authorized.

Permanent-policy closure started from that same HEAD with all seven F4 paths already pending. This closure changes only the three subsequently approved files: chat-persistence.service.ts (comments only), chat-persistence.security.test.ts and this report. The other four pending F4 files are preserved byte-for-byte.

## Permanent historical chat-read policy

The user explicitly approved this permanent product rule and then approved the narrow three-file closure plan:

> Current canonical chat relationship authority is required for active chat and historical chat access. Revoked/expired/unverified/closed/transferred relationships conceal chat access but do not delete persisted Conversation/Message records. Branch transfer conceals old-Branch conversations. Conversation membership is never authorization.

This approved decision controls chat history. Notification metadata and attendance history remain separate domains. Current implementation already enforces the rule: own active identity/Branch and membership are necessary filters, followed by F3 relationship authorization for detail, listing, history and read mutation. No runtime authorization behavior is changed by this closure. See `backend/src/services/chat-persistence.service.ts:47`, `:102`, `:148`, `:195`, `:304`, `:335` and `backend/src/services/chat-write-authority.service.ts:89`.

Expanded real replica-set tests cover lifecycle concealment, physical retention, membership-bypass rejection and restoration without duplicate conversations/messages. Restored teaching/enrollment responsibility uses new current canonical records; guardian access requires current independent verification. The original chat identity and messages are reused.

## Index initialization evidence

The existing canonical startup initializes required indexes after database connection and before app.listen: baseline server.ts lines 35–59 included Finance, academic setup, assignments, attendance and notifications. Current `backend/src/server.ts:36`, `:57`, `:58` and `:72` show the same pattern including the added awaited ensureChatIndexes call. Only the model import and index-initialization call were added. `backend/src/models/chat.ts:89` owns index definitions/initialization; tests also explicitly await it because the existing replica-set fixture disables autoIndex.

## Stores, identity and ordering

- One ChatConversation per immutable Branch and sorted, distinct participant User IDs. A unique compound index is the database authority, not an in-memory lookup. `backend/src/models/chat.ts:24`, `:31`; pair normalization `backend/src/services/chat-persistence.service.ts:34` and transactional create `:112`.
- One ChatMessage store with immutable conversation/Branch/sender/recipient/body/sequence/operation identity. Only recipient readAt is mutable. `backend/src/models/chat.ts:39`.
- Unique sender/operation ID and conversation/sequence indexes enforce retry and ordering invariants: `backend/src/models/chat.ts:78` and `:82`.
- Server sequence allocation and message insertion share one MongoDB transaction. Retries do not consume another sequence. `backend/src/services/chat-persistence.service.ts:245` and `:259`.
- Sequence history is newest-first with `_id` as a deterministic tie-breaker; beforeSequence uses a strict less-than boundary so new arrivals cannot shift an older page. Default 50, limit 1–100, positive safe-integer boundary. `backend/src/services/chat-persistence.service.ts:292`.

## Write authority and races

`backend/src/services/chat-write-authority.service.ts:83` wraps creation, sending and explicit read mutation. It always calls existing authorizeChatRecipient; no second relationship policy or stored membership grant is introduced. Session/JWT remains canonical (`backend/src/routes/chat.routes.ts:22`).

Flow: initial F3 authority → canonical persisted Branch transaction lock → matching non-revoked Session write fence → actual F3 witness dependency fences → fresh F3 authority and witness comparison → chat mutation → fresh F3/witness/JWT/clock check → transaction commit. See `chat-write-authority.service.ts:90`, `:103`, `:115`, `:116`, `:118` and `:121`.

The fence dependency list includes both participant Users, Student and its User, current StudentEnrollment, TeacherAssignment, Class/Section/Subject/AcademicPeriod, and ParentStudentLink plus independent verifier when applicable. Dependencies are derived from internal F3 witnesses and read under the transaction, deduplicated and locked in deterministic order; they are never returned publicly. See `chat-write-authority.service.ts:31`.

Branch-only locking would be insufficient: existing Teacher assignment revocation directly updates TeacherAssignment (`backend/src/services/teacher-assignment.service.ts:90`). F4 locks that actual document. The existing canonical transaction pattern is `backend/src/services/academic-catalog-lock.service.ts:9` and document fence `backend/src/services/teacher-communication-access.service.ts:48`.

Readiness does not imply a cached permission ticket. Membership identifies the other participant; every send, including an idempotent retry, reruns F3 under the write boundary. Revocation committed before the protected write wins and leaves no message. When send already owns the relevant fences, a conflicting revocation cannot commit ahead of it; it serializes after the send. Final time validation rolls back a message inserted just before assignment expiry. These are real MongoDB replica-set tests, not an in-memory transaction simulation.

## Idempotency

Required clientOperationId: 16–80 alphanumeric/underscore/hyphen characters. Text is trimmed, 1–4000 characters. Persistent operation scope is globally unique per sender; fingerprint binds conversation plus normalized text. Same operation/payload replays the same message; different payload or conversation returns 409. Another sender has its own operation namespace. `backend/src/services/chat-persistence.service.ts:220`, `:232` and `:245`; database constraint `backend/src/models/chat.ts:78`.

Conversation creation is pair-idempotent via transaction plus unique Branch/sorted-pair index. Counter, message and read mutations commit atomically with authority fences. No operation ledger or unread state is stored in Notification. Unexpected database errors are sanitized by `backend/src/routes/chat.routes.ts:46`.

## HTTP and safe DTO contracts

All routes inherit authenticateToken and Cache-Control: no-store. Discovery is unchanged. New routes are registered before the existing fail-closed catchall (`backend/src/routes/chat.routes.ts:76`):

| Method/path under /api/chat | Input / result |
| --- | --- |
| POST /conversations | body recipientUserId only; returns safe canonical conversation |
| GET /conversations | offset 0–1000, limit 1–100 (default 25); current-authorized own items, total, nextOffset |
| GET /conversations/:conversationId | owned current-Branch conversation plus current F3 history authority |
| POST /conversations/:conversationId/messages | body and clientOperationId only; returns one safe message |
| GET /conversations/:conversationId/messages | limit and optional beforeSequence; items, limit, nextBeforeSequence |
| POST /conversations/:conversationId/messages/:messageId/read | empty object body; incoming own message only, stable server read timestamp |

Conversation DTO: conversationId, otherParticipant (F3's exact userId/displayName/role/relationshipType), createdAt, updatedAt, own unread count. Message DTO: messageId, conversationId, senderUserId, body, sequence, createdAt, ownReadAt. Other participants' read timestamps are not exposed as read receipts. Source: `backend/src/services/chat-persistence.service.ts:67` and `:89`. Runtime exact-key tests: `backend/tests/chat-persistence.security.test.ts:80`.

No raw profile, email/phone, Branch authority internals, witness IDs, operation IDs, fingerprint, Session information or arbitrary navigation is serialized. Validation rejects client Branch/sender/sequence/time selectors and unknown query/body fields. Missing/foreign conversations/messages are concealed with 404; Session/account failures use canonical 401, forbidden authority 403, contract failures 400 and operation conflicts 409. The pre-F4 empty POST /conversations request remains forbidden (403) to preserve the unchanged F3 zero-write assertion; explicit malformed target IDs get 400. `chat-persistence.service.ts:117`.

Conversation listing reauthorizes candidate membership before computing authorized total/pagination; stable order updatedAt DESC/_id DESC. It fails explicitly above 1000 candidate conversations rather than truncating. This remains a bounded MVP read and may be expensive near the cap, like F3 discovery. `chat-persistence.service.ts:165`.

## Recipient-owned read state and GET safety

Only the incoming recipient can POST the read marker. readAt uses a server date and a null-to-date conditional update, preserving the first confirmed timestamp across retries and concurrent requests. Own unread count is server-calculated over all unread incoming messages in the conversation, independent of a history page. See `chat-persistence.service.ts:67`, `:325`.

Ordinary conversation/list/history GETs perform no fences, lazy creation, timestamp updates, message read mutation or notification production. A database snapshot test compares every collection before and after both participants' GET requests: `backend/tests/chat-persistence.security.test.ts:872`.

## Earlier implementation validation

This section records the earlier implementation runs, before the permanent-policy test expansion. Current closure counts and raw outputs are recorded in the permanent-policy closure section below.

Final combined security run: 184 PASS, 0 FAIL (F4 plus unchanged F1–F3/Teacher notification suites). Teacher scope/communications, Student self and Parent verified-child regressions: 132 PASS, 0 FAIL. Auth/session: 3 PASS, 0 FAIL. Combined final coverage: 319 distinct tests, 0 failures; repeated focused runs below are not added again to that count.

The F4-only final suite is recorded separately in raw evidence below. It covers all four send edges, pair uniqueness, duplicate and conflicting retries, concurrent sequence allocation, unauthorized scope/history access, six real revoke-wins schedules (assignment, enrollment, guardian link, recipient, Session, Branch), overlapping revocation blocked by an acquired assignment fence, expiry after insertion, rollback/retry, history bounds/new arrivals, recipient-owned sequential/concurrent reads and zero-write GETs. Evidence: `backend/tests/chat-persistence.security.test.ts:80`, `:132`, `:155`, `:171`, `:514`, `:596`, `:635`, `:655`, `:672`, `:729`, `:872`.

Backend TypeScript exit 0; scoped ESLint exit 0 over six source/test files with no output/errors/warnings. Root comparison baseline 76, initial 76, final 76, introduced 0. Mobile TypeScript/native builds were not required because no mobile/shared type, dependency, native configuration or asset changed. git diff --check exit 0; Git's existing LF→CRLF conversion warning is not a whitespace failure.

Initial focused run: 36 PASS, 0 FAIL before adding the conversation-list pagination case. Initial ESLint found one unused Section import in the new test file; that import was removed and final lint passed. No existing F1–F3 assertion, timeout or scope check was modified. Raw initial/final results are preserved below, including the lint failure.

## Completion self-check

| Criterion | Verified evidence / status |
| --- | --- |
| Canonical conversation identity with DB duplicate protection | PASS — models/chat.ts:31; tests/chat-persistence.security.test.ts:132 |
| Every send reruns F3 with commit-time fences | PASS — services/chat-write-authority.service.ts:83; real race tests at tests/chat-persistence.security.test.ts:514 and :596 |
| Persistent retry/concurrency protection | PASS — models/chat.ts:78; services/chat-persistence.service.ts:245; tests at :155 and :171 |
| Scoped deterministic bounded history/read mechanism | PASS for implemented mechanism — services/chat-persistence.service.ts:292 and :325; tests at :672 and :729 |
| Permanent history access policy | PASS — approved rule at services/chat-persistence.service.ts:102; six real lifecycle/restoration cases at tests/chat-persistence.security.test.ts:250 and Branch transfer at :453 |
| Real replica-set tests and static checks | PASS — actual command outputs below; no simulated MongoDB persistence |

The closure self-review compares the three changed files and every new claim against current code and command output. Non-comment service text is identical to its closure baseline; F3 authority, persistence, transactions, DTOs and startup behavior are unchanged.

## Final Git state

Branch `integration/team-merge`; HEAD `e2b9aa48abaf5400616f37f58c89d9abe5057577` unchanged. Two tracked modifications and five new files (seven approved paths total). Zero staged files, no merge in progress, no commit/push. F3 authority and all existing F1–F3 tests are unchanged. No destructive Git operation, donor import or native/dependency change occurred. Validation output is confined to the existing ignored `.validation-principal-audit/chat-f4/` directory.

Permanent-policy closure status: **DONE — all required real tests and static validation passed; evidence is recorded below.**

## Files and deferred scope

Approved files: new backend/src/models/chat.ts; new backend/src/services/chat-write-authority.service.ts; new backend/src/services/chat-persistence.service.ts; modified backend/src/routes/chat.routes.ts; modified backend/src/server.ts; new backend/tests/chat-persistence.security.test.ts; this new report. No other source or existing test was changed.

No F5 UI, group chat, peer-role expansion, edit/delete, attachments, typing/presence, WebSocket/Socket.IO, push, chat-generated notifications, F6 event integration, AI or donor auth/session/runtime import. Donor pair identity and payload-blind replay were rejected; canonical primitives and the approved plan control this implementation.

## Earlier implementation raw command evidence

Commands below show the executed program and arguments; output redirection to the existing ignored validation directory is omitted. tsx commands ran from backend; other commands ran from the repository root. Raw output tails contain at most 20 lines each. Empty compiler/linter output is stated explicitly, not fabricated.

Root baseline command: node .validation-principal-audit/chat-f4/types.cjs baseline. Actual output: {"baseline":76}.

### Initial F4-only suite (36 tests, before added coverage)

```powershell
.\node_modules\.bin\tsx.cmd --test tests/chat-persistence.security.test.ts
```

Raw last 20 lines (or all lines when fewer):
```text
✔ history rejects malformed query or authority override: limit=0 (187.3823ms)
✔ history rejects malformed query or authority override: limit=101 (202.7532ms)
✔ history rejects malformed query or authority override: limit=1&limit=2 (175.135ms)
✔ history rejects malformed query or authority override: beforeSequence=0 (215.893ms)
✔ history rejects malformed query or authority override: beforeSequence=-1 (188.1966ms)
✔ history rejects malformed query or authority override: beforeSequence=1.5 (219.0602ms)
✔ history rejects malformed query or authority override: beforeSequence=1e2 (189.9647ms)
✔ history rejects malformed query or authority override: beforeSequence=9007199254740992 (265.7037ms)
✔ history rejects malformed query or authority override: beforeSequence=1&beforeSequence=2 (189.7334ms)
✔ validation rejects malformed IDs, empty/oversized messages and invalid operations without persistence (274.0232ms)
✔ revoked/missing Session, inactive User and unsupported roles do not gain chat persistence (263.835ms)
✔ ordinary conversation/history GETs cause zero chat/domain/notification/session writes (483.1285ms)
ℹ tests 36
ℹ suites 0
ℹ pass 36
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 47455.2546
```

### Final F4-only suite

```powershell
.\node_modules\.bin\tsx.cmd --test tests/chat-persistence.security.test.ts
```

Raw last 20 lines (or all lines when fewer):
```text
✔ history rejects malformed query or authority override: limit=0 (233.9036ms)
✔ history rejects malformed query or authority override: limit=101 (219.4478ms)
✔ history rejects malformed query or authority override: limit=1&limit=2 (253.0023ms)
✔ history rejects malformed query or authority override: beforeSequence=0 (231.3116ms)
✔ history rejects malformed query or authority override: beforeSequence=-1 (222.9133ms)
✔ history rejects malformed query or authority override: beforeSequence=1.5 (221.7701ms)
✔ history rejects malformed query or authority override: beforeSequence=1e2 (205.2257ms)
✔ history rejects malformed query or authority override: beforeSequence=9007199254740992 (204.9244ms)
✔ history rejects malformed query or authority override: beforeSequence=1&beforeSequence=2 (252.9578ms)
✔ validation rejects malformed IDs, empty/oversized messages and invalid operations without persistence (296.5594ms)
✔ revoked/missing Session, inactive User and unsupported roles do not gain chat persistence (373.0758ms)
✔ ordinary conversation/history GETs cause zero chat/domain/notification/session writes (630.253ms)
ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 20731.3391
```

### Final F1-F4 authority/notification suites

```powershell
.\node_modules\.bin\tsx.cmd --test tests/chat-persistence.security.test.ts tests/chat-authority.security.test.ts tests/notification-foundation.security.test.ts tests/notification-inbox.security.test.ts tests/teacher-notification.security.test.ts
```

Raw last 20 lines (or all lines when fewer):
```text
✔ logout revokes current session and invalidates later authorization (168.6208ms)
✔ internal notification DTO claims no external delivery (135.923ms)
✔ Student and Principal cannot access Teacher notification data (145.3983ms)
✔ read operation ID cannot be reused across notifications (213.0985ms)
✔ preference retries replay while conflicting operation reuse fails (199.2898ms)
✔ AI and external-channel preference fields are rejected (129.3191ms)
✔ published Teacher notice reconciles once and remains visible during quiet hours (253.1724ms)
✔ shared-device identity switch never returns the previous Teacher data (166.3045ms)
✔ concurrent mark-read requests converge on one server timestamp (562.1272ms)
✔ concurrent notice reconciliation creates one recipient event (538.7224ms)
✔ stale preference revision cannot overwrite the confirmed revision (205.1582ms)
✔ revoked secondary session fails its next protected request (192.3254ms)
ℹ tests 184
ℹ suites 0
ℹ pass 184
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 43287.0988
```

### Final Teacher/Student/Parent regressions

```powershell
.\node_modules\.bin\tsx.cmd --test tests/teacher-scope.security.test.ts tests/teacher-communications.security.test.ts tests/student-self.security.test.ts tests/parent-scope.security.test.ts
```

Raw last 20 lines (or all lines when fewer):
```text
✔ revoked assignment immediately removes roster access (466.076ms)
✔ expired assignment immediately removes roster access (462.0823ms)
✔ future assignment immediately removes roster access (476.2208ms)
✔ current inactive change fails closed on roster and independent service call (390.2334ms)
✔ current role change fails closed on roster and independent service call (399.8429ms)
✔ current branch change fails closed on roster and independent service call (412.0912ms)
✔ current branch inactive change fails closed on roster and independent service call (467.341ms)
✔ current permission change fails closed on roster and independent service call (398.8917ms)
✔ roster query/body injection never widens scope and malformed tuple IDs are sanitized (637.8254ms)
✔ roster has independent authentication/role gates and no guessed learner detail surface (481.9723ms)
✔ roster reference changes invalidate authority and DB failure is sanitized (458.2116ms)
✔ roster resolves scope once and executes one aggregate regardless of learner count (481.6697ms)
ℹ tests 132
ℹ suites 0
ℹ pass 132
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 46986.8191
```

### Auth/session regression

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/auth-session.test.tsx
```

Raw last 20 lines (or all lines when fewer):
```text
PASS __tests__/auth-session.test.tsx
  √ logout revokes the current token then clears protected identity state (1602 ms)
  √ shared-device local identity is cleared even when server logout cannot be confirmed (2 ms)
  √ logout clears locally before revocation and a late response cannot clear Teacher B (2 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        5.853 s, estimated 10 s
Ran all test suites matching /__tests__\\auth-session.test.tsx/i.
```

### Initial backend TypeScript

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p backend/tsconfig.json
```

Raw stdout/stderr: empty (0 lines).


### Final backend TypeScript (exit 0)

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p backend/tsconfig.json
```

Raw stdout/stderr: empty (0 lines).


### Initial scoped ESLint (one unused import; corrected)

```powershell
.\node_modules\.bin\eslint.cmd backend/src/models/chat.ts backend/src/services/chat-write-authority.service.ts backend/src/services/chat-persistence.service.ts backend/src/routes/chat.routes.ts backend/src/server.ts backend/tests/chat-persistence.security.test.ts
```

Raw last 20 lines (or all lines when fewer):
```text

D:\SchoolManagementSystem\backend\tests\chat-persistence.security.test.ts
  15:8  error  'Section' is defined but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (1 error, 0 warnings)

```

### Final scoped ESLint (exit 0)

```powershell
.\node_modules\.bin\eslint.cmd backend/src/models/chat.ts backend/src/services/chat-write-authority.service.ts backend/src/services/chat-persistence.service.ts backend/src/routes/chat.routes.ts backend/src/server.ts backend/tests/chat-persistence.security.test.ts
```

Raw stdout/stderr: empty (0 lines).


### Initial root TypeScript comparison

```powershell
node .validation-principal-audit/chat-f4/types.cjs final
```

Raw last 20 lines (or all lines when fewer):
```text
{"baseline":76,"current":76,"introduced":[]}
```

### Final root TypeScript comparison (exit 0)

```powershell
node .validation-principal-audit/chat-f4/types.cjs final
```

Raw last 20 lines (or all lines when fewer):
```text
{"baseline":76,"current":76,"introduced":[]}
```

### Git whitespace check (exit 0)

```powershell
git diff --check
```

Raw last 20 lines (or all lines when fewer):
```text
warning: in the working copy of 'backend/src/routes/chat.routes.ts', LF will be replaced by CRLF the next time Git touches it
```

## Permanent-policy closure verification

The approved rule is permanent in code and report; runtime service changes are comments only. The six lifecycle cases at `backend/tests/chat-persistence.security.test.ts:250` cover revoked/expired assignments, revoked/unverified guardian links and closed/transferred enrollment. Each case proves current baseline access, denial for both participants across send/detail/list/history/read-marker, exact physical retention, and restoration with the same conversation/message IDs without duplicates. Teaching/enrollment restoration creates valid current relationship records. Branch transfer at `:453` proves concealment, retention and reuse after valid Branch authority is restored.

| Required check | Actual result |
| --- | --- |
| F4 persistence/security, including real race tests | 40 passed, 0 failed |
| F3 canonical authority | 57 passed, 0 failed |
| Teacher authorization/communications, Student self, Parent scope | 132 passed, 0 failed |
| Total this closure | 229 passed, 0 failed |
| Backend TypeScript | Exit 0; no stdout/stderr |
| Scoped ESLint, six F4 source/test files | Exit 0; no stdout/stderr |

Membership remains only a lookup filter (`chat-persistence.service.ts:47`). Detail/list/history then call F3 (`:148`, `:195`, `:304`); read-marker and sends use unchanged fenced authority (`:233`, `:335`; `chat-write-authority.service.ts:83`). The lifecycle and Branch tests compare exact stored Conversation/Message records during concealment and confirm original IDs and counts after restoration.

### Raw closure validation outputs

tsx commands ran from backend; compiler/linter ran from the repository root. Raw tails contain at most 20 lines. Empty output is stated explicitly.

### f4 — exit 0

```powershell
.\node_modules\.bin\tsx.cmd --test tests/chat-persistence.security.test.ts 2>&1 | Select-Object -Last 20
$taskExit=$LASTEXITCODE
exit $taskExit
```

```text
✔ history rejects malformed query or authority override: limit=0 (188.1239ms)
✔ history rejects malformed query or authority override: limit=101 (189.1566ms)
✔ history rejects malformed query or authority override: limit=1&limit=2 (231.4623ms)
✔ history rejects malformed query or authority override: beforeSequence=0 (187.9188ms)
✔ history rejects malformed query or authority override: beforeSequence=-1 (202.5881ms)
✔ history rejects malformed query or authority override: beforeSequence=1.5 (186.6365ms)
✔ history rejects malformed query or authority override: beforeSequence=1e2 (201.6228ms)
✔ history rejects malformed query or authority override: beforeSequence=9007199254740992 (192.7241ms)
✔ history rejects malformed query or authority override: beforeSequence=1&beforeSequence=2 (157.039ms)
✔ validation rejects malformed IDs, empty/oversized messages and invalid operations without persistence (285.5972ms)
✔ revoked/missing Session, inactive User and unsupported roles do not gain chat persistence (393.64ms)
✔ ordinary conversation/history GETs cause zero chat/domain/notification/session writes (521.2921ms)
ℹ tests 40
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 62596.3914
```

### f3 — exit 0

```powershell
.\node_modules\.bin\tsx.cmd --test tests/chat-authority.security.test.ts 2>&1 | Select-Object -Last 20
$taskExit=$LASTEXITCODE
exit $taskExit
```

```text
✔ rejects malformed filters and client authority selector: offset=1&offset=2 (223.4395ms)
✔ rejects malformed filters and client authority selector: limit=0 (221.6126ms)
✔ rejects malformed filters and client authority selector: limit=101 (252.7029ms)
✔ rejects malformed filters and client authority selector: limit=1.2 (221.0896ms)
✔ rejects malformed filters and client authority selector: limit= (219.2442ms)
✔ rejects malformed filters and client authority selector: limit=1&limit=2 (253.6949ms)
✔ rejects malformed filters and client authority selector: limit[x]=1 (251.28ms)
✔ default/max limits, stable User ID ordering, complete pages and end offset (4001.8148ms)
✔ multiple subjects and multiple verified child relationships collapse to one recipient (453.6747ms)
✔ substitution record alone never grants permanent Teacher chat scope (225.9299ms)
✔ oversized candidate scope fails explicitly rather than truncating recipient authority (232.8125ms)
✔ recipient discovery and authorization cause zero domain/chat/notification/session writes (741.2571ms)
ℹ tests 57
ℹ suites 0
ℹ pass 57
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 53826.4565
```

### scope — exit 0

```powershell
.\node_modules\.bin\tsx.cmd --test tests/teacher-scope.security.test.ts tests/teacher-communications.security.test.ts tests/student-self.security.test.ts tests/parent-scope.security.test.ts 2>&1 | Select-Object -Last 20
$taskExit=$LASTEXITCODE
exit $taskExit
```

```text
✔ revoked assignment immediately removes roster access (538.5747ms)
✔ expired assignment immediately removes roster access (336.9171ms)
✔ future assignment immediately removes roster access (306.8543ms)
✔ current inactive change fails closed on roster and independent service call (276.5036ms)
✔ current role change fails closed on roster and independent service call (277.1697ms)
✔ current branch change fails closed on roster and independent service call (250.6871ms)
✔ current branch inactive change fails closed on roster and independent service call (263.2683ms)
✔ current permission change fails closed on roster and independent service call (237.5811ms)
✔ roster query/body injection never widens scope and malformed tuple IDs are sanitized (354.7485ms)
✔ roster has independent authentication/role gates and no guessed learner detail surface (303.2831ms)
✔ roster reference changes invalidate authority and DB failure is sanitized (282.721ms)
✔ roster resolves scope once and executes one aggregate regardless of learner count (348.9477ms)
ℹ tests 132
ℹ suites 0
ℹ pass 132
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 57664.2476
```

### typescript — exit 0

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p backend/tsconfig.json
```

Raw stdout/stderr: empty (0 lines).

### eslint — exit 0

```powershell
.\node_modules\.bin\eslint.cmd backend/src/models/chat.ts backend/src/services/chat-write-authority.service.ts backend/src/services/chat-persistence.service.ts backend/src/routes/chat.routes.ts backend/src/server.ts backend/tests/chat-persistence.security.test.ts
```

Raw stdout/stderr: empty (0 lines).

### git diff --check — exit 0

```powershell
git diff --check
```

Raw output (one line):
```text
warning: in the working copy of 'backend/src/routes/chat.routes.ts', LF will be replaced by CRLF the next time Git touches it
```

### Closure self-review and Git confirmation

Reopened the three closure files and compared code, source references, assertions and all reported results with the executed commands. The service's non-comment text is unchanged. Content hashes confirm models/chat.ts, chat-write-authority.service.ts, chat.routes.ts and server.ts are unchanged from the closure baseline. No prohibited policy wording remains in the service, test or report.

Only the approved three files changed during this closure. The existing seven-file F4 worktree remains unstaged on integration/team-merge at e2b9aa48abaf5400616f37f58c89d9abe5057577; the index is empty, no merge is active and no commit/push/destructive Git action occurred. F5 was not started.

DONE — F4 permanent history policy closed and fully verified.

