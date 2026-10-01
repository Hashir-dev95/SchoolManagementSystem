# Backend scope

- Keep backend implementation in this directory using JavaScript (`.js`) only.
- Do not edit existing TypeScript files or shared project configuration.
- Keep routes, validation, MongoDB models, and database setup in separate modules where practical.
- Load database connection settings from environment variables and fail startup clearly when they are missing.
- Do not add an in-memory fallback for database-backed records.
- Do not claim persistence or authentication that has not been implemented.
- If integration requires changes to TypeScript or shared configuration, provide a separate snippet and explain where it belongs; do not apply it.
- Verify JavaScript syntax and API behavior with focused checks.
