// Team context — retained historical decoding types.
//
// Reconciliation and restore readers may decode retained Team rows and event
// envelopes. Team exposes no runtime command, request, or repository surface.

export type { Team, TeamId } from '../domain/types'

export type { TeamCreated, TeamUpdated, TeamDeleted, TeamEvent } from '../domain/events'
