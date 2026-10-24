# T-PR5 — Teacher Notices, Inbox and AssignedWork

Implemented on `feture`. Nothing staged, committed or pushed.

## A. Existing infrastructure audit

- `SchoolNotice` stores branch, creator, title/message, priority, draft/published/archived state, publication/expiry timestamps. Principal list filters publication/expiry; detail is branch-scoped. It has no class recipient authority, recipient records, language, revision or send-operation identity. Principal routes provide reads, not a notice-composer mutation API.
- There is no private Student/Parent message, question, thread, participant, moderation or secure attachment domain. Student stores guardian name/phone/address; User stores private contacts and credentials. There is no authenticated guardian relationship to use as an audience.
- `PrincipalTask` and `ApprovalRequest` are distinct. Principal tasks have branch assignment, ownership/action policy and history; approvals have category, financial, source and delegation authority. Neither authorizes Teacher operational work.
- Effective `TeacherAssignment` scope already validates current Teacher/branch and exact class/section/subject tuples, active references and section parentage. Student enrollment is class/section based; no subject enrollment domain exists.
- Existing attendance/timetable writes use replica-set transactions, record/branch fences, primary authority reads, revisions and explicit client operation identities. Trusted enrollment creation shares the branch fence. T-PR5 follows those patterns.
- Teacher Inbox/Tasks were placeholder text. Existing navigation, `useTeacherResource`, Teacher service envelopes and Hira components provide the navigation, generation protection and design conventions.
- Several shared models and unrelated Principal/Super Admin files already had unstaged edits. Their existing edits were retained.

## B. Notice domain decision

Dedicated `TeacherNotice`, `NoticeDelivery` and `NoticeOperation` models keep class publication separate from legacy Principal notices. Notice fields retain branch, creator/role, exact audience context, title/body, `en`/`ur` language, state, revision, timestamps, published time/count and operation identity.

The only legacy extension is optional `SchoolNotice.audienceRoles: ['teacher']` and its index. Missing audience metadata does **not** include Teachers. Existing Principal behavior is unchanged. A trusted school-notice producer must opt in explicitly; this PR adds no school moderation/authoring admin UI.

## C. Recipient-scope contract

`class_students` is the only Teacher-authored audience. The server requires a current effective exact tuple, then derives active Student enrollment in that branch/class/section and joins active same-branch Student User identities. Subject scopes Teacher authority; Student subject enrollment cannot be inferred from the current model.

Arbitrary recipient IDs, caller branch/creator/role, contacts, attachments and unrecognized request fields are rejected. Same branch alone does not authorize any class audience. No tuple cross-products are permitted.

## D. Preview/send parity

Preview and send call `resolveNoticeRecipients`. Preview returns only `{context, audienceType, recipientCount, channel}`. Context contains the seven existing assignment display fields; there is no recipient contact/name list or preview token granting authority.

## E. Send-time reauthorization

Send verifies current login, role, active branch, action permission, assignment/references, ownership and draft revision. It fences the login, Teacher, branch, tuple references, assignment and recipient enrollment/identity rows. Primary reads after locking observe changes before the lock; subsequent writes to locked rows serialize. New enrollment uses the existing branch fence. Unexpected newly eligible enrollment or changed identity between candidate locking and resolution causes a conflict.

Recipients are resolved again immediately before durable publication. Draft context must match the context actually fenced. A final permission/scope check occurs before transaction commit. Authority failures roll back notice, delivery and operation writes together.

## F. Privacy contract

Explicit DTOs exclude raw User/Student records, creator/assignee audit payloads, recipient identities, personal/guardian contacts, addresses, finance/support data, credentials, sessions and provider secrets. Preview exposes a count and authorized academic context only. Delivery recipient IDs remain internal.

Notice input is public class copy; no profile/private-note interpolation or templates are implemented. Common phone-number/email patterns are rejected and the composer asks authors to omit private notes/contact details. This is not semantic detection or anonymization: authors remain responsible for the public text they enter.

## G. Draft/send/idempotency behavior

- Create draft within current assignment. Edit uses revision compare-and-swap and requires authority over the existing and selected context. Old drafts remain creator history in the current branch after revocation, with editing/sending denied.
- Save does not publish. Published drafts are immutable through the draft endpoint.
- Send accepts only `{revision, clientOperationId}`. The operation is unique per authenticated creator across branches. The hash binds notice ID and revision; revision guards the stored content/audience.
- Same operation/payload returns the same logical publication, without new delivery records. Changed revision/notice under that operation returns 409. Another operation cannot republish the same draft.
- The frontend retains operation identity across uncertain send failures, preserves input, guards duplicate clicks and waits for server confirmation. Draft creation itself is not transport-idempotent; an uncertain draft-create retry can create an extra **unsent** draft.

## H. Delivery semantics

`accepted_internal` means notice publication and per-recipient acceptance records were atomically stored for the internal school-app channel. It does not mean a device received, displayed or read the notice. There is no external provider, push infrastructure or Student messaging UI. Recipient consumption/read receipts are later work.

Draft has no delivery state. Failed transactions create no publication/delivery records; the client shows the request failure. No fake queued, delivered or read transitions are generated. The schema reserves notice archive state for later scoped lifecycle work; no archive action is exposed here.

## I. Threads/private questions

Deferred because the required private participant and moderation domains do not exist. Inbox explains that private questions/replies are unavailable. No Reply, attachment, anonymization or anonymized-explanation publish button is fabricated.

## J. AssignedWork domain

Separate model: branch, Teacher assignee/role, source type/context, title/summary, open/completed/cancelled status, normal/high priority, optional due date, assigner, timestamps, revision and state-change history. Supported producers are deliberately limited to `coordinator_follow_up` and `class_follow_up`. Unknown source types fail closed.

Principal/Super Admin producers use separate `assigned_work.manage` routes. Branch derives from the eligible assignee; callers cannot supply it. Class work additionally requires the assignee's exact effective tuple. There is no Teacher assignment or ownership mutation route.

## K. Work versus approvals

PDF “assigned approvals” is interpreted as assigned authorized operational work until a Teacher approval policy exists. No Principal approval permission, approval service or approval action is reused. Completing work does not approve a request or modify its linked academic source.

## L. Teacher Tasks contract

`GET /api/teacher/tasks?offset=0` returns `{total, items, nextOffset}` for current authorized **open** work only. Each item has exactly:

`workId, title, summary, sourceType, source, status, priority, dueAt, revision, completedAt, createdAt, updatedAt, canComplete`.

Standalone coordinator work has no linked source. Class work requires current class-view permission and exact source scope on queue/detail/completion; linking/ownership never grants source access. Completion rechecks the source permission across the transaction. Opening the class navigates to the existing roster route, which independently reauthorizes the tuple and source permission.

Completion is idempotent, with one revision/history transition. Owner withdrawal serializes with completion and ultimately leaves the work cancelled, including when completion committed first. Cancelled work detail is concealed; further completion conflicts. Missing/inactive/mismatched class references reconcile stale open work to cancelled with `source_unavailable` audit reason. This queue reconciliation writes closure history; it is not a read-only analytics endpoint.

## M. Teacher Inbox contract

`GET /api/teacher/inbox?offset=0` returns `{total, items, nextOffset}`. It combines:

- Own class notices/drafts/history in the current branch.
- Published class announcements with an exact current supervising Teacher tuple. This explicit supervision policy does not share other creators' drafts.
- Published, unexpired current-branch school notices explicitly opted in to Teachers.

Notice items have exactly:

`noticeId, kind, title, body, language, state, revision, classId, sectionId, subjectId, audienceType, createdAt, updatedAt, publishedAt, recipientCount, channel, deliveryState, canEdit`.

School notice language/revision/count or missing legacy update timestamp may be null rather than invented. Its publication is not evidence of per-recipient delivery.

## N. Future Home parity

Home can consume the **same** Inbox/Tasks services and their `total` values. Notices total means all items in the Inbox policy, including drafts/history; it is not an unread count. Assigned-work total means the currently authorized open Tasks queue. No dashboard-only filters or invented zeros were added. Today/attendance remain T-PR3/T-PR4; submissions/catch-up remain unavailable.

## O. Frontend Inbox

Real paginated Inbox with loading, empty/error/Retry, focus and pull refresh, selected-item context and draft/notice distinctions. Visited tabs remain mounted; inactive tabs defer fetching. Generation guards ignore blurred/stale responses and hide rows during current-authority refresh. No search/filter was added without a demonstrated need.

## P. Composer/preview UX

Server-provided exact class choices, title/body, English/Urdu, recipient count, full content preview and internal-channel label. Flow: choose → preview → save draft → explicit send. Editing invalidates preview and requires saving current content. Authority/conflict failures force revalidation without discarding input. Revision conflict offers explicit reload of the saved draft. Send confirmation displays the server's actual current recipient count.

## Q. Tasks frontend

Open work rows display title, source, priority, due/overdue state and status. Detail offers independently authorized class source navigation and server-confirmed completion when permitted. Concealed/withdrawn items lose their controls and are removed from the refreshed queue. Selected tab/item persists on navigation return; list pagination is retained. No remount keys are used.

## R. Hira design reuse

Existing `DashboardShell`, `Card`, `SectionCard`, `ScreenHeading`, `Button`, `StatusBadge` and Teacher/Hira theme styles. No separate Teacher design system. Existing shared payment badge colors are reused with explicit Draft/Notice/Open/Completed labels. Native-device visual review was not performed.

## S. Security/IDOR verification

42 real HTTP/database tests use owned ephemeral replica-set MongoDB, real indexes and transactions. Coverage includes own/other Teacher/foreign/guessed IDs, class/section/subject/cross-product attacks, strict recipient/branch field rejection, revoked/changed role/branch/permission/session, moved or invalid Student identities, exact DTO privacy, school audience opt-in/expiry, revisions, concurrent send replay, changed-operation payload conflicts, source authority, ownership spoofing, work completion replay and source withdrawal.

Additional boundary tests mutate authority after initial authorization, invalidate permission after staging publication to prove rollback, and prove enrollment movement waits for publication fences. Empty audiences do not publish. Unique operation/delivery indexes are tested with autoIndex disabled.

## T. Wrong-recipient verification

Exact tuple, other section/Teacher/class/branch, subject mismatch and tuple cross-product tests fail closed. Student movement/identity changes after preview are excluded at send. Persisted delivery audiences are inspected, including the absence of wrong-class recipients.

## U. Concurrency/idempotency verification

Concurrent same-operation sends persist one publication, one operation and one record per current recipient. Changed-payload reuse conflicts. Concurrent draft edits use revision CAS. Work completion replays produce one transition; concurrent owner withdrawal leaves cancelled work. Boundary permission failure rolls back all publication records.

## V. Privacy verification

Preview/context, notice, queue and work DTO keys are asserted exactly; seeded private User/guardian/address data does not enter responses. Recipient IDs and audit/operation internals remain outside notice DTOs. Author-entered contact patterns are rejected.

## W. Frontend verification

The full frontend suite passes: 18 suites, 202 tests. New communication tests cover service request contracts, queue loading/empty/error/Retry/focus/pull/stale responses, notices/privacy, authorized composer selection, validation, previews/count refresh, draft/save failure, explicit send/failure/retry/duplicate-click guard, stale authority, revision reload, selected context, inactive tabs, source opening, completion, concealed 404 and withdrawn-item removal. The actual frontend Preview adapter is also exercised against the owned local backend, including projection of a full composer form to the strict audience-only request. Existing Teacher, Principal, permissions, navigation, Super Admin routing and App smoke tests also run.

## X. Performance/index review

Recipient resolution is one projected aggregate with indexed identity joins, not per-recipient assignment lookups. Enrollment/identity fencing uses bulk writes. Queues return at most 50 items per page with stable created-time/ID ordering. Inbox merges IDs in MongoDB; work source availability is reconciled with batched projected joins. Queue projections omit internal audit history.

Indexes cover Teacher notice creator/history and audience/state, unique creator/operation, unique notice/Student delivery, recipient publication lookup, work branch/assignee/status/time and source/status, Student branch/class/section/active, and explicit school Teacher audience/state/time. Startup establishes the new indexes before accepting traffic, including autoIndex-disabled deployments. Send also fails closed if required indexes cannot be established.

Branch fencing intentionally follows the existing enrollment/academic write convention. It can serialize high-volume publications/attendance within a branch; production load measurement remains future work. No real database migration or provider call was run.

## Y. Regression/static results

- Final new backend communications suite: **42/42 pass**.
- Final frontend: **202/202 tests**, **18/18 suites** pass.
- Backend regression matrix: **356/366 pass**, with **10 confirmed pre-existing Principal safety failures**. It includes Teacher scope/roster, timetable, attendance, bootstrap, approval/resubmission, Principal authorization and writes/tasks/safety.
- Isolated baseline Principal comparison: **136/146 pass**, with **10 failures**. Current matching Principal suites reproduce the same 10 safety failures; T-PR5 introduces no additional failure. The unrelated safety service returns no updated document for callers that need one, breaking safety serialization/actions.
- Repository TypeScript baseline/current: **30/30 diagnostics**, **zero added diagnostics**, compared using the compiler API against a temporary copy with only T-PR5 changes removed.
- Backend source compiler retains one pre-existing diagnostic: `safety-alert.controller.ts:47`, `void` passed as `ISafetyAlert`. Scoped frontend TypeScript: **0 diagnostics**.
- All T-PR5 changed-file lint: **0 errors, 0 warnings**. Standard repository `git diff --check` passes after removing an added EOF blank line.
- Existing permission snapshot tests were updated only to recognize/exclude the new dedicated Teacher grants, preserving explicit non-Teacher authority boundaries.

Reproduce backend checks from `backend` with `node_modules/.bin/tsx --test tests/teacher-communications.security.test.ts tests/teacher-scope.security.test.ts tests/teacher-timetable.security.test.ts tests/teacher-attendance.security.test.ts tests/bootstrap.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/principal-write.security.test.ts`. Frontend: `node_modules/.bin/jest --runInBand`. Use `.cmd` launchers on Windows. Sandbox Node user-information access required the isolated backend runs to execute outside the sandbox; no external service/account data was used.

## Z. Exact T-PR5 files

Added:

1. `backend/src/models/teacherNotice.ts`
2. `backend/src/models/assignedWork.ts`
3. `backend/src/services/teacher-communication-access.service.ts`
4. `backend/src/services/teacher-notice.service.ts`
5. `backend/src/services/teacher-work.service.ts`
6. `backend/src/routes/teacher-communication.routes.ts`
7. `backend/tests/teacher-communications.security.test.ts`
8. `src/services/teacher/communicationService.ts`
9. `src/screens/teacher/TeacherInboxScreen.tsx`
10. `src/screens/teacher/TeacherNoticeScreen.tsx`
11. `src/screens/teacher/TeacherTasksScreen.tsx`
12. `src/screens/teacher/TeacherWorkScreen.tsx`
13. `__tests__/teacher-communication-service.test.ts`
14. `__tests__/teacher-communications.test.tsx`
15. `docs/T-PR5-communications.md`

Modified:

1. `backend/src/app.ts`
2. `backend/src/server.ts`
3. `backend/src/constants/permissions.ts`
4. `backend/src/constants/rolePermissions.ts`
5. `backend/src/models/schoolNotice.ts` — audience opt-in/interface/index only; existing unrelated formatting retained.
6. `backend/src/models/student.ts` — recipient lookup index only; existing unrelated formatting retained.
7. `backend/tests/approval-authority.security.test.ts` — new Teacher grant exclusions only.
8. `backend/tests/principal-write.security.test.ts` — new Teacher grant exclusions only.
9. `src/constants/permissions.ts`
10. `src/navigation/TeacherNavigator.tsx`
11. `src/screens/teacher/TeacherWorkspaceScreen.tsx`
12. `src/screens/teacher/useTeacherResource.ts` — optional active-tab fetching, default behavior retained.
13. `__tests__/teacher-navigation.test.tsx`
14. `__tests__/teacher-screens.test.tsx`
15. `__tests__/teacher-service.test.ts`

Ignored backend `tpr5-*.log` files retain local verification output; the temporary baseline copy lives outside the repository. Neither is part of the intended code changes.

## AA. Unrelated changes preserved

No edits were made by this task to the existing changes in `.gitignore`, Principal task controller, permission middleware, approval/attendance/safety/class/section/session/subject/assignment models, safety service, Super Admin navigation/dashboard, Principal dashboard, admin service or API client. Existing `.gradle-user/` and `services/` contents were not changed. Shared dirty `schoolNotice.ts` and `student.ts` received only the explicit T-PR5 additions above; staging those whole files later would also include their pre-existing edits.

Git index is unchanged and empty. Branch remains `feture`. No staging, commit, push, reset, clean or broad restoration was performed.

## AB. Remaining risks

- The repository still has the confirmed pre-existing Principal safety failures and TypeScript diagnostics. This report does not claim the overall repository is green.
- Native-device visual review and production query/load/index rollout remain review/deployment checks.
- Publication acceptance is durable internal state, not actual recipient delivery/read evidence; recipient consumption UI/providers are intentionally absent.
- Private threads, moderation admin UI, secure attachments, guardian messaging and anonymized explanations are intentionally deferred. Future work/source types must add explicit source policies, not accept arbitrary model names or reuse approvals.
- Privacy checks do not semantically inspect authored text. There is no private data interpolation.

## AC. T-PR5 readiness

**READY FOR REVIEW**

T-PR5 behavior/security/frontend checks pass and it adds zero TypeScript diagnostics. The unrelated repository baseline problems remain visible for separate resolution.

## AD. T-PR6 recommendation

**YES — after T-PR5 commit, move to T-PR6 Teacher Home Aggregator**

Use existing shared queue contracts; preserve unavailable submissions/catch-up domains and truthful publication semantics. This task did not create the commit.
