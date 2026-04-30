// Portal context — domain constructors (smart constructors)
// Per architecture: "Build domain entities from raw input, composing all validations,
// returning a Result."
// Pure — ID and time are inputs, no side effects.

import { Result } from 'neverthrow'
import type {
  Portal,
  PortalId,
  PortalLinkCategory,
  PortalLink,
  PortalTheme,
} from './types'
import type { PortalLinkCategoryId, PortalLinkId } from '#/shared/domain/ids'
import type { PortalError } from './errors'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  normalizeSlug,
  validateSlug,
  validatePortalName,
  validateDescription,
  validatePortalTheme,
  validateSmartRoutingThreshold,
  validateUrl,
  validateLinkLabel,
  validateCategoryTitle,
} from './rules'

// ── Portal constructor ─────────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type BuildPortalInput = Readonly<{
  id: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  entityType?: 'property' | 'team' | 'staff'
  entityId?: string
  name: string
  providedSlug?: string
  description?: string | null
  theme?: Partial<PortalTheme>
  smartRoutingEnabled?: boolean
  smartRoutingThreshold?: number
  now: Date
}>

export const buildPortal = (input: BuildPortalInput): Result<Portal, PortalError> => {
  const nameResult = validatePortalName(input.name)
  const slug = validateSlug(input.providedSlug ?? normalizeSlug(input.name))
  const desc = validateDescription(input.description ?? null)
  const defaultTheme: PortalTheme = { primaryColor: '#6366F1' }
  const theme = validatePortalTheme(input.theme ?? defaultTheme)
  const threshold = validateSmartRoutingThreshold(input.smartRoutingThreshold ?? 4)

  return Result.combine([nameResult, slug, desc, theme, threshold]).map(
    ([validName, validSlug, validDesc, validTheme, validThreshold]): Portal => ({
      id: input.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: input.entityType ?? 'property',
      entityId: input.entityId ?? input.propertyId,
      name: validName,
      slug: validSlug,
      description: validDesc,
      heroImageUrl: null,
      theme: validTheme,
      smartRoutingEnabled: input.smartRoutingEnabled ?? false,
      smartRoutingThreshold: validThreshold,
      isActive: true,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }),
  )
}

// ── PortalLinkCategory constructor ─────────────────────────────────

// fallow-ignore-next-line unused-type
export type BuildCategoryInput = Readonly<{
  id: PortalLinkCategoryId
  portalId: PortalId
  organizationId: OrganizationId
  title: string
  sortKey: string
  now: Date
}>

export const buildPortalLinkCategory = (
  input: BuildCategoryInput,
): Result<PortalLinkCategory, PortalError> => {
  const title = validateCategoryTitle(input.title)
  return title.map(
    (validTitle): PortalLinkCategory => ({
      id: input.id,
      portalId: input.portalId,
      organizationId: input.organizationId,
      title: validTitle,
      sortKey: input.sortKey,
      createdAt: input.now,
      updatedAt: input.now,
    }),
  )
}

// ── PortalLink constructor ─────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type BuildLinkInput = Readonly<{
  id: PortalLinkId
  categoryId: PortalLinkCategoryId
  portalId: PortalId
  organizationId: OrganizationId
  label: string
  url: string
  iconKey?: string | null
  sortKey: string
  now: Date
}>

export const buildPortalLink = (
  input: BuildLinkInput,
): Result<PortalLink, PortalError> => {
  const label = validateLinkLabel(input.label)
  const url = validateUrl(input.url)
  return Result.combine([label, url]).map(
    ([validLabel, validUrl]): PortalLink => ({
      id: input.id,
      categoryId: input.categoryId,
      portalId: input.portalId,
      organizationId: input.organizationId,
      label: validLabel,
      url: validUrl,
      iconKey: input.iconKey ?? null,
      sortKey: input.sortKey,
      createdAt: input.now,
      updatedAt: input.now,
    }),
  )
}
