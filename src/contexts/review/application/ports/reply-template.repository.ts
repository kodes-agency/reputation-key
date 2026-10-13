import type { ReplyTemplateAspect } from '#/shared/aspect-taxonomy'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { StarRating } from '../../domain/types'

export type PropertyReplyProfile = Readonly<{
  id: string
  organizationId: OrganizationId
  propertyId: PropertyId
  greeting: string
  signOffPositive: string
  signOffNegative: string
  emojiAllowed: boolean
  escalationContact: string | null
  version: number
  updatedBy: UserId | string
  createdAt: Date
  updatedAt: Date
}>

export type PropertyReplyTemplate = Readonly<{
  id: string
  organizationId: OrganizationId
  propertyId: PropertyId
  title: string
  ratingMin: number
  ratingMax: number
  hasText: boolean
  aspect: ReplyTemplateAspect | null
  openLabel: string | null
  languageTag: string
  body: string
  enabled: boolean
  version: number
  updatedBy: UserId | string
  createdAt: Date
  updatedAt: Date
}>

export type ReplyProfileWrite = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  greeting: string
  signOffPositive: string
  signOffNegative: string
  emojiAllowed: boolean
  escalationContact: string | null
  updatedBy: string
}>

export type ReplyTemplateWrite = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  title: string
  ratingMin: number
  ratingMax: number
  hasText: boolean
  aspect: ReplyTemplateAspect | null
  openLabel: string | null
  languageTag: string
  body: string
  enabled: boolean
  updatedBy: string
}>
export type ReplyTemplateUpdate = ReplyTemplateWrite &
  Readonly<{
    templateId: string
  }>
export type ReplyTemplateEnabledUpdate = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  templateId: string
  enabled: boolean
  updatedBy: string
}>

export type ReplyLibraryUpsertResult<T> = Readonly<{
  disposition: 'inserted' | 'updated' | 'unchanged'
  value: T
}>

/** Nothing was written: another template of the Property holds the title. */
export type ReplyTemplateTitleTaken = Readonly<{ disposition: 'title_taken' }>

export type ReplyTemplateRepository = Readonly<{
  findPropertyOrganization(propertyId: PropertyId): Promise<OrganizationId | null>
  findProfile(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<PropertyReplyProfile | null>
  findApplicableTemplates(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    rating: StarRating
    hasText: boolean
  }): Promise<readonly PropertyReplyTemplate[]>
  listPropertyTemplates(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<readonly PropertyReplyTemplate[]>
  findEnabledTemplateById(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    templateId: string
  }): Promise<PropertyReplyTemplate | null>
  readDefaultReplyLanguage(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<string | null>
  upsertProfile(
    input: ReplyProfileWrite,
  ): Promise<ReplyLibraryUpsertResult<PropertyReplyProfile>>
  /**
   * Title-keyed, for the operations importer only: a re-import updates the
   * template that holds the title. Settings never calls it.
   */
  upsertTemplate(
    input: ReplyTemplateWrite,
  ): Promise<ReplyLibraryUpsertResult<PropertyReplyTemplate>>
  /** A new template. A title the Property already uses is never overwritten. */
  createTemplate(
    input: ReplyTemplateWrite,
  ): Promise<ReplyLibraryUpsertResult<PropertyReplyTemplate> | ReplyTemplateTitleTaken>
  updateTemplate(
    input: ReplyTemplateUpdate,
  ): Promise<
    ReplyLibraryUpsertResult<PropertyReplyTemplate> | ReplyTemplateTitleTaken | null
  >
  setTemplateEnabled(
    input: ReplyTemplateEnabledUpdate,
  ): Promise<ReplyLibraryUpsertResult<PropertyReplyTemplate> | null>
}>
