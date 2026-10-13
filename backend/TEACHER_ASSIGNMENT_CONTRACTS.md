# Teacher assignment foundation (T-PR1)

## Boundary

These APIs are backend-only. Login remains the shared login contract. A future
Teacher client calls `GET /api/teacher/classes` after login to load current
assignments. No Home, timetable, roster, attendance writes or academic workflows
are implemented here.

`authenticateToken` validates the JWT, registered session, current active user
and unchanged role. Teacher routes additionally require Teacher role and
`teacher.classes.view`. The scope service reloads current identity, derives the
branch from the database, requires an active Branch, then resolves effective
assignment tuples against current active Class, Section and Subject records.
Section must still belong to the same class. No assignment scope is cached.

Assignment scope is not a generic grant to every object in a class. Each future
domain must own its action permission, object/roster checks and business filter.

## Minimal academic source

There was no Subject source. Subject contains branchId, normalized display name,
isActive and timestamps. Its branch/name unique index uses case-insensitive
English collation; whitespace is normalized by the model. Names remain reserved
when inactive. There is no curriculum or public Subject-management API. Trusted
data provisioning must use the model and an existing branch. Assignment creation
independently validates the active branch and all referenced records.

## Effective assignment

An assignment preserves teacher/branch/class/section/subject as one immutable
tuple. It is effective when `isActive === true`, `validFrom <= now`, and
`validUntil` is absent or `validUntil > now`. Boundaries are UTC instants supplied
as strict RFC3339 strings with timezone; date-only input is rejected. Each scope
request captures one server time. This PR introduces no school calendar/date
interpretation. Deployment hosts must maintain synchronized clocks.

The Teacher must remain active, retain Teacher role and the assignment's branch.
Referenced academic objects and branch must remain active and correctly related.
Missing or invalid references remove the tuple from the read scope.

Inactive branches deny Teacher operations with 403. This extends existing
active-branch provisioning semantics to the new Teacher boundary only; existing
Principal behavior is unchanged. No cross-request authorization cache is used.
Writes/reads already in flight have request-time authorization, not a global
transactional snapshot of every account/reference change.

## Read API

All reads require authentication, Teacher role and `teacher.classes.view`.
All query parameters and GET bodies are rejected. Responses use `Cache-Control:
no-store`. Client IDs select objects; they do not establish authority.

- `GET /api/teacher/classes`: all current authorized tuple rows.
- `GET /api/teacher/classes/:classId`: only this Teacher's current tuples in that class.
- `GET /api/teacher/classes/:classId/sections/:sectionId/subjects/:subjectId`:
  the exact authorized tuple. Independent class/subject set membership is never used.

Successful response: `{success: true, data: [...]}`. Each row contains exactly:

```text
assignmentId
classId, className
sectionId, sectionName
subjectId, subjectName
```

Class detail returns an array because one class can have multiple authorized
sections/subjects. Empty list is 200; missing/unassigned/foreign detail is the
same concealed 404. No students, identities, private records, permission maps,
branch IDs, effective dates or provisioning metadata are returned.

## Trusted provisioning

Both routes require current active Principal or Super Admin role AND
`teacher.assignments.manage`. Services independently enforce these checks.

- `POST /api/teacher-assignments`
  - Required: teacherId, classId, sectionId, subjectId, validFrom.
  - Optional: validUntil, strictly after validFrom.
  - No branchId, actor fields, activation flags, permissions or other fields.
  - Principal: target Teacher must belong to the Principal's current active DB branch.
  - Super Admin: target Teacher's current DB branch determines the target scope.
  - All academic references must be active in that branch; section belongs to class.
  - Returns 201 with `{success: true, data: {assignmentId, isActive: true}}`.
- `PATCH /api/teacher-assignments/:assignmentId/revoke`
  - Requires empty JSON object `{}` and no query parameters.
  - Principal can revoke only records in their current active DB branch.
  - Super Admin can revoke any stored assignment, including inactive-branch cleanup.
  - Revocation is allowed when target Teacher/references are unavailable because it
    only removes authority. It cannot change the tuple, dates or reactivate it.
  - Returns 200 with `{success: true, data: {assignmentId, isActive: false}}`.
  - An atomic active-state condition permits one transition; repeats return 409.

Create/revoke are the only supported mutations. To correct dates or tuple fields,
revoke and create a replacement. A failed replacement leaves no active grant.
createdBy/updatedBy, timestamps and revokedAt are server-owned attribution.
Revoked records remain stored.

## Duplicate policy and indexes

The unique partial index on teacherId/branchId/classId/sectionId/subjectId applies
to every `isActive: true` record. This is deliberately stronger than date overlap:
future and expired active records reserve the tuple until explicit revocation.
Non-overlapping scheduled versions cannot coexist in T-PR1. This permits database
enforcement without interval transactions and prevents concurrent equivalent
creates. Another Teacher can legitimately have the same academic tuple.

There is one additional assignment lookup index on teacherId/branchId/isActive/
validFrom. Class/section/subject references use their existing `_id` indexes.
There are no speculative timetable/attendance indexes.

Startup creates the new model indexes before accepting traffic, including with
autoIndex disabled. Creation also verifies the assignment unique index before
writing and fails closed if it cannot be established. No indexes are dropped.
Duplicate key conflicts are sanitized to 409. Deployments must permit index
creation; index build errors prevent startup/writes rather than relaxing the invariant.

## Permission grants

- Teacher: adds only `teacher.classes.view`; existing coarse grants unchanged.
- Principal: adds only `teacher.assignments.manage`.
- Super Admin: obtains `teacher.assignments.manage` through the existing permission
  enumeration, with explicit exclusion of `teacher.classes.view`.
- Student: unchanged.

Teacher role is required even if another role were mistakenly granted class-view.
Provisioning role is required even if a Teacher were mistakenly granted management.
No Principal approval authority is granted to Teachers.

## Errors and verification

401 invalid authentication/current identity; 403 role/permission/active-branch or
known target eligibility denial; 404 concealed out-of-scope/missing objects;
400 malformed IDs/contracts/dates; 409 duplicate or repeated mutation; 500 sanitized
unexpected failures. Teacher JSON parse errors do not echo request bodies.

`npm run test:teacher` runs the isolated MongoDB/HTTP security suite, including
real unique indexes and concurrent writes. Existing Principal, approval,
bootstrap and write suites must also be run before review. The new queue is an
assignment list; pagination and roster detail belong to later scoped work.

## Implementation verification

- Teacher security: 44/44 pass.
- Bootstrap: 17/17 pass.
- Approval authority/resubmission: 47/47 pass.
- Principal authorization: 47/50 pass; three existing safety-action failures.
- Principal writes/tasks/safety: 42/49 pass; seven existing safety-action failures.
- The same ten failures were reproduced in an isolated pre-Teacher working-tree
  snapshot. The existing safety service returns void where the controller expects
  an alert; the unrelated source file was preserved byte-for-byte.
- New Teacher source dependency graph passes strict TypeScript. Full backend and
  targeted test typing report only the existing safety-controller source error.
- Repository-wide typing additionally reports pre-existing Principal test typing
  errors. No Teacher diagnostics remain.
- ESLint passes for all changed TypeScript files; `git diff --check` passes.

The required whole-branch build/regression gate remains blocked by the preserved
baseline safety change. Resolve that separately before beginning T-PR2 integration.
