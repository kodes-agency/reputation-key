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

export type ReplyLibraryUpsertResult<T> = Readonly<{
  disposition: 'inserted' | 'updated' | 'unchanged'
  value: T
}>

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
  upsertTemplate(
    input: ReplyTemplateWrite,
  ): Promise<ReplyLibraryUpsertResult<PropertyReplyTemplate>>
}>
