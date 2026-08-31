// Team context — historical compatibility barrel.
//
// It remains only for retained tests/tooling while Team data is reconciled.
// Production contexts must not import it; the runtime-contraction architecture
// pin enforces that boundary.

export type { Team, TeamId } from '../domain/types'

export { teamCreated, teamUpdated, teamDeleted } from '../domain/events'
export type { TeamCreated, TeamUpdated, TeamDeleted, TeamEvent } from '../domain/events'

/** Empty by design: Portal Groups are the supported grouping model. */
export type TeamPublicApi = Readonly<Record<string, never>>
