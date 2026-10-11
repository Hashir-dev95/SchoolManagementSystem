# Principal write contracts

All mounted Principal business writes require the existing JWT/session, Principal
role, permission and assigned-branch middleware. Body/query IDs never set actor
or branch. This PR adds no routes or permissions. Admin provisioning, public
authentication and bootstrap retain their existing separate contracts.

| Endpoint | Accepted JSON fields |
| --- | --- |
| POST /api/principal/tasks | title, assignedTo; optional description, priority, dueDate |
| PATCH /api/principal/tasks/:taskId | action: start, complete or cancel |
| PATCH /api/principal/safety-alerts/:alertId | action: assign, resolve or escalate; assignedTo only for assign |
| PATCH /api/approval-requests/:requestId | Existing action/reason/delegation contract; stricter date parsing only |

Bodies must be plain objects. Unknown fields, nulls, arrays, wrong types, and
attempts to set status, branch, creator, actor, timestamps or history are rejected.
Strings are validated before Mongoose can coerce them. Task titles trim to 2–150
characters; optional descriptions trim to at most 2000. Priority is exactly low,
normal, high or urgent; omission uses the schema's normal default. IDs are exactly
24 hexadecimal characters and normalize to lowercase. Assignment requires an
active same-branch Principal or Teacher; missing/cross-branch users return 404,
ineligible/inactive users 403. Task actions remain creator/assignee restricted,
in addition to the existing Principal route restriction.

Due dates accept YYYY-MM-DD at UTC midnight or an RFC3339 timestamp with seconds
and explicit Z/offset (up to three fractional digits). Valid today and past dates
are accepted; task due dates have no future-only restriction.
Impossible dates, local timestamps without timezone, leap seconds, empty values,
numeric timestamps, booleans, arrays and objects are rejected. Approval delegation
requires the timestamp form; PR-2 still checks future expiry and MongoDB write-time
expiry. Approval categories, amount grants and related-entity rules are unchanged.

No numeric or boolean business input is accepted by task/safety actions. The
approval decision body still cannot contain amount, limits or arbitrary metadata.
Resolution reasons/evidence have no existing stored contract: they are rejected
as unknown fields rather than silently discarded or added as a new product feature.
There is no mounted safety creation, notice creation/update, student, attendance or
fee mutation route available to Principal in the current backend.

Task creation now uses a model save with explicit fields, validators, default
pending/normal state, empty history, server timestamps and version. Branch/creator
are immutable in the model. Task actions use validated atomic model updates:
start only from pending; complete/cancel from pending or in_progress. Completion
sets completedAt to server time; cancellation explicitly clears completedAt to null.
Final states
and repeated starts conflict. Safety assign/escalate/resolve only modify open or
in_progress alerts. Repeating the same assignment or completed escalation conflicts.
Atomic updates compare scoped snapshots and versions, append authenticated actor
history, and run validators. Legacy raw documents without __v can make their first
guarded update; this creates a version without a migration. Reads use model defaults
for legacy tasks whose raw creation omitted priority.

Errors: 400 invalid contract; 401 missing authentication; 403 wrong role, permission
or actor/assignee authority; 404 missing/cross-branch objects; 409 stale/invalid state;
500 sanitized unexpected failure. Principal/approval malformed or oversized JSON
returns sanitized 400 without echoing input or parser internals. Bootstrap's parser
behavior and unrelated API handlers are unchanged. JSON parsing precedes auth, so
malformed JSON can return 400 even without a token.

Final task/safety decisions cannot both succeed for the same authorized snapshot.
No existing idempotency key exists. Repeating task creation can create duplicate
tasks; no arbitrary persistent deduplication identity is introduced. A lost create
response requires reconciliation before retry. Reassignment to different users is
still a legitimate action, not deduplicated forever. Audit history grows with those
actions. Multi-document actor/assignee branch changes are separate reads, not atomic
with the object write; PR-2's related-reference concurrency limitation remains.

Run test:principal-writes, test:approvals and test:bootstrap from backend. These
suites own temporary MongoDB instances and never load configured database URIs.
Legacy manual auth/model scripts that import dotenv remain excluded.
