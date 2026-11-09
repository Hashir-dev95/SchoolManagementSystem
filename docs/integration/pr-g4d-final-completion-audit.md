# G4d Final Completion and Security Audit

Audit date: 2026-11-09 (Asia/Karachi). Repository: `D:/SchoolManagementSystem`.

**PR readiness: BLOCKED — FIX REQUIRED.** G4D-AUD-01 is a reproduced P2 focus-generation/privacy correctness defect. Existing committed suites pass, but two independent audit probes fail. No implementation fix has been applied.

## A. Git baseline and audit safety

| Item | Independently verified value |
| --- | --- |
| Current branch | `feature/g4d-early-exit-requests` |
| Initial/current implementation HEAD | `22733198af49dc8f6ba81aaf7dd91c90a4053e8d` |
| Part 1 | `39f8f1727ad6e262732f752ef76eedbdc3e3c89e` — feat(g4d): add secure early exit request backend |
| Part 2 | `22733198af49dc8f6ba81aaf7dd91c90a4053e8d` — feat(g4d): integrate secure early exit mobile workflows |
| Fetched integration baseline | `49fc00ce6d7f2bc7c7eb36777ce10345dc85288c` |
| Fetched remote feature | Same SHA as local HEAD; ahead/behind `0 0` |
| Initial worktree/index | Clean / empty |
| Feature comparison | Two commits, 41 distinct paths, 6,868 insertions / 10 deletions against integration |

`git fetch origin` succeeded. Both checkpoints and integration ancestry were checked with Git, not inferred from previous PASS wording. No new branch, switch, source/test edit, dependency install, reset, clean, restore, rebase, cherry-pick, stage, commit, push, PR or merge occurred during this audit. Audit-generated probes, logs, JSON and a Part 1 compiler-reference extraction are under system TEMP. Only this new report is added to the canonical worktree, unstaged/uncommitted; the index remains empty.

The historical Part 1/Part 2 reports were reviewed as claims to verify. This audit supersedes their unconditional focus-isolation claim for the reproduced batched focus case; it does not rewrite those reports to conceal the finding.

## B. Exact committed feature inventory

All paths below are relative to the repository above. Part 1 and Part 2 inventories are disjoint: 18 + 23 = 41. The new audit report is outside the reviewed committed 41-file comparison.

### Part 1 — 18 paths

```text
backend/src/app.ts
backend/src/models/approvalRequest.ts
backend/src/models/earlyExitRequest.ts
backend/src/routes/early-exit.routes.ts
backend/src/routes/parent-self.routes.ts
backend/src/routes/principal.routes.ts
backend/src/server.ts
backend/src/services/approval-request.service.ts
backend/src/services/approval-resubmission.service.ts
backend/src/services/early-exit-authority.service.ts
backend/src/services/early-exit-read.service.ts
backend/src/services/early-exit-write.service.ts
backend/src/services/principal-dashboard.service.ts
backend/tests/development-startup.security.test.ts
backend/tests/early-exit.security.test.ts
backend/tests/helpers/early-exit-worker.ts
backend/tests/principal-authorization.security.test.ts
docs/integration/pr-g4d1-early-exit-backend.md
```

### Part 2 — all 23 paths inspected

| Path | Review result |
| --- | --- |
| `__tests__/developer-preview.test.tsx` | Fictional five-state preview, no network/auth writes and production guard coverage; passes. |
| `__tests__/early-exit-services.test.ts` | Exact paths/bodies/revisions, identity mismatch, forbidden action, normalization and HTTP semantics asserted; 37 cases pass. |
| `__tests__/helpers/early-exit-fixture.ts` | Fictional typed DTOs, verified-child fixtures and deferred promises; no production wiring. |
| `__tests__/parent-early-exit.test.tsx` | 42 cases pass, including retained Save/nonce and draft-refresh regression; mocked focus transitions miss G4D-AUD-01. |
| `__tests__/parent-workspace.test.tsx` | Exact route inventory and one root NavigationContainer retained. |
| `__tests__/pickup-navigation.test.tsx` | Existing Pickup/Leave routes retained; real Parent/Principal Early Exit destinations asserted. |
| `__tests__/principal-approval-context.test.tsx` | Exact unique stack inventory and mounted approval context preserved. |
| `__tests__/principal-early-exit.test.tsx` | 30 cases pass, including denial, versions and retry; same batched focus coverage gap. |
| `docs/integration/pr-g4d2-early-exit-mobile.md` | Contract/counts largely verified; unconditional focus isolation is incomplete under G4D-AUD-01. |
| `src/components/earlyExit/EarlyExitPresentation.tsx` | Five real states, private reason/history, date/reason feedback and explicit no-release notices; no operational action. |
| `src/components/earlyExit/ParentEarlyExitRequests.tsx` | Typed commands, revisions, nonce/pending fences, safe retries and edit identity verified; lifetime/generation checks depend on the flawed shared session focus boundary. |
| `src/devPreview/EarlyExitPreview.tsx` | Five fictional read-only examples; no auth/service/network import. |
| `src/devPreview/ParentPreview.tsx` | Existing guarded preview embeds examples; changing fictional child resets selection. |
| `src/hooks/useEarlyExitSession.tsx` | Identity-keyed isolation works for committed identity changes; missing focus epoch is G4D-AUD-01. |
| `src/navigation/ParentNavigator.tsx` | Real authenticated Early Exit route added; existing routes retained. |
| `src/navigation/PrincipalNavigator.tsx` | Dedicated queue/detail keyed by canonical approvalId; no new container. |
| `src/screens/parent/ParentEarlyExitRequestsScreen.tsx` | Canonical verified children and returned-Branch validation; Student/enrollment/Branch-keyed workspace; focus defect inherited through wrapper. |
| `src/screens/parent/ParentWorkspaceScreen.tsx` | Entry opens the existing authenticated stack route. |
| `src/screens/principal/PrincipalEarlyExitReviewScreen.tsx` | Typed review, current capabilities/revisions, safe decisions and disabled approval; same focus defect. |
| `src/screens/principal/PrincipalWorkspaceScreen.tsx` | Dedicated review entry; no fabricated count or approval grant. |
| `src/services/api/apiClient.ts` | Approved two-line resolver reconnection verified; transport regressions pass. |
| `src/services/parent/earlyExitService.ts` | Real DTO/envelope, bounded filter/offset, strict write allowlist, returned ownership identity and exact five-state contract. |
| `src/services/principal/earlyExitReviewService.ts` | Typed approvalId paths, response Branch/Student checks and reject/request_changes only; no Branch authority transmitted. |

## C. Backend security verdict — PASS within the deliberately restricted domain

This verdict is for Draft/review lifecycle security; it does not certify operational approval or student release. No new P0/P1 backend defect was found in the reviewed G4d scope.

| Boundary | Source evidence | Assertions independently inspected / freshly executed |
| --- | --- | --- |
| JWT, active persisted role, registered session | `backend/src/middleware/auth.middleware.ts:29`; `parent-application-access.service.ts:29`, `:47`; `early-exit-authority.service.ts:173` | Early Exit test `:423` exercises all Parent/Principal entry families with expired/unregistered/wrong-role/anonymous credentials; current Principal/Parent revocation cases assert concealment and retained records. |
| Verified independent Parent relationship and exact enrollment | `backend/src/services/parent-scope.service.ts:48`, `:69`; `parent-application-access.service.ts:71`; `early-exit-authority.service.ts:132` | Early Exit test `:321` adds a second verified guardian for the same child and denies the original request; `:369` covers link/verifier/enrollment/Branch/role/session revocation. |
| Original owner and immutable provenance | `backend/src/models/earlyExitRequest.ts:10`, `:23`; write service `:175`; read service `:269` | Model save/HTTP provenance reassignment denied at test `:241`; record count retained after denial. No arbitrary requester/Branch/enrollment field is accepted. |
| Own-Branch Principal/category/view/manage authority | `early-exit-authority.service.ts:191`, `:203`, `:218`; write service `:427`, `:563` | Principal revocation `:539`, explicit permission tests, own-grant foreign Principal test `:635`. Role alone or Pickup/Leave grants do not confer Early Exit authority. |
| Typed reciprocal approval and history | `early-exit-read.service.ts:34`, `:83`, `:106`, `:311`; `approvalRequest.ts:272` | Queue approvalId/detail test `:515`; immutable cycles/original approval `:677`; forged links/tampered snapshots `:850`. |
| Lifecycle/CAS | `early-exit-write.service.ts:234`, `:239`, `:247`; canonical approval CAS `:94`; Principal CAS `:506`, `:515` | Draft edits only; Pending withdrawal; reasoned reject/changes requested; resubmission reuses original approval and creates a new immutable snapshot; terminal decisions cannot be modified. |
| Atomicity and source/session fences | `parent-application-access.service.ts:123`, `:125`, `:138`, `:154`; `academic-catalog-lock.service.ts:9`; write service `:424`, `:433`, `:474` | Thirteen after-write rollback cases at test `:1236` compare all linked collection contents; two staged policy/grant changes also roll back. |
| Durable receipts and replay | write service `:54`, `:165`, `:188`, `:353`, `:480`, `:489`; safe receipt DTO `early-exit-read.service.ts:145` | Exact replay, changed-payload conflict, current authority on replay, earlier receipt plus current resource and receipt whitelist assertions at test `:193`, `:616`, `:677`. |
| Real independent-process races | `backend/tests/early-exit.security.test.ts:997`, `:1029`, `:1065`, `:1109`, `:1148`; worker `:23`, `:39` | Workers connect separately to the fixture replica set; IPC holds the actual transactional Branch write. Assertions check one approval/snapshot, exact winner/conflict statuses, legal serial order and revocation rollback. Eleven Early Exit process-race cases. |
| Generic bypass | `approval-request.service.ts:37`, `:128`; `approval-resubmission.service.ts:20` | Test `:757` calls actual generic detail/queue/decision/delegate/requester routes; typed guard denies them. |
| Index readiness | `earlyExitRequest.ts:189`, `:228`, `:283`, `:288`; `server.ts:69` before `:88` | Required unique indexes with autoIndex disabled at test `:915`; actual server waits before login/listen in `development-startup.security.test.ts:82`. |
| No operational approval/release | `early-exit-authority.service.ts:223`; write service `:512`; `gate-authority.service.ts:257` | Test `:811` denies typed approve for Unknown/Hold and compares source/receipt counts plus unchanged Pickup/Leave/attendance/correction/notification collections. Existing Gate regression preserves its separate duty/release guard. |

Backend source paths abbreviated in this table are under `D:/SchoolManagementSystem/backend/src/services` unless the model/server is named; test references are `D:/SchoolManagementSystem/backend/tests/early-exit.security.test.ts`. They refer to the inspected committed source, not report assertions.

Read proofs are rechecked after snapshot reads (`early-exit-read.service.ts:298`, `:434`, `:442`). Source placement uses the exact current StudentEnrollment; no legacy profile/Teacher/global fallback is introduced. TeacherAssignment remains unrelated permanent teaching authority. Private reasons/history are explicit detail DTO fields, not generic approval payloads. Withdraw invalidates only an unapproved Pending proposal; it grants no departure/custody permission. Routing/category configuration must remain consistent across server workers under the existing canonical configuration model.

## D. Mobile security verdict — FAIL: G4D-AUD-01 must be resolved

The following are verified by source and the passing committed tests, subject to the focus defect below:

- DTOs match actual backend envelopes and fields: `earlyExitService.ts:23`, `:46`, `:72`, `:156`; write allowlists at `:212`; Principal typed response/decision checks at `earlyExitReviewService.ts:45`, `:85`.
- Parent uses only canonical authenticated children (`ParentEarlyExitRequestsScreen.tsx:102`), validates returned Branch (`:104`), and keys child state by Student/enrollment/Branch (`:167`). Account/token/role/Branch changes alter the auth key (`useEarlyExitSession.tsx:32`).
- Principal queue navigation uses persisted linked approvalId (`PrincipalEarlyExitReviewScreen.tsx:279`); details and actions use dedicated typed endpoints, never generic approval decisions.
- Synchronous sending/pending refs protect new mutations and retained callbacks (`ParentEarlyExitRequests.tsx:157`, `:206`; Principal screen `:169`, `:209`). Same normalized command/revisions/nonce are retained for timeout and 503 retries (`useEarlyExitSession.tsx:44`); fresh `request` DTO wins over old receipt metadata.
- Current 401/403/404 clears protected data; safe errors do not echo private server messages. 409 requires detail/version review; failed refresh cannot enable stale Save/decision. Parent detail identity is retained independently (`ParentEarlyExitRequests.tsx:124`, `:469`), with recovery regression at `__tests__/parent-early-exit.test.tsx:550`.
- The only visible Approve control is disabled (`PrincipalEarlyExitReviewScreen.tsx:310`); runtime forged approve is rejected before network (`earlyExitReviewService.ts:93`; service test `:226`). There are no Gate/token/attendance-release/notification writes in the new mobile paths.
- Existing navigators and one root NavigationContainer remain, verified by exact route inventories. Preview is fictional and read-only (`src/devPreview/EarlyExitPreview.tsx:21`, `__tests__/developer-preview.test.tsx:171`), with no auth impersonation or real writes.

### G4D-AUD-01 — P2, must fix before PR: batched blur/refocus revives prior-focus responses

**Primary locations:** [useEarlyExitSession.tsx:17](D:/SchoolManagementSystem/src/hooks/useEarlyExitSession.tsx:17), [useEarlyExitSession.tsx:32](D:/SchoolManagementSystem/src/hooks/useEarlyExitSession.tsx:32). The reused lifetime hook at [usePickupSession.tsx:42](D:/SchoolManagementSystem/src/hooks/usePickupSession.tsx:42) toggles one Boolean false/true rather than identifying a focus lifetime.

**Consumers:** Parent checks `live.current` and an unchanged request generation at [ParentEarlyExitRequests.tsx:140](D:/SchoolManagementSystem/src/components/earlyExit/ParentEarlyExitRequests.tsx:140); Principal does the same at [PrincipalEarlyExitReviewScreen.tsx:135](D:/SchoolManagementSystem/src/screens/principal/PrincipalEarlyExitReviewScreen.tsx:135). Initial/fresh loads run on component/dependency changes (`ParentEarlyExitRequestsScreen.tsx:124`, Principal screen `:166`), so a focus cycle that does not remount them starts no new read.

**Reproduction, separately executed against unchanged implementation:**

1. Mount the real Parent/Principal screen with its canonical test fixture and hold an authorized detail response unresolved.
2. Use the installed React Navigation `useFocusEffect` and NavigationContext, controlling only `isFocused()`/`addListener()` event delivery. The actual hook source is loaded from `node_modules/@react-navigation/core/src/useFocusEffect.tsx`; it is not replaced by the repository's simplified focus mock.
3. Emit blur and then focus within one React `act` batch, keeping account/token/Branch identical.
4. Resolve the pre-blur detail with the fictional marker `PROTECTED_PRIOR_FOCUS`.
5. The old marker renders. Parent performs only one verified-child read, and Principal only one detail read, instead of a new protected revalidation after re-entry.

Observed results, repeatable with the actual installed hook:

```text
Parent expected:    {priorFocusVisible:false, verifiedChildReads:2}
Parent observed:    {priorFocusVisible:true,  verifiedChildReads:1}
Principal expected: {priorFocusVisible:false, detailReads:2}
Principal observed: {priorFocusVisible:true,  detailReads:1}
Audit probes: 0 passed, 2 failed, exit 1.
```

React can batch `setFocused(false)` and `setFocused(true)` into the same final `true` state. The auth-only Fragment key stays identical, private children are not destroyed, lifetime refs return to true, and the old request generation still matches. This violates the promised focus-boundary cancellation and fresh authority read. The reproduction uses the same account/token/Branch; it demonstrates prior-focus response acceptance and missing revalidation. It does not demonstrate a server RBAC bypass or cross-account access. A relationship/category grant revoked between the old read and re-entry need not be observed without a new server read. Physical-device frequency is not verified; the React/hook interleaving is deterministically reproduced.

**Why 1,301 committed tests still pass:** Parent test `:30` and Principal test `:26` replace `useFocusEffect` with a Context-driven `useEffect`; their blur tests commit a false-focus render before processing the late promise. They do not deliver real hook blur/focus events in a single batch.

**Minimum proposed correction, not implemented:** add a monotonically increasing focus epoch to the Early Exit session boundary and include it in its private Fragment key, so every focus entry produces a new lifetime even when the Boolean update batches away. Ensure callbacks from previous epochs remain invalid and current authority is reloaded. Prefer an Early Exit-scoped correction over unrelated G4c refactoring. Add Parent and Principal regressions using actual hook event semantics for batched blur/refocus, late success/denial and refreshed authority; retain all auth/child-switch, ordinary-blur and idempotency assertions. Revalidate full mobile, scoped types/lint and relevant backend restrictions. Update the prior mobile report's focus claim only after the fix is verified. Lead Engineer approval is required before implementation in a later task.

## E. Shared transport verdict — PASS at source/configuration-test level

`src/services/api/apiClient.ts:1` imports the existing resolver, and `:31` invokes it inside the request try/finally before fetch. No hardcoded LAN base remains in canonical transport. Method, JWT header/body and abort signal are preserved at `:32–38`; the per-request AbortController/timer and guaranteed cleanup remain at `:25–28`, `:56`.

`src/services/api/apiConfig.ts:5` explicitly separates development/release using `__DEV__`; release calls the existing HTTPS/public-origin validation and cannot fall back to the development origin. `config/api-origin-policy.js:49` and `:73` reject malformed/credential-bearing origins and release HTTP/local/IP inputs. Build-host Babel injection supplies only the selected public settings; the mobile runtime does not read Node process.env. Missing/invalid configuration fails before fetch.

Fresh existing transport/build tests pass 22/22, including missing markers, invalid release settings, configured dev/release paths, JWT/method preservation, HTTP errors and timeout/abort behavior. Their synthetic origins are test inputs, not deployed endpoints.

Native networking source is unchanged against integration. Android main manifest `android/app/src/main/AndroidManifest.xml:20` uses the existing cleartext placeholder. Installed RNGP source `node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/src/main/kotlin/com/facebook/react/utils/AgpConfiguratorUtils.kt:41` sets release cleartext false; debug is true at `:39`. iOS `ios/SchoolManagementSystem/Info.plist:32` keeps NSAllowsArbitraryLoads false and the existing local-networking exception at `:34`. No native build/merged-manifest/device attestation is claimed.

## F. Findings and deferred scope

| ID | Severity | Status / minimal action | Gate affected |
| --- | --- | --- | --- |
| G4D-AUD-01 | P2 | Confirmed batched focus lifetime defect above; add focus epoch plus real-hook regressions under separate approval. | Blocks PR readiness. |
| G4D-REL-01 | P1, inherited deployment configuration | `android/app/build.gradle:106–109` points release at `signingConfigs.debug`. Source is unchanged by G4d. Configure managed production signing with no debug fallback, then verify actual release certificate/artifact. No keystore secrets should be committed. | Production deployment blocker; separate from this feature's code integration. |
| F-AUD-03 | P3, previously approved deferred debt | Root TypeScript has 96 identical baseline/current diagnostic headers. Examples: `backend/src/services/rtc/zego-room-control.ts:37` (AbortSignal.timeout typing), `backend/tests/academic-evidence.security.test.ts:99` (Mongoose overload typing). Repair in its separately approved scope; no suppression or root-config edit here. | Root check remains FAIL; any external CI enforcement must be respected. |

No P0 was found in the reviewed scope. No additional P1 in the G4d domain/transport implementation was identified. G4D-REL-01 is a source configuration finding, not a claim that an APK was built or its certificate inspected. Root debt, the release-signing setting and native settings predate Part 2; they are not attributed to its frontend changes.

Operational school policy is still unconfigured. Actual approval, verified identity/custody activation, pickup/checkout, QR/OTP, emergency release, physical attendance exit mutation and exit notifications remain deliberately unavailable. These are not completed product capabilities. Explicit Branch routing and Principal category grants require consistent school/deployment configuration. Production HTTPS origin, DNS/TLS/reachability, production signing, Android/iOS release builds and physical-device/keyboard/accessibility verification remain separate release prerequisites.

Android build: **NOT RUN**. iOS native build: **NOT RUN**. Physical devices: **NOT RUN**. Actual production HTTPS connectivity: **NOT RUN**. No PR/CI status or required-check completion is inferred from local tests.

## G. Fresh validation results

| Command group | Actual result | Exit |
| --- | --- | --- |
| Complete existing mobile Jest selection | 91 suites; 1,301 passed, 0 failed/skipped | 0 |
| Full applicable G1–G4d backend selection | 20 files; 798 passed, 0 failed/cancelled/skipped/todo | 0 |
| Existing transport/build tests | 22 passed, 0 failed; overlaps mobile run | 0 |
| Independent real-hook focus audit probes, outside repo | 0 passed, 2 failed; not part of the committed 1,301 | 1 |
| Mobile-scoped TypeScript | No diagnostics | 0 |
| Backend TypeScript | No diagnostics | 0 |
| Independently extracted Part 1 root TypeScript | 96 diagnostic headers | 2 |
| Current root TypeScript | Same 96 diagnostic headers; zero introduced | 2 |
| Strict ESLint across all 39 changed TS/TSX paths | No diagnostics or warnings | 0 |
| Committed feature diff / worktree / cached whitespace | Clean | 0 |

Counts are per invocation and overlap. Passing committed counts do not override G4D-AUD-01.

### Exact commands and working directories

Repository working directory: `D:/SchoolManagementSystem`.

```powershell
git branch --show-current
git status --porcelain=v1
git diff --cached --name-only
git fetch origin
git rev-parse HEAD origin/feature/g4d-early-exit-requests origin/integration/team-merge
git rev-list --left-right --count HEAD...origin/feature/g4d-early-exit-requests
git merge-base --is-ancestor 39f8f1727ad6e262732f752ef76eedbdc3e3c89e HEAD
git merge-base --is-ancestor 49fc00ce6d7f2bc7c7eb36777ce10345dc85288c HEAD
# Test-only development origin is process-local and restored in finally.
$previousDevOrigin = $env:SCHOOL_APP_DEV_API_ORIGIN
try {
  $env:SCHOOL_APP_DEV_API_ORIGIN = 'http://127.0.0.1:5000'
  .\node_modules\.bin\jest.cmd --runInBand --json --outputFile "$env:TEMP\hira-g4d-audit-mobile.json"
} finally {
  if ($null -eq $previousDevOrigin) { Remove-Item Env:SCHOOL_APP_DEV_API_ORIGIN -ErrorAction SilentlyContinue }
  else { $env:SCHOOL_APP_DEV_API_ORIGIN = $previousDevOrigin }
}
.\node_modules\.bin\jest.cmd --runInBand __tests__/api-client.test.ts __tests__/api-origin-build.test.ts
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json --pretty false
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
$scopedPaths = @(git diff --name-only 49fc00ce6d7f2bc7c7eb36777ce10345dc85288c...HEAD -- '*.ts' '*.tsx')
.\node_modules\.bin\eslint.cmd --max-warnings=0 $scopedPaths
git diff --check 49fc00ce...HEAD
git diff --check
git diff --cached --check
git diff --exit-code 49fc00ce...HEAD -- android ios babel.config.js metro.config.js config scripts/babel-plugin-api-origins.js
```

Backend working directory: `D:/SchoolManagementSystem/backend`.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/early-exit.security.test.ts tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-review.security.test.ts tests/parent-leave-decision.security.test.ts tests/parent-scope.security.test.ts tests/teacher-scope.security.test.ts tests/student-enrollment.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/teacher-attendance.security.test.ts tests/principal-attendance.security.test.ts tests/attendance-amendment.security.test.ts tests/development-startup.security.test.ts tests/bootstrap.security.test.ts tests/teacher-provisioning.security.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
```

Backend tests use isolated disposable real replica sets and owned fixture data, never the real .env/production database. No dependency installation was needed. Mobile ran before the lengthy backend gate; static checks and temporary probes ran separately. A temporary probe harness initially needed root/ESM transform configuration corrections; those setup failures are not represented as product regressions. The final probe invocation above executes both real-hook cases and fails both behavioral assertions without timeout.

### Independent root baseline procedure

Part 1 was freshly exported with `git archive`, not checked out or restored over canonical files. A temporary source tree was extracted at `C:/Users/LAPTOP~1/AppData/Local/Temp/hira-g4d-audit-baseline-b050be7e0e6e48c3898987848716ca62`. Root/backend node_modules junctions reference the same installed dependencies, whose package/lockfiles are unchanged between checkpoints. No emit or dependency write occurs.

```powershell
git archive --format=tar --output=$archivePath 39f8f1727ad6e262732f752ef76eedbdc3e3c89e
tar -xf $archivePath -C $auditBaseline
New-Item -ItemType Junction -Path (Join-Path $auditBaseline 'node_modules') -Target 'D:\SchoolManagementSystem\node_modules'
New-Item -ItemType Junction -Path (Join-Path $auditBaseline 'backend\node_modules') -Target 'D:\SchoolManagementSystem\backend\node_modules'
Push-Location $auditBaseline
& 'D:\SchoolManagementSystem\node_modules\.bin\tsc.cmd' --noEmit --pretty false
Pop-Location
```

Both root compilations exited 2. Comparing the actual `error TS...` file/line/code/message headers returned `BASELINE=96 CURRENT=96 DELTA=0`; mobile and backend source scopes independently exited 0. Root is not claimed clean.

### Audit probe reproduction artifacts

Only temporary tests/config were written. Existing source/test files remain unchanged. Probe directory: `C:/Users/LAPTOP~1/AppData/Local/Temp/hira-g4d-audit-probes-rxmnsm7y`. Files `parent-focus.test.tsx` and `principal-focus.test.tsx` reuse the committed typed fixtures and setup; the temporary config allows transformation of the installed React Navigation core source. It loads actual `useFocusEffect`, `useNavigation` and NavigationContext, controlling only navigation event delivery. Dependencies are linked, not installed/copied/modified.

```powershell
.\node_modules\.bin\jest.cmd --runInBand --config 'C:\Users\LAPTOP~1\AppData\Local\Temp\hira-g4d-audit-probes-rxmnsm7y\jest.config.cjs' --json --outputFile "$env:TEMP\hira-g4d-audit-probes.json"
```

Core interleaving (both screens, with an unresolved pre-blur detail):

```tsx
await act(async () => {
  mockIsFocused = false;
  for (const emit of [...mockListeners.blur]) emit();
  mockIsFocused = true;
  for (const emit of [...mockListeners.focus]) emit();
});
await act(async () => waiting.resolve(detailWithPriorFocusMarker));
// Fails: prior marker is visible and protected read count remains 1.
```

## H. PR readiness and required handoff

**BLOCKED — FIX REQUIRED** for G4D-AUD-01. Propose only an Early Exit focus-epoch correction and the two real-hook regression families for Lead Engineer approval. Do not modify backend authority, custody policy, release gates or generic approval behavior as part of that correction. After an approved fix, rerun the complete mobile suite, actual-event probes, scoped types/lint and applicable backend restrictions; preserve inherited-debt reporting and native/deployment separation.

No PR, commit, push or merge is authorized by this audit. Implementation HEAD remains `22733198af49dc8f6ba81aaf7dd91c90a4053e8d`. The report remains untracked/unstaged for review. Production release remains separately blocked by missing verified deployment/signing/device evidence and school operational policy.

## I. Raw validation outputs (last 20 lines)

### Full mobile Jest — exit 0

~~~~text
PASS __tests__/academic-evidence-service.test.ts
PASS __tests__/teacher-timetable-service.test.ts
PASS __tests__/teacher-service.test.ts
PASS __tests__/academic-setup-service.test.ts
PASS __tests__/teacher-assignment-service.test.ts
PASS __tests__/notification-service.test.ts
PASS __tests__/teacher-communication-service.test.ts
PASS __tests__/principal-substitution-service.test.ts
PASS __tests__/permissions.test.ts
PASS __tests__/live-lesson-api.test.ts
PASS __tests__/academic-work-service.test.ts
PASS __tests__/academic-phase2-service.test.ts
PASS __tests__/notification-inbox-service.test.ts

Test Suites: 91 passed, 91 total
Tests:       1301 passed, 1301 total
Snapshots:   0 total
Time:        63.616 s
Ran all test suites.
Test results written to: C:\Users\LAPTOP~1\AppData\Local\Temp\hira-g4d-audit-mobile.json
~~~~

### Full applicable backend — exit 0

~~~~text
✔ revoked assignment immediately removes roster access (398.5568ms)
✔ expired assignment immediately removes roster access (407.5195ms)
✔ future assignment immediately removes roster access (471.9083ms)
✔ current inactive change fails closed on roster and independent service call (397.4511ms)
✔ current role change fails closed on roster and independent service call (314.3749ms)
✔ current branch change fails closed on roster and independent service call (342.1748ms)
✔ current branch inactive change fails closed on roster and independent service call (300.2154ms)
✔ current permission change fails closed on roster and independent service call (293.548ms)
✔ roster query/body injection never widens scope and malformed tuple IDs are sanitized (464.6495ms)
✔ roster has independent authentication/role gates and no guessed learner detail surface (328.4437ms)
✔ roster reference changes invalidate authority and DB failure is sanitized (296.0848ms)
✔ roster resolves scope once and executes one aggregate regardless of learner count (320.2481ms)
ℹ tests 798
ℹ suites 0
ℹ pass 798
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 370595.3578
~~~~

### Transport/build configuration — exit 0

~~~~text
PASS __tests__/api-origin-build.test.ts (8.681 s)
PASS __tests__/api-client.test.ts

Test Suites: 2 passed, 2 total
Tests:       22 passed, 22 total
Snapshots:   0 total
Time:        11.824 s, estimated 13 s
Ran all test suites matching /__tests__\\api-client.test.ts|__tests__\\api-origin-build.test.ts/i.
~~~~

### Independent actual-hook probes — exit 1, confirmed finding

~~~~text
    +   "verifiedChildReads": 1,
      }

      138 |   });
      139 |   await act(async () => waiting.resolve(earlyExitDetail({ reason: 'PROTECTED_PRIOR_FOCUS' })));
    > 140 |   expect({ priorFocusVisible: output().includes('PROTECTED_PRIOR_FOCUS'), verifiedChildReads: childrenTransport.children.mock.calls.length }).toEqual({ priorFocusVisible: false, verifiedChildReads: 2 });
          |                                                                                                                                               ^
      141 | });
      142 |

      at Object.toEqual (../../../../../LAPTOP~1/AppData/Local/Temp/hira-g4d-audit-probes-rxmnsm7y/parent-focus.test.tsx:140:143)
      at asyncGeneratorStep (D:/SchoolManagementSystem/node_modules/@babel/runtime/helpers/asyncToGenerator.js:3:17)
      at _next (D:/SchoolManagementSystem/node_modules/@babel/runtime/helpers/asyncToGenerator.js:17:9)

Test Suites: 2 failed, 2 total
Tests:       2 failed, 2 total
Snapshots:   0 total
Time:        3.802 s, estimated 8 s
Ran all test suites.
Test results written to: C:\Users\LAPTOP~1\AppData\Local\Temp\hira-g4d-audit-probes.json
~~~~

### Root TypeScript, current checkpoint — exit 2, inherited

~~~~text
      Type 'string' is not assignable to type '{ readonly schemaName?: "ObjectId" | undefined; auto?: ((turnOn: boolean) => ObjectId) | undefined; $conditionalHandlers?: { [x: string]: ((val: any, context: any) => any) | undefined; } | undefined; ... 24 more ...; validateAll?: ((validators: (RegExp | ... 1 more ... | ValidatorFunction<...>)[]) => ObjectId) | und...'.
backend/tests/student-enrollment.security.test.ts(331,51): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Type 'string' is not assignable to type '{ readonly schemaName?: "ObjectId" | undefined; auto?: ((turnOn: boolean) => ObjectId) | undefined; $conditionalHandlers?: { [x: string]: ((val: any, context: any) => any) | undefined; } | undefined; ... 24 more ...; validateAll?: ((validators: (RegExp | ... 1 more ... | ValidatorFunction<...>)[]) => ObjectId) | und...'.
      Type 'string' is not assignable to type '{ readonly schemaName?: "ObjectId" | undefined; auto?: ((turnOn: boolean) => ObjectId) | undefined; $conditionalHandlers?: { [x: string]: ((val: any, context: any) => any) | undefined; } | undefined; ... 24 more ...; validateAll?: ((validators: (RegExp | ... 1 more ... | ValidatorFunction<...>)[]) => ObjectId) | und...'.
backend/tests/student-enrollment.security.test.ts(339,43): error TS2339: Property '_id' does not exist on type 'never'.
backend/tests/student-enrollment.security.test.ts(342,43): error TS2339: Property '_id' does not exist on type 'never'.
backend/tests/student-enrollment.security.test.ts(345,42): error TS2769: No overload matches this call.
  Overload 1 of 2, '(filter?: _QueryFilter<{ status: NonNullable<FeeStatus>; description: string; dueDate: Date; branchId: ObjectId; studentId: ObjectId; createdAt: Date; ... 282 more ...; "studentId.validateAll": (validators: (RegExp | ... 1 more ... | ValidatorFunction<...>)[]) => ObjectId; }> | undefined, options?: (CountOptions & ... 2 more ... & Abortable) | ... 1 more ... | undefined): Query<...>', gave the following error.
    Type 'string' is not assignable to type 'StrictCondition<ApplyBasicQueryCasting<ObjectId>> | undefined'.
  Overload 2 of 2, '(filter?: Query<any, any, {}, unknown, "find", Record<string, never>> | undefined, options?: (CountOptions & Pick<QueryOptions<IFee>, "timestamps" | ... 1 more ... | "lean"> & { ...; } & Abortable) | null | undefined): Query<...>', gave the following error.
    Object literal may only specify known properties, and 'studentId' does not exist in type 'Query<any, any, {}, unknown, "find", Record<string, never>>'.
backend/tests/student-enrollment.security.test.ts(350,233): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Argument of type '{ effectiveTo: Date; effectiveFrom: Date; status?: undefined; reason: string; createdBy: string; updatedBy: string; academicPeriodId: string; classId: string; sectionId: string; studentId: string; branchId: string; } | { ...; } | { ...; } | { ...; }' is not assignable to parameter of type '{ revision?: number | undefined; classId?: ObjectIdQueryTypeCasting | undefined; sectionId?: ObjectIdQueryTypeCasting | undefined; ... 13 more ...; _id?: ObjectIdQueryTypeCasting | undefined; }'.
      Type '{ status: string; effectiveTo?: undefined; effectiveFrom: Date; reason: string; createdBy: string; updatedBy: string; academicPeriodId: string; classId: string; sectionId: string; studentId: string; branchId: string; }' is not assignable to type '{ revision?: number | undefined; classId?: ObjectIdQueryTypeCasting | undefined; sectionId?: ObjectIdQueryTypeCasting | undefined; ... 13 more ...; _id?: ObjectIdQueryTypeCasting | undefined; }'.
        Types of property 'status' are incompatible.
          Type 'string' is not assignable to type 'RegExp | "withdrawn" | "active" | "transferred" | "promoted" | undefined'.
backend/tests/teacher-timetable.security.test.ts(411,17): error TS2554: Expected 2-3 arguments, but got 0.
backend/tests/teacher-timetable.security.test.ts(602,21): error TS2554: Expected 2-3 arguments, but got 0.
~~~~

Mobile-scoped TypeScript, backend TypeScript and strict ESLint each exited 0 with empty output. Independent root baseline/current comparison: BASELINE=96 CURRENT=96 DELTA=0; each root compilation exited 2.

Final audit conclusion: **BLOCKED — FIX REQUIRED**.

## J. Approved G4D-AUD-01 remediation — 2026-11-09

This is a new, append-only remediation assessment. Sections A–I, their original P2 finding, failing reproduction, original blocked verdict and release limitations remain unchanged. The first **37,371 bytes**, SHA-256 `17B96CC15E7BA9E72E8B6F025FEC0F9A6D4E6D379307AC474814A46F30A138B9`, are preserved byte-for-byte.

### J1. Authorization, baseline and exact changed files

The Lead Engineer authorized only the Early Exit focus-generation/privacy correction and directly related permanent regressions. Initial branch/HEAD were verified as `feature/g4d-early-exit-requests` / `22733198af49dc8f6ba81aaf7dd91c90a4053e8d`. `git fetch origin` succeeded; remote feature matched HEAD, ahead/behind `0 0`. Index was empty. The sole pre-existing untracked artifact was this audit report, as expected.

Exact intended working-tree scope (four paths):

| Path | Change |
| --- | --- |
| `src/hooks/useEarlyExitSession.tsx` | Early Exit-only focus epoch in private component identity and a non-reactivating per-instance liveness fence. |
| `__tests__/early-exit-focus.security.test.tsx` | New permanent 42-case Parent/Principal real-hook security/regression suite. |
| `__tests__/helpers/early-exit-real-navigation.fixture.ts` | Executes the installed React Navigation core hook/context modules with controlled navigation event delivery. |
| `docs/integration/pr-g4d-final-completion-audit.md` | This append-only remediation section and validation evidence. |

No new branch, switch, stage, commit, push, PR, merge, rebase, cherry-pick, reset, restore or clean was used. Implementation HEAD remains unchanged. All correction changes are unstaged/uncommitted for Lead Engineer review.

### J2. Root cause and minimal correction

The old boundary represented focus with a Boolean. React could batch false then true into the same final state, retaining the private component keyed only by auth identity. The reused liveness Boolean could also become true again, allowing old callbacks to run. Permanent red tests confirmed both the previous-focus detail exposure and an old 401 invoking logout before the batched remount could occur.

The correction is entirely in the Early Exit hook module:

1. Every genuine focus-effect entry functionally increments `focusEpoch`; the private Fragment key includes that epoch alongside account, role, Branch and token. Every focus entry therefore creates a distinct monotonically increasing private lifetime even when the Boolean updates batch away.
2. `useEarlyExitLifetime` is now Early Exit-scoped. Mount initializes its ref, and blur/unmount invalidates it. Refocus never reactivates the old instance. This immediately fences prior callbacks, including errors settling inside the same event batch before React commits the epoch remount.
3. Fresh private instances run the existing verified-child/history or Principal-detail reads. Current authority is revalidated server-side through unchanged canonical services. Duplicate focus notifications while already focused are handled by the actual installed hook and do not reset a pending operation.

`src/hooks/usePickupSession.tsx` and G4c behavior were not modified. No shared-hook expansion was required. Existing account/token/role/Branch and child keys, service contracts, native secure operation IDs, synchronous mutation/pending guards, Draft identity and uncertainty/retry rules remain intact. No backend, RBAC, grants, models, routes, transport, navigation, custody, approval or physical-release behavior changed.

### J3. Permanent reproduction and red-to-green evidence

The new fixture executes installed `@react-navigation/core` source modules (`useFocusEffect`, `useNavigation`, NavigationContext and NavigationContainerRefContext) using the existing Babel preset/CommonJS transform. It supplies the same React instance and controls only navigation context/events. It does not copy or simplify the hook implementation, change global Jest/Babel configuration, install a dependency or increase test timeouts. This follows the repository's existing actual-module transformation testing pattern.

Before production edits:

- The original two permanent batched blur/refocus success cases failed **2/2**, exit 1. The old marker rendered and protected read counts stayed at 1 instead of a fresh read.
- Adding old-401 delivery inside that same batch reproduced **4/4 failures**, exit 1. Both roles could invoke logout from an obsolete focus callback.

After the correction:

- Those four assertions passed **4/4**, exit 0, without weakening them or changing event timing.
- The expanded permanent suite passed **42/42**, exit 0.
- The original audit's two unchanged temporary actual-hook probes also passed **2/2**, exit 0, against the corrected working tree. Their original failing evidence in section I remains preserved.

The permanent suite covers both roles' batched blur/refocus, delayed success, delayed 401/403/404, denied responses settling before the epoch render commits, fresh current 401/403/404 concealment, current registered-identity context changes, repeated focus lifetimes, duplicate-focus nonce preservation, duplicate-tap guards, stale mutation success/denial, and disabled operational actions. It additionally verifies Parent child switching without a focus change and the existing failed-Draft-refresh invariant: retained request ID/form, disabled Save until revisions recover, and edit of the original ID with the returned application revision.

The original Parent/Principal tests and every existing assertion remain unchanged. No frontend mock becomes backend authority; real persisted role/session/relationship/Branch restrictions remain covered by the complete replica-set backend selection.

### J4. Final validation

| Gate | Actual result | Exit |
| --- | --- | --- |
| Baseline original permanent focus cases | 0 passed, 2 failed | 1 |
| Baseline expanded red cases, before production fix | 0 passed, 4 failed | 1 |
| Same four assertions after fix | 4 passed, 0 failed | 0 |
| Final permanent real-hook suite | 42 passed, 0 failed/skipped | 0 |
| Original unchanged temporary audit probes after fix | 2 passed, 0 failed | 0 |
| Full mobile Jest | 92 suites, 1,343 passed, 0 failed/skipped; includes the 42 new cases and all 1,301 prior cases | 0 |
| Complete applicable G1–G4d backend selection | 20 files, 798 passed, 0 failed/cancelled/skipped/todo; real replica sets and process races | 0 |
| Mobile-scoped TypeScript | No diagnostics | 0 |
| Strict ESLint on the three changed/new TS/TSX paths | No diagnostics or warnings | 0 |
| Root TypeScript baseline/current | 96 diagnostic headers in each; zero introduced headers | 2 / 2 |
| Git diff, explicit untracked-file whitespace and conflict-marker checks | Passed; index empty | 0 |

These invocations overlap; their pass counts must not be summed as unique coverage. Initial fixture typing compatibility issues with React Native's ambient Node declarations were resolved using the existing Node createRequire API, without root-config edits or type suppression. Final mobile TypeScript is clean. Root-wide TypeScript remains the measured inherited F-AUD-03 failure, not a passing root check.

Working directory for frontend/static commands: `D:/SchoolManagementSystem`.

```powershell
# Captured before production edits:
.\node_modules\.bin\jest.cmd --runInBand __tests__/early-exit-focus.security.test.tsx --json --outputFile "$env:TEMP\hira-g4d-focus-red-all.json"
# Captured after the correction and expanded coverage:
.\node_modules\.bin\jest.cmd --runInBand __tests__/early-exit-focus.security.test.tsx --json --outputFile "$env:TEMP\hira-g4d-focus-green.json"
# Original unchanged audit probes, using their preserved temporary config:
.\node_modules\.bin\jest.cmd --runInBand --config 'C:\Users\LAPTOP~1\AppData\Local\Temp\hira-g4d-audit-probes-rxmnsm7y\jest.config.cjs' --json --outputFile "$env:TEMP\hira-g4d-focus-original-probes-green.json"
# Full mobile run uses a process-local test-only development origin, restored afterward:
$previousDevOrigin = $env:SCHOOL_APP_DEV_API_ORIGIN
try {
  $env:SCHOOL_APP_DEV_API_ORIGIN = 'http://127.0.0.1:5000'
  .\node_modules\.bin\jest.cmd --runInBand --json --outputFile "$env:TEMP\hira-g4d-focus-mobile.json"
} finally {
  if ($null -eq $previousDevOrigin) { Remove-Item Env:SCHOOL_APP_DEV_API_ORIGIN -ErrorAction SilentlyContinue }
  else { $env:SCHOOL_APP_DEV_API_ORIGIN = $previousDevOrigin }
}
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json --pretty false
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
.\node_modules\.bin\eslint.cmd --max-warnings=0 src/hooks/useEarlyExitSession.tsx __tests__/helpers/early-exit-real-navigation.fixture.ts __tests__/early-exit-focus.security.test.tsx
# Compare file/line/code/message error headers from the pre-edit and final root outputs:
# BASELINE=96 FINAL=96 DELTA=0
git diff --check
git diff --cached --check
git status --short
```

Backend working directory: `D:/SchoolManagementSystem/backend`.

```powershell
.\node_modules\.bin\tsx.cmd --test --test-concurrency=2 tests/early-exit.security.test.ts tests/pickup-authorization.security.test.ts tests/gate-foundation.security.test.ts tests/parent-leave-application.policy.test.ts tests/parent-application-authority.security.test.ts tests/parent-leave-draft.security.test.ts tests/parent-leave-lifecycle.security.test.ts tests/parent-leave-review.security.test.ts tests/parent-leave-decision.security.test.ts tests/parent-scope.security.test.ts tests/teacher-scope.security.test.ts tests/student-enrollment.security.test.ts tests/approval-authority.security.test.ts tests/principal-authorization.security.test.ts tests/teacher-attendance.security.test.ts tests/principal-attendance.security.test.ts tests/attendance-amendment.security.test.ts tests/development-startup.security.test.ts tests/bootstrap.security.test.ts tests/teacher-provisioning.security.test.ts
```

Validation output/JSON stays outside Git under system TEMP. No real .env or production database was read or changed. Backend tests use isolated disposable MongoDB replica sets and fixture-only credentials/data.

### J5. Unchanged restrictions and new readiness assessment

**G4D-AUD-01 remediation: PASS for the verified, uncommitted working tree. Ready for Lead Engineer checkpoint review.** The reproduced focus defect is closed by the source change and red-to-green evidence above. No unrelated authority behavior changed.

The published implementation HEAD `22733198af49dc8f6ba81aaf7dd91c90a4053e8d` still lacks this unstaged correction. The original blocked verdict for that checkpoint has not been erased or retroactively changed. After Lead Engineer approval, explicitly checkpoint/push only the reviewed correction on the existing feature branch, then assess the actual published branch for PR preparation. This task does not authorize staging, commit, push, PR or merge.

Remaining limitations are unchanged: inherited release debug signing (G4D-REL-01), production HTTPS/signing/artifact verification, Android/iOS native builds and physical-device/accessibility/keyboard checks, and the 96 inherited root TypeScript diagnostics (F-AUD-03). Native/device and actual production connectivity checks were **NOT RUN** for this fix. No release-readiness or deployed-endpoint success is claimed.

School identity/custody/operational policy remains unconfigured. Early Exit approval, Gate checkout, QR/OTP, actual student release, emergency exceptions, automatic attendance exit effects and unauthorized notifications remain disabled/out of scope. No school-policy, transport or backend redesign occurred.

### J6. Raw remediation validation outputs (last 20 lines)

#### Baseline red permanent tests — exit 1

~~~~text
    1: called with 0 arguments

      88 |       await act(async () => { focus.blur(); focus.focus(); waiting.reject(new ApiError(401, 'old focus')); await Promise.resolve(); });
      89 |     }
    > 90 |     expect(mockAuth.logout).not.toHaveBeenCalled();
         |                                 ^
      91 |     expect(freshReads(role)).toBe(2);
      92 |   });
      93 | }

      at Object.toHaveBeenCalled (__tests__/early-exit-focus.security.test.tsx:90:33)
      at asyncGeneratorStep (node_modules/@babel/runtime/helpers/asyncToGenerator.js:3:17)
      at _next (node_modules/@babel/runtime/helpers/asyncToGenerator.js:17:9)

Test Suites: 1 failed, 1 total
Tests:       4 failed, 4 total
Snapshots:   0 total
Time:        3.603 s, estimated 4 s
Ran all test suites matching /__tests__\\early-exit-focus.security.test.tsx/i.
Test results written to: C:\Users\LAPTOP~1\AppData\Local\Temp\hira-g4d-focus-red-all.json
~~~~

#### Final permanent real-hook tests — exit 0

~~~~text
  √ principal: fresh current authority denial 404 conceals previous private detail (4 ms)
  √ principal: real-hook account isolation rejects a late old 401 (4 ms)
  √ principal: real-hook token isolation rejects a late old 401 (5 ms)
  √ principal: real-hook role isolation rejects a late old 401 (2 ms)
  √ principal: real-hook branch isolation rejects a late old 401 (4 ms)
  √ principal: real-hook logout isolation rejects a late old 401 (2 ms)
  √ principal: each successive batched focus entry reloads current authority (10 ms)
  √ principal: duplicate focus notification cannot reset a pending nonce or bypass duplicate-tap guards (14 ms)
  √ principal: focus re-entry does not enable approval or trigger domain writes (6 ms)
  √ principal: prior-focus mutation success cannot affect the re-entered workspace (11 ms)
  √ principal: prior-focus mutation denied cannot affect the re-entered workspace (10 ms)
  √ Parent real-hook Draft refresh failure retains edit identity, fields and returned revision (23 ms)
  √ Parent real-hook child switch keeps the old child response invalid without changing focus (12 ms)

Test Suites: 1 passed, 1 total
Tests:       42 passed, 42 total
Snapshots:   0 total
Time:        5.013 s
Ran all test suites matching /__tests__\\early-exit-focus.security.test.tsx/i.
Test results written to: C:\Users\LAPTOP~1\AppData\Local\Temp\hira-g4d-focus-green.json
~~~~

#### Original unchanged audit probes — exit 0

~~~~text
PASS C:/Users/LAPTOP~1/AppData/Local/Temp/hira-g4d-audit-probes-rxmnsm7y/principal-focus.test.tsx
PASS C:/Users/LAPTOP~1/AppData/Local/Temp/hira-g4d-audit-probes-rxmnsm7y/parent-focus.test.tsx

Test Suites: 2 passed, 2 total
Tests:       2 passed, 2 total
Snapshots:   0 total
Time:        5.025 s
Ran all test suites.
Test results written to: C:\Users\LAPTOP~1\AppData\Local\Temp\hira-g4d-focus-original-probes-green.json
~~~~

#### Full mobile Jest — exit 0

~~~~text
PASS __tests__/teacher-home-service.test.ts
PASS __tests__/teacher-attendance-service.test.ts
PASS __tests__/principal-task-service.test.ts
PASS __tests__/class-subject-service.test.ts
PASS __tests__/academic-evidence-service.test.ts
PASS __tests__/teacher-communication-service.test.ts
PASS __tests__/teacher-assignment-service.test.ts
PASS __tests__/student-enrollment-service.test.ts
PASS __tests__/notification-service.test.ts
PASS __tests__/academic-work-service.test.ts
PASS __tests__/teacher-timetable-service.test.ts
PASS __tests__/permissions.test.ts
PASS __tests__/live-lesson-api.test.ts

Test Suites: 92 passed, 92 total
Tests:       1343 passed, 1343 total
Snapshots:   0 total
Time:        74.907 s
Ran all test suites.
Test results written to: C:\Users\LAPTOP~1\AppData\Local\Temp\hira-g4d-focus-mobile.json
~~~~

#### Complete backend security — exit 0

~~~~text
✔ revoked assignment immediately removes roster access (500.902ms)
✔ expired assignment immediately removes roster access (503.5312ms)
✔ future assignment immediately removes roster access (441.0507ms)
✔ current inactive change fails closed on roster and independent service call (444.5129ms)
✔ current role change fails closed on roster and independent service call (405.1408ms)
✔ current branch change fails closed on roster and independent service call (430.7949ms)
✔ current branch inactive change fails closed on roster and independent service call (444.868ms)
✔ current permission change fails closed on roster and independent service call (439.9323ms)
✔ roster query/body injection never widens scope and malformed tuple IDs are sanitized (682.8355ms)
✔ roster has independent authentication/role gates and no guessed learner detail surface (481.067ms)
✔ roster reference changes invalidate authority and DB failure is sanitized (451.0416ms)
✔ roster resolves scope once and executes one aggregate regardless of learner count (513.7017ms)
ℹ tests 798
ℹ suites 0
ℹ pass 798
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 390893.9956
~~~~

Mobile-scoped TypeScript and strict ESLint emitted no diagnostics (exit 0). Root compiler baseline/final each exited 2: BASELINE=96 FINAL=96 DELTA=0.

Remediation handoff: **PASS — ready for checkpoint review; changes remain unstaged and uncommitted.**
