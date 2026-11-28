# G4e-2B2-5A — Trusted Backend Integration

## Authoritative final acceptance — 2026-11-28

This section supersedes the earlier blocked-runtime status below. The later native Windows execution is authoritative for the final source fingerprints recorded here.

### Closure of the six reported failures

| Failure | Confirmed cause | Correction and evidence |
|---|---|---|
| Super Admin permission inventory assertion | The derived-permission test formula did not exclude the new Principal-only `principal.custodyRecords.review` grant. Production mapping already excluded it. | Updated the expected inventory in `backend/tests/approval-authority.security.test.ts`; explicitly asserted the permission is Principal-only and absent from Super Admin, Parent, Teacher, Student, Finance and Gate Staff. Approval-authority suite: 47/47 passed. |
| Collector authorization module initialization | Eager re-export loaded the shared authorizer while its guarded model imports loaded the service back through a partial CommonJS module; the service received an undefined authorizer during singleton construction. | Both fixed trusted-dependency modules now defer the model-backed authorizer import until invocation using NodeNext-compatible `.js` specifiers. No factory, setter, alternate issuer or mutable authorization dependency was added. The unmocked cold-import suite passed in both service orders, model-first order, and app entry-point order. |
| Four Parent HTTP cases reported `403 !== 201` | The existing `parentSelfRoutes` router ends in a terminal 403. The new custody routes were mounted after it, so authenticated requests never reached their endpoints. | `backend/src/app.ts` mounts the specific custody endpoints before the Parent router. All four real-HTTP integration cases now pass, including workflow assertions previously blocked by the initial creation failures. |

Follow-on assertions exposed two additional test-contract issues and one detail-privacy gap. Static model imports had loaded the production `null` evidence runtime before the integration suite installed its test-only runtime composition; the suite now dynamically imports guarded models after installing that composition. Receipt assertions distinguish Parent, second-guardian and Principal receipts (and prove replay adds none). Principal detail denial now conceals unauthorized records as 404 for revoked requester links, absent review grants and wrong-category grants; mutations still require configured action grants. These corrections did not weaken the real authorizer or use an allow-all mock.

### Final runtime evidence

| Execution | Command / working directory | Result |
|---|---|---|
| Approval authority | `node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 tests\approval-authority.security.test.ts` / `D:\SchoolManagementSystem\backend` | PASS, 47/47, exit 0. |
| Unmocked production denial and cold imports | `node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 tests\collector-verification-record.production-deny.test.ts` / backend | PASS, 2/2, exit 0. Includes cold imports of both service orders, collector-model-first plus app import, and app initialization; no database connection or listener. |
| Real authenticated HTTP integration | `node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 tests\custody-record-http.integration.test.ts` / backend | PASS, 4/4, exit 0. Real JWT/session/Parent/link/enrollment/reviewer authorization with an isolated replica set; only private test storage and synthetic scanner are used. All later assertions ran. |
| Consolidated applicable regression | Exact 14-file command below / backend | PASS, 440 discovered, 439 passed, 0 failed, 0 cancelled, 1 skipped, 222725.1315 ms, exit 0. The skip is the Windows symbolic-link test (EPERM); it is not counted as passed. |

The earlier ENOMEM-only attempt and initial failing runtime evidence remain historical only. The final consolidated execution above occurred after the last source change.

### Final static evidence

- Backend TypeScript: `npx tsc --noEmit --pretty false` from `backend`, PASS, exit 0.
- Focused changed test TypeScript: `npx tsc --noEmit --ignoreConfig --target ES2022 --module esnext --moduleResolution bundler --types node --strict --esModuleInterop --skipLibCheck tests/custody-record-http.integration.test.ts tests/collector-verification-record.production-deny.test.ts tests/approval-authority.security.test.ts` from `backend`, PASS, exit 0.
- Strict scoped ESLint, `--max-warnings 0`, over all changed TypeScript paths including the approval regression, PASS, exit 0, zero warnings.
- `git diff --check` and explicit trailing-whitespace scan across all 15 changed paths, including untracked files, PASS, exit 0.
- NodeNext import-specifier and optional diagnostic typing corrections were included before the final runtime execution; static and runtime evidence corresponds to the same implementation source.

### Final acceptance boundary

The code-level backend integration and scoped regressions are ready for commit authorization. This is not production deployment readiness: the actual evidence runtime remains deliberately unavailable until reviewed private storage, a real malware scanner and retention configuration are supplied. Reviewer configuration remains per-process and is not transactionally persisted or fleet-wide revocation; B2-1 history-integrity enforcement remains mandatory before policy/grant lifecycle writers. No positive custody or collector verification, Pickup/Early Exit approval, Gate checkout, QR/OTP, physical release, attendance effect or transport effect was enabled.

## Result

Implementation and scoped runtime acceptance are complete on the isolated feature branch. The authoritative fresh consolidated run passed with one Windows EPERM skip. Production deployment remains blocked on the infrastructure and policy dependencies listed below.

No positive custody verification, collector verification, Pickup/Early Exit approval, Gate checkout, QR/OTP authorization, physical release, attendance effect, or transport effect was added. `review_completed` remains administrative record completeness only. The B2-1 evaluator remains denying.

## Baseline and Git state

- Repository: `D:\SchoolManagementSystem` (`Hashir-dev95/SchoolManagementSystem` remote).
- Verified integration baseline: `46e39b82d7a95e3f939646e92b68eb378e7a8b36` (`origin/integration/team-merge`).
- Feature branch: `feature/g4e-2b2-5a-trusted-backend-integration`.
- Current HEAD remains the baseline commit above; the implementation is local and unstaged.
- Index is empty. No commit, push, merge, reset, clean, or branch switch occurred during implementation.
- B2-4 ancestry was verified before branching; its implementation commit is an ancestor of the baseline.

## Exact changed-file inventory

1. `backend/src/app.ts`
2. `backend/src/constants/permissions.ts`
3. `backend/src/constants/rolePermissions.ts`
4. `backend/src/routes/custody-record.routes.ts`
5. `backend/src/services/collector-verification-record.service.ts`
6. `backend/src/services/collector-verification-record.trusted-dependencies.ts`
7. `backend/src/services/custody-record-api.contract.ts`
8. `backend/src/services/custody-record-trusted-authorization.ts`
9. `backend/src/services/protected-evidence-runtime.ts`
10. `backend/src/services/student-custody-record.service.ts`
11. `backend/src/services/student-custody-record.trusted-dependencies.ts`
12. `backend/tests/approval-authority.security.test.ts`
13. `backend/tests/collector-verification-record.production-deny.test.ts`
14. `backend/tests/custody-record-http.integration.test.ts`
15. `docs/integration/pr-g4e2b2-5a-trusted-backend-integration.md`

The scope expanded by one file to correct the directly failing Super Admin permission inventory test while preserving least privilege. No models, schemas, indexes, mobile files, generic approval handlers, policy/grant writers, or operational routes changed.

## Canonical infrastructure reused

- `authenticateToken` and the existing JWT verification/revocation path.
- Persisted `User` role and active-state checks, exact persisted `Session` selected by the Bearer token, and Branch derived from the persisted User. The request body and query cannot provide actor or Branch authority.
- Existing B2-3 and B2-4 fixed singleton services for lifecycle transitions, exact enrollment/proposal validation, revision checks, operation receipts, private persistence permits, event append, and transaction rollback.
- Existing `ParentStudentLink`, `StudentEnrollment`, current Branch, Student, `PickupAuthorization`, `PickupSubmission`, `PickupPerson`, approval linkage, custody policy, and `StudentCustodyState` checks.
- Existing B2-2 `createProtectedEvidenceService` and storage interfaces. The HTTP layer does not implement a second store or scanner.
- Existing permission middleware, role middleware, Express error conventions, and safe service DTOs.

## Parent and reviewer authorization

`custody-record-trusted-authorization.ts` supplies the two fixed B2-3/B2-4 authorizers. They require a live transaction and canonical ObjectIds; both recheck the exact current enrollment and Branch. Parent access requires a persisted active Parent in that Branch, an active Student, and an independently verified, currently active `ParentStudentLink`. Custody record reads also require `createdBy` to be the current Parent; custody list queries filter by `createdBy`, so another guardian cannot see that Parent’s records. Collector access is bound by B2-4 to the original requester, exact ParentStudentLink, current proposal, person revision/fingerprint, submission cycle, policy revision and enrollment.

Authorization fences the current User, Session, Branch, Student, enrollment, ParentStudentLink, and target record in the Mongo transaction. Current relationship/enrollment loss conceals access while persisted records remain retained. Reviewer access also requires the requester's current verified Parent relationship; a revoked relationship conceals the reviewer detail and list row.

Principal review requires all of:

- Persisted active `principal` role, matching Branch, and a current registered session.
- `principal.custodyRecords.review` permission (granted only to the Principal role; deliberately excluded from Super Admin's derived permission set).
- A matching entry in the server-owned `CUSTODY_RECORD_REVIEW_AUTHORITY_JSON` configuration for the exact Principal ID, Branch ID, record category, and action.
- Requester separation; a requester cannot review their own record.

The strict configuration shape is an array of unique records with exactly these keys:

```json
[
  {
    "principalUserId": "<24-hex-user-id>",
    "branchId": "<24-hex-branch-id>",
    "studentCustody": ["read", "request_changes", "complete_review"],
    "collectorVerification": ["read", "request_changes"]
  }
]
```

Only `read`, `request_changes`, `complete_review`, `revoke`, and `invalidate` are accepted. Missing, oversized, malformed, duplicate, extra-field, or unsupported-action configuration denies review. The configuration is read for each authority check. Updating the process environment affects that process's next check; external deployment configuration changes generally require a process restart/rollout. This configuration is not transactionally persisted or distributed, so immediate fleet-wide revocation is not claimed. No B2-1 verifier grants or generic approval category are reused.

## Protected evidence integration and deployment boundary

Parent upload endpoints pass bounded raw PDF/PNG/JPEG bytes (10 MB maximum) to B2-2, with an `Idempotency-Key`, server-configured retention reference, fixed custody domain/purpose, student owner, and exact record resource. B2-2 revalidates current actor/session and calls the domain authorizer during its asynchronous ingestion/scanning lifecycle. The fixed record services provide a read-only `authorizeEvidenceUpload` operation that rechecks the current draft and full domain scope; for collector records this reuses the existing live proposal/person/revision checks. Association is a separate revisioned service operation. Upload results and record DTOs expose only allowlisted metadata; no object key, filesystem path, storage URL, or binary download route is returned.

The repository has no reviewed production private-storage provider or real malware scanner. `protected-evidence-runtime.ts` therefore exports an immutable `null`; the real API returns a safe unavailable response rather than using development storage, an always-clean scanner, or a fallback. The HTTP integration test replaces only this runtime composition with the actual B2-2 service, isolated private test storage, and a synthetic test scanner; it does not mock Parent or reviewer authorization. Production evidence upload/read and evidence-dependent submit/review remain unavailable until separately reviewed providers and retention configuration are deployed. MongoDB transactions do not make external storage writes atomic.

## HTTP routes and JSON contracts

Dates in JSON DTOs are ISO strings. Lists use descending `(createdAt, _id)` keyset order, a maximum page size of 100, and opaque `cursor` / `nextCursor` values. Unknown query/body fields are rejected. The TypeScript contracts live in `custody-record-api.contract.ts`.

| Actor | Method and route | Payload / result |
|---|---|---|
| Parent | `GET /api/parent/me/children/:studentId/custody-records?enrollmentId=…&limit=…&cursor=…` | `{ items, nextCursor }`; own current-scope records only. |
| Parent | `POST /api/parent/me/children/:studentId/custody-records` | `{ enrollmentId, summary, operationId }`; creates a draft. |
| Parent | `GET /api/parent/me/children/:studentId/custody-records/:recordId` | `{ record, history }`; current owner only. |
| Parent | `PATCH /api/parent/me/children/:studentId/custody-records/:recordId` | `{ expectedRevision, operationId, summary, reason }`; draft edit. |
| Parent | `POST …/:recordId/actions/submit` or `/withdraw` | `{ expectedRevision, operationId, reason }`; service lifecycle action. |
| Parent | `POST …/:recordId/evidence` | Raw PDF/PNG/JPEG bytes; `Idempotency-Key`; returns allowlisted B2-2 evidence metadata. |
| Parent | `POST …/:recordId/evidence-associations` | `{ evidenceId, expectedRevision, operationId }`; immutable association. |
| Parent | `GET /api/parent/me/pickup-authorizations/:authorizationId/collector-verification-records?limit=…&cursor=…` | `{ items, nextCursor }`; exact current proposal scope. |
| Parent | `POST /api/parent/me/pickup-authorizations/:authorizationId/collector-verification-records` | `{ summary, operationId }`; creates a draft. |
| Parent | `GET /api/parent/me/pickup-authorizations/:authorizationId/collector-verification-records/:recordId` | `{ record, history }`; original requester only. |
| Parent | `PATCH …/:recordId` | `{ expectedRevision, operationId, summary, reason }`; draft edit. |
| Parent | `POST …/:recordId/actions/submit` or `/withdraw` | `{ expectedRevision, operationId, reason }`. |
| Parent | `POST …/:recordId/evidence` | Raw bounded supported bytes and `Idempotency-Key`; returns safe evidence metadata. |
| Parent | `POST …/:recordId/evidence-associations` | `{ evidenceId, expectedRevision, operationId }`. |
| Principal | `GET /api/principal/custody-records?studentId=…&enrollmentId=…&limit=…&cursor=…` | `{ items, nextCursor }`; requires explicit configured `read`. |
| Principal | `GET /api/principal/custody-records/:recordId` | `{ record, history }`; configured Branch/category read. |
| Principal | `POST /api/principal/custody-records/:recordId/actions/{request_changes\|complete_review\|revoke\|invalidate}` | `{ expectedRevision, operationId, reason }`; configured per-action grant. |
| Principal | `GET /api/principal/collector-verification-records?authorizationId=…&limit=…&cursor=…` | `{ items, nextCursor }`; exact current proposal scope. |
| Principal | `GET /api/principal/collector-verification-records/:recordId` | `{ record, history }`; configured Branch/category read. |
| Principal | `POST /api/principal/collector-verification-records/:recordId/actions/{request_changes\|complete_review\|revoke\|invalidate}` | `{ expectedRevision, operationId, reason }`; configured per-action grant. |

Typical statuses: 401 authentication/session invalid; 403 role or missing reviewer permission/configuration; 404 concealed foreign, stale, revoked, or unavailable scope; 400 malformed/unknown fields or unsupported content; 409 revision/operation conflict; 503 evidence/storage/scanner/retention dependency unavailable. Error bodies remain sanitized `{ success: false, message }`.

Create and mutation responses are the service's allowlisted record DTO. Detail responses contain that DTO plus immutable history. List responses contain allowlisted DTOs and a cursor. Evidence metadata includes `evidenceId`, domain/purpose, scan/lifecycle status, detected type, length, revision, and timestamps only; the B2-2 DTO omits storage internals.

## Security and non-operational review

- Both authorized Parent flows and configured Principal review flows are exercised by the new real-Express HTTP test source. Parent/reviewer auth is not mocked.
- The tests assert same-child guardian separation, Parent role/session/link checks, Branch concealment, current enrollment, collector identity revision changes, malformed reviewer configuration, generic approval route denial, idempotent Parent create replay, pagination cursors, safe evidence DTOs, evidence scan-time link/identity revocation, and persisted state/history remaining unchanged after denied upload.
- Existing service suites continue to cover revisions, receipt conflicts, final transaction fences, rollback, private writers, B2-2 scan/storage behavior, and current pickup/Gate/Early Exit denial contracts. They have not been runtime executed in this environment during this cycle.
- The old collector production-deny test was updated to verify malformed authority contexts deny and that the real production evidence runtime is unavailable without providers; it no longer asserts that all valid Parent/reviewer authority is permanently denied.
- No endpoint accepts a client role, actor, Branch, requester, enrollment authority, reviewer identity, approval outcome, or operational state.
- Generic approval APIs are unchanged and existing typed pickup approval guards remain in force.

## Validation evidence

| Check | Command | Result |
|---|---|---|
| Backend source TypeScript | `npx tsc --noEmit --pretty false` from `D:\SchoolManagementSystem\backend` | PASS, exit 0 (latest run). |
| Focused changed-test TypeScript | `npx tsc --noEmit --ignoreConfig --target ES2022 --module esnext --moduleResolution bundler --types node --strict --esModuleInterop --skipLibCheck tests/custody-record-http.integration.test.ts tests/collector-verification-record.production-deny.test.ts tests/approval-authority.security.test.ts` from backend | PASS, exit 0 (final source). |
| Strict scoped ESLint | `npx eslint --max-warnings 0 backend/src/app.ts backend/src/constants/permissions.ts backend/src/constants/rolePermissions.ts backend/src/routes/custody-record.routes.ts backend/src/services/collector-verification-record.service.ts backend/src/services/collector-verification-record.trusted-dependencies.ts backend/src/services/custody-record-api.contract.ts backend/src/services/custody-record-trusted-authorization.ts backend/src/services/protected-evidence-runtime.ts backend/src/services/student-custody-record.service.ts backend/src/services/student-custody-record.trusted-dependencies.ts backend/tests/approval-authority.security.test.ts backend/tests/collector-verification-record.production-deny.test.ts backend/tests/custody-record-http.integration.test.ts` from repository root | PASS, exit 0, zero warnings (final source). |
| Whitespace | `git diff --check`, plus explicit PowerShell trailing-whitespace scan over all 15 changed paths, including untracked files | PASS, both exit 0. |
| Runtime tests | Consolidated command below, from `D:\SchoolManagementSystem\backend` | PASS, 440 discovered, 439 passed, 0 failed, 0 cancelled, 1 skipped, 222725.1315 ms, exit 0. The skip is the Windows EPERM symbolic-link case and is not counted as passed. |

The final consolidated runtime command (from backend) was:

```cmd
node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 tests\custody-record-http.integration.test.ts tests\collector-verification-record.production-deny.test.ts tests\student-custody-record.security.test.ts tests\collector-verification-record.security.test.ts tests\protected-evidence.security.test.ts tests\school-custody-contract.test.ts tests\school-custody-foundation.security.test.ts tests\custody-policy-foundation.test.ts tests\gate-foundation.security.test.ts tests\pickup-authorization.security.test.ts tests\early-exit.security.test.ts tests\parent-scope.security.test.ts tests\student-enrollment.security.test.ts tests\approval-authority.security.test.ts
```

The command completed in native Windows CMD. The symbolic-link test remains an outstanding platform-specific execution requirement for an environment where Windows permits the test link operation; the expected EPERM skip is documented and is not counted as a pass.

## Remaining dependencies and B2-5B handoff

- Reviewed production private storage provider and real malware scanner.
- Deployment retention policy reference and secure configuration rollout.
- Distributed configuration update/revocation procedure for Principal reviewer grants.
- Symbolic-link protection test execution in an environment where the OS permits creating the test link.
- Mobile work remains out of scope; B2-5B can consume the typed DTOs, lifecycle payloads, cursor contract, idempotency key, and status behavior above.

## Source fingerprints

SHA-256 hashes for the 14 implementation source and test files are recorded here after the final static checks and runtime execution. The report itself is excluded from this list.

```text
0836A72C347D08DC9AC7192B629B0ECCAC8902AB55D7234E679169469ED04AB3  backend/src/app.ts
3BFAFC0C0A9C21E6B079BA72BB14A8A922E92063D2ED964408FF8AD48926A3D7  backend/src/constants/permissions.ts
4C6A67D3C51C20F79C0D575E497A9AF540F55DDCA2FE449154092F9484AF0B1E  backend/src/constants/rolePermissions.ts
ED28EDEBA3CDC1FB270E31D40B12A43D3B53589BDE3E1E5330C4AEC9B1720CEE  backend/src/routes/custody-record.routes.ts
5C193268B5047D5DFB339A78517A2751ECB091F9D39E251C66317F68049A75F9  backend/src/services/collector-verification-record.service.ts
C275F0166CC5E0FEF0AF50E52B60CE38C3D49630946A16A8F7C8E908C46D4F57  backend/src/services/collector-verification-record.trusted-dependencies.ts
3D17856083E7F512BD1B6943DA616CB77B7E5848A9CE9BA1CB24A277DA7ABFDA  backend/src/services/custody-record-api.contract.ts
3C75E31EB208F5C0D32B95CA9A17CE99ED5A58B67161FAFE0A8F7835C05DA399  backend/src/services/custody-record-trusted-authorization.ts
383BE9D59BB9D89680E868FBB4564B036031C5C0B613E76E7614F1ADD792E205  backend/src/services/protected-evidence-runtime.ts
898ED7FA60DA12F5FCD82CA108E0B012B97EB490BA325136AD63E0F5FD7B0322  backend/src/services/student-custody-record.service.ts
DFB3C8B15FFAEF2E526E9A96782F9A56E274536D1C98902C9DD5F1EAF2D8CE30  backend/src/services/student-custody-record.trusted-dependencies.ts
F19DC3D7ECE3455AD27C4F5812BA2F0B3B7D9FAD92B5215C1512B71C1BF8C32E  backend/tests/approval-authority.security.test.ts
8A1C3199526049E08358097E13CEC19CEDD664A299A944C092E745E05666AB76  backend/tests/collector-verification-record.production-deny.test.ts
984A94F5AF453D7B91AE6BA17075B2A0540FCFF3D415A80E263619DCF417CF6E  backend/tests/custody-record-http.integration.test.ts
```

## Final Git status

All 15 paths listed above remain unstaged and uncommitted on `feature/g4e-2b2-5a-trusted-backend-integration`. The index is empty; no remote branch was pushed or changed.
