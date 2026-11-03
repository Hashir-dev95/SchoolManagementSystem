# PR-F3 — Canonical Chat Authority

## Baseline and decisions (recorded before implementation)

Branch `integration/team-merge`; HEAD `876cf8efc6a7b181574dae0500626fd0a5fe78c0` (`f2`). Worktree/index clean, F1/F2 committed, no merge in progress. No Git mutation is authorized.

Canonical code has no chat/conversation/message models, services, routes or tests. Teacher notices/work queues are separate authorized domain workflows, not direct chat. Student teacher-question and Parent message screens remain roadmap features. Reuse currentAcademicActor, requireActiveAcademicBranch, getTeacherScope, resolveStudentReadScope and verifiedChild. The legacy enrollmentMembership roster pipeline permits pre-enrollment snapshots; direct chat must use strict current StudentEnrollment instead, with no legacy placement fallback.

Product evidence: existing Hira School App Features PDF p2 (permitted Branch/classes/verified children), p29 (verified class recipients), p47 (assigned Teacher questions/messages), p66 (verified school/assigned Teacher threads; unrelated class/Teacher denied). These justify the four academic/guardian edges, not a general staff or peer directory. Substitution code grants occurrence/window-specific attendance/lesson authority; no chat policy exists.

| Capability | Canonical implementation | Donor behavior | Decision | F3 action |
| --- | --- | --- | --- | --- |
| Chat authority service | Absent; safe scope helpers exist | chatService uses donor identity/assignment models | MISSING | One read-only eligibility service over canonical helpers |
| Recipient/contact discovery | Absent | authorizedPairs and assigned-Teacher lookup | MISSING_MVP | Own bounded discovery endpoint; no sender/Branch/child selectors |
| Teacher → Student | Notice audiences, no direct chat policy | Class assignment and Student.classId | MISSING | Current permanent assignment + strict current enrollment + active users |
| Student → Teacher | Strict self scope, no chat | Assigned Teacher lookup | MISSING | Same canonical relationship in reverse |
| Teacher → Parent | No chat eligibility | Child-context conversation participants | MISSING | Assigned Student + independently verified current ParentStudentLink |
| Parent → Teacher | Verified-child scope, no chat | Verified donor child link + class Teacher | MISSING | Same canonical guardian/assignment relationship in reverse |
| Teacher ↔ Teacher | No product-specific direct-chat policy | Unsupported recipient role pair | DEFER | Deny in F3 |
| Principal ↔ staff | Branch oversight is not chat policy | Unsupported direct-chat role | DEFER | Deny in F3; Principal↔Parent also deferred |
| Finance chat | No source/navigation policy | Unsupported role | DEFER | No Finance directory or chat edge |
| Student ↔ Student | No peer policy | Not an allowed pair | REJECT | Explicitly deny |
| Parent ↔ Parent | No peer policy | Not an allowed pair | REJECT | Explicitly deny |
| Cross-Branch communication | Existing canonical scope isolation | Donor branch adapter checks | REJECT | Require sender, recipient and relationship Branch equality |
| Stale relationship handling | Existing current-read helpers | Rechecks donor assignments/links; weaker legacy fields | MISSING | Re-run canonical eligibility; no persisted contact permission |
| Substitution authority | Exact occurrence/window for academic operations only | No applicable chat policy | DEFER | Permanent TeacherAssignment only; no substitute chat grant |
| Chat recipient DTO | Absent | Teacher lookup includes email/raw Student context | MISSING_MVP | Only userId/displayName/role/relationshipType |
| Conversation persistence | Absent | chatConversations | DEFER | F4 |
| Message persistence | Absent | chatMessages/read state/attachments | DEFER | F4 |
| WebSocket/realtime | Absent | Socket tickets, ws runtime | DEFER | No runtime import |
| Push notifications | No chat integration | Realtime event publishing | DEFER | No provider or chat-generated notification |

## Donor inspection

Read-only `D:/Faraz-Reference`: branch `faraz-audit`, HEAD `293966bf7f477bd430133e91d9a87d75523782f4`, clean. Inspected backend chatService.js, chatRoutes.js, chatRealtime.js, frontend shared/services/chatService.js and shared/chat/MessagesInbox.jsx; searched unread and notification integration. ADAPT_NOW: relationship-based discovery and rechecking current participants as concepts. DUPLICATE: canonical JWT/Session/current actor and relationship helpers already exist. LATER: participant naming, inbox/retry/unread presentation, stable message ordering, persistence and attachment UX. REJECT: donor identity adapters/auth/session, classTeacherAssignments, Student.classId placement, parentChildLinks compatibility flags, returned email/raw profiles, stale participant authority and socket runtime. No wholesale copy.

## Supported communication graph

| Edge | F3 policy |
| --- | --- |
| Teacher → Student | Allowed only through a current permanent assignment and the Student's strict current enrollment |
| Student → Teacher | Same current relationship, reversed |
| Teacher → Parent | Allowed only through an assigned Student and the Parent's current independently verified child link |
| Parent → Teacher | Same current child/assignment relationship, reversed |
| Teacher ↔ Teacher | Deferred; 403 |
| Principal ↔ staff / Parent | Deferred; 403 |
| Finance / Super Admin | Unsupported chat sender/recipient roles; 403 |
| Student ↔ Student | Rejected; 403 |
| Parent ↔ Parent | Rejected; 403 |
| Self / unknown / unrelated recipient | Rejected; same safe 403 for valid ObjectIds |
| Cross-Branch | Rejected; no client Branch override |
| Temporary substitution | Deferred; no chat grant from an occurrence/window overlay |

The permanent Teacher remains responsible for these communication edges until the permanent assignment changes. A temporary substitution neither replaces that assignment nor grants broad contact access.

## Canonical authorization primitive

`backend/src/services/chat-authority.service.ts` exports `authorizeChatRecipient(identity, recipientUserId)`. Identity is trusted canonical authenticateToken context, never a request-supplied sender or Branch. It reloads the active persisted sender, validates the supported role and current active Branch, loads an active recipient in that Branch and proves the exact allowed relationship using existing canonical helpers.

It returns server context: senderUserId, branchId, a safe recipient DTO and internal relationship witness IDs (Student, current enrollment, permanent assignment, and ParentStudentLink where applicable). Witness IDs are never serialized by discovery. They identify why this read was allowed; they are not a reusable permission ticket or authority for all of a Parent's children.

Valid guessed recipient IDs, existing unrelated accounts, unsupported pairs and foreign recipients produce the same generic forbidden error. Malformed IDs fail contract validation. No public arbitrary-recipient authorization-probe endpoint was added.

## Recipient discovery API

`GET /api/chat/me/recipients?offset=0&limit=25`

- Canonical Session/JWT middleware, persisted active matching-role sender, supported role and active Branch are mandatory. Cache-Control: no-store.
- Only offset/limit are accepted. Strict decimal integers; offset 0–1000, limit 1–100, default 25. Duplicate/array/object/fractional/negative/empty/exponential values are rejected. Sender, recipient, role, child, student, Branch and search selectors are rejected with 400. GET bodies are rejected.
- The server derives candidate IDs from the sender's assignment/enrollment or verified-child relationships. It does not expose a Branch-wide User directory.
- Every returned candidate is independently passed through authorizeChatRecipient; candidate membership alone never authorizes it.
- Response: `{ success: true, data: { items, offset, limit, total, nextOffset } }`.
- DTO: userId, displayName, role, relationshipType only. No email, phone, private Student details, verifier metadata, permissions, sessions, raw profiles or witness IDs.
- Contacts are deduplicated by User ID, sorted by User `_id` ascending, validated before pagination and returned in bounded pages. Total counts authorized recipients, not raw candidate rows.
- A work bound of 1000 candidate relationships/recipients (and the existing verified-child bound of 100 per Parent) fails explicitly with 409 when exceeded. It never silently truncates an oversized scope into a supposedly complete recipient list. This is a bounded MVP read, not an unbounded directory search. Offset pages may naturally change when relationships change between requests; each request resolves current authority afresh.
- Empty eligible scope returns an honest empty list. This endpoint creates no conversation, message, contact snapshot or notification. Unsupported chat routes/methods return 403 after authentication.

## Relationship guarantees

TeacherAssignment stays permanent responsibility. getTeacherScope validates active Teacher, Branch, time window and canonical Class/Section/Subject references. F3 additionally rechecks the exact witness's isActive, revokedAt, validFrom and validUntil before returning eligibility, including contradictory imported revokedAt metadata.

Student placement comes only from resolveStudentReadScope: active Student/User in Branch, exactly one current active enrollment with a valid start and no end, matching active academic period/Class/Section. Student.classId/sectionId snapshots and the roster helper's legacy fallback never authorize direct chat. Class/Section equality must match the exact Teacher tuple.

Parent scope always passes verifiedChild: active Parent/child, exact current link, verified status/active flag/current verification date, no revocation or self verification, current eligible independent verifier, correct Branch and valid current enrollment. Shared email/phone/guardian snapshot never grants authority. Multiple subjects/children collapse to one contact without broadening that contact's domain access.

## Stale authority, races and future write boundary

No contact permission or participant snapshot is stored or cached across requests. Tests prove immediate loss of authority after assignment deletion/inactivation/expiry/future dating/revocation, link revocation/unverification, verifier invalidation, enrollment closure/transfer, account/role changes and inactive academic references without logging in again.

**Recipient appeared in a list earlier != recipient is authorized now.** F4 must rerun this primitive at send time. For future writes it must also serialize/fence and recheck the Session, actors, Branch and all witnessed relationship/academic dependencies at commit time, including clock expiry. F3 introduces no chat writes and makes no premature commit-time locking claim; it reuses current primary reads for read-only discovery.

## Existing notification boundary

F1/F2 files, ownership, safe DTO, read idempotency, unread counts and existing Teacher notice reconciliation are unchanged. Chat messages are not Notification records. No chat unread count, event producer or notification integration was added. No new models, collections or indexes were introduced.

## Frontend scope

Backend-only F3. HTTP and internal authority tests prove discovery; no frontend service or temporary UI is necessary. Existing canonical navigation, inboxes and Developer Preview remain unchanged. Full chat UI belongs to F5.

## Files changed (5; all unstaged)

| File | Change |
| --- | --- |
| backend/src/app.ts | Two lines: import and mount the isolated /api/chat router |
| backend/src/routes/chat.routes.ts | New authenticated read-only own discovery route, safe errors and fail-closed catchall |
| backend/src/services/chat-authority.service.ts | New single eligibility authority and bounded discovery using canonical helpers |
| backend/tests/chat-authority.security.test.ts | New permanent isolated security/state-change tests |
| docs/integration/pr-f3-chat-authority.md | This report and pre-implementation decision matrix |

No shared scope helper, RBAC, relationship model, notification implementation, dependency/native configuration, donor repository or ignore policy was modified.

## Tests and validation

57 new F3 backend tests cover the four edges, unassigned/foreign/peer/staff/self/unknown cases, active identities, Branch/Session gates, stale assignment/link/enrollment/verifier/reference state, transfer without login refresh, legacy snapshot rejection, contact dedupe/order/bounds/selectors, substitution deferral and zero database writes. A before/after snapshot compares every collection across discovery/authorization and forbidden chat write requests. Existing canonical chat tests: none before F3.

| Validation | PASS | FAIL |
| --- | ---: | ---: |
| New F3 chat authority | 57 | 0 |
| F1 notification foundation | 24 | 0 |
| F2 notification inbox | 33 | 0 |
| Existing Teacher notification security | 33 | 0 |
| Teacher scope / assignment authorization and communications | 101 | 0 |
| Student self | 17 | 0 |
| Parent verified-child scope | 14 | 0 |
| **Backend total** | **279** | **0** |
| Notification inbox UI / service | 21 / 1 | 0 |
| Teacher notifications / service | 8 / 1 | 0 |
| Teacher communications / service | 23 / 5 | 0 |
| Student workspace / service | 11 / 9 | 0 |
| Parent workspace | 14 | 0 |
| Auth/session | 3 | 0 |
| Developer Preview | 11 | 0 |
| **Frontend total (11 suites)** | **107** | **0** |
| **Combined** | **386** | **0** |

Backend TypeScript: PASS. Mobile source/test TypeScript: PASS. Root TypeScript comparison: baseline 76, final 76, introduced 0. Inherited errors were not changed. Scoped ESLint (4 changed source/test files): 0 errors, 0 warnings. git diff --check: PASS.

Tests use existing local tsx/node:test isolated temporary MongoDB replica sets and Jest --runInBand. Initial validation found query typing issues and a test setup that simultaneously changed sender/recipient role; those were corrected without weakening assertions. One unchanged Parent UI test timed out at 5 seconds while database suites/TypeScript were running. The complete frontend suite was rerun independently: 107 PASS, 0 FAIL, with no test or timeout changes. Finance/Principal authorization suites were not rerun because no existing shared authority/RBAC helpers were modified; unsupported staff chat roles are directly tested. No native/dependency/assets change requires an Android/iOS build.

Validation artifacts remain excluded under the existing ignored `.validation-principal-audit/chat-f3/`. No generated output or secret was added to source.

## Deferred F4/F5/F6 scope

Conversation persistence, message persistence (F4), chat UI/workspace (F5), typing/presence, read receipts, attachments, WebSocket/realtime, push/FCM/APNs, chat-generated notifications, new domain notification events/F6 integration, staff/Finance/peer policy expansion and substitution chat policy are unimplemented/deferred. No Applications, Payroll, Expenses, Batch Payments or AI work was started.

## Final Git state

Branch `integration/team-merge`; HEAD unchanged at `876cf8efc6a7b181574dae0500626fd0a5fe78c0`. Zero staged files. One tracked modification and four new files (5 total), all left unstaged for review. No merge in progress. No staging, commit, push, merge, cherry-pick, reset, clean, restore, stash or branch switch occurred. Faraz was inspected read-only.

PR-F3 disposition: **READY FOR REVIEW**.
