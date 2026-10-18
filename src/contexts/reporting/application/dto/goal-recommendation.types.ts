// Monthly portal goal — what the recommendation read returns (types only).
//
// No zod and no values: a component imports these with `import type`, so
// nothing here reaches a bundle (PLAN E10). The shapes are the domain's own
// (`domain/goal-recommendation-types.ts`); each is re-exported here when a
// reader outside Reporting's domain first needs it.

export type {
  PortalGoalMeasure,
  PortalGoalRatio,
  PortalGoalRecommendation,
} from '../../domain/goal-recommendation-types'
