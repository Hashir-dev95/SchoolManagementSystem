# Principal approval authorization

`PRINCIPAL_APPROVAL_AUTHORITY` is server-only JSON keyed by reviewer MongoDB user
ID. Each entry has `branchId` (the user's assigned branch), `types` (an explicit
approval-type array), and optional `limits` (financial type to numeric ceiling).
Provision grants through trusted deployment configuration, never client input.
No production thresholds are supplied. Empty, malformed, mismatched or missing
grants deny access. Financial types require a finite nonnegative ceiling and a
finite nonnegative stored amount. Zero is explicitly permitted; negative, missing
or nonfinite financial amounts are invalid. All decisions, including rejection,
change requests and delegation, require the same category/amount authority.

Configuration shape (replace both ID placeholders with real MongoDB ObjectIds):

```json
{"<reviewer-user-id>": {"branchId": "<assigned-branch-id>", "types": ["leave"], "limits": {}}}
```

For financial categories, an authorized business owner must supply the relevant
numeric ceiling in `limits`; enabling a financial type alone grants no authority.

The existing categories are leave, refund, discount, result, paper, purchase,
payroll and certificate. Currently resolvable entity combinations are:

| Approval category | entityType | Required reference |
| --- | --- | --- |
| leave | user or student | Same-branch user/student |
| certificate | student | Same-branch student |
| refund, discount | fee | Same-branch invoice and linked student/user |
| payroll | user | Same-branch user |

`entityId` is required. Student references must also link a same-branch user.
Other entity/category combinations fail closed. Result/paper/purchase lack domain
models and cannot be enabled by configuration alone. Add explicit reviewed
resolvers with those future domain implementations; do not dynamically resolve
model names. These checks authorize request review only, not business execution.

Only active same-branch Principals are eligible delegates. Both delegate and
delegator need their own category/amount grants. Delegated decisions recheck the
delegator's current role, branch, active state and grant, and require unexpired
delegation with recorded `delegatedBy`. Legacy delegations lacking that field fail
closed for the delegate. An assigned delegate cannot fall back to direct authority
after expiry or redelegate. Other authorized Principals retain direct review.
History distinguishes direct and delegated authority and records the delegator.
No delegation renewal/cancellation UI or endpoint is added.

List and detail require authority; lists omit inaccessible or invalid requests.
Cross-branch/missing requests and invalid requester/entity scope return 404.
Insufficient authority returns 403; invalid inputs/amounts return 400; stale
decisions return 409. The final update compares the authorized document snapshot,
checks delegation expiry against MongoDB's clock at the write, increments its
version, and requires pending status.

Responses include only explicitly selected fields. Requester/entity scope is
validated; reviewer/delegate/history user references are resolved only inside the
branch, with unavailable references replaced by a neutral label. Raw
`supportingFileUrl`, `beforeData` and `afterData` are withheld on every approval
response. There is no secure file-delivery subsystem in the repository: attachments
remain inaccessible through this API until a dedicated authenticated, scoped
endpoint exists. Mixed payloads need typed, branch-validated contracts before
re-exposure. Free-text reasons remain trusted source text, not structured data.
Reference checks read multiple documents without a transaction. Concurrent user
or entity branch reassignment is not atomic with request review; future business
execution must coordinate that invariant. The request snapshot/transition itself
is atomic. Dashboard approval counts remain branch totals, not reviewer-filtered
actionable totals, because this PR does not change dashboard behavior.

Principal no longer receives students.delete, teachers.delete, results.manage or
finance.manage. Read access and existing approvals/tasks/notices/safety permissions
are retained. Super Admin's permissions and existing route access are unchanged;
Super Admin remains excluded from Principal-only approval routes.

Run `npm run test:approvals` in backend for isolated MongoDB/HTTP tests. Test-only
amount ceilings are fixtures, not business defaults. Existing manual DB scripts
are excluded; neither this suite nor the bootstrap suite reads `.env` or `MONGODB_URI`.

## Request Changes and requester resubmission

The status remains `changes_requested` while awaiting correction. Principal
Request Changes requires a non-empty decision reason and clears current delegation.
It preserves historical delegation and reviewer information in append-only history.

Only an active, same-branch original requester with role Principal, Teacher or
Student can use these owner endpoints. Super Admin is excluded. These endpoints
do not grant Principal review permissions and do not create approval requests.

1. GET `/api/approval-requests/:requestId/resubmission` returns only `_id`, `status`,
   `reason`, `revision`, `canResubmit` and, when present, `changeReason`.
   Its ETag is the quoted revision, for example `"3"`; responses use `no-store`.
2. PATCH `/api/approval-requests/:requestId/resubmit` requires that ETag in
   `If-Match`, and exactly a JSON body such as `{"reason":"Corrected explanation"}`.
   Reason is trimmed, non-empty and at most 500 characters. No query keys are accepted.

No amount, category, entity, attachment, mixed payload, identity, status, version,
reviewer or delegation fields are editable. Revision is an optimistic precondition,
not a body field to modify. Missing/malformed If-Match is 400; a stale revision,
non-change-requested status or conflicting concurrent update is 409.

A successful atomic update retains the request ID, returns it to `pending`, clears
current reviewer/delegation fields, increments the version and appends a
`resubmitted` history entry with requester, corrected reason and server timestamp.
Existing history IDs are preserved and exposed additively to Principal readers.
Legacy records without a version expose revision zero and receive a guarded first
version increment. Old revision tokens cannot be reused across review cycles.

Next review recalculates current authority and source scope; no old delegation is
restored. Resubmission performs no business execution. Requester product screens
and initial request-producing workflows remain unavailable. Multi-document source
and account checks retain the previously documented reference concurrency limitation.
