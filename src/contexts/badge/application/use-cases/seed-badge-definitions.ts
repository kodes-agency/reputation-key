// Badge context — seed system badge definitions

import type { BadgeRepository } from '../ports/badge.repository'
import type { BadgeDefinition } from '../../domain/types'
import { SYSTEM_BADGE_DEFINITIONS } from '../../domain/seed-badges'

export type SeedBadgeDefinitionsDeps = Readonly<{
  badgeRepo: BadgeRepository
}>

export const seedBadgeDefinitions =
  (deps: SeedBadgeDefinitionsDeps) =>
  async (): Promise<ReadonlyArray<BadgeDefinition>> => {
    return deps.badgeRepo.seedDefinitions(SYSTEM_BADGE_DEFINITIONS)
  }
