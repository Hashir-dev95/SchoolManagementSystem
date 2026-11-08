# G4c final audit, integration and completion gate

Audit date: 2026-11-08. Repository: `D:/SchoolManagementSystem`. Published head: `b0c58b99ed6dd9466fb80296f18047307fbbf625`.

## A. Git and GitHub baseline

Before any edit, the worktree and index were clean on `feature/g4c-pickup-authorization`. `git fetch origin` succeeded without changing the checked-out branch. Local and remote feature tips both equal the published head above. `origin/integration/team-merge` and the merge base both equal G4b `3aceff7914dff843c304238181a9c7c0704a6316`. `git rev-list --left-right --count origin/integration/team-merge...HEAD` returned **0 2**. Exactly the two expected G4c commits are ahead; no unexpected commit was found. All three expected commits passed ancestry checks.

GitHub's connected account is `Hashir-dev95`; repository metadata reports administrative/write access. A repository-scoped search for `head:feature/g4c-pickup-authorization`, all states, returned no PR. The combined-status API returned `statuses: []`; the PR-triggered workflow-run API returned `workflow_runs: []`. Repository `.github` workflows were **NOT FOUND**. These empty responses do not prove required checks passed or that no external checks/rules exist. Required branch protection/ruleset details were not returned by the available connector metadata and are **NOT VERIFIED**.

The target is an ancestor of the published feature tip, so the currently published commits have a straightforward Git ancestry comparison. GitHub PR mergeability, review approval, unresolved threads and required-check completion are **NOT VERIFIED / not applicable without a PR**. No merge was attempted. The local P2 fix below is not on the published head and requires review before PR creation in this run.

## B. Exact commits and scope

| Commit | Meaning |
| --- | --- |
| `3aceff7914dff843c304238181a9c7c0704a6316` | G4b foundation and current remote integration baseline |
| `59299658b220f5f703f58f5b75662cb78a0e2a3f` | G4c Part 1 backend |
| `b0c58b99ed6dd9466fb80296f18047307fbbf625` | G4c Part 2 mobile and approved linked queue-ID correction |

The published comparison has **41 files, 7,455 insertions and 8 deletions**. The exact filename inventory is appended below. No package/lockfile, root tsconfig, API-origin client or G4b authority change occurs in that comparison. Actual manifests declare React Native **0.86.2**, React **19.2.3**, React Navigation **7**, Express **5.2.1** and Mongoose **9.10.3** (declared ranges where applicable); no dependency installation or downgrade was performed.

This audit adds only three local dirty paths: `src/screens/parent/ParentPickupPersonsScreen.tsx`, `__tests__/parent-pickup-persons.test.tsx`, and this report. The first two contain the small P2 fix/regression described in M. No source change other than that fix was made. These local changes are unstaged and uncommitted; they do not change the published two-commit/41-file comparison.

## C. Authoritative requirements traceability

The actual local `C:/Users/Laptop Valley/OneDrive/Documents/Hira_School_App_Features.pdf` pages 10, 51, 56 and 72 were extracted and read again. The G4b, Part 1 and Part 2 reports were compared to source; prior PASS wording was not treated as evidence by itself.

| Requirement | Backend evidence / function | Mobile evidence | Security/regression evidence | Audit result |
| --- | --- | --- | --- | --- |
| p10 current scoped Principal review | `pickup-authorization-access.service.ts:95` pickupReviewer; `pickup-authorization-review.service.ts:204` decidePickup | `PrincipalPickupAuthorizationReviewScreen.tsx:196` confirm and capability checks | `pickup-authorization.security.test.ts:400`, `:435`, `:1299` | PASS for typed Reject/Request Changes; activation approval blocked |
| p10 requester segregation | `pickup-authorization-review.service.ts:105` queue excludes requester; decision rejects same requester | Real AuthContext and typed detail, no fake grant | Generic bypass test `pickup-authorization.security.test.ts:591` and authority regressions | PASS in audited scope |
| p10 delegation with expiry | Generic delegation is denied for the typed pickup entity; no dedicated pickup delegation contract exists | No pickup Delegate action | Generic bypass test `pickup-authorization.security.test.ts:591` | UNIMPLEMENTED for pickup by current approved scope; not counted as a completed product capability |
| p10 reasons, immutable history, retry | `pickupAuthorization.ts:65` protectHistory; write/review receipts | `PickupPresentation.tsx:64` history; Parent/Principal execute retain identical pending commands | Replay/rollback/race suite and UI retry tests | PASS, subject to P2 refresh defect below on published mobile code |
| p51 school-verified Parent-child access | `parent-scope.service.ts:48` resolveVerifiedParentChild; `parent-application-access.service.ts:47` authorizeParentApplication | `ParentPickupPersonsScreen.tsx:104` verified-child loading; keyed child workspace | `pickup-authorization.security.test.ts:300`; Parent scope/enrollment regressions | PASS; shared contact alone never authorizes |
| p51 independent verifier | `parent-scope.service.ts:69` rejects self-verification/revocation and checks current verifier role/Branch | No verification checkbox or authority input | Parent scope tests and pickup revocation cases | PASS |
| p56 typed proposed persons / requested validity | `pickupAuthorization.ts:17` provenance; `pickup-authorization.policy.ts:52` pickupPayload and `:86` assertPickupRange | `pickupAuthorizationService.ts:200` field validation; `PickupPresentation.tsx:108` form | Draft/security/service tests | PASS for proposals; dates remain enrollment/academic-period bound |
| p56 submission/history/withdrawal/resubmission | `pickup-authorization-write.service.ts:145` writeParentPickup; one approval retained across cycles | `ParentPickupPersonsScreen.tsx:321` execute and `:374` begin | Lifecycle, snapshot retention, revision and race tests | PASS at service level; published edit refresh has P2 defect, locally corrected |
| p56 school-approved identity and custody authority | `pickupAuthorization.ts:143`, `:184`, `:247`; `pickup-authorization.policy.ts:184` pickupEligibility | `PickupPresentation.tsx:28` PickupSafety; disabled approval | Unknown/Hold/approval and Gate foundation tests | SAFE GATE verified; actual verification/activation is UNIMPLEMENTED, not PASS as an operational capability |
| p56 operational revocation | Reserved operationalStatus cannot become active; no operational Revoke endpoint | Withdraw means pending proposal invalidation, not revoking an active gate pass | No physical/domain side-effect test `pickup-authorization.security.test.ts:784` | DEFERRED; no active permission exists to revoke in G4c |
| p56/p72 QR/OTP, confirmed entry/exit, operator event and exit notification | `gate-authority.service.ts:257` requireAutomatedReleaseAuthority always denies; no G4c release route | No release/token/checkout control | Pickup no-side-effect tests; gate isolation tests | UNIMPLEMENTED/DEFERRED by approved scope; never counted as operational PASS |
| p10, p51 privacy after scope loss | Read proofs before/after snapshot; explicit DTO projections | `usePickupSession.tsx:8`, `:42`; current denial clears protected state | UI child/account/token/role/Branch/focus cases; backend scope revocations | PASS in audited automated scope |

Backend paths in this matrix are relative to `backend/src/services` unless the model is named; mobile paths are the exact matching files under `src`. Test references are under `backend/tests`. Native runtime behavior is distinguished from Jest simulation in L/O.

## D. Backend domain, linkage and indexes

`backend/src/models/pickupAuthorization.ts:11` marks Student/Branch/requester/link/enrollment/period/Class/Section references immutable. PickupPerson validates only an unverified `proposed` identity (`:143`); Parent-controlled fields never become a school verification assertion. The policy sentinel admits only `unconfigured` with activation disabled (`:184`). Authorization's history replay validates owner/reviewer transitions, cycle count and inactive operational state (`:247`).

`readPickupGraph` (`backend/src/services/pickup-authorization-read.service.ts:37`) validates person provenance, current payload fingerprint, immutable submission sequence, source revisions, reciprocal canonical ApprovalRequest identity/category/Branch/requester/status, and mirrored actor/time/reason history. It rejects tampering rather than projecting raw documents.

Exactly one canonical approval per authorization is enforced by the partial unique index at `backend/src/models/approvalRequest.ts:263` and reciprocal unique index in `pickupAuthorization.ts:302`. Submission-cycle and application-revision uniqueness, person uniqueness, Branch-policy uniqueness and actor/operation uniqueness are declared in the pickup model. `ensurePickupAuthorizationIndexes` (`pickupAuthorization.ts:426`) creates every domain index and ApprovalRequest indexes. Startup awaits it at `backend/src/server.ts:67`, before `app.listen` at `:86`, using the existing startup initialization sequence. The real index test at `backend/tests/pickup-authorization.security.test.ts:832` runs with autoIndex disabled. No server initialization change was made during this audit.

## E. Parent API and authority matrix

Base: `/api/parent/me/children/:studentId/pickup-authorizations`. `backend/src/app.ts:63` mounts the canonical Parent router; `backend/src/routes/parent-self.routes.ts:66` applies JWT/session middleware and Parent role before the pickup router at `:67`. `pickup-authorization.routes.ts:28` uses the actual token, rejects unsupported body/query fields and sanitizes unexpected errors. All Parent responses inherit no-store.

| Route/method | Input contract | Current authority and state |
| --- | --- | --- |
| GET base | Bounded `offset`, optional exact `state` | Current original Parent, verified child and exact provenance; private detail omitted |
| GET `/:authorizationId` | No body/query | Same plus exact owned object; current proof repeated after snapshot |
| POST base | Six proposal fields + clientOperationId | Current write fences; creates Draft only |
| PATCH `/:authorizationId` | Fields + applicationRevision + personRevision + operation ID | Draft only; versioned update |
| POST `/:authorizationId/submit` | Two revisions + operation ID | Draft → Pending; explicit eligible review routing; creates one linked approval |
| POST `/:authorizationId/withdraw` | Two revisions + approvalVersion + operation ID | Pending → Withdrawn; retains history; safe withdrawal may proceed when routing is disabled |
| POST `/:authorizationId/resubmit` | Fields + all three versions + operation ID | Changes Requested → Pending; updates existing linked pair atomically |

`authorizeParentApplication` checks the registered unrevoked token/session and persisted active Parent via canonical scope. `resolveVerifiedParentChild` rejects missing/duplicate/revoked/self-verified links and invalid current school verifiers, then resolves exact active same-Branch enrollment. Private queries include all original immutable provenance, not just Student ID (`readParentPickups:294`). A second verified guardian cannot read another requester's proposal.

`writeParentPickup:154` builds a strict field allowlist per operation. Requester, Branch, role, enrollment, school verification, timestamps and status are not accepted from the client. Date/phone/length checks are canonical; stale revisions and conflicting operations are 409. Authentication errors are 401, role/category denial 403, concealed objects 404, unavailable routing 503, with sanitized messages. No arbitrary Student-ID fallback exists.

## F. Principal API and typed authority

Base: `/api/principal/pickup-authorizations`. The dedicated router (`backend/src/routes/pickup-authorization.routes.ts:129`) applies no-store, canonical JWT/session, persisted Principal role and approval-view permission. Decision POST adds approval-manage. `pickupReviewer` (`pickup-authorization-access.service.ts:95`) independently rechecks current persisted actor, session, active own Branch, explicit `pickup_authorization` category grant and server routing.

GET base accepts offset only and lists pending typed records. GET `/:approvalId` resolves typed reciprocal detail, not a generic approval record. POST `/:approvalId/decisions` requires exact application/person/approval revisions, a stable operation ID and action-specific explanation. `decidePickup` rejects requester self-review, checks all current source proofs, and permits only Reject/Request Changes effects. A typed `approve` request hits `requireAutomatedReleaseAuthority` at `pickup-authorization-review.service.ts:320` and is denied. No frontend boolean can bypass that guard.

Canonical generic reads/queue/decision/delegate/resubmission guards remain in `approval-request.service.ts:37`, `:128` and `approval-resubmission.service.ts:20`; the dedicated pickup tests exercise those real endpoints (`:591`). Generic dashboard counts do not pretend to include a dedicated pickup queue count. No raw custody document, medical file, internal approval document or unrelated Parent data is projected.

## G. Approved queue approvalId correction

PASS. `readPrincipalPickups` calls `reviewRecord` (`pickup-authorization-review.service.ts:50`), which selects the same-Branch typed ApprovalRequest and reciprocal authorization and invokes `readPickupGraph`. The queue ID at `:143` is `String(graph.approval!._id)` from that validated persisted graph, not a submitted client ID. The surrounding DTO consists of the explicit pickup projection plus whitelisted Student/requester context and capabilities, never a raw approval spread.

`backend/tests/pickup-authorization.security.test.ts:378` checks the exact queue field set, matches the stored approval entity ID, and uses the returned approvalId to read the existing typed detail endpoint. Tests at `:400` and `:435` prove missing grants/other roles/foreign Branches do not obtain private queue data. Mobile service/detail identity checks are at `src/services/principal/pickupAuthorizationReviewService.ts:34`; queue navigation uses the linked ID at `PrincipalPickupAuthorizationReviewScreen.tsx:272`. No correction to this already-committed exception was necessary.

## H. Transactions, idempotency and races

`withAcademicCatalogLock` (`backend/src/services/academic-catalog-lock.service.ts:9`) performs a real persisted Branch increment before dependency reads inside `withTransaction`, with snapshot reads and majority writes. Parent write authority (`parent-application-access.service.ts:110`) fences the registered session, current Parent/Student/verifier, link, enrollment and academic dependencies and repeats source proofs before commit. Principal decisions use the same Branch-first lock at `pickup-authorization-review.service.ts:242`, then fence reader/session/source/person/policy dependencies.

`writeParentPickup` creates/edits linked person/application/submission/approval/receipt in one transaction. It revalidates policy/routing before completion. `advancePickupApproval` (`write.service.ts:90`) uses exact reciprocal IDs, state, submitted revision and `__v` CAS. Document updates also bind revision/state and use optimistic concurrency. Resubmission reuses the original approval ID and stores a separate immutable submission. Withdrawal versus decision shares the persisted lock and CAS; terminal decisions cannot be overwritten.

Receipts (`write.service.ts:61`) bind actor + unique operation ID, resources, all expected versions and canonical payload fingerprint. Identical replay returns the original acknowledgement plus a fresh current scoped projection; conflicting reuse is 409. Replays still recheck current session, relationship/enrollment/policy and relevant reviewer/routing authority. Earlier receipt state is never used as current pickup eligibility.

Real independent-process tests (`backend/tests/pickup-authorization.security.test.ts:860`, worker at `backend/tests/helpers/pickup-authorization-worker.ts:27`) use `fork` and the same fixture replica-set URI. Workers pause after an actual Branch lock and wait for parent release signals; they do not simulate concurrency with Promise-only mocks. Thirteen race cases cover duplicate/distinct submission nonces, both withdrawal/decision orders, competing Principals, both request-change/resubmit orders, committed source/session/role revocations, and both Custody Hold/approval orders. Fifteen post-write failure-injection cases (`:1336`) assert rollback of every linked record, with additional staged routing/grant revocation tests at `:1266`/`:1299`.

Custody Hold never races into activation: approval is always rejected and no active permission is created. G4b's Verified custody restriction remains in place; Gate foundation tests verify it. No attendance, notification or physical release record is produced (`pickup-authorization.security.test.ts:784`).

## I. Parent mobile verification

Real navigation is registered in `src/navigation/ParentNavigator.tsx:19` and exposed in `ParentWorkspaceScreen.tsx:226`. The screen uses the canonical authenticated children service, keys child state by Student/enrollment/Branch, and does not query fabricated IDs. List pagination follows `nextOffset`; All/Draft/Pending and Reviewed subfilters use the actual single-state API rather than downloading an unlimited union. List DTOs contain no phone/notes or update timestamp; last-update time is shown only from detail history.

Form feedback matches six real fields, strict calendar dates and backend bounds (`pickupAuthorizationService.ts:200`). Save/edit/submit/withdraw/resubmit use the exact typed union and revisions (`:91`), server capabilities, confirmation and immutable history. Unknown write results retain the identical command/UUID; duplicate taps are synchronously fenced. Current denial clears protected state and current 401 invokes canonical logout. The identity/focus boundary is `usePickupSession.tsx:8`, lifetime guard `:42`; stale responses cannot act on a newer child/account/token/role/Branch. No private pickup state is persisted to AsyncStorage or logs.

The published screen has P2 finding G4C-AUD-01 below despite passing its original 354 tests. The new local guard and regression correct only that lost-edit-context case; no new product behavior or authority is introduced. Actual Android/iOS interaction was not performed.

## J. Principal mobile verification

The dedicated queue/detail services use only `/principal/pickup-authorizations`, not generic approval APIs. Separate native queue/detail routes at `src/navigation/PrincipalNavigator.tsx:43` preserve stack back behavior; the workspace entry is at `PrincipalWorkspaceScreen.tsx:136`. It is an entry point for the actual Principal, not a fabricated frontend category grant; server denial reveals no records.

Queue/detail context uses only returned Student/requester/person/date/capability fields. Reject and Request Changes require a 10–500-character normalized explanation, confirmation, stable operation ID and current server versions. Current denial clears protected detail, and stale identity/Branch/focus responses are ignored. Approval stays visibly disabled at `PrincipalPickupAuthorizationReviewScreen.tsx:319` and the transport action union has no approve operation. Native back is used at `:427`. Existing leave/generic approval and notification/chat/navigation regressions are included in L.

## K. Developer Preview verification

`src/devPreview/DeveloperPreview.tsx:42` requires **both `__DEV__` and a real user/token**; this limitation is explicit. Parent is a fictional read-only preview destination, while privileged canonical navigators retain the actual session and may receive 403. It never manufactures a role/token to make a UI work.

`ParentPreview.tsx:34` shows Pickup Persons Design Preview with local fictional Pending/Changes Requested/Rejected examples and a local detail interaction. It imports only UI/display data (`previewData.ts:16`), no pickup API or authentication mutator. It reports unverified identity, Unknown custody, inactive pickup permission and policy-blocked approval; no live pass or checkout control exists. `__tests__/developer-preview.test.tsx:144` checks no fetch, unchanged real auth, no save/QR/exit controls and clearing the sample detail on child switch. No live DB mutation was performed by preview verification.

## L. Actual automated validation

The exact commands, exit codes and raw output tails are appended below. The repository-supported frontend runner uses its installed react-test-renderer/act convention; no testing dependency was added. Backend tests use isolated real MongoDB replica sets with no development database configuration.

| Run | Actual result |
| --- | --- |
| Published mobile baseline, 24 selected suites | Exit 0, 354 passed, 0 failed |
| New targeted regression before source fix | Exit 1, 1 failed, 30 intentionally excluded by testNamePattern; this is a deliberate reproducer, not a final gate |
| Parent pickup suite after fix | Exit 0, 31 passed, 0 failed |
| Full selected mobile regressions after fix | Exit 0, 355 passed in 24 suites, 0 failed/skipped |
| Backend G1–G4c/shared authority/attendance/startup, 19 files | Exit 0; 730 passed, 0 failed/skipped, including 59 pickup tests |
| Backend TypeScript | Exit 0; no diagnostics |
| Mobile-scoped TypeScript | Exit 0; no diagnostics |
| Strict ESLint, cumulative 39 changed TS/TSX files | Exit 0; 0 errors/warnings |
| Git and explicit untracked report whitespace | Exit 0; cumulative diff, index and explicit report whitespace/newline checks pass |

No original assertion, timeout or exclusion was weakened to obtain PASS. Counts overlap; 31 is contained in 355 and pickup coverage is contained in the broad backend selection. Root-wide F-AUD-03 diagnostics, native builds/devices, release connectivity and unavailable PR CI are not counted as passed tests.

## M. Findings and safe local correction

### G4C-AUD-01 — P2: failed ordinary detail refresh loses edit/create context

**Published evidence:** `src/screens/parent/ParentPickupPersonsScreen.tsx:283` open preserves the working fields but clears detail at `:286`; on transient failure it ends loading. Before the fix, `:648` enabled Save with no detail and `:654` selected create when detail was null, despite `detailId.current` still identifying an existing proposal. This bypasses the user's intended edit operation, not server authorization.

**Safe reproduction:** open an owned Draft, choose Edit, change a field, receive a known 400 from save, press Retry on the error card, and let the detail GET time out. The retained form offered an enabled Save Draft that could create another proposal. No real account or production data was used. The new Jest test failed on the published implementation with expected disabled=true / actual=false.

**Risk:** unintended duplicate Draft and loss of editing intent/version context after a common recovery path. No approval, identity verification or physical collection permission is created; this is P2, not a child-release or cross-user authority bypass. It blocks completion of the published G4c mobile acceptance until reviewed.

**Smallest local correction:** at `:375`, block the command handler when an existing detail ID has no current loaded detail; at `:650`, disable Save in the same condition. This preserves the in-memory working copy and existing ID until successful scoped reload. An intentional New proposal still explicitly clears the ID. No backend, policy, routing, API or durable receipt behavior changes.

**Regression:** `__tests__/parent-pickup-persons.test.tsx:512` checks the failed-refresh state, disabled Save, command-level duplicate-create prevention, retained values and successful later PATCH/edit against the original ID and refreshed application/person revisions. The exact two-file diff is appended below. This small P2 correction is permitted by the brief, but is **unstaged/uncommitted and requires Lead Engineer review**. Stop before PR creation/commit/push/merge as instructed after a fix.

### G4C-DEP-01 — pre-existing P1 deployment/privacy blocker: active cleartext LAN client

`src/services/api/apiClient.ts:1` uses `http://192.168.18.32:5000/api`; `:34` sends Bearer-authenticated requests through that origin. The approved configurable resolver at `apiConfig.ts:5` is not used by the active client. This was already documented before G4c and is absent from the G4c diff. It is a production transport/privacy blocker wherever cleartext is permitted, and may prevent release connectivity under platform protections. No actual interception or deployed endpoint was tested or inferred.

Do not deploy private pickup data through that development transport. Repair it in a separately reviewed configuration change with HTTPS/fail-closed release tests and actual native/connectivity verification. The audit did not alter global networking or relax Android/iOS restrictions. This finding is separate from G4c domain/RBAC correctness and remains open.

No P0 finding or new G4c P1 authority/linkage/transaction defect was confirmed in the inspected scope. No separate P3 defect was confirmed. Passing tests do not eliminate the confirmed P2 or inherited deployment blocker.

## N. Missing school policy decisions

The required school identity-evidence/verifier policy, custody reconciliation, authorization duration/revocation policy, operational approval activation, emergency/manual release rules and protected evidence delivery remain unapproved/unimplemented. School operators must explicitly configure review routing/version/Branch eligibility and Principal category grants; the code does not assume school policy from role names or an example.

Unknown/Hold custody, unverified persons and absent school policy remain fail-closed. The audit does not request or implement a bypass. Early exit, QR/OTP, actual gate confirmation and exit notifications remain separately authorized roadmap work, not hidden completion claims for G4c.

## O. Deployment and runtime limitations

Operational school pickup readiness: **BLOCKED** by the deliberate verification/activation gates. Production deployment readiness: **BLOCKED / NOT VERIFIED** by the inherited HTTP client plus missing actual production HTTPS origin/connectivity and native release/device checks. Android/iOS physical-device layout, keyboard/accessibility behavior, native builds and device interaction were not run. No endpoint was invented. No release-bundle behavior is claimed from Jest or TypeScript alone. F-AUD-03 root diagnostics remain a separate deferred item.

## P. Remaining G4c work and local Git status

1. Lead Engineer reviews the P2 two-guard correction and regression; decide whether to accept or revise it.
2. Only after explicit authorization, checkpoint/push the reviewed fix and audit report on the feature branch. This audit performs neither operation.
3. Reverify the published comparison and open the correctly targeted PR, then obtain required independent review/CI. The local fix is not visible on GitHub yet.
4. Integration requires explicit Lead Engineer action. G4d remains stopped until the next roadmap decision. Operational custody activation and production deployment are separate gates, not prerequisites to be silently bypassed to start a future design task.

Expected audit worktree at handoff: two modified tracked source/test files and this new untracked report; index empty; HEAD remains the published Part 2 checkpoint. Exact final status is recorded after the final checks below.

## Q. PR review and CI status

PR **absent** at the live check. Creation would otherwise be permitted by repository access, but this audit found and made a local acceptance fix; the brief's stop-for-review rule therefore prevents creating a PR as if the published branch were complete. No review requests, comments, merges or CI reruns were sent.

Exact future comparison: [integration/team-merge ← feature/g4c-pickup-authorization](https://github.com/Hashir-dev95/SchoolManagementSystem/compare/integration/team-merge...feature/g4c-pickup-authorization?expand=1).

GitHub review approval: NOT FOUND (no PR). Unresolved PR threads: NOT APPLICABLE (no PR). Required CI/protection completion: NOT VERIFIED. Local test PASS is not a substitute for those gates. Never target main or enable auto-merge.

## R. Final readiness verdict

**PARTIAL — FIXES REQUIRED**

The published G4c code contains confirmed P2 G4C-AUD-01. Its minimum safe fix is present locally with a reproducer and regression, but requires architectural review and an explicitly authorized checkpoint before PR review/integration. The local corrected worktree passes 355 mobile and 730 backend tests, both TypeScript scopes and strict ESLint. Final Git state is recorded below. No G4d/G4e/G4f, custody verification, QR, actual pickup or Gate checkout has been enabled.

| Readiness dimension | Decision |
| --- | --- |
| Published code implementation | PARTIAL: confirmed P2 retained-edit refresh defect |
| Local corrected source/test verification | PASS: 355 mobile, 730 backend, TypeScript/ESLint/whitespace; no device/runtime claim |
| PR integration | Not ready: no PR; local fix unreviewed/unpublished; reviews/required CI absent or unverified |
| Operational pickup authorization | BLOCKED deliberately by unapproved school policy and disabled activation |
| Production deployment | BLOCKED / NOT VERIFIED; existing HTTP transport and native/connectivity gates outstanding |

## Exact published 41-file inventory

```text
__tests__/developer-preview.test.tsx
__tests__/helpers/pickup-fixture.ts
__tests__/parent-pickup-persons.test.tsx
__tests__/parent-workspace.test.tsx
__tests__/pickup-navigation.test.tsx
__tests__/pickup-services.test.ts
__tests__/principal-approval-context.test.tsx
__tests__/principal-pickup-review.test.tsx
backend/src/app.ts
backend/src/models/approvalRequest.ts
backend/src/models/pickupAuthorization.ts
backend/src/routes/parent-self.routes.ts
backend/src/routes/pickup-authorization.routes.ts
backend/src/routes/principal.routes.ts
backend/src/server.ts
backend/src/services/approval-request.service.ts
backend/src/services/approval-resubmission.service.ts
backend/src/services/pickup-authorization-access.service.ts
backend/src/services/pickup-authorization-read.service.ts
backend/src/services/pickup-authorization-review.service.ts
backend/src/services/pickup-authorization-write.service.ts
backend/src/services/pickup-authorization.policy.ts
backend/src/services/principal-dashboard.service.ts
backend/tests/development-startup.security.test.ts
backend/tests/helpers/pickup-authorization-worker.ts
backend/tests/pickup-authorization.security.test.ts
backend/tests/principal-authorization.security.test.ts
docs/integration/pr-g4c1-pickup-authorization-backend.md
docs/integration/pr-g4c2-pickup-authorization-mobile.md
src/components/pickup/PickupPresentation.tsx
src/devPreview/ParentPreview.tsx
src/devPreview/previewData.ts
src/hooks/usePickupSession.tsx
src/navigation/ParentNavigator.tsx
src/navigation/PrincipalNavigator.tsx
src/screens/parent/ParentPickupPersonsScreen.tsx
src/screens/parent/ParentWorkspaceScreen.tsx
src/screens/principal/PrincipalPickupAuthorizationReviewScreen.tsx
src/screens/principal/PrincipalWorkspaceScreen.tsx
src/services/parent/pickupAuthorizationService.ts
src/services/principal/pickupAuthorizationReviewService.ts
```

## Exact local P2 fix diff

```diff
diff --git a/__tests__/parent-pickup-persons.test.tsx b/__tests__/parent-pickup-persons.test.tsx
index 9c90b71a..59b91b98 100644
--- a/__tests__/parent-pickup-persons.test.tsx
+++ b/__tests__/parent-pickup-persons.test.tsx
@@ -5 +5 @@ import Screen from '../src/screens/parent/ParentPickupPersonsScreen';
-import { Button, WorkspaceTabs } from '../src/components/hiraDashboard';
+import { Button, DashboardStateCard, WorkspaceTabs } from '../src/components/hiraDashboard';
@@ -510,0 +511,28 @@ test('routing-disabled draft exposes no enabled submit action', async () => {
+
+test('failed ordinary detail refresh cannot turn a retained draft edit into a new create', async () => {
+  await mount();
+  await press(`View ${pickupFields.fullName}`);
+  await press('Edit draft');
+  await change('Full name', 'Retained edit');
+  transport.write.mockRejectedValueOnce(new ApiError(400, 'Check fields'));
+  await press('Save draft');
+  transport.detail.mockRejectedValueOnce(new Error('Refresh timed out'));
+  await act(async () => {
+    await tree.root.findAllByType(DashboardStateCard)
+      .find(node => node.props.error)!.props.onRetry();
+  });
+  expect(output()).toContain('Retained edit');
+  expect(button('Save draft').props.disabled).toBe(true);
+  await act(async () => { await button('Save draft').props.onPress(); });
+  expect(transport.write).toHaveBeenCalledTimes(1);
+  transport.detail.mockResolvedValueOnce(pickupDetail({ revision: 3, personRevision: 2 }));
+  await act(async () => {
+    await tree.root.findAllByType(DashboardStateCard)
+      .find(node => node.props.error)!.props.onRetry();
+  });
+  await press('Save draft');
+  expect(transport.write.mock.calls[1][2]).toEqual({
+    kind: 'edit', id: 'proposal-A',
+    body: { ...pickupFields, fullName: 'Retained edit', applicationRevision: 3, personRevision: 2, clientOperationId: 'uuid-next' },
+  });
+});
diff --git a/src/screens/parent/ParentPickupPersonsScreen.tsx b/src/screens/parent/ParentPickupPersonsScreen.tsx
index 8f561139..24829af7 100644
--- a/src/screens/parent/ParentPickupPersonsScreen.tsx
+++ b/src/screens/parent/ParentPickupPersonsScreen.tsx
@@ -375 +375 @@ function ChildPickups({
-    if (sending.current || uncertain || conflict) return;
+    if (sending.current || uncertain || conflict || (detailId.current && !detail)) return;
@@ -649,0 +650 @@ function ChildPickups({
+              (!!detailId.current && !detail) ||
```

## Exact validation commands and raw last-20-line outputs

Each runner redirected stdout/stderr to the named log under %TEMP%, captured its actual process exit code and printed its tail. Logs are outside Git. Shorter output is shown in full; an empty static-output block means no diagnostics.

### Published mobile baseline

Working directory: D:/SchoolManagementSystem

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/pickup-services.test.ts __tests__/parent-pickup-persons.test.tsx __tests__/principal-pickup-review.test.tsx __tests__/pickup-navigation.test.tsx __tests__/developer-preview.test.tsx __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts __tests__/principal-parent-leave-review.test.tsx __tests__/principal-approval-context.test.tsx __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/teacher-navigation.test.tsx __tests__/academic-setup-navigation.test.tsx __tests__/teacher-provisioning.test.tsx __tests__/auth-session.test.tsx __tests__/gate-foundation.test.tsx __tests__/chat-navigation.test.tsx __tests__/chat-workspace.test.tsx __tests__/chat-service.test.ts __tests__/notification-inbox.test.tsx __tests__/notification-inbox-service.test.ts __tests__/teacher-notifications.test.tsx __tests__/permissions.test.ts __tests__/App.test.tsx
```

Exit 0; 354 passed, 0 failed, 24 suites.

Log: hira-g4c-final-mobile.log

```text
      at flushActQueue (node_modules/react/cjs/react.development.js:590:34)
      at node_modules/react/cjs/react.development.js:847:21

PASS __tests__/chat-navigation.test.tsx
PASS __tests__/pickup-navigation.test.tsx
PASS __tests__/teacher-navigation.test.tsx
PASS __tests__/gate-foundation.test.tsx
PASS __tests__/auth-session.test.tsx
PASS __tests__/pickup-services.test.ts
PASS __tests__/chat-service.test.ts
PASS __tests__/permissions.test.ts
PASS __tests__/notification-inbox-service.test.ts
PASS __tests__/parent-leave-service.test.ts
PASS __tests__/parent-service.test.ts

Test Suites: 24 passed, 24 total
Tests:       354 passed, 354 total
Snapshots:   0 total
Time:        42.086 s
Ran all test suites matching /__tests__\\pickup-services.test.ts|__tests__\\parent-pickup-persons.test.tsx|__tests__\\principal-pickup-review.test.tsx|__tests__\\pickup-navigation.test.tsx|__tests__\\developer-preview.test.tsx|__tests__\\parent-leave-applications.test.tsx|__tests__\\parent-leave-service.test.ts|__tests__\\principal-parent-leave-review.test.tsx|__tests__\\principal-approval-context.test.tsx|__tests__\\parent-workspace.test.tsx|__tests__\\parent-service.test.ts|__tests__\\teacher-navigation.test.tsx|__tests__\\academic-setup-navigation.test.tsx|__tests__\\teacher-provisioning.test.tsx|__tests__\\auth-session.test.tsx|__tests__\\gate-foundation.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\chat-workspace.test.tsx|__tests__\\chat-service.test.ts|__tests__\\notification-inbox.test.tsx|__tests__\\notification-inbox-service.test.ts|__tests__\\teacher-notifications.test.tsx|__tests__\\permissions.test.ts|__tests__\\App.test.tsx/i.
```

### P2 reproducer before source correction

Working directory: D:/SchoolManagementSystem

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/parent-pickup-persons.test.tsx --testNamePattern="failed ordinary detail refresh"
```

Exit 1; 1 failed, 30 intentionally excluded by the targeted test pattern. Confirmed defect; not a final successful gate.

Log: hira-g4c-final-repro.log

```text
    Expected: true
    Received: false

      523 |   });
      524 |   expect(output()).toContain('Retained edit');
    > 525 |   expect(button('Save draft').props.disabled).toBe(true);
          |                                               ^
      526 |   await act(async () => { await button('Save draft').props.onPress(); });
      527 |   expect(transport.write).toHaveBeenCalledTimes(1);
      528 |   transport.detail.mockResolvedValueOnce(pickupDetail({ revision: 3, personRevision: 2 }));

      at Object.toBe (__tests__/parent-pickup-persons.test.tsx:525:47)
      at asyncGeneratorStep (node_modules/@babel/runtime/helpers/asyncToGenerator.js:3:17)
      at _next (node_modules/@babel/runtime/helpers/asyncToGenerator.js:17:9)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 30 skipped, 31 total
Snapshots:   0 total
Time:        5.856 s
Ran all test suites matching /__tests__\\parent-pickup-persons.test.tsx/i with tests matching "failed ordinary detail refresh".
```

### Complete Parent pickup suite after correction

Working directory: D:/SchoolManagementSystem

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/parent-pickup-persons.test.tsx
```

Exit 0; 31 passed, 0 failed, 0 skipped.

Log: hira-g4c-final-parent-fixed.log

```text
  √ account switching discards private state and ignores old request (52 ms)
  √ token switching discards private state and ignores old request (72 ms)
  √ branch switching discards private state and ignores old request (53 ms)
  √ role switching discards private state and ignores old request (24 ms)
  √ logout switching discards private state and ignores old request (33 ms)
  √ blur switching discards private state and ignores old request (50 ms)
  √ fresh authorization wins over an older replay receipt (100 ms)
  √ an unconfirmed write cannot be discarded by child refresh or child switching (139 ms)
  √ a failed conflict refresh keeps the working copy and retries the same detail ID before enabling versions (53 ms)
  √ current denial while refreshing a loaded list clears cached summaries (12 ms)
  √ out-of-order child list response cannot replace the newly selected child (8 ms)
  √ old mutation failure after account switch cannot clear or log out the newer account (93 ms)
  √ routing-disabled draft exposes no enabled submit action (32 ms)
  √ failed ordinary detail refresh cannot turn a retained draft edit into a new create (123 ms)

Test Suites: 1 passed, 1 total
Tests:       31 passed, 31 total
Snapshots:   0 total
Time:        7.327 s
Ran all test suites matching /__tests__\\parent-pickup-persons.test.tsx/i.
```

### Full selected mobile gate after correction

Working directory: D:/SchoolManagementSystem

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/pickup-services.test.ts __tests__/parent-pickup-persons.test.tsx __tests__/principal-pickup-review.test.tsx __tests__/pickup-navigation.test.tsx __tests__/developer-preview.test.tsx __tests__/parent-leave-applications.test.tsx __tests__/parent-leave-service.test.ts __tests__/principal-parent-leave-review.test.tsx __tests__/principal-approval-context.test.tsx __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/teacher-navigation.test.tsx __tests__/academic-setup-navigation.test.tsx __tests__/teacher-provisioning.test.tsx __tests__/auth-session.test.tsx __tests__/gate-foundation.test.tsx __tests__/chat-navigation.test.tsx __tests__/chat-workspace.test.tsx __tests__/chat-service.test.ts __tests__/notification-inbox.test.tsx __tests__/notification-inbox-service.test.ts __tests__/teacher-notifications.test.tsx __tests__/permissions.test.ts __tests__/App.test.tsx
```

Exit 0; 355 passed, 0 failed, 0 skipped; 24 suites.

Log: hira-g4c-final-mobile-fixed.log

```text
      at performWorkOnRoot (node_modules/react-test-renderer/cjs/react-test-renderer.development.js:12181:11)
      at performWorkOnRootViaSchedulerTask (node_modules/react-test-renderer/cjs/react-test-renderer.development.js:2908:7)
      at flushActQueue (node_modules/react/cjs/react.development.js:590:34)
      at node_modules/react/cjs/react.development.js:847:21

PASS __tests__/teacher-navigation.test.tsx
PASS __tests__/auth-session.test.tsx
PASS __tests__/gate-foundation.test.tsx
PASS __tests__/pickup-services.test.ts
PASS __tests__/parent-service.test.ts
PASS __tests__/parent-leave-service.test.ts
PASS __tests__/notification-inbox-service.test.ts
PASS __tests__/chat-service.test.ts
PASS __tests__/permissions.test.ts

Test Suites: 24 passed, 24 total
Tests:       355 passed, 355 total
Snapshots:   0 total
Time:        38.061 s, estimated 44 s
Ran all test suites matching /__tests__\\pickup-services.test.ts|__tests__\\parent-pickup-persons.test.tsx|__tests__\\principal-pickup-review.test.tsx|__tests__\\pickup-navigation.test.tsx|__tests__\\developer-preview.test.tsx|__tests__\\parent-leave-applications.test.tsx|__tests__\\parent-leave-service.test.ts|__tests__\\principal-parent-leave-review.test.tsx|__tests__\\principal-approval-context.test.tsx|__tests__\\parent-workspace.test.tsx|__tests__\\parent-service.test.ts|__tests__\\teacher-navigation.test.tsx|__tests__\\academic-setup-navigation.test.tsx|__tests__\\teacher-provisioning.test.tsx|__tests__\\auth-session.test.tsx|__tests__\\gate-foundation.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\chat-workspace.test.tsx|__tests__\\chat-service.test.ts|__tests__\\notification-inbox.test.tsx|__tests__\\notification-inbox-service.test.ts|__tests__\\teacher-notifications.test.tsx|__tests__\\permissions.test.ts|__tests__\\App.test.tsx/i.
```

### Backend TypeScript

Working directory: D:/SchoolManagementSystem/backend

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

Exit 0; no diagnostics.

Log: hira-g4c-final-backend-types.log

```text

```

### Mobile-scoped TypeScript

Working directory: D:/SchoolManagementSystem

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json
```

Exit 0; no diagnostics.

Log: hira-g4c-final-mobile-types.log

```text

```

### Strict cumulative scoped ESLint

Working directory: D:/SchoolManagementSystem

```powershell
$pickupAuditPaths = @(git diff --name-only origin/integration/team-merge...HEAD -- '*.ts' '*.tsx'); & .\node_modules\.bin\eslint.cmd --max-warnings=0 $pickupAuditPaths
```

Exit 0; 39 source/test TS/TSX paths; 0 errors, 0 warnings.

Log: hira-g4c-final-lint.log

```text

```

### Full backend G1–G4c, authority, attendance and startup gate

Working directory: D:/SchoolManagementSystem/backend

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-review.security.test.ts tests/parent-leave-decision.security.test.ts tests/parent-scope.security.test.ts tests/teacher-scope.security.test.ts tests/student-enrollment.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/teacher-attendance.security.test.ts tests/principal-attendance.security.test.ts tests/attendance-amendment.security.test.ts tests/development-startup.security.test.ts tests/bootstrap.security.test.ts tests/teacher-provisioning.security.test.ts
```

Exit 0; 730 passed, 0 failed, 0 skipped; 19 test files. Log: hira-g4c-final-backend.log

```text
✔ revoked assignment immediately removes roster access (346.7092ms)
✔ expired assignment immediately removes roster access (339.6693ms)
✔ future assignment immediately removes roster access (298.0691ms)
✔ current inactive change fails closed on roster and independent service call (262.6603ms)
✔ current role change fails closed on roster and independent service call (272.9374ms)
✔ current branch change fails closed on roster and independent service call (259.6279ms)
✔ current branch inactive change fails closed on roster and independent service call (277.0903ms)
✔ current permission change fails closed on roster and independent service call (256.0971ms)
✔ roster query/body injection never widens scope and malformed tuple IDs are sanitized (419.2988ms)
✔ roster has independent authentication/role gates and no guessed learner detail surface (353.8298ms)
✔ roster reference changes invalidate authority and DB failure is sanitized (284.7879ms)
✔ roster resolves scope once and executes one aggregate regardless of learner count (316.894ms)
ℹ tests 730
ℹ suites 0
ℹ pass 730
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 485642.9765
```

## Final Git and handoff evidence

Final working directory: `D:/SchoolManagementSystem`.

```text
## feature/g4c-pickup-authorization...origin/feature/g4c-pickup-authorization
 M __tests__/parent-pickup-persons.test.tsx
 M src/screens/parent/ParentPickupPersonsScreen.tsx
?? docs/integration/pr-g4c-final-completion-audit.md
```

HEAD: `b0c58b99ed6dd9466fb80296f18047307fbbf625`. Final remote `git ls-remote` verifies the feature tip still equals HEAD and the integration tip still equals `3aceff7914dff843c304238181a9c7c0704a6316`. Published comparison remains two commits / 41 files. Local source/test fixes are not published.

`git diff --cached --name-only` emitted no paths (exit 0): index empty. `git diff --check origin/integration/team-merge` and `git diff --cached --check` both exited 0; only informational LF-to-CRLF notices appeared. Explicit trailing-whitespace/final-newline checks passed for both modified files and this untracked report. Final diff scope is exactly those three paths. No dependencies, existing reports, startup, backend source/tests or other features were modified during this audit.

No staging, commit, push, merge, reset, rebase, force-push, clean or restore was used. The only remote/ref mutation was the explicitly requested safe fetch. No PR, review request, comment, CI rerun or merge was created because the local P2 correction triggers the brief's stop-for-review rule. PR search remained empty at the final check. No native/device verification or actual school pickup was performed.

**PARTIAL — FIXES REQUIRED.** Review the two-file P2 correction and its passing regression, authorize any subsequent checkpoint/push explicitly, then create/review the feature-to-integration PR and verify required human/CI gates. Lead Engineer retains the next roadmap decision; G4d has not started. Operational custody activation and production deployment remain separate blocked gates.

## Lead Engineer approval and final fix checkpoint — 2026-11-08

The Lead Engineer explicitly approved narrow P2 fix G4C-AUD-01 and authorized checkpointing exactly this report, `src/screens/parent/ParentPickupPersonsScreen.tsx` and `__tests__/parent-pickup-persons.test.tsx`, pushing only the feature branch, and creating a PR targeting `integration/team-merge`. The earlier PARTIAL verdict and stop-for-review language above record the audit before that approval; this follow-up supersedes that P2 approval gate, not the deployment or school-policy blockers.

The approved source/test correction was preserved unchanged. Review confirms that an existing detail ID without current detail blocks both Save and the command handler. The original ID and form values remain in memory; successful recovery edits the original authorization using refreshed expected application/person revisions. No backend, RBAC, custody policy, routing, Gate security, API origin, dependency or other feature code changed.

Fresh final gates before checkpoint:

| Gate | Actual result |
| --- | --- |
| Parent pickup regression | Exit 0; 31 passed, 0 failed/skipped |
| Selected complete mobile regression group | Exit 0; 355 passed across 24 suites, 0 failed/skipped; includes the 31 Parent tests |
| Pickup/Gate/canonical approval/Principal/Parent scope backend security | Exit 0; 197 passed, 0 failed/skipped; includes the 59 pickup security tests |
| Backend TypeScript and mobile-scoped TypeScript | Both exit 0; no diagnostics |
| Strict cumulative G4c ESLint | Exit 0; 39 TS/TSX paths, 0 errors/warnings |
| Git diff/index whitespace and explicit untracked-report newline/whitespace | Exit 0 |

The Parent and mobile commands are the same suite selections recorded above. The final backend command (working directory `D:/SchoolManagementSystem/backend`) was:

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/parent-scope.security.test.ts
```

Fresh logs are outside the repository under `%TEMP%`: `hira-g4c-approved-parent.log`, `hira-g4c-approved-mobile.log`, `hira-g4c-approved-backend.log`, `hira-g4c-approved-backend-types.log`, `hira-g4c-approved-mobile-types.log` and `hira-g4c-approved-lint.log`. Overlapping counts are not summed. No assertions, timeouts or test selection were weakened to obtain these results.

Code-level P2 status: approved correction verified, ready for the authorized checkpoint and PR review. This does not assert GitHub reviewer approval or required CI completion. The final checkpoint SHA, PR URL and live review/check status are provided in the subsequent handoff because a committed report cannot contain its own final commit hash. School identity verification, operational pickup approval/activation, QR/OTP, Gate checkout and physical release remain unavailable. The inherited HTTP LAN API-origin deployment/privacy blocker remains open; production HTTPS connectivity and native/device verification remain separate. No merge or G4d work is authorized by this follow-up.
