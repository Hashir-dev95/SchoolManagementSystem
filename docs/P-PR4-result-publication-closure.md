# P-PR4 continuation and closure audit

Workspace: `D:\SchoolManagementSystem`; branch: `feture`. Completion pass: 25 October 2026 (Asia/Karachi).

## A. Verdict

**P-PR4 COMPLETE — RESULT PUBLICATION WORKFLOW CLOSED**

## B. Existing P-PR4 state found

This PC already contained the implementation in the tracked worktree before this completion pass. It was inspected directly, rather than reconstructed from the older report.

| Classification | Observed implementation | Decision |
| --- | --- | --- |
| Already correct | Principal Results destination, Approvals entry, five server-filtered queues, bounded pagination and server search | KEEP |
| Already correct | Existing result routes/service/model, separate moderation/publication, linked approval and revision checks | KEEP |
| Already correct | P-PR1 transaction authority fences, academic-reference fencing, single existing result history | KEEP |
| Already correct | Server-resource-only detail ownership, auth/record remount boundary, refresh generation handling | KEEP |
| Already correct | Hira confirmation/feedback, native stack headers/Back, enrollment-aware Student visibility rules | KEEP |
| Partial | Tests did not explicitly assert non-publishable capabilities and correct queue membership for all non-approved states; direct queue/detail denial for several persisted actor changes was implicit | COMPLETE with permanent assertions and four read-security tests |
| Partial | Stale-state tests covered publication and actor/token changes, but not unchanged status/revision capability removal, late older refresh, or permission context change with the same token | COMPLETE with three permanent component tests |
| Missing | Final independent regression evidence and completed closure report | COMPLETE in this pass |
| Broken | Student result DTO resolved Subject names by ID without Branch scoping; a corrupt legacy foreign reference exposed a foreign Subject name | FIX the existing lookup; permanent failing-then-passing regression |
| Duplicate/unnecessary | No second result domain, result queue route, or alert framework found | None added |

The initial unrelated modifications were `backend/src/controllers/principal-task.controller.ts` and `src/services/api/apiClient.ts`, alongside existing untracked PC files/directories. This pass did not edit those files.

## C. Remaining root causes

The historical discoverability defect was the pending-only approval inbox: approving removed the result from its only visible entry point. The historical stale-state defect was a local complete `current` result winning over newer `resource.data`.

Both primary fixes were already present here. Fresh permanent tests prove the current return journey and removal of obsolete capabilities. The remaining closure gaps were explicit edge-case coverage, an unfinished validation/report, and one DTO isolation flaw discovered during final review. The new corrupt-reference regression first failed with `FOREIGN PRIVATE Subject` in the Student DTO. The existing Subject lookup now includes the result's Branch, preventing foreign contextual name resolution without changing publication or historical enrollment eligibility. Prior reports/logs were not counted as fresh passing evidence.

## D. Final result state machine

`draft` -> `submitted_for_moderation` -> Principal decision:

- Approve -> `moderated_approved`; linked approval is `approved`; still Student-invisible.
- Return -> `returned_for_revision`; linked approval is `changes_requested`; Teacher explicitly creates a new draft revision and submits as `resubmitted_for_moderation`.
- Reject -> `rejected`, terminal under the existing contract.
- Explicit publication of the approved current revision -> `published`, setting `publishedRevision`, `publishedAt`, and `publishedBy`.

`recordRevision` protects writes. `currentRevision` identifies the marks revision; approval and submitted revisions must align. Approval does not auto-publish. Teacher publication authority was not added.

## E. Return queue architecture

Approvals -> Results / Awaiting Publication -> existing Result Review -> explicit Publish confirmation. Results defaults to Awaiting Publication and also exposes Pending Review, Published, Changes Requested and Rejected.

`GET /principal/results` derives the active persisted Principal and own active Branch, checks Results/approval-view permissions and configured result-category authority, validates exact approval linkage and academic context, then paginates in MongoDB. It accepts state, search, offset and optional Class/Section/Subject IDs. Pages contain at most 20 projected summaries plus total/nextOffset. Search is server-side across assessment, academic context, Teacher/Student names and year. Invalid academic references produce an explicit configuration count. Foreign Branch results/context are concealed.

## F. Publication authority

The mutation revalidates persisted active Principal identity, own active Branch, result/approval permissions and configured result-category grant. Inside the transaction it rereads exact result/approval linkage, expected record revision, approved state, absence of prior publication and alignment of approval/submitted/current revisions. It fences the approval and writes the result/publication event once.

The existing `withPrincipalWriteAuthority` performs conditional Branch/User/exact-session fences after provisional writes, then checks token validity and management permission before commit. Class/Section/Subject are fenced and validated inside the same transaction, and category/view grants are rechecked. Branch transfer, role demotion, account disable, session revocation, permission removal and Branch deactivation all roll back the complete result/approval documents. Tests compare full persisted documents, including timestamps/version/history. Invalid academic references also roll back. Replica-set transactions are required; unsupported deployments fail safely.

DTOs use explicit projections: Principal detail strips Teacher-only drafting notes; result history omits operation fingerprints/IDs; Student responses expose marks and released feedback only. No session/policy internals or unrelated Student data are added.

## G. Authoritative stale-state ownership

`useTeacherResource` owns the only complete Principal detail record. Local state holds reason input, confirmation, busy/lock state and feedback. Mutation DTOs never become a competing local result. Every mutation outcome awaits authoritative refetch; refresh immediately clears old data/actions; failed refresh leaves no stale actionable result. Generations reject older responses. Record/auth context changes remount the resource; authoritative data changes reset temporary reason/confirmation state.

Permanent tests cover the original mutation-DTO shadowing reproduction; published/non-publishable refresh; capability removal with unchanged approved status/revision; out-of-order refresh completion; record/token changes; permission-context change with the same token; revised marks; refresh failure/retry; conflict and permission loss.

## H. Concurrency proof

Two independently authorized Principals publishing the same revision produce one HTTP 200 and one HTTP 409, one recordRevision increment and one `published` history event. Latest detail is published with `canPublish=false`. Identical operation retries are idempotent; different duplicate operations conflict. Stale publication/moderation cannot overwrite current data. Transaction-retry tests validate actual references rather than stale initial reads.

## I. Student visibility proof

Approved/unpublished results are absent from Student list and return 404 from Student detail. Published results require active persisted Student identity, active own Branch, matching Student/recipient IDs and legitimate Class/Section membership. Managed StudentEnrollment records take precedence over compatibility placement fields. Valid historical membership preserves published history after withdrawal/promotion/transfer under the existing contract; never-held placement and foreign Branch access remain denied. Existing legacy publication compatibility remains intact.

## J. UI/UX re-audit

Reviewed actual queue/detail components, services, workspace wiring, navigator, resource hook, shared dialog, Button and DashboardShell implementations. Cards use vertical wrapping text for long academic/Teacher names and a scrolling mobile layout, with details carrying evidence/history. Native stack headers preserve Back; returning to a focused queue reloads it. Integration tests perform approve -> leave -> rediscover -> reopen -> confirmation -> publish -> obsolete action disappears.

Queues distinguish loading, each status-specific empty state, search misses, permission failure, backend error/retry and academic configuration problems. Confirmation explains eligible Student visibility and Class/Section/Subject; Cancel does not mutate. Server-confirmed success uses Result Published feedback. Conflict/authority loss use safe Hira feedback and refetch, with stale actions removed. No optimistic publication occurs.

Validation includes source/layout review and rendered component interaction tests. A physical-device/emulator visual certification was not performed; no production deployment was attempted.

## K. Hira theme reuse

Preserved DashboardShell, ScreenHeading, SectionCard/Card, Button, StatusBadge, AdminDialog, AdminFeedback, formStyles, semantic theme colors and existing spacing/typography/safe-area patterns. No theme, UI library, table layout, navigation paradigm or alert framework was introduced.

## L. Files changed in this completion pass

| File | Reason |
| --- | --- |
| `backend/src/services/academic-result.service.ts` | Scope Student result Subject-name resolution to the result's Branch |
| `backend/tests/academic-result.security.test.ts` | Four persisted actor/session/role queue+detail denial tests; explicit capability/queue assertions for pending/returned/rejected results; foreign Subject DTO regression |
| `__tests__/marks.test.tsx` | Three stale-state tests: unchanged-state capability removal, older refresh completing late, same-token permission-context replacement |
| `docs/P-PR4-result-publication-closure.md` | Replace unfinished historical draft with current-PC audit, exact fresh evidence and final closure decision |
| `.validation-p-pr4-completion/run-backend.cjs` | Fresh regression runner without the prior runner's cached-pass reuse |
| `.validation-p-pr4-completion/*.log` and `*.json` | Fresh test/compiler/lint evidence; no production artifacts |

Existing P-PR4 production architecture was reviewed and retained: backend academic result service/routes/model; Principal results service/queue/detail/Approvals/workspace/navigation; shared resource hook; Student visibility and existing enrollment/authority helpers. Only the narrow Subject lookup needed a production correction; no rewrite was necessary.

The fresh runner reuses the existing validation-only Mongo launch helper and owned temporary directory. Its helper also creates diagnostic `mongo-<pid>.log` files under `.validation-p-pr4`. Application code, production DB configuration and test assertions were not weakened for the host.

## M. Exact test counts

Final backend run: **966 PASS, 0 FAIL, 0 skipped across 22 suites**. Final full frontend run: **668 PASS, 0 FAIL, 0 skipped across 60 suites**. The final result-security subset is **86 PASS, 0 FAIL**. StudentEnrollment was also rerun after the DTO fix: **58 PASS, 0 FAIL**. Focused/rerun counts are subsets and are not added to full-run totals.

Earlier non-acceptance attempts: the restricted sandbox prevented Node Windows user-profile lookup before backend assertions; the rerun uses normal local execution and owned temporary replica sets. The first full frontend run had one 5-second staff self-service timeout (664 PASS, 1 FAIL); that unchanged suite passed on isolated rerun and the final full run passed all 668 tests. No timeout/expectation changes were made.

## N. Broader regression

All required suites passed. P-PR1 commit authority, P-PR2 Safety/release and P-PR3 admission/profile remain green. No closed-phase implementation was redesigned. Principal/navigation and all academic frontend suites are included in the 60-suite frontend run.

| Backend suite | PASS | FAIL |
| --- | ---: | ---: |
| principal-commit-authority | 70 | 0 |
| principal-authorization | 50 | 0 |
| principal-write | 53 | 0 |
| approval-authority | 47 | 0 |
| student-admission | 50 | 0 |
| student-enrollment | 58 | 0 |
| academic-setup | 57 | 0 |
| class-subject | 36 | 0 |
| teacher-assignment-admin | 20 | 0 |
| teacher-timetable | 91 | 0 |
| teacher-attendance | 51 | 0 |
| attendance-amendment | 49 | 0 |
| academic-foundation | 15 | 0 |
| academic | 35 | 0 |
| academic-work | 16 | 0 |
| academic-evidence | 13 | 0 |
| lesson-delivery | 30 | 0 |
| catch-up | 30 | 0 |
| teacher-provisioning | 28 | 0 |
| teacher-communications | 42 | 0 |
| staff-self-service | 39 | 0 |
| academic-result | 86 | 0 |

Full backend TypeScript, scoped frontend TypeScript, scoped backend-test TypeScript, scoped ESLint and git diff --check all exited 0. Structured evidence: .validation-p-pr4-completion/backend-results.json, frontend-final.json and static-results.json. The final index inspection found no staged files. Full backend TypeScript, scoped frontend TypeScript, scoped backend-test TypeScript, scoped ESLint and `git diff --check` are also recorded in the fresh validation directory. Required coverage includes P-PR1 commit authority, P-PR2 Safety/release, P-PR3 admission/profile, Principal authorization/writes, approval authority, result/Student visibility, StudentEnrollment, Academic Setup, ClassSubject, TeacherAssignment and Timetable plus relevant academic/navigation suites.

## O. Remaining Principal gaps

P-PR5 onward only: attendance oversight, substitution UI, Teacher directory, task-recipient redesign, notice redesign, Branch reports and broad Principal information architecture. None started.

## P. Worktree preservation

No reset, restore, clean, staging, broad staging, commit, push or force operation was performed. Existing unrelated PC/laptop work was not edited by this pass. Branch remains `feture`. Validation evidence is isolated from production code. No second result/history/alert system was created.
