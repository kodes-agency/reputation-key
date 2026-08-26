// Badge context — DTOs and Zod validators

import { z } from 'zod/v4'

const badgeTargetTypeSchema = z.enum(['portal', 'portal_group'])

export const getVisibleTargetBadgesSchema = z.object({
  propertyId: z.uuid(),
  targetType: badgeTargetTypeSchema,
  targetId: z.uuid(),
})

export const getStaffVisibleBadgesSchema = z.object({
  propertyId: z.uuid(),
  limit: z.number().int().positive().max(50).optional(),
})

export const setOrganizationBadgeEnablementSchema = z.object({
  // organizationId is resolved from the authenticated session in the handler,
  // never from client input (per cross-context architecture contract).
  badgeDefinitionId: z.uuid(),
  enabled: z.boolean(),
})

export type GetVisibleTargetBadgesInput = z.infer<typeof getVisibleTargetBadgesSchema>
export type GetStaffVisibleBadgesInput = z.infer<typeof getStaffVisibleBadgesSchema>
export type SetOrganizationBadgeEnablementInput = z.infer<
  typeof setOrganizationBadgeEnablementSchema
>

export type BadgeCriteriaSummary = Readonly<{
  type: string
  metricKey: string
  operator: string
  threshold: number
  aggregation?: string
  period?: string
  streakDays?: number
  dailyThreshold?: number
}>

export type BadgeDefinitionWithEnablementOutput = Readonly<{
  id: string
  key: string
  name: string
  description: string | null
  icon: string
  targetScope: string
  criteria: BadgeCriteriaSummary
  orgEnabled: boolean
}>
