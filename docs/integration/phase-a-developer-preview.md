# Phase A: development preview shell

This is an isolated visual inspection entry, not a domain integration or a completed donor migration.

## Entry and authority

In development builds, sign in through the canonical login and select **Open Developer Preview**. The entry requires both the real user and token. Exit returns to the normal role-selected app. Production rendering follows the existing role routing without the launcher.

The existing AuthProvider and single NavigationContainer remain the only root owners. No auth context, user, token, branch scope or API header is replaced. Super Admin, Principal and Teacher render their existing canonical navigators directly. Selecting a navigator grants no backend authority: requests still carry the real session and can return 403. Canonical screens are live screens and authorized actions retain their normal effects.

Student, Parent and Finance are deliberately small read-only visual adapters. They show explicitly fictional local samples. They have no services, network effects, uploads, forms or persistence. Sample placement/timetable/result strings are presentation only and never become domain authority. Logout removes the preview workspace and its state.

## Donor provenance and selected surface

References were inspected directly with `git show faraz-audit:<path>`. No branch was merged and no donor file was copied wholesale.

| Donor reference | Adaptation |
| --- | --- |
| `src/mobileApp/roles/student/StudentDashboard.jsx` | Student identity, timetable/homework/results record cards in `src/devPreview/StudentPreview.tsx` |
| `src/mobileApp/roles/parent/ParentDashboard.jsx` | Child selector and school-story cards in `src/devPreview/ParentPreview.tsx` |
| `src/mobileApp/roles/finance/FinanceDashboard.jsx` | Overview and fees/challans tabs/cards in `src/devPreview/FinancePreview.tsx` |
| `src/mobileApp/shared/home/HiraHome.jsx` | Role-specific hero copy in those three adapters |
| `src/mobileApp/theme/hiraTheme.js` | Small palette subset in `src/devPreview/PreviewUI.tsx`; no feature registry imported |
| `src/mobileApp/shared/data/previewData.js` | Small display-only sample subset in `src/devPreview/previewData.ts` |

The inspected MobileApp, RoleNavigationHub and roleNavigation files were not imported: the full shell/hub pulls in services and unrelated feature pages. Rejected dependencies include donor `authService`, `authSession`, `sessionStorage`, `apiConfig`, parent/student/finance services, backend auth/session/runtime and the document-picker package. No dependency or lockfile changes are required.

The previews cover the selected dashboard surfaces, not every donor feature. Future API/domain reconnection is outside Phase A.

## Review surface and validation

Only `src/navigation/AppNavigator.tsx` changes among existing canonical files. Six files under `src/devPreview/`, `__tests__/developer-preview.test.tsx` and this note are new. Backend sources, API client, canonical role navigators, manifests and lockfiles remain unchanged.

Preview tests cover login/token gating, all six destinations, sample navigation without network requests, real-session preservation, logout isolation, the production guard and propagation of API 403 with the original bearer token. Existing navigation/auth/Principal attendance/substitution tests are also run. Canonical navigator selection is tested with mocked destination components; a real-device authenticated workflow remains a separate smoke check.

Validation artifacts are kept in the already locally excluded `.validation-principal-audit/phase-a/` directory. This work is intentionally uncommitted and unstaged for review. No push is authorized.

Validation on the Phase A worktree:

| Check | Result |
| --- | --- |
| Jest: preview, Teacher/academic/timetable navigation, auth session, Principal attendance/substitutions | 7 suites, 67 passed, 0 failed; includes 11 preview tests |
| Mobile sources and frontend tests TypeScript | PASS, no diagnostics |
| Repository-wide TypeScript | FAIL: 85 existing diagnostics; unchanged-HEAD virtual-source comparison also reports 85, zero introduced |
| ESLint for changed TS/TSX files | PASS, zero warnings/errors |
| `git diff --check` | PASS |
| Android debug build, arm64-v8a | PASS: 143 tasks; 9 executed, 134 up-to-date |
| Android development Metro bundle | PASS; 24 assets copied |
| Physical device smoke test | NOT RUN: ADB has no connected devices; prior wireless endpoint could not be reached |

Authenticated on-device login, role navigation and donor preview appearance are therefore not claimed as physically verified. No fake login or backend response was added to obtain runtime screenshots.
