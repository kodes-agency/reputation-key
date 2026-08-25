// Portal context — row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { portals } from '#/shared/db/schema/portal.schema'
import type { Portal, PortalTheme, EntityType } from '../../domain/types'
import type { PropertyId, TeamId, UserId } from '#/shared/domain/ids'
import {
  portalId,
  organizationId,
  propertyId,
  teamId,
  userId,
  unbrand,
} from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import type { PortalPublicationState } from '../../domain/portal-publication'

type PortalRow = typeof portals.$inferSelect
type PortalInsertRow = typeof portals.$inferInsert

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set(['property', 'team', 'staff'])

function parseEntityType(value: string): EntityType {
  if (!VALID_ENTITY_TYPES.has(value)) {
    throw portalError('portal_not_found', `[portal.mapper] invalid entityType: ${value}`)
  }
  return value as EntityType
}

const VALID_PUBLICATION_STATES: ReadonlySet<string> = new Set([
  'draft',
  'published',
  'disabled',
  'archived',
])

function parsePublicationState(value: string): PortalPublicationState {
  if (!VALID_PUBLICATION_STATES.has(value)) {
    throw portalError(
      'portal_not_found',
      `[portal.mapper] invalid publication state: ${value}`,
    )
  }
  return value as PortalPublicationState
}

function brandEntityId(
  value: string,
  entityType: EntityType,
): PropertyId | TeamId | UserId {
  switch (entityType) {
    case 'team':
      return teamId(value)
    case 'staff':
      return userId(value)
    default:
      return propertyId(value)
  }
}

function parseTheme(value: Record<string, unknown> | null): PortalTheme {
  const raw = value ?? { primaryColor: '#6366F1' }
  if (typeof raw.primaryColor !== 'string') {
    throw portalError(
      'portal_not_found',
      '[portal.mapper] invalid theme: missing primaryColor',
    )
  }
  return {
    primaryColor: raw.primaryColor,
    ...(typeof raw.backgroundColor === 'string' && {
      backgroundColor: raw.backgroundColor,
    }),
    ...(typeof raw.textColor === 'string' && { textColor: raw.textColor }),
  }
}

export const portalFromRow = (row: PortalRow): Portal => ({
  id: portalId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  entityType: parseEntityType(row.entityType),
  entityId: brandEntityId(row.entityId, parseEntityType(row.entityType)),
  name: row.name,
  slug: row.slug,
  description: row.description,
  heroImageUrl: row.heroImageUrl,
  theme: parseTheme(row.theme as Record<string, unknown> | null),
  privateFeedbackThreshold: row.privateFeedbackThreshold,
  publicationState: parsePublicationState(row.publicationState),
  createdBy: row.createdBy ? userId(row.createdBy) : null,
  responsibleManagerRevision: row.responsibleManagerRevision,
  responsibilityNeededSince: row.responsibilityNeededSince,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
})

export const portalToRow = (portal: Portal): PortalInsertRow => ({
  id: unbrand(portal.id),
  organizationId: unbrand(portal.organizationId),
  propertyId: unbrand(portal.propertyId),
  entityType: portal.entityType,
  entityId: unbrand(portal.entityId),
  name: portal.name,
  slug: portal.slug,
  description: portal.description,
  heroImageUrl: portal.heroImageUrl,
  theme: portal.theme as Record<string, unknown>,
  privateFeedbackThreshold: portal.privateFeedbackThreshold,
  publicationState: portal.publicationState,
  createdBy: portal.createdBy ? unbrand(portal.createdBy) : null,
  responsibleManagerRevision: portal.responsibleManagerRevision,
  responsibilityNeededSince: portal.responsibilityNeededSince,
  createdAt: portal.createdAt,
  updatedAt: portal.updatedAt,
  deletedAt: portal.deletedAt,
})
