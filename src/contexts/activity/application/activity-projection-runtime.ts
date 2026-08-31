// Activity context — Recent Activity projection runtime.
//
// ARC-03-T12: the container used to publish Activity's recent-activity
// REPOSITORY so bootstrap could assemble the projection job itself. That put a
// repository in the container's vocabulary and split one context's wiring
// across two files. Activity now owns the whole projection; the worker
// registers a job that calls this capability with the job payload.

import {
  projectRecentActivity,
  type ProjectRecentActivityDeps,
  type ProjectRecentActivityInput,
} from './use-cases/project-recent-activity'

export type ActivityProjectionRuntime = Readonly<{
  /** Project one activity fact into the Recent Activity read model. */
  projectRecentActivity: (input: ProjectRecentActivityInput) => Promise<void>
}>

export function createActivityProjectionRuntime(
  deps: ProjectRecentActivityDeps,
): ActivityProjectionRuntime {
  return Object.freeze({ projectRecentActivity: projectRecentActivity(deps) })
}
