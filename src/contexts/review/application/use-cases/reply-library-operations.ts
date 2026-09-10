import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyId, type PropertyId } from '#/shared/domain/ids'
import {
  replyProfileValuesSchema,
  replyTemplateValuesSchema,
  type PropertyReplyLibraryInput,
  type ReplyProfileValues,
  type ReplyTemplateValues,
  type SavePropertyReplyProfileInput,
  type SavePropertyReplyTemplateInput,
  type SetPropertyReplyTemplateEnabledInput,
} from '../dto/reply-library.dto'
import type {
  PropertyReplyProfile,
  PropertyReplyTemplate,
  ReplyLibraryUpsertResult,
  ReplyTemplateRepository,
} from '../ports/reply-template.repository'
import { reviewError } from '../../domain/errors'
import { assertReplyPropertyAccessible, requireReplyManager } from './reply-access'

export type PropertyReplyLibraryProfile = ReplyProfileValues &
  Readonly<{ version: number }>

export type PropertyReplyLibraryTemplate = ReplyTemplateValues &
  Readonly<{
    id: string
    version: number
  }>

export type PropertyReplyLibrary = Readonly<{
  profile: PropertyReplyLibraryProfile | null
  templates: readonly PropertyReplyLibraryTemplate[]
  defaultLanguageTag: string | null
}>

export type PropertyReplyLibraryWriteResult<T> = Readonly<{
  disposition: ReplyLibraryUpsertResult<T>['disposition']
  value: T
}>

export type GetPropertyReplyLibrary = (
  input: PropertyReplyLibraryInput,
  ctx: AuthContext,
) => Promise<PropertyReplyLibrary>

export type SavePropertyReplyProfile = (
  input: SavePropertyReplyProfileInput,
  ctx: AuthContext,
) => Promise<PropertyReplyLibraryWriteResult<PropertyReplyLibraryProfile>>

export type SavePropertyReplyTemplate = (
  input: SavePropertyReplyTemplateInput,
  ctx: AuthContext,
) => Promise<PropertyReplyLibraryWriteResult<PropertyReplyLibraryTemplate>>

export type SetPropertyReplyTemplateEnabled = (
  input: SetPropertyReplyTemplateEnabledInput,
  ctx: AuthContext,
) => Promise<PropertyReplyLibraryWriteResult<PropertyReplyLibraryTemplate>>

type ReplyLibraryDeps = Readonly<{
  repository: ReplyTemplateRepository
  staffPublicApi: StaffPublicApi
}>

function publicProfile(profile: PropertyReplyProfile): PropertyReplyLibraryProfile {
  return {
    greeting: profile.greeting,
    signOffPositive: profile.signOffPositive,
    signOffNegative: profile.signOffNegative,
    emojiAllowed: profile.emojiAllowed,
    escalationContact: profile.escalationContact,
    version: profile.version,
  }
}

function publicTemplate(template: PropertyReplyTemplate): PropertyReplyLibraryTemplate {
  return {
    id: template.id,
    title: template.title,
    ratingMin: template.ratingMin,
    ratingMax: template.ratingMax,
    hasText: template.hasText,
    aspect: template.aspect,
    openLabel: template.openLabel,
    languageTag: template.languageTag,
    body: template.body,
    enabled: template.enabled,
    version: template.version,
  }
}

async function requireProperty(
  deps: ReplyLibraryDeps,
  input: PropertyReplyLibraryInput,
  ctx: AuthContext,
): Promise<PropertyId> {
  requireReplyManager(ctx)
  const id = propertyId(input.propertyId)
  await assertReplyPropertyAccessible(deps, ctx, id)
  const owner = await deps.repository.findPropertyOrganization(id)
  if (owner !== ctx.organizationId) {
    throw reviewError('property_not_found', 'Property not found')
  }
  return id
}

function parseProfile(input: ReplyProfileValues): ReplyProfileValues {
  const result = replyProfileValuesSchema.safeParse(input)
  if (!result.success) {
    throw reviewError(
      'invalid_input',
      result.error.issues[0]?.message ?? 'Reply profile is invalid',
    )
  }
  return result.data
}

function parseTemplate(input: ReplyTemplateValues): ReplyTemplateValues {
  const result = replyTemplateValuesSchema.safeParse(input)
  if (!result.success) {
    throw reviewError(
      'invalid_input',
      result.error.issues[0]?.message ?? 'Reply template is invalid',
    )
  }
  return result.data
}

function templateWrite(
  template: ReplyTemplateValues,
  scope: Readonly<{
    organizationId: AuthContext['organizationId']
    propertyId: PropertyId
    updatedBy: string
  }>,
) {
  return { ...scope, ...template }
}

export const getPropertyReplyLibrary =
  (deps: ReplyLibraryDeps): GetPropertyReplyLibrary =>
  async (input, ctx) => {
    const id = await requireProperty(deps, input, ctx)
    const [profile, templates, defaultLanguageTag] = await Promise.all([
      deps.repository.findProfile(ctx.organizationId, id),
      deps.repository.listPropertyTemplates(ctx.organizationId, id),
      deps.repository.readDefaultReplyLanguage(ctx.organizationId, id),
    ])
    return {
      profile: profile === null ? null : publicProfile(profile),
      templates: templates.map(publicTemplate),
      defaultLanguageTag,
    }
  }

export const savePropertyReplyProfile =
  (deps: ReplyLibraryDeps): SavePropertyReplyProfile =>
  async (input, ctx) => {
    const id = await requireProperty(deps, input, ctx)
    const result = await deps.repository.upsertProfile({
      organizationId: ctx.organizationId,
      propertyId: id,
      ...parseProfile(input.profile),
      updatedBy: String(ctx.userId),
    })
    return { disposition: result.disposition, value: publicProfile(result.value) }
  }

export const savePropertyReplyTemplate =
  (deps: ReplyLibraryDeps): SavePropertyReplyTemplate =>
  async (input, ctx) => {
    const id = await requireProperty(deps, input, ctx)
    const write = templateWrite(parseTemplate(input.template), {
      organizationId: ctx.organizationId,
      propertyId: id,
      updatedBy: String(ctx.userId),
    })
    const result = input.templateId
      ? await deps.repository.updateTemplate({ ...write, templateId: input.templateId })
      : await deps.repository.upsertTemplate(write)
    if (result === null) {
      throw reviewError('invalid_input', 'Reply template is unavailable')
    }
    return { disposition: result.disposition, value: publicTemplate(result.value) }
  }

export const setPropertyReplyTemplateEnabled =
  (deps: ReplyLibraryDeps): SetPropertyReplyTemplateEnabled =>
  async (input, ctx) => {
    const id = await requireProperty(deps, input, ctx)
    const result = await deps.repository.setTemplateEnabled({
      organizationId: ctx.organizationId,
      propertyId: id,
      templateId: input.templateId,
      enabled: input.enabled,
      updatedBy: String(ctx.userId),
    })
    if (result === null) {
      throw reviewError('invalid_input', 'Reply template is unavailable')
    }
    return { disposition: result.disposition, value: publicTemplate(result.value) }
  }
