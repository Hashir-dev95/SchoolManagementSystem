# Student, Parent, and Finance notification integration

The JS inbox APIs store recipient-specific notification records in MongoDB; there is no process-memory fallback and no client-facing create endpoint. Student and Finance records use the `notifications` collection. Parent DLP records use `parentNotifications` so their class and exact-version authorization remains attached to the notice.

## Student and Finance publishers

Trusted backend publisher code can import `createRecipientNotification` from `src/notificationService.js` after it has resolved the intended recipient and exact source record. Example integration call (do not call from a client):

```js
await createRecipientNotification({
  recipientUserId: student.userId,
  recipientRole: 'student',
  title: 'Homework published',
  body: homework.title,
  targetType: 'homework',
  targetId: homework.id,
  recordSnapshot: homework,
});
```

Finance publishers use the same helper with `recipientRole: 'finance'` and the Finance user's database identity. `recordSnapshot` captures the exact record as it was when the notice was created. The drawer opens that persisted snapshot and displays its stable target type and ID. Keep snapshots to the minimum data the recipient is allowed to see; never include credentials, tokens, or file bytes. Existing finance API routes do not yet emit notifications automatically, so invoice/payment workflow owners must call the helper at the relevant business event.

Each document contains `id`, `recipientUserId`, `recipientRole`, `title`, `body`, `targetType`, `targetId`, `recordSnapshot`, `createdAt`, and `readAt` (initially `null`). Only trusted backend code should insert or revise content. The mobile API scopes list, exact-detail, and read-state operations to both the trusted recipient user ID and role.

## Parent DLP publishers

For each verified Parent recipient, create a separate `parentNotifications` record containing `id`, `parentUserId`, `type: 'parent_dlp_shared'`, `classId`, exact `dlpVersionId`, title, `createdAt`, and `readAt: null`. Its `dlpVersions` target must be published, `audience: 'parent'`, and have the same `classId`. Parent routes additionally check that a currently verified linked child belongs to the notified class. A new DLP revision needs a new version and new recipient notices; existing notices must keep their original `dlpVersionId`.

## Trusted context and route paths

The current JS server does not populate `req.user`, and the partner TypeScript server does not mount these JS routes. Until the trusted integration is connected, Student, Parent, and Finance live API requests return 401. The upstream middleware must validate the existing session/token, load the matching database user and role, and set `req.user.id` plus a lowercase database-derived `req.user.role` before mounting the JS API router. Never derive either field from client input.

Partner integration snippet (adapt the middleware import to the partner's existing auth module; do not add a test header or bypass):

```js
app.use('/api', trustedUserContextMiddleware, apiRoutes);
```

Finance routes now reject requests without trusted Finance context. Payment entry additionally requires an `Idempotency-Key`; clients must reuse the same key for retries of the same payload and use a fresh key for a new payment. The backend stores a unique Finance-user/key pair and rejects reuse of that key with different payment data.

The notification routes are:

- Student: `/api/students/me/notifications`
- Parent: `/api/parents/me/notifications`
- Finance: `/api/finance/me/notifications`

Finance UI can show zero notifications until a trusted Finance publisher writes recipient records. Do not add client-controlled recipient IDs or role claims to notification requests.
