# AS-PR3 final closure review

Branch: `feture`. HEAD and origin/feture: `69c3f29aa70d7e0c170688cb52f576b3266cb387`. No staging, commit, push, reset, restore, unrelated cleanup or production migration was performed.

The implementation report was verified against source, routing, indexes, actual tests and pre-AS-PR3 hashes. Closure tightened status/date consistency and imported-invalid-state handling, completed the operation/parent race matrix, strengthened transfer/promotion races to use different targets, and added narrow readmission/retry/UI proofs. All edits remain inside the original 25 feature files.

**A. Student/Enrollment architecture — PASS.** Student remains one permanent identity/profile across years. StudentEnrollment owns immutable Student/Branch/period/Class/Section membership, lifecycle, intervals and predecessor. Transfer/promotion/readmission create new membership records, never another Student identity. Retry receipts are separate operational records.

**B. Current Enrollment authority — PASS, strengthened during closure.** Current means the exact Branch-owned active enrollment with a valid Date effectiveFrom no later than server now and no effectiveTo. Query and aggregate readers now use that same semantic predicate; a future start, missing start or ended-active import cannot count as current. MongoDB reserves one status-active row globally per Student and one per Student/period, including malformed imported reservations, so filtering corrupt data cannot permit a second active row. Principal detail returns a controlled 409 requiring administrator review for inconsistent status-active data. Model document validation rejects future starts, active records with end dates, closed records without ends, and backwards intervals. Every supported lifecycle close validates the composed document before the conditional update. Native database administration can bypass model validation, as with other project models; focused corruption tests prove current readers and operational writes fail closed rather than reviving legacy snapshots. Historical effective intervals remain distinct from the current predicate.

**C. Legacy Student compatibility — PASS with explicit transitional policy.** Student.classId/sectionId remain controlled compatibility projections for managed Students. Forging those fields cannot change managed membership or restore withdrawn eligibility. For Students with zero enrollment records, the existing snapshot predicate remains a deliberate compatibility fallback for rosters/new audiences; it is not presented as authoritative enrollment in the admin UI. This exception is justified by preserving existing installations during explicit migration: there is no unrestricted HTTP placement editor, new trusted admission creates an enrollment atomically, and fallback permanently ends for each Student once any enrollment history exists. Candidate-lock queries still use projections only to acquire fences; final eligibility is resolved from enrollment and drift fails closed. Installation-wide enrollment authority requires the rollout in Z, not merely deploying this PR.

**D. Principal branch security — PASS.** All routes require registered-session authentication, current active DB role, explicit narrow permission and Principal/global Super Admin role middleware. Principal Branch comes from DB User.branchId. Scope revalidation inside the transaction follows Branch/User/Session/Student/Student-User fences. Student and identity, period, Class and Section must match the exact Branch; Class/period and Section/Class relationships are checked. Foreign branch queries, body authority injection, foreign Student/period/Class/Section, mismatched relationships and guessed enrollment IDs fail closed. Closure additionally tests foreign lifecycle targets and withdrawal branch manipulation. No branch escape found.

**E. Initial enrollment — PASS.** Explicit eligible Student, active target period and active exact Class/Section, reason and operation identity. Conflicting membership fails; same retry replays its receipt; changed payload conflicts. Client cannot establish enrollment through Student projection fields, dates, status or actor injection. The trusted internal admission service validates a DB-authorized creator and same-Branch Student identity and records the intentional initial membership atomically; it is not exposed as a new unauthenticated admission route.

**F. Uniqueness/concurrency — PASS.** Startup establishes both partial active-membership unique indexes and the Branch/Student/actor/operation receipt index even with autoIndex disabled. API and independent model-writer tests verify database arbitration, not precheck-only safety. All lifecycle operations share the persisted Branch fence; 409 conflicts and transaction rollback prevent contradictory outcomes.

**G. Section transfer — PASS.** Same Branch, same active period, same Class, different active Section. Source remains transferred with its original tuple/interval and closing reason; successor becomes current and projection updates atomically. Same-period Class change and cross-Branch targets are explicitly rejected. Closure races use different target Sections.

**H. Promotion — PASS.** Source active membership is closed as promoted; a distinct successor belongs to a later active period and valid target Class/Section. Source period must be closed/archived. Target start date must be later; grade names/marks/attendance/AI do not infer eligibility. Principal makes the explicit operational decision. Duplicate/stale promotion conflicts; identical retry converges. Closure races use different target Classes/Sections. Old tuples, marks, receipts and fees are not moved.

**I. Withdrawal — PASS.** Closes membership with revision, reason and receipt; does not delete/deactivate Student/User or cascade-delete academic/finance records. No current transfer/promotion remains possible until valid readmission. Historical entitlements and released records retain their existing access rules.

**J. Readmission — PASS.** Only explicit enrollment after a withdrawn latest membership, into a valid active context. Creates a fresh predecessor-linked record; never flips withdrawn history back to active. Closure verifies readmission replay/payload conflict and a single current row. UI now explicitly labels the action and confirmation Readmit for managed withdrawn Students.

**K. Lifecycle race matrix — PASS.** Two separate API processes exercise both fence orderings. Distinct operation IDs compete; receipts also separately cover same-operation retries. Persisted active counts and active parents are inspected.

| Race | Safe committed outcome |
| --- | --- |
| Enrollment / Enrollment | one current enrollment; losing distinct request 409 |
| Transfer / Transfer to different Sections | one successor; losing stale request 409 |
| Promotion / Promotion to different targets | one successor; losing stale request 409 |
| Transfer / Promotion | old-period transfer cannot bypass closed-period rule; promotion wins |
| Withdrawal / Promotion | first valid lifecycle decision wins; loser 409 |
| Withdrawal / Transfer | first valid lifecycle decision wins; loser 409 |
| Section deactivation / Enrollment | enrollment first blocks deactivation; deactivation first blocks enrollment |
| Section deactivation / Transfer | transfer first blocks deactivation; deactivation first blocks target transfer |
| Section deactivation / Promotion | promotion first blocks deactivation; deactivation first blocks target promotion |
| Class deactivation / Enrollment | existing conservative Section/reference guard blocks unsafe Class deactivation |
| Class deactivation / Promotion | existing conservative Section/reference guard blocks unsafe Class deactivation |

There are 22 two-process ordering cases. Class races explicitly acknowledge that a valid target Class already contains Sections, so its stronger AS-PR1 guard may reject deactivation even before enrollment; these tests do not falsely claim to isolate only the new guard. An independent test drifts compatibility projections and proves the new active-enrollment guard's specific conflict.

**L. Multi-instance safety — PASS.** Real Branch document increments occur inside MongoDB transactions; write conflicts retry against committed state. No process-local mutex supplies correctness. User/session/reference revalidation, unique indexes, revision checks and durable actor-scoped receipts remain required. Injected successor-write failure after source closure proves rollback of source history, projections and receipt. No nontransactional fallback was introduced; supported replica-set/sharded topology remains mandatory.

**M. Class/Section lifecycle integration — PASS.** AS-PR1 deactivation checks active StudentEnrollment before its existing conservative historical-reference checks. Enrollment/transfer/promotion acquire the same Branch fence before parent validation. Initial/target Section and Class races cover both orderings; no active membership commits into a concurrently deactivated target.

**N. AcademicPeriod lifecycle — PASS.** Initial enrollment/readmission/transfer targets must be active and exact Class-owned periods. Promotion requires a closed/archived source and later active target. Closed/archived periods cannot receive ordinary new enrollment. Closing a period preserves its current/historical membership for explicit promotion/withdrawal; it does not invent automatic promotion. Historical period membership remains readable.

**O. Teacher roster — PASS.** Existing assigned Class/Section/Subject and active identity/Branch scope gates remain. Managed membership is resolved from enrollment plus Class-owned period, independent of Student projection drift. A real Teacher endpoint test now proves transfer-out disappears and transfer-in appears after projection forgery. Foreign/unassigned contexts remain concealed; historical records are accessed through their existing dedicated flows.

**P. Attendance — PASS.** New/open/draft rosters and draft amendment eligibility resolve current/effective membership. Current-day roster is live; past dates use the final school-local civil-date interval. Submitted attendance retains its roster/status/context snapshot and does not move when Student projections change. Focused effective-interval tests and real submitted-attendance reads after promotion/withdrawal pass. No historical mark is rewritten. Existing roster-review conflicts and Branch/identity fences remain covered.

**Q. Homework/Quiz — PASS with C's documented legacy transition.** New audiences use exact managed enrollment; new-Class work cannot be granted through a stale Student projection. Publication still snapshots audience and revision under existing fences. Published entitlements remain stable after transfer/promotion/withdrawal, with original release/due/attempt policy. Existing historical Quiz entitlement still permits its intended attempt; no new enrollment automatically fabricates work entitlement.

**R. Submission/Catch-up history — PASS.** Submission, review and Catch-up contexts remain pinned to original work/Student/absence references. Promotion does not re-parent or complete recovery work. Real Student work/evidence/Catch-up endpoints remain readable after lifecycle changes; persisted record comparisons and existing submission/review regressions pass.

**S. Results — PASS.** Historical Class/Subject/year, evidence/review source, marks, publication and revisions remain unchanged. New result work is authorized through the relevant immutable evidence/review context, rather than a Student's mutable current Class. Real published-result reads after promotion/withdrawal retain original marks/context. T-PR12 regressions pass.

**T. Finance — PASS.** Fee records reference permanent Student, Branch and academicYear. Enrollment writes do not edit invoices/payments/receipts or create charges. Actual partial Fee document and Branch summary survive promotion/withdrawal with the same outstanding balance. New-year billing remains separate.

**U. Student/Parent compatibility — PASS for existing scope.** Administrative enrollment routes deny Student/Teacher roles; Student academic reads remain bound to own identity, Branch and existing entitlements. No cross-Student disclosure was introduced. This repository has no Parent role/linked-child backend portal to extend or regression-test; guardian/profile fields are unchanged. No claim is made that an absent Parent integration was tested or implemented.

**V. RBAC — PASS.** Enrollment view/manage/promote/withdraw permissions are central on backend/frontend, deliberately assigned to Principal and global Super Admin, and enforced by middleware plus DB-revalidated service scope. Teacher retains scoped roster access; Student has no administration. Branch-bound Super Admin cannot acquire global enrollment governance. Server actions account for permission, Student availability, membership/source-period lifecycle and valid readmission state.

**W. API/DTO — PASS.** Only bounded list/options/history and explicit lifecycle routes; no generic placement update, delete or batch bypass. Query/body allowlists constrain authority. DTOs contain necessary names/admission, enrollment/period/Class/Section summaries, lifecycle/revision/reason and action availability. Actor IDs, tokens, locks and transaction internals remain absent. Business reason is shown as lifecycle context, not private technical audit metadata.

**X. Principal UI — PASS.** Dedicated permission-filtered Students & Enrollment drawer/stack destination; no Principal Home cards. Existing theme, cards, selectors, typography, spacing, badges and dialogs are reused. Search/status filters, pagination, current membership, separate legacy-placement note and history are displayed with human names. No raw IDs/debug view. Native-device visual QA remains unperformed; rendered behavior was verified.

**Y. Confirmation/retry UX — PASS, strengthened during closure.** Student/admission, current and target period/Class/Section, reason and operation type are explicit. Ref guards disable duplicate submission; success follows confirmed server commit. Frozen operation identity/payload supports safe network retry; 403/404/409/network errors and authoritative refresh are surfaced. Target reload now clears stale Section choices. Confirmed save plus refresh failure retains success and hides stale action data until refresh. Readmit is clearly named. New rendered tests prove these cases.

**Z. Migration/rollout — explicit prerequisite.** No ordinary read or runtime backfill creates enrollment history. Inventory Student/User Branch, Class/Section relationships and Class period authority; review ambiguous records and period-less Classes separately. Establish startup indexes on the supported transaction topology. Explicitly confirm known current baseline placements, or use a separately reviewed deterministic migration recording only verified current membership/effective date/provenance. Do not invent past years. Review open draft rosters when introducing baseline intervals; submitted/published snapshots remain intact. Complete that setup before claiming installation-wide enrollment authority; legacy zero-history snapshot compatibility remains until then. No migration was run.

**AA. Bulk promotion — DEFERRED.** No hidden bulk route or batch bypass. Preview, partial failures and bounded bulk policy remain separate work.

**AB. Cross-Branch transfer — UNSUPPORTED.** Crafted Branch/Class/Section/period targets fail closed. Same-period Class transfer is also unsupported. Only same-Class Section transfer and explicit later-period promotion are implemented.

**AC. New-year fees — DEFERRED.** New enrollment does not imply fee assignment, invoice generation or payment migration. Existing dues remain intact.

**AD. Focused backend — PASS, 58/58.** `recovery-backend-focused.log`, zero failures/skips. Adds interval consistency/import corruption, explicit Class/cross-Branch lifecycle denial, all-operation receipt replay/conflicts, real transfer roster checks and six missing race orderings; strengthens distinct-target races. Existing real historical academic/finance preservation tests remain green.

**AE. Backend regression — PASS, 518/518, zero failures/skips.** Fresh full relevant run: AS-PR1, AS-PR2, assignment administration, Syllabus, Teacher scope/roster, timetable, Attendance/amendments, Homework/Quiz, evidence/reviews, Catch-up, Results, communications and lesson delivery. Evidence: `recovery-backend-regression.log`.

**AF. Frontend — PASS.** Focused 17/17 across two suites; full 427/427 across 46 suites. Logs: `recovery-frontend-focused.log`, `recovery-frontend-full.log`. Existing Principal/Teacher navigation coverage is included.

**AG. Static validation.** Frontend scoped TypeScript PASS; all 25 changed source/test files ESLint with zero warnings PASS; `git diff --check` PASS. Backend source TypeScript retains only the known unrelated `backend/src/controllers/safety-alert.controller.ts(47,49)` TS2322 (void versus ISafetyAlert). That file and surrounding user-owned safety work are unchanged. Logs: `recovery-backend-types.log`, `recovery-frontend-types.log`, `recovery-eslint.log`, `recovery-diff-check.log`. The exact 25-path feature patch passes the final read-only git apply --cached --check; no patch was staged/applied. External model formatting is excluded.

**AH. Exact AS-PR3 files (25).** All clean AS-PR3-only relative to the original captured baseline; closure edits are confined to six of these same files. Reports/evidence are additional unstaged artifacts.

- `__tests__/principal-approval-context.test.tsx` — clean AS-PR3-only
- `__tests__/student-enrollment-service.test.ts` — clean AS-PR3-only
- `__tests__/student-enrollment.test.tsx` — clean AS-PR3-only
- `backend/src/app.ts` — clean AS-PR3-only
- `backend/src/constants/permissions.ts` — clean AS-PR3-only
- `backend/src/constants/rolePermissions.ts` — clean AS-PR3-only
- `backend/src/models/studentEnrollment.ts` — clean AS-PR3-only
- `backend/src/routes/student-enrollment.routes.ts` — clean AS-PR3-only
- `backend/src/services/academic-setup.service.ts` — clean AS-PR3-only
- `backend/src/services/academic-work.service.ts` — clean AS-PR3-only
- `backend/src/services/attendance-amendment.service.ts` — clean AS-PR3-only
- `backend/src/services/enrollment-membership.service.ts` — clean AS-PR3-only
- `backend/src/services/student-enrollment.service.ts` — clean AS-PR3-only
- `backend/src/services/student.service.ts` — clean AS-PR3-only
- `backend/src/services/teacher-attendance.service.ts` — clean AS-PR3-only
- `backend/src/services/teacher-notice.service.ts` — clean AS-PR3-only
- `backend/src/services/teacher-roster.service.ts` — clean AS-PR3-only
- `backend/tests/academic-setup.security.test.ts` — clean AS-PR3-only
- `backend/tests/student-enrollment.security.test.ts` — clean AS-PR3-only
- `backend/tests/teacher-attendance.security.test.ts` — clean AS-PR3-only
- `src/constants/permissions.ts` — clean AS-PR3-only
- `src/navigation/PrincipalNavigator.tsx` — clean AS-PR3-only
- `src/screens/principal/PrincipalWorkspaceScreen.tsx` — clean AS-PR3-only
- `src/screens/principal/StudentEnrollmentScreen.tsx` — clean AS-PR3-only
- `src/services/admin/enrollmentService.ts` — clean AS-PR3-only

**AI. Mixed files — NONE.** No feature path intersects the original dirty set. Exact mixed hunks: not applicable. `.validation-as-pr3/as-pr3-source.patch` contains the full real-path feature diff excluding unrelated hunks.

**AJ. Unrelated work preservation — PASS after authorized recovery.** The historical closure blocker was external formatting in 24 models, including six original dirty files. Three-way comparisons, trustworthy baseline reconstruction, TypeScript AST equality and emitted JavaScript AST equality proved all six baseline-to-current changes formatting-only, with no AS-PR3 semantics. Only those six working-tree files were reconstructed from their exact captured dirty baseline bytes. All 22 original dirty files now match their original SHA-256 hashes; their combined Git diff matches the original initial.patch after line-ending normalization. All 25 feature files remain byte-identical to recovery start; no mixed files. Other 18 external formatting paths remain untouched and excluded from AS-PR3. HEAD/origin unchanged and index empty. See [preservation recovery](AS-PR3-preservation-recovery.md) for exact files, proof, hashes, snapshots and fresh validation logs. The original closure report is retained in `.validation-as-pr3/recovery/closure-review-before-recovery.md`; original baseline and closure evidence were not replaced.

**AK. Deferred gaps.** Controlled migration/backdated scheduling, bulk promotion, cross-Branch/same-period Class transfer, graduation/completion, marks-based eligibility, new-year fee assignment, Parent portal integration, Super Admin enrollment UI and native-device visual QA remain explicitly outside this closure. All focused/regression/static checks have completed. No AS-PR3 correctness/security blocker was found. The original dirty-file preservation gate now passes after the authorized formatting-only recovery in AJ; no new baseline was adopted.

**AL. T-PR14 — EXCLUDED.** No Staff Self-Service/Appointments work was introduced.

**AM. Final verdict**

`READY TO COMMIT`

Fresh recovery validation: focused backend 58/58, backend regression 518/518, focused frontend 17/17, full frontend 427/427, frontend TypeScript, feature ESLint and diff checks pass. Backend TypeScript retains only the known unrelated safety-controller diagnostic. Original dirty hashes match 22/22. Nothing staged, committed or pushed.
