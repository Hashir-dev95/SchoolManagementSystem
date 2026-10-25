# P-PR4 — Principal result moderation and publication

Workspace: D:\SchoolManagementSystem; branch: feture. Implementation and re-audit: 24–25 October 2026 (Asia/Karachi).

## A. Verdict

Final validation in progress. This draft is updated only after the required regression run completes.

## B. Original root causes and reproduction

The original Principal result router exposes only detail, moderation and publication by approval ID. The general approval inbox returns pending requests. Approval moves a result to moderated_approved and its linked approval to approved, so navigating away removes the only normal discovery path even though publication is still pending. No queue endpoint existed.

The original detail screen keeps a complete mutation response in local current state and renders current ?? resource.data. Once populated, that object wins over every later authoritative refresh. Its old canPublish survives a published or unavailable server response.

The isolated original-router inventory fails the queue assertion (reproduced-route.log). The isolated original-screen renderer fails the permanent refresh assertion by retaining Publish Result (reproduced-stale-state.json/log). Application files were never replaced for these reproductions. Early setup/compiler failures and superseded runs are retained separately; they are not current acceptance failures or counted as passing evidence.

## C. Existing state machine preserved

- Teacher draft -> submitted_for_moderation (initial revision) or resubmitted_for_moderation (later revisions).
- Principal approve -> moderated_approved; the linked approval becomes approved. This remains unpublished and Student-invisible.
- Principal return -> returned_for_revision; the linked approval becomes changes_requested. Teacher explicitly creates a new revision, edits the resulting draft and resubmits.
- Principal reject -> rejected, retained and terminal under the existing contract.
- Principal explicit publication -> published, with publishedRevision, publishedAt and publishedBy set on the current approved revision.

recordRevision protects mutations; currentRevision identifies immutable mark revisions. Approval.resultRevision and submittedRevision must match the current revision before publication. No state renaming, auto-publication or unpublication action was introduced.

## D. Canonical return queue

Approvals -> Results / Awaiting Publication -> existing Result Review -> Publish Result confirmation. Results defaults to Awaiting Publication and also provides Pending Review, Published, Changes Requested and Rejected groups. The existing native stack owns Results and ResultModeration, so Back returns to the previous destination. Focus/refresh reloads the queue.

GET /principal/results accepts state, search, offset and optional Class/Section/Subject IDs. The server derives the persisted Principal and active own Branch, checks result/approval read grants and existing result-category authority, joins the exact approval and academic tuple before pagination, and returns at most 20 summaries with total/nextOffset. Search runs on the server across assessment, academic names/year and contextual Teacher/Student names. It never scans all results in the frontend. Invalid/inactive academic references produce an explicit configuration count/message rather than a fabricated empty-success explanation. Foreign Branch references are not populated into contextual names.

## E. Publication authority and safe DTO

Mutation entry revalidates the persisted active Principal, own active Branch, Results view and approval-management permission and the existing configured result-category grant. Publication reads the linked result/approval in a transaction, checks recordRevision, approved moderation, unpublished metadata and aligned current/submitted/approval revisions, and serializes the linked approval plus result.

Both Principal result mutations reuse withPrincipalWriteAuthority from P-PR1. Target/history writes remain provisional until conditional Branch/User/exact-Session fences and final token/permission/category-policy checks succeed. Class, Section and Subject references are fenced and checked in the same transaction. Authority changes after the provisional save roll back the entire result and approval documents, including timestamps/version/history. No second identity, permission, session, result or logging model was added.

Detail capabilities include the actual management grant, valid academic context and authoritative state/revision alignment. Queue summaries are explicit projections. Principal detail omits Teacher-only drafting notes; Student DTOs retain their existing minimal marks/released-feedback projection. Session and policy internals, operation IDs/fingerprints and foreign contextual identity data are not exposed.

## F. Authoritative frontend ownership

The existing server resource is the only complete record owner. Local state contains only the reason input, confirmation, request lock and feedback. Mutation responses are never stored as a second full record: every outcome waits for an authoritative GET. Actions are unavailable while a mutation/refetch runs; a failed refresh leaves no actionable stale record. Record/authenticated-actor changes remount the resource boundary. Refresh/revision changes clear temporary moderation/confirmation state. Generation handling in the existing resource rejects late responses after blur/unmount. Mounted lifecycle handling also supports repeated effect setup/cleanup.

The permanent original-bug test first gets Publish from a moderation response, then refreshes to published/non-publishable server data and verifies Publish is absent. Additional tests cover changed actor/record/revision, failed refresh/retry, conflict and authority loss.

## G. Concurrency and history

Two independently authorized Principals publish the same approved revision: one succeeds and the other receives 409; latest detail is published/cannot-publish. Exactly one recordRevision transition and one published history event persist. An identical operation retry is idempotent; a different duplicate or changed operation payload conflicts. Stale moderation and publication cannot overwrite each other.

The existing result history records draft/submission/revision, moderation_approve/moderation_return/moderation_reject and published separately. The existing moderation and approval histories remain in place. There is no parallel audit log.

## H. Student visibility and Teacher regression

Approved/unpublished results are absent from Student list and concealed by detail. Published results require the active persisted Student identity, active own Branch, exact Student/recipient IDs and legitimate Class/Section membership. Managed enrollment history takes precedence over compatibility projections; valid historical membership preserves published marks after promotion, transfer or withdrawal. A never-held tuple or foreign Branch cannot grant access. Legacy Student placement and legacy published records without publication-revision metadata retain compatibility; an explicit publication revision must match currentRevision.

The unchanged StudentEnrollment regression caught an overly strict current-placement implementation during P-PR4. The result reader was corrected to preserve the existing published-history contract; enrollment implementation and its assertions were not changed. Teacher submitted/approved/published status, moderation feedback and private notes remain available under existing Teacher authority. Teacher gains no Principal publication power.

## I. UI/UX and navigation

Mobile-oriented scrollable Hira cards show assessment, Student, Class/Section/Subject, Teacher, academic year and clear queue grouping; details show frozen evidence, marks, revision/moderation/event history and publication state. Search/pagination remain bounded. Loading, different empty groups, search misses, error/retry, permission loss and academic configuration have distinct feedback. Publication requires an explicit confirmation explaining Student visibility. Success, stale conflict and authority loss use safe business feedback; raw revision/database errors are not shown. The component integration test performs approve -> leave -> no longer pending -> return queue -> reopen -> confirm -> publish -> obsolete capability disappears.

## J. Hira reuse and validation limits

Reuses DashboardShell, ScreenHeading, SectionCard, Button, StatusBadge, AdminDialog, AdminFeedback, formStyles and the existing theme. No new component/alert library, color palette, table UI, navigation paradigm or localization architecture was added. Text follows the repository's current English convention. Validation covers implementation, automated server/component interaction and layout/component review. No physical Android/iOS device or emulator visual certification or production deployment is claimed.

## K. Files changed

| File | Reason |
| --- | --- |
| backend/src/services/academic-result.service.ts | Canonical queue, authoritative capabilities, P-PR1 mutation fences, scoped DTOs and enrollment-aware published reads |
| backend/src/routes/academic-result.routes.ts | Add focused Principal list route within the existing result API |
| src/services/principal/resultModerationService.ts | Typed queue/filter and safe detail contract |
| src/screens/principal/PrincipalResultsScreen.tsx | New bounded results queue; reuse existing detail |
| src/screens/principal/PrincipalResultModerationScreen.tsx | Remove duplicated record ownership; explicit Hira confirmation, refresh, history and feedback |
| src/screens/principal/PrincipalApprovalsScreen.tsx | Discoverable Results / Awaiting Publication entry |
| src/screens/principal/PrincipalWorkspaceScreen.tsx | Connect that entry to the existing stack |
| src/navigation/PrincipalNavigator.tsx | Register Results with native Back/header |
| backend/tests/academic-result.security.test.ts | Permanent queue/publication/authority-race/concurrency/Student/Teacher regressions |
| __tests__/marks.test.tsx | Detail/publication/stale-state tests and complete Principal return journey |
| __tests__/principal-results.test.tsx | Queue loading/empty/error/retry/filter/pagination/authority/navigation tests |
| __tests__/result-service.test.ts | Queue request encoding contract |
| __tests__/principal-approval-context.test.tsx | Updated route inventory and Approvals return entry assertion |
| docs/P-PR4-result-publication-closure.md | Closure architecture, evidence, counts and preservation |

.validation-p-pr4 contains only validation fixtures, isolated original copies, configs/runners, logs, structured results and owned temporary test artifacts. package-lock.json and yarn.lock were already dirty and were not edited by this task.

## L. Exact final test results

Pending final structured summary.

## M. Broader regression

Pending final suite table. P-PR1/P-PR2/P-PR3 implementations and their security contracts were not redesigned. Full backend TypeScript, scoped frontend and new backend-test TypeScript, scoped ESLint and git diff --check are required for closure. All database tests use owned temporary instances. Validation runtime settings bound compiler/Mongo memory, run cross-process suites from backend, and place temporary databases on D: because C: has insufficient free space. No production database/deployment configuration or existing assertions were altered to accommodate the host.

## N. Deferred Principal work

P-PR5 onward only: attendance oversight, substitution UI, Teacher directory, notice redesign, Branch reports and broader information architecture. None started.

## O. Worktree preservation

No reset, restore, clean, staging, commit or push. Existing unrelated lockfile work remains untouched. The shared P-PR1 helper and closed-phase domain implementations remain unchanged. Branch remains feture. Final index/dirty-file verification is recorded with the structured evidence.
