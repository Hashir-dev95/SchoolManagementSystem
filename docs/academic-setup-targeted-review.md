# Academic Setup targeted review — 2026-10-21

## Academic Period finding

The reported Principal form cannot be reproduced from the checked-out source or the currently served Metro bundle. This is an unresolved runtime/source discrepancy, not a proven persistence defect. Do not claim the reported Save Changes failure is fixed.

The current route is `index.js -> App.tsx -> AppNavigator -> RoleNavigator -> PrincipalNavigator -> PrincipalWorkspaceScreen drawer -> AcademicSetup -> src/screens/admin/AcademicSetupScreen.tsx`. There is one Academic Setup screen implementation. Super Admin Settings routes to the same component. Principal period access is intentionally read-only in both permission tables, the screen, and `academicSetupScope`; even manually granting the Principal period permission does not bypass the service's explicit Super Admin restriction. This design originates in `5688e3f`.

The authorized Super Admin path is `AdminDialog -> Button.onPress -> save -> name/code/date validation -> mutate (synchronous ref guard) -> academicSetupService.create/update -> apiClient -> POST /api/academic-setup/periods or PATCH /api/academic-setup/periods/:id`. It supplies the registered bearer token, selected branch query, date-only strings, and revision for updates; immutable period code is omitted on update. Routes apply authentication, role, and permissions. The service reloads persisted identity, validates scope and contract, acquires the Branch transaction fence, locks/revalidates the login and user, creates/saves the existing AcademicPeriod model, and returns `{success, data}`. The screen catches errors inside the open form and refreshes the visible list after server confirmation. Periods are created as drafts; creating one does not activate it. Existing duplicate indexes, lifecycle transitions, and immutable historical references remain in place.

Focused tests exercise the real Save changes button, successful draft create/update, visible 409 feedback, list refresh, and double-click suppression. Backend HTTP tests verify persisted records and invalid/duplicate input. No defect was demonstrated in this authorized save path.

## Class finding and smallest fix

Class CRUD is implemented and reachable, not missing. Both roles can manage current-period Classes in the shared screen. Principal enters through the workspace drawer; Super Admin enters through Dashboard Settings. Existing navigation tests explicitly keep setup CRUD off the Home dashboards. No navigation destination, model, API, or permission was added.

The first failing presentation layer is the create-action conditional: it removed Create Class entirely when no active period existed. The screen now retains a disabled create action and explains that Super Admin must create and activate a period. The same current-period writable guard remains. All existing Class edit/lifecycle, Section, and Class Subjects panels are reused.

## Runtime reconciliation

Read-only Android/Metro inspection found:

- Connected Samsung SM_G715U with package `com.schoolmanagementsystem`, version 1.0/code 1, DEBUGGABLE, last updated 2026-10-21 20:18:53 according to device package metadata.
- Device reverse mapping for port 8081. Metro process command points to `D:\SchoolManagementSystem\node_modules\react-native/cli.js start`.
- Metro's current Android development bundle includes `AcademicSetupContent`, the explicit Principal period read-only message, and the Class prerequisite explanation.
- At the final inspection, the package had no PID and Metro `/json/list` had no attached target. The original failing UI was therefore unavailable for inspection. These observations cannot prove which bundle, role state, or form the user saw earlier.

No app install, reload, login, or permission change was performed. Reproducing the original Principal form in the running app remains necessary before attributing its silent save to a particular layer. No JWTs, credentials, authorization headers, or user data were logged; development environment files were not read.

## Security and compatibility

The review found a status-contract mismatch: existing Principal foreign-target catalog mutations failed closed with 404; the requested contract specifies 403. The standard catalog mutation route adapter now returns a generic 403 for unavailable Principal mutation targets. Nonexistent and foreign IDs produce identical responses, preventing existence disclosure. Reads retain 404, Super Admin responses retain their prior semantics, and Class Subjects endpoints retain their existing contract. A same-branch record deleted before a Principal mutation also produces this generic 403.

Authorization still depends on persisted users/sessions, server permission checks, branch scope, and transactional revalidation. Frontend visibility grants no authority. Catalog locks, academic-history retention, enrollment dependencies, and immutable references were not changed. Forged body role/branch fields remain rejected by exact-field validation.

## Changed application/test files

- `src/screens/admin/AcademicSetupScreen.tsx`: retain disabled Class create action and display its prerequisite.
- `__tests__/academic-setup.test.tsx`: assert the prerequisite UX; add period button/create/edit/error/refresh/double-click and Super Admin Class refresh coverage.
- `backend/src/routes/academic-setup.routes.ts`: enforce generic 403 for unavailable Principal standard catalog mutation targets.
- `backend/tests/academic-setup.security.test.ts`: assert 403 for foreign branch/record/parent writes and authority changes, preserving read concealment and identical nonexistent-target responses.
- This review document records findings, evidence, limitations, and validation.

Local logs/configuration/bundle evidence are under `.validation-academic-setup-fix/` and are not staged.

## Validation

- Frontend: **8 suites, 55 tests passed**: academic-setup, academic-setup-service, academic-setup-navigation, class-subject, class-subject-service, student-enrollment, student-enrollment-service, permissions. Final command uses `node node_modules/jest/bin/jest.js --runInBand --testTimeout=30000` followed by these test paths. An initial run had one unrelated enrollment navigation test exceed the default 5-second timeout under concurrent validation; the complete rerun passed.
- Backend: **4 test files, 156 tests passed, 0 failed/skipped**: academic-setup.security, academic-foundation.security, class-subject.security, student-enrollment.security. Command: `node --import tsx --test --test-concurrency=1` followed by those paths, from backend. Uses owned temporary MongoDB replica sets, including transaction/concurrency/security/history regressions. The first sandbox attempt failed before execution because tsx's Windows user lookup returned ENOMEM; approved execution outside the sandbox passed.
- Scoped frontend TypeScript: PASS using `.validation-academic-setup-fix/tsconfig.json` (changed screen/tests and imported dependencies).
- Backend TypeScript: only the known unrelated `safety-alert.controller.ts:47 TS2322` diagnostic. No new academic diagnostics; full release TypeScript gate is not passing.
- Scoped ESLint on all four changed application/test files: PASS, no output.
- `git diff --check`: PASS, including the mixed worktree.
- SHA-256 comparison of every pre-existing dirty tracked file: unchanged. No reset, restore, clean, staging, commit, or push. Unrelated untracked files were not edited.

## Remaining gaps

The original Principal period form/save incident remains unproven until it can be observed in the running app. Current policy intentionally does not permit Principal period creation or updates. Class management is available through existing destinations and requires an active period; this review did not introduce dashboard shortcuts or expand role authority.
