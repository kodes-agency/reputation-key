/**
 * Change only in an owner-approved activation release, after the command-level
 * erasure replay proof and verification that every backup, including Manual,
 * is within the 30-day ceiling. A passing data restore alone is insufficient.
 * Queue payloads and operator enqueue confirmation cannot activate retention.
 */
export const SCHEDULED_RETENTION_ACTIVE: boolean = false
