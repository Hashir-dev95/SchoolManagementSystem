# AS-PR3 preservation recovery

**A–D. Six affected files and classification.** Every path below is under `backend/src/models/`. Every baseline-to-current difference is formatting-only; none introduces AS-PR3 semantics, user semantic changes, or uncertain changes. No fields, validators, indexes, defaults, types, hooks, exports, or runtime behavior change. The responsible tool/person cannot be established from content; the changes are consistent with external formatting.

| File | Baseline-to-current changes | Formatting-only | AS-PR3 semantics |
| --- | --- | --- | --- |
| `approvalRequest.ts` | Line-ending normalization only | Yes | None |
| `schoolClass.ts` | Object spacing and line wrapping | Yes | None |
| `schoolNotice.ts` | Object spacing, line wrapping, redundant literal-type parentheses | Yes | None |
| `section.ts` | Object spacing | Yes | None |
| `student.ts` | Line-ending normalization only | Yes | None |
| `subject.ts` | Object spacing | Yes | None |

**E. Proof and recovery.** HEAD, original dirty baseline, and pre-recovery current bytes are captured separately under `.validation-as-pr3/recovery/backend/src/models/`, together with both three-way textual comparisons. Reconstructing each baseline UTF-8 buffer reproduces its original saved SHA-256 exactly; each also matches closure-start hash evidence. All six parse without diagnostics. TypeScript syntax trees compare equal after ignoring trivia and redundant type parentheses; emitted JavaScript syntax trees also compare equal. Raw emitted text still differs in line wrapping for two files; no raw emitted-byte equality is claimed. Visual diff inspection confirms the table classifications. ApprovalRequest and Student differ only in line endings (Git's normalized diff is empty).

All six checks passed before any source write. A guarded byte write copied only the verified original dirty baseline buffer into each working-tree path, retaining pre-recovery snapshots. No Git restore/reset/clean or index mutation was used. Original baseline/evidence was retained rather than replaced. Full hashes and comparisons: `recovery/analysis.json`.

**F. Original dirty preservation: 22/22 PASS.** Each current SHA-256 equals its pre-AS-PR3 baseline. All 22 still have their original unstaged modified status. Their combined current Git diff exactly equals the captured `initial.patch` after line-ending normalization; their original work relative to HEAD remains intact. Evidence: `recovery/verification.json`, `recovery/user-diff-verification.json`, `recovery/original-dirty-status.json`.

Six repaired files appear above. The other 16 were already byte-identical and remain untouched:

- `.gitignore`
- `backend/src/controllers/principal-task.controller.ts`
- `backend/src/controllers/school-notice.controller.ts`
- `backend/src/middleware/permission.middleware.ts`
- `backend/src/models/attendance.ts`
- `backend/src/models/safetyAlert.ts`
- `backend/src/models/session.ts`
- `backend/src/models/teacherAssignment.ts`
- `backend/src/services/safety-alert.service.ts`
- `backend/src/services/teacher-work.service.ts`
- `blueprint`
- `src/navigation/SuperAdminNavigator.tsx`
- `src/screens/principal/PrincipalDashboardScreen.tsx`
- `src/screens/superAdmin/SuperAdminDashboardScreen.tsx`
- `src/services/admin/adminService.ts`
- `src/services/api/apiClient.ts`

**G. Feature boundary: PASS.** Exactly the same 25 feature paths listed in closure AH and `feature-files.json`; all feature hashes remain unchanged from recovery start. No mixed AS-PR3 files. Across all tracked source paths plus new feature files, only the authorized six paths changed during recovery. The other 18 external model-formatting paths recorded by closure remain untouched, outside AS-PR3. Recovery documentation/evidence is additional unstaged material.

**H. Fresh backend reruns: PASS.** Focused 58/58; shared-model backend regressions 518/518. Both have zero failures/skips. Logs: `recovery-backend-focused.log`, `recovery-backend-regression.log`.

**I. Fresh frontend reruns: PASS.** Focused 17/17, two suites; full 427/427, 46 suites. Logs: `recovery-frontend-focused.log`, `recovery-frontend-full.log`.

**J. Fresh static validation.** Frontend TypeScript PASS; ESLint on all 25 feature paths PASS with zero warnings; `git diff --check` PASS. Backend TypeScript retains only the known unrelated safety-alert.controller.ts(47,49) TS2322 (void versus ISafetyAlert). Logs: `recovery-frontend-types.log`, `recovery-backend-types.log`, `recovery-eslint.log`, `recovery-diff-check.log`.

**K. User work and repository state.** Original 22 dirty files and all 25 feature hashes verified again after testing; all other tracked source bytes match recovery start. Index empty; HEAD and origin/feture remain at `69c3f29aa70d7e0c170688cb52f576b3266cb387` on `feture`. No staging, commit, push, feature implementation, or T-PR14 work performed. Unrelated untracked work was not modified; no retrospective byte proof for entire untracked directories is claimed.

**L. Final verdict**

`READY TO COMMIT`
