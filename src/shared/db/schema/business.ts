// Business tables only — used by drizzle-kit for migrations.
// Auth tables (user, session, account, verification) live in ./auth.ts
// and are managed by `pnpm auth:migrate` (Better Auth CLI).
// Organization plugin tables (organization, member, invitation) are also
// managed by Better Auth CLI.

export * from './audit'
export * from './property.schema'
export * from './team.schema'
export * from './staff-assignment.schema'
export * from './portal.schema'
export * from './portal-group.schema'
export * from './guest.schema'
export * from './google-connection.schema'
export * from './gbp-cache.schema'
export * from './gbp-import-job.schema'
export * from './review.schema'
export * from './inbox.schema'
export * from './metric.schema'
export * from './goal.schema'
