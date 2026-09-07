// Migratable schema barrel — every table drizzle-kit manages (BQC-5.4).
//
// drizzle.config.ts points HERE, not at schema/index.ts: this barrel exports
// Every app-owned table across every module is exported here (no
// tablesFilter whitelist — the barrel itself is the boundary). The 8
// session, account, verification, organization, member, invitation,
// organizationRole) live in ./auth.ts, are managed by `pnpm auth:migrate`
// (the Better Auth schema API), and are deliberately NOT exported here.
//
// Keep this barrel in lockstep with ./index.ts minus ./auth.ts — the semantic
// drift test (../migration-verification.test.ts) fails if a migration-owned
// table is missing from the model.

export * from './ai.schema'
export * from './activity.schema'
export * from './audit'
export * from './beta-feedback-triage.schema'
export * from './dac.schema'
export * from './goal.schema'
export * from './google-connection.schema'
export * from './google-import-discovery.schema'
export * from './google-import-v2.schema'
export * from './google-content-control.schema'
export * from './guest.schema'
export * from './inbox.schema'
export * from './organization-lifecycle.schema'
export * from './backup-erasure-ledger.schema'
export * from './property-erase.schema'
export * from './privacy-request.schema'
export * from './metric.schema'
export * from './notification.schema'
export * from './outbox.schema'
export * from './people-access.schema'
export * from './policy.schema'
export * from './merchant-ai-authorization.schema'
export * from './portal.schema'
export * from './portal-group.schema'
export * from './property.schema'
export * from './recovery.schema'
export * from './dashboard.schema'
export * from './review.schema'
export * from './review-sync.schema'
