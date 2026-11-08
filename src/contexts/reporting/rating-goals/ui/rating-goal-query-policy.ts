import { dashboardKeys, goalKeys, propertyKeys } from '#/shared/queries/query-keys'

export const ratingGoalRelatedKeys = (propertyId: string) => [
  propertyKeys.setup(propertyId),
  propertyKeys.setupSummaries(),
  dashboardKeys.fleets(),
]

export const ratingGoalMutationKeys = (propertyId: string) => [
  goalKeys.ratingGoal(propertyId),
  ...ratingGoalRelatedKeys(propertyId),
]
