// Badge context — DTOs and Zod validators

import { z } from 'zod/v4'

export const badgeTargetScopeSchema = z.enum(['portal', 'portal_group'])
export const badgeTargetTypeSchema = z.enum(['portal', 'portal_group'])
export const badgeCriteriaOperatorSchema = z.enum(['>=', '<='])
export const badgePeriodPresetSchema = z.enum([
  'today',
  'this_week',
  'this_month',
  'this_quarter',
  'all_time',
  'last_7_days',
  'last_30_days',
  'last_90_days',
])

export const badgeCriteriaSchema = z.object({
  type: z.enum(['threshold', 'streak', 'milestone']),
  metricKey: z.string().min(1),
  operator: badgeCriteriaOperatorSchema,
  threshold: z.number(),
  aggregation: z.enum(['sum', 'count', 'avg', 'max']).optional(),
  period: badgePeriodPresetSchema.optional(),
  streakDays: z.number().int().positive().optional(),
  dailyThreshold: z.number().positive().optional(),
})

export const evaluateBadgeForTargetSchema = z.object({
  organizationId: z.string().uuid(),
  propertyId: z.string().uuid(),
  targetType: badgeTargetTypeSchema,
  targetId: z.string().uuid(),
})

export const reconcileBadgeDefinitionsSchema = z.object({
  organizationId: z.string().uuid().optional(),
})

export const getVisibleTargetBadgesSchema = z.object({
  propertyId: z.string().uuid(),
  targetType: badgeTargetTypeSchema,
  targetId: z.string().uuid(),
})

export const getStaffVisibleBadgesSchema = z.object({
  propertyId: z.string().uuid(),
  limit: z.number().int().positive().max(50).optional(),
})

export const setOrganizationBadgeEnablementSchema = z.object({
  // organizationId is resolved from the authenticated session in the handler,
  // never from client input (per cross-context architecture contract).
  badgeDefinitionId: z.string().uuid(),
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
