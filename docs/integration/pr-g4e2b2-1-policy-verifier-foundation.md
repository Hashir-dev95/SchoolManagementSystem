# G4e-2B2-1 — Policy configuration and scoped verifier foundation

## Objective and baseline

Backend-only foundation on `feature/g4e-2b2-1-policy-verifier-foundation`, based on `fc6b190f2959e9b2bcef9af95467f3058cdc9b75`. No policy can be approved by these records and no verifier decision or release can be performed.

## Changed files

- `backend/src/models/custodyPolicyRevision.ts` — immutable Branch/revision identity, draft lifecycle, strict schema and indexes. Approval metadata is rejected pending a future typed approval workflow.
- `backend/src/models/custodyVerifierGrant.ts` — immutable User/Branch/scope identity, validity interval, revocation metadata, bounded history and indexes.
- `backend/src/services/custody-policy-foundation.service.ts` — strict product configuration parser and read-only fail-closed current actor/session/grant evaluator. The evaluator always returns `allowed:false`; no writer consumes grants.
- `backend/tests/custody-policy-foundation.test.ts` — synthetic parser allow/deny coverage.
- `backend/src/server.ts` — initializes the two model indexes before accepting traffic, using existing startup ordering.
- This report.

## Reused architecture and invariants

Canonical User, registered Session, Branch references, Mongoose strict schemas, explicit indexes and startup index initialization are reused. Grant identity cannot be retargeted; revision and Mongo `__v` remain separate. Policy business revision and schema version are separate. Draft policy is not approved. No default grant, permission, route, mobile surface or School/tenant model was introduced. No production records are migrated or provisioned.

The Branch transaction lock was not added to this read-only evaluator: this slice exposes no grant or policy write operation. Future writes must use a justified transaction/fence design and tests before being exposed.

## Preserved restrictions and exclusions

No positive student custody or collector verification, school policy activation, pickup/Early Exit approval, Gate operational duty, QR/OTP, physical checkout/release, emergency path, attendance/transport effect or notification was implemented. Existing policy sentinel and operational guards were not changed. Evidence storage/upload, scanning, mobile UI and public grant administration remain out of scope.

## Final acceptance validation

- Focused foundation suite, executed by the Lead Engineer in normal Windows CMD after the test-source corrections: `node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\custody-policy-foundation.test.ts` from `D:\SchoolManagementSystem\backend` — **18 passed, 0 failed, 0 skipped, 0 cancelled; exit 0; 6480.0258 ms**. The focused test source was not changed during this final acceptance review.
- Applicable custody, Gate, Pickup, and Early Exit regressions, executed by the Lead Engineer in normal Windows CMD — **211 passed, 0 failed, 0 skipped, 0 cancelled**.
- Combined scoped validation — **229 passed, 0 failed, 0 skipped, 0 cancelled; exit 0; 144941.6685 ms**. This combines the 18 foundation tests and 211 applicable regressions above.
- Backend TypeScript: `npx --no-install tsc --noEmit -p tsconfig.json` from `backend` — **exit 0**.
- Strict scoped ESLint: `..\node_modules\.bin\eslint.cmd --max-warnings=0 src\models\custodyPolicyRevision.ts src\models\custodyVerifierGrant.ts src\services\custody-policy-foundation.service.ts tests\custody-policy-foundation.test.ts src\server.ts` from `backend` — **exit 0**.
- `git diff --check` and explicit trailing-whitespace scan across all six scoped paths — **pass**.
- Applicable regression suites: `tests\school-custody-contract.test.ts`, `tests\school-custody-foundation.security.test.ts`, `tests\gate-foundation.security.test.ts`, `tests\pickup-authorization.security.test.ts`, and `tests\early-exit.security.test.ts`. Their manual regression run is accepted as completed. The earlier Codex runner attempt that stopped before loading tests with `uv_os_get_passwd returned ENOMEM` is an environment startup failure, not an application test result.

```cmd
cd /d D:\SchoolManagementSystem\backend
node_modules\.bin\tsx.cmd --test --test-concurrency=1 tests\school-custody-contract.test.ts tests\school-custody-foundation.security.test.ts tests\gate-foundation.security.test.ts tests\pickup-authorization.security.test.ts tests\early-exit.security.test.ts
```

## Limitations / next milestone

This is a non-operational backend foundation, not complete G4e-2B2. Policy approval, grant administration, verification records, evidence infrastructure and mobile integration require separate reviewed scopes. The read evaluator currently denies even a matching valid grant by design.

History integrity limitation: the schemas bound history-array length and mark selected event identity fields immutable through Mongoose, but they do not enforce an append-only event chain. A permitted document writer could replace/remove history entries (and event revision fields are not immutable), while direct collection writes bypass Mongoose validation entirely. This slice adds no history hash chain, separate audit ledger, or database-level write restriction. Future lifecycle writers must address and test this limitation before relying on these arrays as tamper-evident audit evidence; they must not describe the current arrays as immutable history. **Mandatory prerequisite:** before introducing any policy or grant lifecycle writer, implement and test append-only history integrity and transaction/rollback behavior. This acceptance review does not approve or expose such writers.

## Acceptance review status

Six-path scope and empty index verified on `feature/g4e-2b2-1-policy-verifier-foundation` at `fc6b190f2959e9b2bcef9af95467f3058cdc9b75`. Accepted focused and existing regression validation totals 229/229, and backend TypeScript and strict scoped ESLint pass. Independent source review found no confirmed current P0/P1 defect. Operational denial remains intact: the evaluator's return type only permits `allowed: false`; no routes, permissions, grant/policy mutation services, or operational release writers are introduced. This accepts the non-operational foundation for the local checkpoint; it does not authorize future lifecycle writers or operational custody/release behavior.
