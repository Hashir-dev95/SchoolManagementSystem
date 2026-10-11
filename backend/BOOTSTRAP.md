# Initial Super Admin provisioning

Bootstrap is disabled unless `SUPER_ADMIN_BOOTSTRAP_SECRET` is configured on the
server with at least 32 characters. Generate a cryptographically random value in
your secret manager. Do not place it in frontend configuration, URLs or logs.

During initial setup, send `POST /api/bootstrap/super-admin` over HTTPS with the
secret in the `X-Bootstrap-Secret` header and a JSON body containing only
`fullName`, `email`, `password` and optional `phone`. Passwords must contain at
least 12 characters and no more than 72 UTF-8 bytes. Unknown fields are rejected.
The role, active state and internal bootstrap marker are server-derived.

Responses: 201 on success; 403 for missing/incorrect request secret; 503 when
server configuration is absent/weak; 409 for existing Super Admin or conflicting
creation; 400 for invalid input; sanitized 500 for database failures.

All existing Super Admin accounts block bootstrap, including inactive accounts.
Unset the bootstrap secret after setup. Restore administrative access through
controlled administration rather than re-enabling bootstrap.

The endpoint awaits creation of the unique partial index
`unique_super_admin_bootstrap` on `users.bootstrapKey` before writing. The database
user needs permission to create this index. Existing users do not need migration:
documents without the marker are excluded. Failure to establish the index denies
provisioning. The bootstrapped account and marker are saved together using the
existing bcrypt/Mongoose creation path. Preserve the index and marker in backups.
Ordinary administrator creation is not restricted to one Super Admin.

No additional Super Admin management endpoint currently exists in this repository;
the existing authenticated `/api/admin/principals` route provisions Principals.
Do not use bootstrap as a general account-management API.

Terminate TLS at the server or trusted reverse proxy, redact this header and
credential bodies in infrastructure logs, and rate-limit/restrict the bootstrap
path at the proxy. There is currently no application rate-limit infrastructure.

Run `npm run test:bootstrap` for isolated HTTP/database security tests. The suite
starts its own temporary MongoDB server and never reads `.env`/`MONGODB_URI`.
Its first run may download the MongoDB binary. Existing manual database scripts
are deliberately excluded because they use the configured database.
