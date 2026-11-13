// EntryPointCatalogue — BQC-2.1 / STD-P1-02 / SPEC-P0-03.
//
// Runtime policy data for every governed delayed entry point, derived from the job
// and consumer definitions. The system
// execution policy and delayed execution gate read these rows and fail closed
// on an unknown job, consumer, schedule, or action.
//
// Row vocabulary:
//   kind           — job | consumer | schedule
//   action         — SystemAction evaluated immediately before execution
//   capability     — beta capability gate; 'none' when ungated
//   resourceScope  — organization | property | tenant_cross | none
//   externalEffect — whether the action requires a fresh policy read
//   name           — job, consumer module, or recurring schedule name
//
// Every row of one action declares the same resourceScope: a tenant-cross
// sweep and the per-item work it discovers are different actions.

import { CONSUMER_ENTRY_POINTS } from '#/shared/events/consumer-entry-points'
import { JOB_ENTRY_POINTS, SCHEDULE_ENTRY_POINTS } from '#/shared/jobs/job-definitions'
import type {
  EntryPointKind,
  EntryPointRow,
  ResourceScope,
  SystemAction,
} from '#/shared/domain/entry-point-types'

export type { EntryPointKind, EntryPointRow, ResourceScope, SystemAction }

export const ENTRY_POINT_CATALOGUE: ReadonlyArray<EntryPointRow> = [
  ...JOB_ENTRY_POINTS,
  ...CONSUMER_ENTRY_POINTS,
  ...SCHEDULE_ENTRY_POINTS,
]
