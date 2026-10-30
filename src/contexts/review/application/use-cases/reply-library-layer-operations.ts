import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyId, type PropertyId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { BUILTIN_REPLY_LIBRARY } from '#/shared/reply-library/builtin-library'
import { REPLY_TEMPLATE_LANGUAGE_GROUPS } from '#/shared/reply-language-catalogue'
import { checkReplyText } from '#/shared/reply-library/reply-checks'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import type {
  GetReplyLibraryInput,
  ReplyLibraryDto,
  ResetReplyTemplateInput,
  SaveReplyTemplateInput,
  SaveReplyVoiceInput,
  SetReplyTemplateHiddenInput,
} from '../dto/reply-library.dto'
import type {
  ReplyLibraryRepository,
  ReplyLibrarySnapshot,
} from '../ports/reply-library.repository'
import { resolveReplyLibraryTemplates } from '../reply-library-resolver'
import { reviewError } from '../../domain/errors'

type ReplyLibraryDeps = Readonly<{
  repository: ReplyLibraryRepository
  staffPublicApi: StaffPublicApi
}>

type ReplyLibraryAccess = 'reply.manage' | 'reply_library.manage'

// Reading the library is Inbox work (`reply.manage`, PropertyManagers see it read-only);
// changing it is `reply_library.manage` (AccountAdmins), ADR 0073 decision 11.
async function requireSnapshot(
  deps: ReplyLibraryDeps,
  inputPropertyId: string,
  ctx: AuthContext,
  access: ReplyLibraryAccess = 'reply_library.manage',
): Promise<Readonly<{ propertyId: PropertyId; snapshot: ReplyLibrarySnapshot }>> {
  if (!canForContext(ctx, access)) {
    throw reviewError(
      'unauthorized',
      access === 'reply.manage'
        ? 'You cannot use reply templates'
        : 'Only AccountAdmins can manage the reply library',
    )
  }
  const id = propertyId(inputPropertyId)
  const accessible = await isPropertyAccessibleForPermission(
    (orgId, userId, orgWide) =>
      deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
    ctx,
    access,
    id,
  )
  if (!accessible) throw reviewError('forbidden', 'No access to this property')
  const snapshot = await deps.repository.loadSnapshot(ctx.organizationId, id)
  if (!snapshot) throw reviewError('property_not_found', 'Property not found')
  return { propertyId: id, snapshot }
}

function publicLibrary(snapshot: ReplyLibrarySnapshot): ReplyLibraryDto {
  return {
    voice: resolveVoice(
      BUILTIN_REPLY_VOICE,
      snapshot.accountVoice,
      snapshot.propertyVoice,
    ),
    voiceVersion: {
      account: snapshot.accountVoice?.version ?? 0,
      property: snapshot.propertyVoice?.version ?? 0,
    },
    templates: resolveReplyLibraryTemplates({
      builtin: BUILTIN_REPLY_LIBRARY,
      accountTemplates: snapshot.accountTemplates,
      propertyTemplates: snapshot.propertyTemplates,
      visibility: snapshot.visibility,
    }),
    supportedLanguages: REPLY_TEMPLATE_LANGUAGE_GROUPS,
  }
}

async function reload(deps: ReplyLibraryDeps, property: PropertyId, ctx: AuthContext) {
  const snapshot = await deps.repository.loadSnapshot(ctx.organizationId, property)
  if (!snapshot) throw reviewError('property_not_found', 'Property not found')
  return publicLibrary(snapshot)
}

export type GetReplyLibrary = ReturnType<typeof getReplyLibrary>
export const getReplyLibrary =
  (deps: ReplyLibraryDeps) =>
  async (input: GetReplyLibraryInput, ctx: AuthContext): Promise<ReplyLibraryDto> => {
    const { snapshot } = await requireSnapshot(
      deps,
      input.propertyId,
      ctx,
      'reply.manage',
    )
    return {
      ...publicLibrary(snapshot),
      canManage: canForContext(ctx, 'reply_library.manage'),
    }
  }

export type SaveReplyVoice = ReturnType<typeof saveReplyVoice>
export const saveReplyVoice =
  (deps: ReplyLibraryDeps) =>
  async (input: SaveReplyVoiceInput, ctx: AuthContext): Promise<ReplyLibraryDto> => {
    const { propertyId: id } = await requireSnapshot(deps, input.propertyId, ctx)
    const saved = await deps.repository.saveVoice({
      organizationId: ctx.organizationId,
      propertyId: id,
      scope: input.scope,
      set: input.set,
      reset: input.reset,
      ...(input.localized === undefined ? {} : { localized: input.localized }),
      expectedVersion: input.expectedVersion,
      actorId: String(ctx.userId),
    })
    if (saved === 'version_conflict') {
      throw reviewError(
        'invalid_input',
        'Reply voice changed by someone else. Reload to see the latest.',
      )
    }
    return reload(deps, id, ctx)
  }

function assertSafeTemplate(input: SaveReplyTemplateInput): void {
  const findingCodes = input.wordings.flatMap((wording) =>
    checkReplyText({
      text: wording.body,
      kind: 'template_body',
      rating: input.starsMin,
      reviewKind: input.reviewKind,
      languageGroup: wording.languageGroup,
      privacyMode: false,
      emojiAllowed: false,
    }).blocks.map(({ code }) => code),
  )
  if (findingCodes.length > 0) {
    throw reviewError('invalid_input', 'Reply template contains blocked text', {
      findingCodes: [...new Set(findingCodes)],
    })
  }
}

export type SaveReplyTemplate = ReturnType<typeof saveReplyTemplate>
export const saveReplyTemplate =
  (deps: ReplyLibraryDeps) =>
  async (input: SaveReplyTemplateInput, ctx: AuthContext): Promise<ReplyLibraryDto> => {
    const { propertyId: id, snapshot } = await requireSnapshot(
      deps,
      input.propertyId,
      ctx,
    )
    assertSafeTemplate(input)
    if (
      input.base !== undefined &&
      !resolveReplyLibraryTemplates({
        builtin: BUILTIN_REPLY_LIBRARY,
        accountTemplates: snapshot.accountTemplates,
        propertyTemplates: snapshot.propertyTemplates,
        visibility: snapshot.visibility,
      }).some(({ ref }) => ref === input.base)
    ) {
      throw reviewError('invalid_input', 'Reply template base is unavailable')
    }
    const saved = await deps.repository.saveTemplate({
      organizationId: ctx.organizationId,
      propertyId: id,
      scope: input.scope,
      ...(input.base === undefined ? {} : { base: input.base }),
      ...(input.templateId === undefined ? {} : { templateId: input.templateId }),
      title: input.title,
      starsMin: input.starsMin,
      starsMax: input.starsMax,
      reviewKind: input.reviewKind,
      topic: input.topic,
      wordings: input.wordings,
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion }),
      actorId: String(ctx.userId),
    })
    if (saved === 'base_unavailable') {
      throw reviewError('invalid_input', 'Reply template base is unavailable')
    }
    if (saved === 'version_conflict') {
      throw reviewError(
        'invalid_input',
        'Reply template changed by someone else. Reload to see the latest.',
      )
    }
    return reload(deps, id, ctx)
  }

export type SetReplyTemplateHidden = ReturnType<typeof setReplyTemplateHidden>
export const setReplyTemplateHidden =
  (deps: ReplyLibraryDeps) =>
  async (
    input: SetReplyTemplateHiddenInput,
    ctx: AuthContext,
  ): Promise<ReplyLibraryDto> => {
    const { propertyId: id, snapshot } = await requireSnapshot(
      deps,
      input.propertyId,
      ctx,
    )
    const exists =
      input.scope === 'account'
        ? (input.ref.startsWith('builtin:') &&
            BUILTIN_REPLY_LIBRARY.templates.some(
              ({ key }) => input.ref === `builtin:${key}`,
            )) ||
          snapshot.accountTemplates.some(
            ({ id: templateId }) => input.ref === `template:${templateId}`,
          )
        : resolveReplyLibraryTemplates({
            builtin: BUILTIN_REPLY_LIBRARY,
            accountTemplates: snapshot.accountTemplates,
            propertyTemplates: snapshot.propertyTemplates,
            visibility: snapshot.visibility,
          }).some(({ ref }) => ref === input.ref)
    if (!exists) throw reviewError('invalid_input', 'Reply template is unavailable')
    await deps.repository.setHidden({
      organizationId: ctx.organizationId,
      propertyId: id,
      scope: input.scope,
      ref: input.ref,
      hidden: input.hidden,
      actorId: String(ctx.userId),
    })
    return reload(deps, id, ctx)
  }

export type ResetReplyTemplate = ReturnType<typeof resetReplyTemplate>
export const resetReplyTemplate =
  (deps: ReplyLibraryDeps) =>
  async (input: ResetReplyTemplateInput, ctx: AuthContext): Promise<ReplyLibraryDto> => {
    const { propertyId: id } = await requireSnapshot(deps, input.propertyId, ctx)
    const archived = await deps.repository.archiveCustomization({
      organizationId: ctx.organizationId,
      propertyId: id,
      scope: input.scope,
      ref: input.ref,
      actorId: String(ctx.userId),
    })
    if (!archived)
      throw reviewError('invalid_input', 'Reply customization is unavailable')
    return reload(deps, id, ctx)
  }
