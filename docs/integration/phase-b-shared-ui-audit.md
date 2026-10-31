# Phase B: shared UI audit and selective integration

Canonical `src/components/hiraDashboard` and `src/theme/hiraDashboard` remain the presentation foundation. No donor tree was merged. This phase integrates one missing reusable control and removes the separate Phase A preview palette. Student/Parent/Finance remain development-only sample adapters.

## Component decision matrix

Donor paths below are relative to `faraz-audit:src/mobileApp/`. References were inspected using `git show`, without checkout or merge. Decisions apply to this phase, not to future feature approval.

| Donor component/pattern | Purpose | Canonical equivalent | Decision | Target file | Reason |
| --- | --- | --- | --- | --- | --- |
| `shared/components/PageIcon.jsx` | Named raster icon registry/aliases | Existing glyphs in ListRow/QuickActions/StatCard | REJECT | None | No selected reusable component requires an image; avoid a 44-image registry and domain page aliases without consumers. |
| `shared/components/SchoolPageHero.jsx` | Title/subtitle, icon and school illustration | HeroBanner, ScreenHeading | REUSE CANONICAL | `src/devPreview/PreviewUI.tsx` | Existing hero satisfies preview needs. No new hero or illustration import. |
| `SchoolReferenceUI.jsx: SchoolPanel` | Titled panel | Card, SectionCard | DUPLICATE | `src/devPreview/PreviewUI.tsx` | PreviewCard now wraps SectionCard; no donor panel copied. |
| `SchoolReferenceUI.jsx: SchoolBadge` | Status pill | StatusBadge, ui/HiraUI StatusPill | REUSE CANONICAL | Existing badge components | Preserve existing status semantics; no new generic status model. |
| `SchoolReferenceUI.jsx: SchoolRow` | Record/action row | ListRow | REUSE CANONICAL | Existing ListRow.tsx | Already supports title, subtitle, icon, tag/right content and callback. No new row needed. |
| `SchoolReferenceUI.jsx: SchoolMetric` | Summary metric tile | StatCard, StatGrid | DUPLICATE | Existing StatCard.tsx | No additional stat implementation or financial calculations needed. |
| `SchoolReferenceUI.jsx: SchoolQuickActions` | Shortcut row | QuickActions | DUPLICATE | Existing QuickActions.tsx | Existing label/icon/callback contract suffices. |
| `SchoolReferenceUI.jsx: schoolColors/schoolStyles` | Palette, page spacing, typography | theme/hiraDashboard and DashboardShell | REUSE CANONICAL | `src/devPreview/PreviewUI.tsx` | Remove Phase A hardcoded palette; retain only token-based record-line spacing. |
| `shared/home/HiraHome.jsx: hero/copy/layout` | Role home composition | HeroBanner, DashboardShell | REUSE CANONICAL | `src/devPreview/PreviewUI.tsx` | Retain already selected fictional copy while using canonical composition. |
| `HiraHome.jsx: Action` | Primary/secondary action | Button | DUPLICATE | `src/devPreview/DeveloperPreview.tsx` | Launcher/exit/back now use canonical Button, including accessibility label. |
| `HiraHome.jsx: fetching/session/sample branches` | Connected role home orchestration | Canonical authenticated services | REJECT | None | Business logic, computed attendance/finance state and network effects are outside reusable presentation scope. |
| `theme/hiraTheme.js` | Theme and role page registry | theme/hiraDashboard tokens | REJECT | Existing canonical theme | Donor theme imports featureScreens and mixes navigation registry with styling; no second theme. |
| `roles/student/StudentDashboard.jsx: Section/Record/ProfileCard` | Sections, record cards, identity display | SectionCard, ScreenHeading | REUSE CANONICAL | `src/devPreview/PreviewUI.tsx` | Keep lightweight preview identity/records; no profile-based placement authority. |
| `roles/student/StudentDashboard.jsx: forms/uploads/loaders` | Submission/application operations | Existing canonical flows | REJECT | None | Imports studentService and document picker; no domain integration in Phase B. |
| `roles/parent/ParentDashboard.jsx: DataCard/Section/Empty` | Child record cards and states | SectionCard, DashboardStateCard, text within Card | REUSE CANONICAL | `src/devPreview/PreviewUI.tsx` | Existing primitives suffice; no redundant state component. |
| `roles/parent/ParentDashboard.jsx: child resources/forms/actions` | Parent data operations | Future canonical enrollment-scoped integration | REJECT | None | parentService, linked resources and application logic are outside Phase B. |
| `roles/finance/FinanceDashboard.jsx: Card/Button/SectionTitle` | Financial dashboard presentation | Card, Button, ScreenHeading, SectionCard | DUPLICATE | Existing canonical components | No new primitives needed. |
| `roles/finance/FinanceDashboard.jsx: Chip/TABS` and Phase A PreviewTabs | Controlled content selection | Inline tabs exist in canonical screens, but no exported reusable control | ADAPT INTO CANONICAL | `src/components/hiraDashboard/WorkspaceTabs.tsx` | Small stateless token-based pill tabs; named tablist, labeled tabs and selected state. No finance tab registry or business logic imported. |
| `roles/finance/FinanceDashboard.jsx: services/auth/payment/upload handlers` | Finance business workflows | Future canonical finance integration | REJECT | None | No API_ROOT, getAuthHeaders, financeApi, picker, payment or receipt logic imported. |
| Donor loading/error/empty patterns | Explain data states | DashboardStateCard; existing Card/Text and screen state patterns | REUSE CANONICAL | Existing DashboardShell.tsx | No additional state abstraction required by the selected surface. |

There are no MERGE SAFE whole-file imports in this phase: equivalent canonical primitives already exist, and the missing tab control is a typed adaptation.

## Canonical inventory and actual changes

Inspected the existing `src/components/`, `src/components/ui/`, `src/components/hiraDashboard/` and `src/theme/` inventory. HiraUI provides headers/status pills/buttons; hiraDashboard provides Button, Card, SectionCard, HeroBanner, StatCard/StatGrid, ListRow, QuickActions, ScreenHeading/DemoNote, DashboardShell/DashboardStateCard and AdminForm helpers. Dashboard theme tokens already define colors, spacing, radius, typography and shadows. Existing screen-owned tabs remain untouched; migrating all staff screens is outside this task.

The preview shared wrappers now consume DashboardShell, HeroBanner, SectionCard and WorkspaceTabs. The launcher uses Button and canonical tokens. No existing theme was redesigned, and no canonical navigator, auth provider, API client, backend contract or fictional fixture changed.

Files added:

- `src/components/hiraDashboard/WorkspaceTabs.tsx`
- `__tests__/workspace-tabs.test.tsx`
- `docs/integration/phase-b-shared-ui-audit.md`

Files modified:

- `src/components/hiraDashboard/index.ts`
- `src/devPreview/PreviewUI.tsx`
- `src/devPreview/DeveloperPreview.tsx`

Dependency changes: none. Asset/native configuration changes: none.

## Asset audit

All 44 donor icon files have valid PNG signatures, 192×192 dimensions and consistent lowercase/kebab-case names. Each is registered by PageIcon. The table records direct literal `name="..."` use in donor source; registry/alias-only does not prove an icon is unused at runtime because the donor also resolves dynamic page names. No icon has a selected Phase B consumer, so none is imported or visually approved for use here. Existing canonical glyphs are sufficient for this scope.

Donor `src/mobileApp/assets/school-art.webp` is byte-identical to canonical `src/assets/images/school-art.webp` (Git blob `4a125823087e754fc582ba9c9ddf41db0b9a4fcd`): DUPLICATE, no import. The selected canonical hero requires no artwork. No screenshots, device/login images, debug artifacts, command-like files or empty files are imported. No zero-byte files were found in the inspected donor `src/mobileApp` tree.

| Donor icon under shared/components/assets/icons | Dimensions | Files with direct literal use | Decision |
| --- | --- | --- | --- |
| bell.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| book.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| bus.png | 192×192 | 2 | REJECT for Phase B: no selected consumer |
| calendar-check.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| calendar.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| card.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| chart.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| check.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| chevron-down.png | 192×192 | 2 | REJECT for Phase B: no selected consumer |
| chevron.png | 192×192 | 5 | REJECT for Phase B: no selected consumer |
| clipboard.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| clock.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| close.png | 192×192 | 2 | REJECT for Phase B: no selected consumer |
| download.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| file-pen.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| file.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| folder.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| graduation.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| help.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| home.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| homework.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| inbox.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| logout.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| menu.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| message.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| more.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| notes.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| party.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| pin.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| play.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| receipt.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| refresh.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| scan.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| school.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| search.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| settings.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| shield.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| sparkle.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| star.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| target.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| trophy.png | 192×192 | Registry/alias only; no direct literal | REJECT for Phase B: no selected consumer |
| users.png | 192×192 | 2 | REJECT for Phase B: no selected consumer |
| video.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |
| wallet.png | 192×192 | 1 | REJECT for Phase B: no selected consumer |

## Validation and preview regression

- Jest: **8 suites passed; 70 tests passed, 0 failed**. Includes three focused WorkspaceTabs tests, all 11 Phase A preview tests, canonical Teacher/academic/timetable navigation, auth-session, Principal attendance and substitution suites. No existing assertions were changed.
- Shared-control tests cover rendering/accessibility labels, selected/unselected state, controlled callbacks/re-render and empty options.
- Preview tests preserve all six destinations, fictional labels/data, no network calls from sample adapters, real user/token authority, logout isolation and production exclusion. Canonical destination selection uses mocked navigator components in those preview tests; device runtime navigation is not newly claimed.
- Mobile sources and frontend tests TypeScript: **PASS**, zero diagnostics.
- Root TypeScript: **85 diagnostics**, also present on the unchanged HEAD baseline; virtual-source comparison reports **zero introduced diagnostics**. No unrelated backend type repair was attempted.
- Scoped ESLint: **PASS**, zero errors/warnings.
- `git diff --check`: **PASS**.
- Android build: not rerun because no native assets, dependencies or configuration changed.

The baseline comparison substituted HEAD versions of each modified tracked TypeScript file and excluded the new control/test from baseline roots, without changing the working tree. Local validation logs/scripts stay within the already excluded `.validation-principal-audit/phase-b/` directory.

No auth/service/domain/store/payment/chat/backend/navigation replacement was integrated. No dependency or ignore-rule changes were made. This phase authorizes a single local focused commit, with no push or Student backend integration.
