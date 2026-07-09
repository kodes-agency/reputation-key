// Badge context — smart constructors

import type { BadgeId } from '#/shared/domain/ids'
import type { BadgeCriteria, BadgeDefinition, BadgeSeedDefinitionInput } from './types'

export function createBadgeDefinition(
  input: BadgeSeedDefinitionInput,
  clock: () => Date,
  idGen: () => BadgeId,
): BadgeDefinition {
  const now = clock()
  return {
    id: idGen(),
    key: input.key,
    name: input.name,
    description: input.description,
    icon: input.icon,
    targetScope: input.targetScope,
    criteriaVersion: input.criteriaVersion ?? 1,
    criteria: input.criteria,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  }
}

export const normalizeBadgeCriteria = (criteria: BadgeCriteria): BadgeCriteria => ({
  aggregation: criteria.aggregation ?? 'sum',
  period: criteria.period ?? 'all_time',
  ...criteria,
})
