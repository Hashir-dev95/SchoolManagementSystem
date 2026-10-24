# Timetable Teacher selector — targeted production fix

## A. Exact root cause

Read-only inspection of the configured backend database on **22 October 2026 at 11:03:25 UTC** explains both branches. This identifies the checked-out backend's configured database; it does not establish that an already running mobile app/backend uses this same connection or this source build.

- **Main Campus:** two active Teacher accounts and two active-flag TeacherAssignments, but **both assignments expired at 2026-09-05T00:00:00.000Z**. A true `isActive` flag does not override the effective end. Neither is future-only.
- **Lydia Kinney:** zero active Teacher accounts and zero TeacherAssignments. There is no assignment to offer for any selected combination.

The eligibility filter correctly excludes these records. No fallback or assignment/date change was appropriate. The product defect was that an empty response carried no explanation, and the selector displayed only a generic eligibility message.

## B. Assignment evidence

| Branch | Teacher | Exact Class / Section / Subject | Assignment window, UTC | Other validity | Current result |
| --- | --- | --- | --- | --- | --- |
| Main Campus | Mano | Grade 7 / A / Science | 2026-08-05T00:00:00Z inclusive to 2026-09-05T00:00:00Z exclusive | Teacher active, Teacher role, same Branch; Class, Section, Subject and ClassSubject active; Section belongs to Class; AcademicPeriod active and mapping matches period | Expired |
| Main Campus | Faraz | Grade 8 / B / Science | Same window | Same checks pass | Expired |
| Lydia Kinney | None active | No assignments exist | None | No active Teacher accounts | No exact assignment |

Evidence: `.validation-timetable-teacher/configured-assignment-evidence.json`. The diagnostic script reads only; it never initializes application models, creates indexes or performs database writes. Its output excludes credentials, connection strings, emails, password hashes and raw IDs.

For Main Campus, an authorized administrator must review/revoke the expired active-flag assignment and create the correct current replacement through existing Teacher Assignment management. The unique active-tuple index intentionally requires revocation before replacement. For Lydia Kinney, configure an appropriate Teacher account and exact assignment through existing administration. This fix does not infer new dates, transfer Teachers, or create assignments.

## C. Data-path review

The canonical path already works: selected Branch → catalog Class ID → catalog Section ID → ClassSubject's canonical `subject.id` → exact eligibility request → active academic scope → exact current TeacherAssignment → active Teacher-role User in the same Branch → `{id,name}` → selector. Mapping IDs are not sent as Subject IDs.

The request waits for all required parents. Parent changes reset downstream selection. Resource generations and context matching reject late responses; failures remain failures rather than empty successes. Filtering happens before Teacher pagination, and the adapter collects all pages.

The first implementation defect found was the read DTO: `teachers: []` discarded the reason. The adapter exposed only an array, so the UI could not distinguish absent assignment, revoked assignment, future start, expired end or unavailable account. No incorrect ID, response nesting, trigger, race or authority defect was proven in this pass.

The existing options endpoint now optionally returns `teacherEligibility: {asOf, reasons}` for validated exact academic context. Only when there are no eligible Teachers, one scoped aggregation groups assignment history into reason codes. It returns no unrelated Teacher names or IDs. Multiple applicable history categories can appear. Existing Teacher filtering and writes retain their authority rules.

## D. Files changed in this pass

| File | Reason |
| --- | --- |
| `src/screens/admin/TimetableAdminScreen.tsx` | Render authoritative reason messages; preserve context/race protection; add local retry and permission-gated navigation to existing `AssignTeacher` route for both roles. |
| `src/services/admin/timetableAdminService.ts` | Carry optional eligibility metadata alongside the all-page Teacher list; retain canonical requests and write payload. |
| `backend/src/services/timetable-admin.service.ts` | Add exact, authorized assignment-state diagnostics to the existing options response without changing eligibility or mutation authorization. |
| `__tests__/timetable-admin.test.tsx` | Diagnostic states, parent prerequisites, loading/failure/retry, canonical Teacher selection and existing assignment navigation for both roles; adapt existing race fixtures to richer result. |
| `__tests__/timetable-admin-service.test.ts` | Metadata preservation, pagination, failure propagation and safe compatibility with responses lacking diagnostics. |
| `backend/tests/teacher-timetable.security.test.ts` | Seven assignment/account-state cases, three exact-tuple mismatch cases and eligibility → draft → approval → Teacher timetable integration. |
| `docs/timetable-teacher-selector-fix.md` | This report. |

Baselines, read-only inspection script, scoped configs, JSON counts and logs were added under `.validation-timetable-teacher/`. Prior reports and validation directories were preserved.

## E. User-facing behavior

- Eligible Teacher: the canonical named Teacher appears and can be selected.
- No exact assignment: explain that no Teacher is assigned to this Class, Section and Subject, and direct the administrator to configure it before scheduling.
- Inactive/revoked assignment: identify that state rather than claiming the account is absent.
- Future assignment: explain that it has not started and that changing timetable effective dates does not change current eligibility policy.
- Expired assignment: explain that its effective window ended.
- Unavailable Teacher: explain that a current exact assignment exists but its Teacher account is unavailable in this Branch; do not leak account details.
- Loading: existing loading indicator; no no-assignment claim.
- Failure: visible load error and local **Retry eligible Teachers** action. Unauthorized errors remain distinct and sanitized.
- Empty result: **Manage Teacher Assignments** uses the existing role-owned `AssignTeacher` route. It does not duplicate forms, auto-create anything or send Branch/role authority claims. The existing form resolves its own authorized context. The draft stays in the existing timetable screen.
- Older API without diagnostic metadata: safe generic explanation; never guess that an assignment is missing.

## F. Security proof

No authorization predicate, write contract, timing check, model/index, permission or assignment policy was broadened. Persisted actor authority, Principal Branch restriction, global Super Admin policy, active AcademicPeriod/ClassSubject, exact Section relationship, active same-Branch Teacher and current exact assignment remain server-enforced. Negative fixtures reject forged/unassigned Teachers and expired/revoked/future assignments. Inactive/wrong-role Teacher identity resolution fails closed with 401; missing/mismatched assignment fails with 404. Foreign-Branch Principal requests remain 403. Publication still fences assignment revocation between read and transaction commit. Existing conflict/substitution tests pass.

## G. Integration proof

An owned ephemeral MongoDB fixture seeds active Branch, AcademicPeriod, Class, Section, Subject, ClassSubject, Teacher and an exact currently effective TeacherAssignment. The options endpoint returns the expected Teacher and no exclusion reasons. That returned canonical Teacher ID creates a draft, approval succeeds, and the authenticated Teacher timetable returns the same Class/Section/Subject and Tuesday 09:00–09:40 period under approved version 2.

Frontend tests independently exercise canonical Class → Section → Subject → expected Teacher selection, save contract and workflow. These are fixture and component proofs, not a device or production schedule publication. No production data or media was changed, and no Student/ZEGO debugging was performed.

## H. Test evidence

| Coverage | PASS | FAIL |
| --- | ---: | ---: |
| Timetable frontend screen | 40 | 0 |
| Timetable frontend service | 7 | 0 |
| TeacherAssignment frontend screen/service | 24 | 0 |
| ClassSubject frontend screen/service | 15 | 0 |
| Teacher timetable frontend screen/service | 22 | 0 |
| Teacher Home frontend screen/service | 28 | 0 |
| **Frontend total, 10 suites** | **136** | **0** |
| Backend timetable/substitution | 81 | 0 |
| Backend TeacherAssignment administration | 20 | 0 |
| Backend Academic Foundation | 15 | 0 |
| Backend ClassSubject | 36 | 0 |
| Backend Teacher Home | 46 | 1 |
| **Backend total** | **198** | **1** |

The single backend failure is the previously established `pre-marking remains allowed but future sessions stay outside Pending`: the legacy fixture lacks current AcademicPeriod/ClassSubject setup and receives 409 instead of 200. It was reproduced with pre-change timetable code during the preceding audit (`.validation-timetable-audit/home-baseline.log`). It is unchanged in this pass; attendance was not modified to suppress it.

The diagnostic regressions were first run against the pre-fix implementation: all seven failed because the reason metadata was absent. Final timetable results are 81/81 with no skips. Early test iterations corrected assertions for existing fail-closed status codes and React Native text-node spacing; the final counts above use the final complete runs.

Scoped frontend TypeScript: PASS. Scoped backend timetable dependency graph TypeScript: PASS. Scoped ESLint for all six changed source/test files: PASS, zero warnings/errors. `git diff --check`: PASS. Full backend TypeScript reproduces only the known `safety-alert.controller.ts:47 TS2322`; that file was not changed.

Commands use `node node_modules/jest/bin/jest.js --runInBand --testTimeout=20000` for the ten named frontend suites; `node --import tsx --test tests/teacher-timetable.security.test.ts` for timetable; and `node --import tsx --test --test-concurrency=1` for the four named backend regression suites. Detailed counts and exact paths are retained in `test-counts.json`, `frontend-results.json` and the test logs.

## I. Remaining policy gap

Future-only assignment planning remains unsupported: eligibility uses server current time, not the proposed timetable version's effective dates. This is explicit in the new future-assignment message. It is **not the cause in the configured two-Branch data**. No future-term model was introduced.

An administrator still needs to configure valid current assignments before these branches can offer a Teacher. The running app's deployment/database binding and physical-device rendering were not verified here. Both updated backend and frontend must be running to obtain the precise new diagnostics.

## J. Worktree preservation

Branch remains `feture`. Snapshot contained 88 pre-existing dirty/source/report files. SHA-256 checks confirm all **82 files outside the six intentionally extended files** are unchanged. Previous targeted-file contents are preserved in the new validation directory. Git index remains empty.

No reset, restore, clean, staging, commit or push. No database writes. Unrelated dirty patches and prior validation artifacts preserved. No Student/StudentEnrollment, Live Lesson authority, ZEGO, recording, R2, attendance or safety source changed in this pass.
