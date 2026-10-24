# P-PR3 — Student admission and permanent profile closure

Workspace: `D:\SchoolManagementSystem`; branch: `feture`. Implementation/re-audit date: 24 October 2026. This report describes incremental changes to the mixed worktree after P-PR1/P-PR2.

## A. Verdict

**P-PR3 COMPLETE — STUDENT ADMISSION AND PROFILE CLOSED**

Principal can open Student Administration, add a Student with an explicit login account and initial placement, review/confirm, receive Hira success feedback, open the permanent profile, edit supported permanent fields, and use existing enrollment/history actions. The operation is server-scoped, transactional and protected against commit-time authority loss.

Validation: **830 backend tests PASS / 0 FAIL** and **130 frontend tests PASS / 0 FAIL**, no skips. Full backend TypeScript, dedicated new-backend-test TypeScript, scoped frontend/application/test TypeScript, scoped ESLint and whitespace checks pass. This is implementation/test/component-review closure; it is not a claim of production deployment or physical-device certification.

## B. Existing architecture reused

- **User:** required login identity. Existing Student reads resolve the Student's User; Student.userId is required and unique. User requires name, unique email and password. Admission therefore creates an actual Student-role account, not a fake placeholder or privileged account.
- **Student:** permanent school identity. Reused admission number, birth date, gender, guardian name/phone and address; name and Student phone remain on User. No new Student model/schema was introduced.
- **StudentEnrollment:** current academic placement and chronological lifecycle. Its active-membership uniqueness and existing enrollment operation journal remain authoritative.

The existing internal `createStudent` service already creates Student plus initial enrollment and validates active period-backed Class/Section relationships. It now accepts an explicitly active caller-owned transaction. Its default internal provisioning/publication transaction remains unchanged for existing callers. The external-authority option is server-only, requires an active transaction, and is never accepted from the HTTP body.

Existing required Student.classId/sectionId fields remain compatibility projections. They are not exposed as editable permanent identity fields; managed membership readers still resolve StudentEnrollment. A new academic year does not recreate User or Student.

Reused `createUser`/bcrypt hashing, the existing provisioning field validator (`teacherAccountBody`, a pure name/email/password/Branch validator), `enrollmentTarget`, `enrollmentDTO`, `enrollmentOptions`, current list/history APIs, `EnrollmentOperation`, and P-PR1's `withPrincipalWriteAuthority`. Reusing the validator does not grant Teacher provisioning authority or invoke Teacher creation.

## C. Final data flow

```text
Principal drawer → Student Administration → Students & Enrollment
  → Add Student → grouped Hira form → canonical active Period/Class/Section
  → Review admission → authenticated studentAdminService/apiClient
  → POST /api/students/admissions
  → persisted Principal + existing permissions + active own Branch
  → one transaction: User + Student + initial StudentEnrollment + operation record
  → Branch/User/Session fences + final permission checks → commit
  → explicit safe DTO → Hira success dialog
  → View Student: refresh list + load profile + canonical enrollment/history
```

Focused new endpoints on the existing Students router:

| Endpoint | Contract |
| --- | --- |
| POST `/api/students/admissions` | Principal admission; required account/profile/placement/operation fields; 201 for confirmed create or safe replay |
| GET `/api/students/:studentId/profile` | Explicit permanent `student` DTO and server `capabilities` |
| PATCH `/api/students/:studentId/profile` | Permanent fields plus required revision; no placement/account-authority fields |

Existing list/search, enrollment options, enrollment detail/history and lifecycle endpoints retain their contracts. No giant combined “do everything” resource or direct frontend database write was added. Responses retain the router's no-store policy.

## D. Admission architecture

1. Reject unknown payload/query fields. Branch, actor, role, User association and active-state authority cannot come from the client.
2. Resolve persisted Principal identity and own active Branch. Check existing Student create/view and Enrollment manage/view permissions.
3. Validate supported profile fields and explicit credentials. Reuse the provisioning password policy: at least 12 characters and at most 72 UTF-8 bytes. No insecure default credentials, automatic email/SMS or password logging/response.
4. On every transaction attempt revalidate scope, including a Branch transfer during retry. Validate the selected Period/Class/Section using canonical enrollment validation in that session.
5. Create User via existing password hashing; invoke existing Student/initial-enrollment creation in the same transaction. Build the safe profile and canonical initial enrollment DTO within it.
6. Reuse the enrollment operation journal for an admission-scoped operation identity. Store only a keyed request fingerprint and a minimal admission marker/ref; never raw credentials in the journal. The existing Branch write fence serializes concurrent admission/replay checks across API instances.
7. Apply P-PR1's persisted Branch/User/Session fences and recheck all required grants before commit. A failed write, DTO preparation or authority condition rolls back all new entities and the operation record.

Indexes already established by existing startup protect global account email, unique Student/User association, Branch/admission number and one active enrollment. Admission numbers are trimmed/uppercased. Names and family contacts are not unique; siblings may share them. Duplicate number/email returns sanitized 409, never Mongo E11000 text.

The HTTP workflow intentionally provisions a new account. It does not claim or relink an existing account merely because an email matches, and accepts no arbitrary userId. Existing permanent Students use enrollment/readmission rather than another admission. Existing email conflicts are handled safely and directed back to search/correction.

An interrupted connection does not trigger an automatic second admission: the form freezes the original body/operation identity and offers a safe same-request retry or checking Students. Concurrent/repeated identical requests produce one User, one Student, one enrollment and one operation record; altered reuse is 409. Replays re-read the permanent profile rather than fabricating success locally.

## E. Student profile architecture

Profile contains full name, admission number, optional birth date/gender, guardian name/phone, Student phone and address. Account email is displayed read-only. Name/phone updates affect the linked User; the remaining fields affect Student in the same transaction. Email/password, role, Branch, userId, isActive and academic placement cannot be patched here.

Profile revision uses the existing Student `__v`, exposed as `revision`. A conditional Student update and transactional linked-User update prevent stale overwrites/partial changes. Duplicate admission edits are clean conflicts. Tests compare complete enrollment documents before/after profile edits and confirm unchanged history, including rejected races.

The canonical enrollment card/history remains separate from the permanent profile card. Current placement comes from enrollment APIs, not legacy Student projections. After enrollment actions, profile refresh also reloads the advanced Student revision, preventing a needless stale edit on the next action.

Birth date input uses Hira's existing `AdminDateField`, accepts unambiguous YYYY-MM-DD, persists the corresponding UTC-midnight Date and returns YYYY-MM-DD. Server future-date validation uses `schoolToday()`; frontend format/calendar convenience validation does not invent authority from device timezone. Enrollment effective dates retain the existing immediate-instant model.

No unsupported guardian relationship, guardian email, emergency contact, photo or additional demographic field was invented. Those are absent from the current Student domain. No schema migration or parallel permanent identity store is required.

## F. Class / Section movement policy

**Option B: same-period Class movement remains intentionally blocked.** The existing server rule allows a Section transfer only within the same active Period and Class, to a different Section. The UI now states this rule explicitly. Profile patch rejects Class/Section/Period fields outright.

Promotion remains the existing explicit action into a later active Period after the source Period is closed/archived; it preserves linked historical placements. Withdrawal ends active membership without deleting Student identity/history. Existing enrollment/readmission, reasons, revision, operation replay and history semantics remain intact. No unsupported cross-Class movement policy was inferred from an unavailable PDF or implemented by editing a projection.

## G. Security proof

| Boundary | Verified result |
| --- | --- |
| Valid Principal / own active Branch | Admission and profile update succeed |
| Foreign or missing Student IDs | Concealed 404 for profile read/edit |
| Forged Branch/role/userId/createdBy/isActive admission fields | Rejected 400; no authority derived from them |
| Anonymous / Teacher / Student / Super Admin on new Principal admission route | 401 / 403 as applicable |
| Inactive Branch | 403; no admission commit |
| Revoked session | 401; no commit |
| Principal transferred/demoted/disabled after provisional Student insert | 401/403; no new User, Student, enrollment or journal record |
| Session revoked / create or enrollment permission removed during admission | 401/403; all provisional records roll back |
| Branch deactivated during admission | 403, including driver retry; no false generic 500 or partial admission |
| Profile actor/role/session/permission/Branch loss | Denied; complete Student, linked Student User and enrollment history unchanged |
| Wrong/missing/inactive Period, Class, mismatched Section, foreign Class | Rejected by canonical validation; no partial account/profile/enrollment |
| Duplicate admission/email/profile identity | 409; no extra account or partial edit |
| Stale profile revision | 409; no overwrite |
| Profile placement/privilege fields | Rejected; cannot bypass enrollment or account authority |

The original P-PR1 helper and 70-case suite, P-PR2 Safety implementations/release fixtures, backend permission maps, and User/Student/StudentEnrollment models are byte-for-byte unchanged. Frontend constants only mirror the three already-existing Principal Student grants; no backend grant or Super Admin capability was broadened.

Safe DTOs omit passwords, tokens, session IDs, raw Mongoose internals, actor/Branch authority records and linked User IDs. Admission returns explicit `student`, `capabilities`, optional `initialEnrollment` and `replayed`; the established enrollment DTO separately supplies current placement, history and actions. No ambiguous profile classId is returned.

## H. UI / UX implementation and re-audit

- **Structure:** retains the existing Principal drawer destination and Students & Enrollment screen. Add Student is a clear primary list action. Profile, current enrollment and history are distinct sections of the existing detail experience.
- **Form:** one scrollable, grouped Hira dialog, matching existing administrative forms: Student information, guardian/contact, login account, academic placement, then explicit review. Review includes identity/contact/context without displaying the password.
- **Selectors:** canonical active Period, Classes and Sections from existing enrollment options; Class pagination and searchable Hira selectors. A Class change immediately clears Section. Request generations and unmount guards prevent old responses restoring stale options.
- **States:** loading, failed request/retry, no active Period, no Classes and no Sections are distinguished. Missing configuration offers Academic Setup navigation. Ordinary field issues stay inline; significant outcomes use existing dialogs.
- **Search/detail:** retains server name/admission-number search, filters and pagination. No unbounded client catalog scan was added. Successful creation refreshes the list; View Student opens authoritative profile/current/history. Done returns to the refreshed list.
- **Editing:** supported fields only, required revision, duplicate-submit ref lock, explicit progress, safe errors and authoritative refresh on conflict. Lost authority clears loaded permanent profile information. No optimistic success.
- **Enrollment:** retains explicit Section-transfer/promotion/withdrawal review, including current/target context and reason. Withdrawal uses existing danger styling. Successful enrollment changes get the same Hira outcome dialog and refresh profile revision/list/history.
- **Mobile:** uses existing safe-area DashboardShell, handled keyboard taps, shared scrollable dialog with constrained height/KeyboardAvoidingView, Android resize configuration, accessible labels/alerts and existing Button tap targets. Android Back from detail returns to the list; modal Back follows the shared dismissal/busy guard. Long names/contact/address wrap in existing Text styles.

Re-audit inspected the actual component hierarchy/styles and compared the reused Academic Setup/Rooms conventions. Tests cover selectors, race responses, alerts, integration and Back/list behavior. **No physical Android/iOS device or emulator visual run was performed**; no screenshots or device certification are claimed. This is an explicit validation limit, not a claim that automated tests alone prove every native-device layout.

## I. Theme reuse

Reused DashboardShell, ScreenHeading, SectionCard, Card, Button, StatusBadge, AdminDialog, AdminFeedback, AdminSelect, AdminDateField and shared formStyles/colors/typography/spacing. Added only an optional backward-compatible `closeTitle` to AdminDialog so business success can say Done rather than Cancel.

No Student theme, arbitrary color palette, component library, wizard framework, global state library, desktop-style table or alternative navigation paradigm was introduced.

## J. SweetAlert / confirmation behavior

Repository review found **no separate SweetAlert library/wrapper and no app-wide localization/translation switch**. The existing Hira custom confirmation abstraction is AdminDialog + AdminFeedback; the implementation reuses it rather than introducing a new alert system or random Alert.alert calls. New text follows the current English application convention; no existing translation mechanism is bypassed or duplicated.

| Outcome | Existing Hira behavior |
| --- | --- |
| Admission confirmed | Success dialog, named Student/placement when supplied by server, View Student primary, Done secondary |
| Duplicate admission/account | Student Already Exists or Admission Conflict dialog, safe backend message, inputs preserved |
| Permission loss | Action Not Available dialog and safe refresh guidance |
| Profile saved | Success dialog; permanent change distinguished from placement |
| Stale/duplicate profile | Conflict dialog; authoritative reload before editing again |
| Section transfer / promotion | Existing explicit current/target/reason confirmation |
| Withdrawal | Existing danger confirmation; permanent history retained |
| Existing enrollment success | Enrollment Completed dialog and refreshed canonical data |
| Network/server uncertainty | Inline retry-oriented state, no fabricated success or automatic new admission |

## K. Files changed

| File | Reason |
| --- | --- |
| [student-admin.service.ts](D:/SchoolManagementSystem/backend/src/services/student-admin.service.ts) — new | Principal admission/profile orchestration, strict bodies, permissions/scope, atomic account/profile/enrollment, operation replay, safe DTOs and profile CAS |
| [student.service.ts](D:/SchoolManagementSystem/backend/src/services/student.service.ts) | Reuse existing creation inside a caller-owned active transaction, session-consistent reads and external actor fencing; preserve default path |
| [student-enrollment.service.ts](D:/SchoolManagementSystem/backend/src/services/student-enrollment.service.ts) | Export existing enrollmentDTO only; do not duplicate or change lifecycle logic |
| [student-enrollment.routes.ts](D:/SchoolManagementSystem/backend/src/routes/student-enrollment.routes.ts) | Focused protected Principal admission/profile routes and optional success status; retain existing routes |
| [studentAdminService.ts](D:/SchoolManagementSystem/src/services/admin/studentAdminService.ts) — new | Typed authenticated admission/profile contracts |
| [StudentProfileForms.tsx](D:/SchoolManagementSystem/src/screens/principal/StudentProfileForms.tsx) — new | Hira admission/review/feedback and permanent profile/edit components |
| [StudentEnrollmentScreen.tsx](D:/SchoolManagementSystem/src/screens/principal/StudentEnrollmentScreen.tsx) | Integrate Add Student/profile, list refresh, enrollment success dialog, explicit movement policy, Back and profile-revision refresh |
| [permissions.ts](D:/SchoolManagementSystem/src/constants/permissions.ts) | Mirror existing backend Principal Student view/create/update grants for feature visibility |
| [AdminForm.tsx](D:/SchoolManagementSystem/src/components/hiraDashboard/AdminForm.tsx) | Optional closeTitle, default Cancel unchanged |
| [student-admission.security.test.ts](D:/SchoolManagementSystem/backend/tests/student-admission.security.test.ts) — new | 50 permanent admission/profile/atomicity/authority/duplicate/CAS regressions |
| [student-profile.test.tsx](D:/SchoolManagementSystem/__tests__/student-profile.test.tsx) — new | 21 form/profile/selector/alert/race/error tests |
| [student-admin-service.test.ts](D:/SchoolManagementSystem/__tests__/student-admin-service.test.ts) — new | 8 API contract/error tests |
| [student-enrollment.test.tsx](D:/SchoolManagementSystem/__tests__/student-enrollment.test.tsx) | Profile API mock for expanded detail and integrated Add Student → refresh/profile/history test; existing lifecycle assertions retained |
| [This report](D:/SchoolManagementSystem/docs/P-PR3-student-admission-profile-closure.md) — new | Architecture, security, UX re-audit, counts and preservation |

Supporting runners/configs/hash evidence/logs are validation-only under `.validation-p-pr3/`.

## L. Exact test evidence

### Backend — 18 suites

| Suite | PASS | FAIL |
| --- | ---: | ---: |
| New Student admission/profile | 50 | 0 |
| P-PR1 commit authority | 70 | 0 |
| Principal authorization | 50 | 0 |
| Principal writes / P-PR2 Safety | 53 | 0 |
| Approval authority | 47 | 0 |
| Academic Setup / Rooms | 57 | 0 |
| Academic Foundation | 15 | 0 |
| ClassSubject | 36 | 0 |
| Existing StudentEnrollment | 58 | 0 |
| TeacherAssignment | 20 | 0 |
| Timetable / substitutions | 91 | 0 |
| Teacher attendance / roster | 51 | 0 |
| Attendance amendment / Principal review | 49 | 0 |
| Academic lesson/syllabus security | 35 | 0 |
| Academic result security | 39 | 0 |
| Teacher provisioning | 28 | 0 |
| Teacher communications | 42 | 0 |
| Staff self-service / leave | 39 | 0 |
| **Total** | **830** | **0** |

### Frontend — 10 suites

| Suite | PASS | FAIL |
| --- | ---: | ---: |
| New Student profile/admission forms | 21 | 0 |
| New Student admin service | 8 | 0 |
| Student enrollment UI/integration | 16 | 0 |
| Existing enrollment service | 2 | 0 |
| Principal approval context/navigation | 8 | 0 |
| Timetable/management navigation | 7 | 0 |
| Principal tasks UI | 31 | 0 |
| Principal task service | 7 | 0 |
| Principal Safety UI | 20 | 0 |
| Principal Safety service | 10 | 0 |
| **Total** | **130** | **0** |
| **Combined unique tests** | **960** | **0** |

No skips or expected failures. Repeated verification runs are not double-counted. All tests use owned ephemeral databases/mocked frontend services, not configured school data. The new authority tests coordinate independently committed database changes after provisional inserts/updates and inspect complete persisted state.

Static results: full backend TypeScript **PASS**; dedicated new-backend-test TypeScript **PASS**; scoped frontend/application/test TypeScript **PASS**; scoped ESLint of all 13 application/test files **PASS, zero errors/warnings**; `git diff --check` **PASS**. No known unrelated failure was suppressed.

Evidence: [structured test results](D:/SchoolManagementSystem/.validation-p-pr3/final-results.json), [new backend TAP](D:/SchoolManagementSystem/.validation-p-pr3/admission-tests.log), [backend runner](D:/SchoolManagementSystem/.validation-p-pr3/run-backend.cjs), [frontend output](D:/SchoolManagementSystem/.validation-p-pr3/frontend.log), [backend compiler](D:/SchoolManagementSystem/.validation-p-pr3/backend-types.log), [frontend compiler](D:/SchoolManagementSystem/.validation-p-pr3/frontend-test-types.log), [ESLint](D:/SchoolManagementSystem/.validation-p-pr3/lint.log).

## M. Broader regression evidence

The unchanged P-PR1/P-PR2/academic backend regression set is **780 PASS / 0 FAIL**; the new 50 cases bring it to 830. Enrollment's 58-case backend suite is byte-for-byte unchanged. Existing enrollment/search/readmission/transfer/withdrawal/promotion/operation replay/history and Branch checks remain green. Canonical Room fixtures and attendance's 51 real scenarios still execute and pass; no attendance/Live Lesson conflation was introduced.

Principal route inventory and intended management entry points remain green with no navigator change. Shared dialog default behavior is preserved; existing Safety/task frontend tests pass. Full backend compilation remains green after the P-PR2 fix.

## N. Remaining Principal gaps — P-PR4 onward

- P-PR4: Result publication return queue and authoritative capability refresh.
- P-PR5: Canonical Principal attendance oversight.
- P-PR6: Substitution management UI and replacement-Teacher availability conflicts.
- P-PR7: Teacher directory, task-recipient handoffs and notice visibility.
- P-PR8: Broader navigation/state/permission presentation and granular dashboard grants.
- P-PR9: Scoped Branch reporting/audit/export.

No work on these product features was started. New Student-specific domain boundaries and device-validation limits are stated above, not hidden as completed capabilities.

## O. Worktree preservation

Verified **481 pre-existing baseline files**: **7 explicitly authorized existing files changed; 474 others remain byte-for-byte unchanged**. Six new application/test files and this report are additive. Existing mixed patches in touched files were preserved. Backend permission maps, domain models, enrollment regression suite, P-PR1 helper/suite and P-PR2 Safety/release fixtures remain unchanged.

[Preservation evidence](D:/SchoolManagementSystem/.validation-p-pr3/preservation.json) records the allowlist, branch `feture`, unchanged foundation hashes and empty index. No reset, restore, clean, staging, commit or push. No ZEGO credentials/client/media testing, recording, R2, unrelated safety, attendance implementation or P-PR4 feature changes.
