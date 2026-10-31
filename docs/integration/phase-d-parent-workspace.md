# Phase D: verified-child Parent read workspace

## Authority map recorded before implementation

| Domain | Canonical source inspected | Phase D decision |
| --- | --- | --- |
| Parent identity | User roles currently SA/Principal/Teacher/Student; AuthProvider/JWT/session are canonical | Add Parent to canonical role vocabulary, no second identity/session store |
| Parent-child link | No link model/API exists; Student.guardianName/guardianPhone are contact fields only | Add ONE ParentStudentLink model with explicit verification/activity and creation/approval metadata; never derive access from contacts or donor child lists |
| Student identity/placement | Student.userId; strict Phase C StudentEnrollment/Branch/Class/Section/AcademicPeriod resolution | Reuse strict resolution after proving Parent-child link |
| Timetable/physical attendance | Phase C occurrence reader plus operational timetable, substitution and effective attendance services | Share trusted-context read functions; never forge a Student JWT or change Parent role |
| Academic work | Canonical AcademicWorkAudience and published Homework/Quiz DTO readers | Reuse safe recipient projection after strict linked-child scope; metadata only, no submissions/answers |
| Results | AcademicResult canonical publication/revision/recipient/membership predicate and safe DTO | Reuse predicate/DTO with verified child; require explicit matching publication revision for Parent |
| Fees | Only branch-level fee summary, no canonical child ledger/payment contract | Fees integration pending canonical Finance phase |
| Production navigation | No Parent navigator/screens/services; Student/staff navigators already owned canonically | Add minimal Parent navigator and root role case, retaining one AuthProvider/NavigationContainer |

This is the existing single-school deployment/database model; Branch is the within-deployment scope. No School entity/tenant architecture is invented. Parent and linked child must share a valid persisted Branch, and the relationship and enrollment must agree with it.

Parent account/link provisioning UI is outside the read MVP. Trusted administration must provision canonical Parent Users and explicitly verified relationship records with approval metadata. There is no public role selection, self-link, automatic email/phone matching or client-supplied verification. The existing registration contract remains Student-only.

## Donor reference decisions

Inspected `faraz-audit:src/mobileApp/roles/parent/` including ParentDashboard, ParentChildrenPage, ParentWorkspaceUI, parentService and the secondary page inventory, plus shared previewData and HiraHome. ADAPT NOW: verified-child chooser, visible Branch/Class/Section context, child profile/enrollment, daily timetable/physical attendance, published assigned-work/results panes. DUPLICATE: donor cards/buttons/hero/theme, replaced by canonical Hira primitives. LATER: applications, chat, transport, resources, documents and payment execution. REJECT: donor authService/authSession/sessionStorage/apiConfig, AppNavigator/server runtime, contact/profile placement authority, stored unverified child lists, legacy timetable/attendance/results and donor balance/payment calculations. Production never imports preview data; Phase A Parent preview remains unchanged.

## Implemented Parent authority

`User.role = parent` is part of the canonical User role vocabulary. Parent has an empty general permission list and receives no Student/staff grants. Existing registration still creates Student accounts only; canonical login/session/revocation and AuthProvider are unchanged.

`backend/src/models/parentStudentLink.ts` is the sole relationship store. It contains parentUserId, studentId, branchId, relationship (mother/father/guardian), pending/verified/revoked status, isActive, createdBy, verifiedBy/verifiedAt, revokedBy/revokedAt and timestamps. It declares unique parentUserId + studentId identity. Verified links require independent approval metadata; reads additionally require creation metadata, a non-future verification date and a real active verifying Principal in the same Branch or unscoped Super Admin. Parent cannot verify their own link. Revocation/activity/status is authoritative. No public endpoint creates or changes these records.

`parent-scope.service.ts` reloads the persisted Parent and active Branch, verifies the exact link to the requested Student, validates the Student account, and resolves the strict Phase C enrollment scope. Link, Parent, child, enrollment and every Class/Section/AcademicPeriod reference must agree with the Branch. Missing/future/ambiguous/inconsistent membership fails closed; no guardian contact or profile placement fallback. Different-Branch children require a future explicit policy; they are not implicitly authorized by this MVP. Invalid linked records are omitted from the verified-child list, and direct child requests are 403.

Every child route validates the relationship before its domain read and revalidates it before responding. IDs only identify the requested child. The safe selector DTO includes Student ID, name, admission number, relationship and full enrollment context (Branch/Class/Section/AcademicPeriod/status). Parent identity/session is never replaced by the Student; internal read functions receive an already-authorized Student context instead of a fabricated Student JWT.

## API and canonical domain reuse

All are read-only, Cache-Control no-store, canonical authenticated Parent routes:

- GET `/api/parent/me`
- GET `/api/parent/me/children`
- GET `/api/parent/me/children/:studentId`
- GET `/api/parent/me/children/:studentId/enrollment`
- GET `/api/parent/me/children/:studentId/timetable` (optional validated date)
- GET `/api/parent/me/children/:studentId/attendance` (optional validated date)
- GET `/api/parent/me/children/:studentId/homework`
- GET `/api/parent/me/children/:studentId/quizzes`
- GET `/api/parent/me/children/:studentId/results`

Other scope selectors/query/body fields and unsupported Parent operations are 403. Canonical missing/invalid/revoked/inactive-session semantics remain 401.

Strict Student scope resolution was factored into an internal reader shared with Phase C. Timetable and physical attendance reuse the same occurrence functions, operational winning-version selection, exact-date approved substitution overlay, submitted roster/revision and effective attendance-correction projection. Only the verified child's physical mark is returned; draft/unmarked records remain non-final, with no participation or recording-completion metric.

Academic work shares the canonical safe recipient projection and Phase C current-enrollment/audience/own-Student/published-revision filter. Parent receives title/instructions/date metadata only, never quiz questions/answers, submissions or write controls. The original Student API authority checks remain in place.

Results share the canonical recipient/membership/publication filter and safe Student DTO/released feedback projection. Parent additionally requires a positive publishedRevision equal to currentRevision. Legacy published rows lacking explicit revision metadata remain outside this new Parent contract rather than guessing publication authority. Canonical Student compatibility behavior is preserved. Draft, pending, approved-but-unpublished marks, private Teacher notes and moderation history are never exposed.

## Frontend and MVP status

`AppNavigator → ParentNavigator → ParentWorkspaceScreen → parentService → canonical Parent API` uses the existing single root AuthProvider/NavigationContainer. AppNavigator only adds the Parent role case. Parent UI reuses DashboardShell, HeroBanner, SectionCard, WorkspaceTabs, DashboardStateCard and Button with canonical tokens.

| MVP feature | Status | Boundary |
| --- | --- | --- |
| Child list | INTEGRATED | Existing administratively verified Parent accounts/links; safe Branch/enrollment DTO |
| Child switch | INTEGRATED | Only server-listed verified children; private pane remounted per child |
| Enrollment | INTEGRATED | Strict current canonical membership |
| Timetable | INTEGRATED | Today's canonical effective occurrences; no weekly/retired-history UI |
| Attendance | INTEGRATED | Today's own submitted/effective physical attendance; no combined metric |
| Homework | INTEGRATED | Safe published assigned read-only information |
| Quiz | INTEGRATED | Safe available published metadata/instructions; no attempts/answers |
| Results | INTEGRATED | Explicitly revisioned canonical published results and released feedback |
| Fees | BLOCKED | Fees integration pending canonical Finance phase |

Loading, no verified children, empty records, 403, expired session, network error and retry are explicit. Child/pane/session switches invalidate late responses; changing Parent identity remounts private state. Refresh re-fetches the verified-child list. No preview-data fallback or production fictional balance exists. Canonical logout is used. Account/link administrative provisioning UI is a prerequisite outside this read MVP; no automated verification or matching was introduced.

The Phase A Parent fictional preview remains unchanged and development-only. Student/staff navigators and Student frontend remain unchanged. Only necessary shared backend read boundaries were factored; no domain models were replaced.

## Security and validation evidence

- **32 Parent backend security tests passed**: scope/identity/verified-child list and selection (14), timetable/attendance (6), academic/publication (12). Positive coverage includes multi-child selection, Branch-preserving DTOs, current enrollment, effective substitution, own physical marks, published homework/quiz metadata and published results.
- Denials cover an actually verified Parent B child (B succeeds, A receives 403), valid foreign IDs, unverified/inactive/revoked links, missing creation/approval metadata, self/non-administrative verification, inactive Parent, Student role misuse, Branch mismatch, missing/inconsistent enrollment, query/body tampering, draft/non-final attendance, unauthorized/draft/revision-mismatched homework, draft/pending/approved-but-unpublished results, foreign recipient results, missing/mismatched publication revisions and Parent submission/attempt/self-link operations. Answer keys/private Teacher/moderation data are excluded. Parent result reads still work without the child's session; the real Parent session stays Parent.
- Full backend regression: **338 passed, 0 failed**, 11 test files using the repository's tsx/node:test security runner and isolated ephemeral MongoDB replica sets. Includes all Parent/Student security files, canonical academic-work/results, Teacher timetable, Principal attendance and bootstrap/auth tests. The final strengthened Parent-only recheck also passed all 32 tests. No production database was used.
- Frontend Jest: **111 passed, 0 failed**, 12 suites, including 23 new Parent tests plus Phase C Student, staff navigation, Principal attendance/substitutions, auth-session, shared tabs and Developer Preview. Parent coverage includes one root container/routing, verified child switching, all panes, empty/error/403/401/retry, safe published results, fees blocker, stale-response/session isolation, read-only service paths and canonical logout. No physical-device runtime smoke test is newly claimed.
- Backend source TypeScript: PASS, zero diagnostics. Mobile source/frontend-test TypeScript: PASS, zero diagnostics.
- Root TypeScript baseline comparison against pre-Phase-D `14f6d9ed8bb04136bb10e46095d490472c09e8c4`: 85 existing diagnostics before and after, zero introduced. No unrelated diagnostic repair.
- Scoped ESLint: PASS, zero errors/warnings. `git diff --check`: PASS.
- No dependencies, native assets/config or lockfiles changed; no Android native rebuild was required/run.

Local validation logs/configs/scripts and donor dependency inventory are under the already excluded `.validation-principal-audit/phase-d/`. Local commits separate scope, occurrence reads, academic reads and the Parent frontend/report. Explicit staging only; no reset/clean, branch switch, bulk merge or push. Finance, chat and applications integration are not started.
