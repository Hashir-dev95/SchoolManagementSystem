# Teacher and Principal integration contract

This document defines the partner integration points for class teacher applications and Parent DLP notifications. It does not implement Teacher or Principal routes, middleware, screens, or modify partner-owned files.

## Trusted request context

The upstream trusted middleware must populate `req.user` before mounting the API routes. Student and Parent routes expect `req.user.id` and a database-derived `req.user.role` (`student` or `parent`). Never accept user or role identity from request bodies, query strings, or client storage. The routes in this JS scope do not implement authentication.

Parent access relies on verified `parentChildLinks` records with `parentUserId`, `studentId`, and either `status: 'verified'` or `verified: true`, and no `revokedAt` value. Student records must have stable `id`, `userId`, and assigned `classId` values.

## Class teacher application workflow

Student and Parent clients submit an application with only `title` and `message`. The JS API resolves the Student's current class and requires exactly one active teacher record in `classTeacherAssignments` matching:

```js
{ classId, teacherUserId, active: true, status: 'assigned' }
```

The application is stored in `classTeacherApplications` with a stable `id`, `classId`, `studentId`, `applicantUserId`, `applicantRole`, `assignedTeacherUserId`, `status`, timestamps, and `statusHistory`. The initial status is `submitted`.

Teacher/Principal workflow code should:

1. List only applications assigned to the trusted Teacher user, or allow Principal access under its own trusted role policy.
2. On every transition, verify the current application and actor authorization server-side. A Teacher may update only when `assignedTeacherUserId === req.user.id`; a Principal's broader authority must come from a database permission/role record.
3. Append a history entry and update current status atomically. A history entry has `status`, `changedAt`, `changedByUserId`, `changedByRole`, and optional `note`.
4. Use the school-approved transition rules. Suggested states are `submitted`, `under_review`, `needs_information`, `approved`, and `rejected`; the current JS API does not expose status mutation.
5. Never permit Student or Parent clients to set status, class, applicant identity, or assigned teacher.

## Parent DLP sharing and notifications

When the authorized Teacher/Principal publishes a Parent-facing DLP, persist an immutable version in `dlpVersions`. Required fields are a stable `id`, `classId`, `audience: 'parent'`, `status: 'published'`, a version value, content, and `publishedAt`.

Create a separate `parentNotifications` document for each intended Parent recipient. Required fields are a stable `id`, `parentUserId`, `type: 'parent_dlp_shared'`, `classId`, `dlpVersionId` equal to the exact `dlpVersions.id` just published, title, and `createdAt`. Notify only Parents with a currently verified link to at least one Student in that class.

The Parent API verifies recipient identity, active linked-child class access, Parent audience, publication status, and class match before returning the referenced DLP version. It loads by the notification's exact `dlpVersionId`; it does not substitute a newer version. For a later revision, create a new immutable DLP version and new notification documents rather than repointing old notifications.

## Integration boundary

The Teacher/Principal routes and UI should be implemented by the partner owning those files. Their publish/update actions need to use the contracts above. No Teacher/Principal integration code or partner TypeScript files were changed as part of this work.
