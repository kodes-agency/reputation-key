// Team context — public API surface for cross-context consumers.
// Shared infrastructure (event bus, testing) and other contexts consume
// domain types and event types from this barrel. Per ADR-0001.

export type { Team, TeamId } from '../domain/types'

export { teamCreated, teamUpdated, teamDeleted } from '../domain/events'
export type { TeamCreated, TeamUpdated, TeamDeleted, TeamEvent } from '../domain/events'

/**
 * Team public API — consumed by contexts that need team data lookups.
 * Currently minimal; expand as cross-context needs emerge.
 */

export type TeamPublicApi = Readonly<Record<string, never>>
