import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type AiPropertyTrendGenerationRequested = Readonly<{
  _tag: 'ai.property_trend.generation_requested'
  scheduleId: string
  organizationId: OrganizationId
  propertyId: PropertyId
}>
