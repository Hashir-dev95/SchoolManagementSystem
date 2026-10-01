# Partner handoff: Student, Parent, Finance

No partner-owned TypeScript or navigation files were changed. The JS endpoints below are implemented, but the current JS server does not set `req.user`, and the partner TS server does not mount the JS router. Live requests require the partner integration first.

## Trusted user context

Before mounting the JS API, validate the existing session/token, load the account and role from the database, and attach:

```js
req.user = {
  id: databaseUser.id, // stable user ID from trusted account lookup
  role: databaseUser.role, // lowercase: 'student' | 'parent' | 'finance'
  branchId: databaseUser.branchId, // required for Finance API access
};
```

Then mount the router:

```js
app.use('/api', trustedUserContextMiddleware, apiRoutes);
```

Import `apiRoutes` from the JS `routes.js` entry in the partner-owned server. Do not take the ID or role from request body, query, route params, or a client-selected role tab. Student records need `userId`, `id`, and `classId`; Parent access uses verified `parentChildLinks` records. Finance routes return 401 without trusted context and 403 for a non-Finance role.

## API map

All paths below are relative to `/api`.

| Role    | Endpoint                                                                                                               | Use                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Student | `GET /students/me`                                                                                                     | Own profile                                                                |
| Student | `GET /students/me/timetable`                                                                                           | Own class timetable                                                        |
| Student | `GET /students/me/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD`                                                            | Own attendance                                                             |
| Student | `GET /students/me/results`, `/progress`, `/homework`                                                                   | Published results, progress, homework                                      |
| Student | `GET /students/me/homework/:homeworkId/submissions`                                                                    | Own submissions and teacher feedback/status                                |
| Student | `POST /students/me/homework/:homeworkId/submissions`                                                                   | Submit multipart `file` (PDF/JPEG/PNG, max 5 MB)                           |
| Student | `GET /students/me/submissions/:submissionId/file`                                                                      | Download own submission                                                    |
| Student | `GET /students/me/applications`, `POST /students/me/applications`                                                      | Application history and submission (`title`, `message`)                    |
| Parent  | `GET /parents/me/children`                                                                                             | Verified linked children                                                   |
| Parent  | `GET /parents/me/children/:studentId`                                                                                  | Select child; every child path rechecks verified ownership                 |
| Parent  | `GET /parents/me/children/:studentId/{attendance,timetable,homework,results,fees,feedback,applications}`               | Selected child’s authorized records                                        |
| Parent  | `POST /parents/me/children/:studentId/applications`                                                                    | Submit (`title`, `message`) for selected verified child                    |
| Finance | `GET /finance/students?q=...`, `/finance/invoices?q=...`, `/finance/dues?studentId=...`                                | Branch-scoped student/invoice search and paid/pending/outstanding balances |
| Finance | `GET /finance/summary`, `/finance/receipts`, `/finance/reports/collections`                                            | Finance dashboard totals and confirmed receipts                            |
| Finance | `GET /finance/vouchers/:code/verify`                                                                                   | Verify voucher                                                             |
| Finance | `GET /finance/payments?status=pending_verification`, `POST /finance/payments/:paymentId/verify`                        | Review and verify payment; updates invoice, audit, receipt atomically      |
| Finance | `POST /finance/payments`                                                                                               | Record a validated partial payment; send `Idempotency-Key` header          |
| All     | `GET /students/me/notifications`, `/parents/me/notifications`, `/finance/me/notifications`                             | Recipient-scoped inbox and `{ notifications, unreadCount }`                |
| All     | `GET /students/me/notifications/:id`, `/parents/me/notifications/:id`, `/finance/me/notifications/:id`                 | Open exact notification/snapshot; Parent resolves exact DLP version        |
| All     | `POST /students/me/notifications/:id/read`, `/parents/me/notifications/:id/read`, `/finance/me/notifications/:id/read` | Mark recipient’s notice read                                               |

The Student and Finance notification publishers should call `createRecipientNotification` from `src/notificationService.js` after resolving an authorized recipient and exact source snapshot. Parent DLP publishers must create one `parentNotifications` record per verified Parent and preserve its exact `dlpVersionId`. See [NOTIFICATIONS_INTEGRATION.md](NOTIFICATIONS_INTEGRATION.md).

## Navigation snippets

The role returned by the trusted account/session bootstrap should select the screen. The existing `RoleDashboard` expects title case, while API roles are lowercase:

```jsx
import FinanceDashboard from './FinanceDashboard';
import ParentDashboard from './ParentDashboard';
import StudentDashboard from './StudentDashboard';

const dashboardByRole = {
  finance: FinanceDashboard,
  parent: ParentDashboard,
  student: StudentDashboard,
};

function AuthenticatedHome({ sessionUser }) {
  const Dashboard = dashboardByRole[sessionUser.role];
  if (!Dashboard) return null;
  return <Dashboard />;
}
```

For a React Navigation stack, register the three screens and select the authorized home route from the same trusted session role (never route params):

```jsx
<Stack.Screen name="StudentHome" component={StudentDashboard} />
<Stack.Screen name="ParentHome" component={ParentDashboard} />
<Stack.Screen name="FinanceHome" component={FinanceDashboard} />
```

The existing JS `MobileApp` already places `NotificationDrawer` in the top bar. If the partner app uses its own stack header, add the same control in `headerRight` and pass the title-case role:

```jsx
import NotificationDrawer from './NotificationDrawer';

const drawerRole = { student: 'Student', parent: 'Parent', finance: 'Finance' }[
  sessionUser.role
];
<Stack.Screen
  name="Home"
  component={AuthenticatedHome}
  options={{ headerRight: () => <NotificationDrawer role={drawerRole} /> }}
/>;
```

Finance payment retries must reuse the same `Idempotency-Key`; a changed payload needs a new key. If session cookies cross origins, configure credentialed CORS for the app’s explicit origin in the server integration.
