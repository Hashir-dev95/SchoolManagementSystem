# G4e-2B2-2 — Protected Evidence Backend Infrastructure

## Baseline and scope

Implemented on `feature/g4e-2b2-2-protected-evidence` from accepted baseline `a301fb867d957a26702b119ac3544b082dadfaff`. This is backend infrastructure only. It does not connect Parent Leave, Homework, school documents, helpdesk, or custody workflows, and it adds no public upload or download route.

## Exact changed files

- `backend/src/models/protectedEvidence.ts` — strict metadata schema, domain/purpose ownership binding, lifecycle and scan metadata, immutable identity, revisions, indexes.
- `backend/src/services/protected-evidence-storage.ts` — provider contract and development/test private filesystem adapter.
- `backend/src/services/protected-evidence.service.ts` — authenticated internal ingestion, domain authorization callback contract, scanning gate, digest-checked reads, deletion, and recovery.
- `backend/src/server.ts` — required evidence indexes initialized before listener startup, following existing index initialization.
- `backend/tests/protected-evidence.security.test.ts` — isolated replica-set and temporary-directory tests with synthetic files and scanner fixture.
- `docs/integration/pr-g4e2b2-2-protected-evidence.md` — this implementation report.

No dependencies, mobile files, domain integration files, permissions, routes, migrations, or production records were changed.

## Architecture and boundaries

The metadata collection stores opaque random evidence IDs and storage keys, Branch, domain, purpose, owner/resource binding, uploader, an operation fingerprint, content type, verified byte count, SHA-256 digest, lifecycle/scan state, independent revision, retention-policy reference, and deletion/recovery fields. It stores no file bytes or public URLs. Unique indexes protect evidence IDs, uploader operation IDs, and storage keys; owner and recovery indexes support scoped lookup and explicit repair.

`ProtectedEvidenceStorage` separates the provider contract from the filesystem adapter. The adapter requires an explicit absolute root and explicit `NODE_ENV=development` or `NODE_ENV=test`; unset or production mode is rejected. It also refuses roots beneath the repository's public directories (including resolved public-directory symlinks), uses opaque server-generated names, restrictive file creation modes, exclusive staging, atomic no-overwrite promotion, path containment checks, bounded reads/writes, an input idle timeout, and explicit cleanup of old staged files with a 15-minute minimum grace period. On Windows, effective access control is inherited from the configured directory's ACL; the adapter does not create or verify Windows ACL entries. Use synthetic test data only until a private production provider and deployment access controls are separately reviewed. It does not provide encryption at rest, distributed durability, backup guarantees, or cloud object storage.

The initial technical allowlist is PDF 1.x, PNG, and JPEG. Validation checks matching signatures and basic structural markers (PDF header/EOF, PNG IHDR/IEND, JPEG start/end), exact declared MIME when supplied, nonempty content, a configured size bound, an upload-stream idle timeout, and a server-calculated digest. These checks reject unsupported or obviously malformed inputs; they do not prove a file is harmless or fully conformant. Files remain private and quarantined until a scanner reports a clean result for the exact digest. Reads and scanner waits are also size/time bounded.

The scanner is an injected interface with no production implementation or default-clean behavior. Missing, failed, unavailable, unsafe, or digest-mismatched results never establish availability. Tests use a clearly synthetic scanner fixture only.

## Authorization and lifecycle

Internal calls require a current active persisted User, matching Branch, and non-revoked persisted Session whose user and role still match. Every upload/read/delete call also requires an explicit domain authorizer callback with the exact Branch, domain, purpose, owner, resource, actor, and action. Missing or denying callbacks fail closed. No built-in role grants evidence access, and the B2-1 custody verifier is not used. The callback is a contract for future domain integrations, not a substitute for implementing and reviewing those domain rules.

Lifecycle is `intent → quarantined → available` only after a clean digest-bound scan; failed validation/scanning and unavailable scanners remain unavailable. Deletion first persists `deletion_pending`; the record becomes `deleted` only after storage confirms removal. Failed deletion stays pending and can be retried. Recovery can reconcile an intent with persisted bytes, detect missing/digest-mismatched content, retry pending deletion, and remove old orphaned staging files. MongoDB and filesystem writes are not atomic together: durable intent/status and explicit recovery handle interrupted boundaries; there is no claim of cross-system transactionality. Mongo updates use status/revision compare-and-set. No automatic retention deletion is scheduled.

Retention is represented only as an immutable configuration reference; no school duration or default is invented. Safe metadata DTOs omit object keys, digests, owner IDs, retention references, scanner internals, and file content. Raw bytes are returned only by the internal read method after current-session, Branch, state/digest, and required domain callback checks. No endpoint exposes that method.

## Tests and validation

The focused suite now contains 32 tests using a one-node MongoDB replica set and isolated temporary storage. Since the original 24-test baseline, coverage was added for session revocation during staging, domain authorization revocation during scanning, session revocation after storage read, active-stage cleanup protection, promotion/recovery concurrency, deletion-authority revocation, symbolic-link targets, and concurrent duplicate replay including authority revocation during conflict resolution. The repeated-cleanup fixture represents an orphan from a prior process; maintenance recovery is verified not to authorize a scan.

Windows CMD evidence before the latest concurrency correction:

- Focused suite: **31 total, 29 passed, 1 failed, 1 skipped**, exit 1. The failure was the concurrent duplicate `state_conflict`; the symbolic-link case skipped because Windows returned `EPERM`.
- Applicable regressions: **250/250 passed**, exit 0. Both results predate the latest production-source correction and are not current verification.
- During this correction, the expanded focused suite was attempted once from `D:\SchoolManagementSystem\backend` and stopped before test discovery with `uv_os_get_passwd returned ENOMEM`; exit 1, **0 tests executed**. The final source then received an additional persisted-state validation tightening and passed the static checks below; runtime remains unverified on the final tree.

The post-correction attempt used Node.js v24.19.0 and failed in `node:os.userInfo()` from the `tsx` temporary-directory loader before any tests loaded. It does not count as a pass or fail for an individual test.

For repeatability, the focused Windows CMD command is:

```cmd
cd /d D:\SchoolManagementSystem\backend
node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\protected-evidence.security.test.ts
```

Directly affected existing suites requiring fresh post-correction execution are `tests\staff-self-service.security.test.ts`, `tests\school-custody-contract.test.ts`, `tests\school-custody-foundation.security.test.ts`, `tests\gate-foundation.security.test.ts`, `tests\pickup-authorization.security.test.ts`, and `tests\early-exit.security.test.ts`. The earlier 250/250 result is pre-correction only. Manual command:

```cmd
cd /d D:\SchoolManagementSystem\backend
node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\staff-self-service.security.test.ts tests\school-custody-contract.test.ts tests\school-custody-foundation.security.test.ts tests\gate-foundation.security.test.ts tests\pickup-authorization.security.test.ts tests\early-exit.security.test.ts
```

Backend TypeScript, rerun after hardening: `npx --no-install tsc --noEmit -p tsconfig.json` — **PASS, exit 0**.

Test TypeScript check: `npx --no-install tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node tests\protected-evidence.security.test.ts` — **PASS, exit 0**.

Strict scoped ESLint: `..\node_modules\.bin\eslint.cmd --max-warnings=0 src\models\protectedEvidence.ts src\services\protected-evidence-storage.ts src\services\protected-evidence.service.ts tests\protected-evidence.security.test.ts src\server.ts` — **PASS, exit 0**.

Focused test-source TypeScript, rerun after hardening: `npx --no-install tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node tests\protected-evidence.security.test.ts` — **PASS, exit 0**.

Strict scoped ESLint, rerun after hardening: `..\node_modules\.bin\eslint.cmd --max-warnings=0 src\models\protectedEvidence.ts src\services\protected-evidence-storage.ts src\services\protected-evidence.service.ts tests\protected-evidence.security.test.ts src\server.ts` — **PASS, exit 0**.

Whitespace checks for the current six-path scope are recorded in the targeted hardening update below. The index is empty; `backend/src/server.ts` is an unstaged modification from the existing foundation work.

## Independent acceptance review

The targeted corrections address the earlier source-supported findings as follows:

- **P1 correction:** `ingest`, authenticated replay and scan resumption re-check the persisted active User/session/Branch and the unchanged exact domain/purpose/owner/resource authorization binding after awaited staging, around metadata/promotion, after scanner/storage reads, before availability finalization, and before returning DTOs. `readAvailable` revalidates after reading and digest verification and returns no bytes after observed denial. Revoked ingestion is moved to a non-available failure state and its promoted object is deleted best-effort; recovery retries that cleanup. Maintenance recovery no longer runs a scanner or creates availability. Deletion authority is revalidated before the pending transition and before storage deletion; once physical deletion starts, metadata reconciliation completes even if authority changes during cleanup, because reporting the still-present state after bytes were removed would be incorrect.
- **P2 correction:** the filesystem adapter tracks staged keys by canonical root in a process-shared lease registry. Cleanup skips unexpired active leases, rechecks before unlink, and only deletes old unleased staging files. Ingestion refreshes its lease; promote/discard releases it. The 15-minute minimum orphan age is unchanged. Prior-process orphan files remain recoverable after restart, and repeated cleanup is safe.
- **Concurrent idempotency correction:** a duplicate replay could observe the winning request's `intent` before binary promotion, call maintenance recovery, and cause a same-status recovery update that incremented the revision. The winner's intent→quarantined CAS then lost and surfaced `state_conflict`. When an intent object's bytes are still missing, recovery now leaves its state and revision untouched. The concurrent duplicate re-reads the canonical record, verifies the payload fingerprint, and revalidates current actor/session and domain authority before returning the safe DTO; it does not take over promotion or scanning. The CAS conflict handler accepts only a reread record with matching uploader, Branch, domain, purpose, owner, resource and payload fingerprint, and only a quarantined or fully valid available state. Other conflicts still fail; revision fencing is unchanged.

Filesystem checks now re-resolve the configured root and object path at use time, reject non-file/symlink leaf targets, compare opened-file identity and size against `lstat` where supported, and verify promoted targets while retaining exclusive hard-link creation. These checks reduce replacement risk but do not provide a pinned directory handle or complete Windows reparse-point/junction race protection. Windows ACLs remain inherited and unverified. The adapter is development/test only; a production private storage provider and deployment ACL controls remain required.

No new route or permission is present; `server.ts` remains limited to index initialization before `app.listen`. No operational approval/release code was changed. Existing valid conflicting replay coverage remains, including preservation of original digest and bytes.

Because service and storage production source changed, the earlier 250-test regression evidence is not current verification. Production prerequisites remain: real malware scanner, private production storage provider, storage deployment security controls, domain-specific authorization with async revalidation, retention configuration, and B2-1 history-integrity enforcement before future policy/grant lifecycle writers.

## Limitations and next gates

- The filesystem adapter is development/test only; production needs a separately reviewed private object-storage provider and deployment configuration. There is no insecure fallback.
- A real malware scanner and its operations/configuration are required before any production evidence can become available.
- Each future domain must implement and test its own exact ownership/relationship authorization before it can call the internal read/ingest/delete methods. No Parent Leave, custody, Homework, document, or helpdesk workflow is connected here.
- No school identity-document requirements, content retention period, legal deletion rule, or school-authorized evidence policy is established by this technical allowlist.
- Future mobile work must use secure Android/iOS file pickers, bounded upload with progress/retry, safe validation errors, protected viewing, account/child-switch isolation, session cleanup, and server-confirmed availability. This is not a user-facing mobile feature.
- Policy/verifier-grant lifecycle writers remain out of scope. The B2-1 history limitation remains: its arrays are not append-only or tamper-evident. History integrity and transaction/rollback protections remain mandatory before any such writer is introduced.

## Preserved restrictions

No positive custody or collector verification, policy/grant writer, Pickup/Early Exit approval, Gate permission, QR/OTP, physical entry/checkout/release, offline emergency path, attendance/transport side effect, or parent notification was added. No route, role, permission, migration, cleanup job, or automatic destructive retention process was added.

## G4e-2B2-2 targeted hardening update — 2026-11-27

### Exact hardening corrections

- `backend/src/services/protected-evidence.service.ts`: revalidates persisted active User/session/Branch and exact domain authorization across ingestion, replay, scan, deletion and read boundaries. A revoked ingestion cannot finalize as available; it is failed with `authorization_revoked`, and promoted bytes are deleted best-effort with recovery cleanup. Read authority is checked after the asynchronous file read and digest validation before bytes are returned. Replay revalidates before returning or resuming a scan. Maintenance `recover` returns no metadata DTO, does not invoke the scanner, and can only reconcile intent to quarantined, preserve verified available status, or complete deletion already pending. Intent recovery tolerates a temporarily missing object so it cannot race an active promote into a false failure. Deletion is rechecked before pending and before physical deletion; once physical deletion begins, metadata finalization completes for consistency.
- `backend/src/services/protected-evidence-storage.ts`: uses a process-shared, canonical-root staged-key lease registry with a 15-minute lease and periodic refresh during ingestion. Cleanup skips active leases and rechecks before unlink. `promote` and `discard` release leases; abandoned files from a stopped process are eligible for age-based cleanup. No cross-process lease or distributed coordination is claimed.
- `backend/src/models/protectedEvidence.ts`: adds the internal `authorization_revoked` failure code and lifecycle event needed to persist the fail-closed ingestion outcome.
- `backend/tests/protected-evidence.security.test.ts`: adds eight tests since the original 24-test baseline. The deterministic concurrent replay case asserts a live intent revision remains unchanged, one metadata record and one binary object exist, original content/digest remain intact, and the winning request reaches available. A second barrier test revokes authorization at conflict resolution and requires unauthorized rejection without mutating the winning intent. The symbolic-link test remains; Windows `EPERM` causes an explicit skip, and a Linux CI/development container with symlink support is an appropriate unprivileged environment to run it. Existing repeated-cleanup and maintenance-recovery expectations reflect prior-process orphan cleanup and quarantine-only maintenance recovery.
- `docs/integration/pr-g4e2b2-2-protected-evidence.md`: records this correction, validation and limits.
- `backend/src/server.ts`: unchanged during this hardening task; its existing unstaged index initialization remains part of the original six-file foundation scope.

### Current validation

- Backend TypeScript: `npx --no-install tsc --noEmit -p tsconfig.json` — **PASS, exit 0**.
- Focused test-source TypeScript: `npx --no-install tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node tests\protected-evidence.security.test.ts` — **PASS, exit 0**.
- Strict scoped ESLint: `..\node_modules\.bin\eslint.cmd --max-warnings=0 src\models\protectedEvidence.ts src\services\protected-evidence-storage.ts src\services\protected-evidence.service.ts tests\protected-evidence.security.test.ts src\server.ts` — **PASS, exit 0**.
- The expanded 32-test focused suite was attempted once during this correction: `node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\protected-evidence.security.test.ts`. Node v24.19.0 exited 1 before test discovery with `uv_os_get_passwd returned ENOMEM`; **0 tests executed, no runtime pass claim**. One subsequent source-only tightening of the CAS reread validation was statically checked but could not be runtime-tested here.
- Lead Engineer Windows CMD evidence immediately before this latest correction was focused **31 total: 29 passed, 1 failed, 1 skipped** and applicable regressions **250/250 passed**. The focused failure was the duplicate-ingest CAS race. These results identify the defect but do not validate its correction. The regression suites listed above need fresh execution after this production change; they were not rerun after it.
- Manual Windows CMD commands to run from the `backend` directory:

```cmd
node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\protected-evidence.security.test.ts
node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\staff-self-service.security.test.ts tests\school-custody-contract.test.ts tests\school-custody-foundation.security.test.ts tests\gate-foundation.security.test.ts tests\pickup-authorization.security.test.ts tests\early-exit.security.test.ts
```

- Remaining consistency limits: rechecks around MongoDB, filesystem and injected domain authorization do not form one cross-system atomic transaction. A revocation immediately after the final check and before a metadata compare-and-set remains a narrow race unless a future domain authorizer supplies transactionally bound current authority. The filesystem active-stage lease is process-local; another process sharing the root is unsupported. Path re-resolution and opened-file checks reduce replacement risk but do not prove complete Windows junction/reparse-point race protection or ACL safety.
- History remains mutable and not tamper-evident. History-integrity enforcement plus transaction tests remain mandatory before future lifecycle writers. Production malware scanning, private storage provider, deployment ACL/security controls, domain-specific authorization, and retention configuration remain prerequisites.

### Git scope at review time

The branch remains `feature/g4e-2b2-2-protected-evidence` at HEAD `a301fb867d957a26702b119ac3544b082dadfaff`. The index is empty. `backend/src/server.ts` is a pre-existing unstaged modification and was not edited during this hardening task. The hardening edits are also unstaged and limited to the existing model, service, storage, test and report paths in the six-file scope. No staging, commit, push, merge, reset, clean or branch switch was performed.

## G4e-2B2-2 final security findings closure — 2026-11-27

### Targeted source review

The latest accepted focused run corresponds to the current implementation and test source; no implementation or test file was changed during this closure review. The changes in this review are limited to this report.

- **P1 asynchronous authorization:** persisted active User/session/Branch and exact domain binding are rechecked after asynchronous boundaries. Read content is returned only after the storage read, digest validation, and current authorization check. The deterministic session-revocation, scan-revocation, and post-read revocation cases assert denial, no bytes returned, and no unauthorized available state.
- **P2 active staging:** the canonical-root, process-local lease is refreshed during ingestion; cleanup skips active stages across adapter instances and safely removes old unleased files. Deterministic barriers verify active-stage protection; repeated cleanup verifies orphan recovery. This is not distributed coordination.
- **Concurrent duplicate ingestion:** recovery encountering an intent without promoted bytes no longer writes a same-status event or increments the live revision. The deterministic replay test holds the winner before promotion, verifies the duplicate returns the same evidence identity without changing revision, then verifies one metadata row, one object, preserved bytes/digest, and the winner’s eventual authorized scan.
- **Conflict binding and authorization:** the CAS recovery path reloads by evidence ID and requires matching uploader, Branch, domain, purpose, owner, resource, and payload fingerprint. It accepts only quarantined state or an available state whose scan metadata is valid. Current session and domain authority are checked before success; the revocation barrier test rejects the duplicate and leaves the winner’s intent unchanged. Other conflicts remain errors.
- **Maintenance recovery:** recovery may reconcile persisted bytes to quarantine but does not call the scanner or establish availability. Missing bytes on a live intent do not revise its CAS token. The recovery/promotion barrier test confirms only the authorized ingestion resumes scanning.

### Accepted runtime evidence

- Focused suite: **32 total; 31 passed, 0 failed, 1 skipped, 0 cancelled; 4468.3789 ms.** The skipped test is the symbolic-link target refusal test; Windows returned `EPERM`. It is not counted as passed.
- Applicable regression suite: **250 total; 250 passed, 0 failed, 0 skipped, 0 cancelled; 236056.7892 ms; exit 0.**
- Combined: **282 tests; 281 passed, 0 failed, 1 skipped, 0 cancelled.**

### Skip disposition and remaining gates

The symbolic-link test remains enabled. Its Windows `EPERM` skip is a platform capability limit, not a passing security assertion. Run it in a supported Linux CI/development container with normal symlink support; do not weaken OS controls or require administrator privileges. This skip does **not** block scoped internal foundation integration: the filesystem adapter is explicitly development/test-only, no public/domain route uses it, and no production provider is being approved. It remains required before claiming that symbolic-link behavior was exercised on a supported platform, and it does not waive production storage requirements.

Production prerequisites remain: real malware scanning; a separately reviewed private production storage provider and deployment security controls; domain-specific authorization; retention configuration; and B2-1 history-integrity enforcement before future lifecycle writers. The adapter does not claim complete Windows reparse-point race protection, ACL enforcement, or cross-process stage coordination.

### Final Git scope

Branch `feature/g4e-2b2-2-protected-evidence`, HEAD `a301fb867d957a26702b119ac3544b082dadfaff`; exactly the six approved paths remain changed and the index is empty. No source or test path changed during this closure review; no staging, commit, push, merge, reset, clean, or branch switch occurred.
