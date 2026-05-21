// Schema barrel — Drizzle Kit reads this file as its single entry point.
// Downstream tasks (task-auth-schema, task-accounts-schema, etc.) append
// re-exports here as each module schema is implemented.
//
// Example of what downstream tasks will add:
//   export * from '../modules/auth/schema.js';
//   export * from '../modules/accounts/schema.js';
