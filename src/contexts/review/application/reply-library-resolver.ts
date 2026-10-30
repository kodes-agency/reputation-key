import {
  BUILTIN_REPLY_LIBRARY_VERSION_NUMBER,
  type BuiltinReplyLibrary,
} from '#/shared/reply-library/builtin-library'
import type { ReplyLibraryRef, ReplyLibraryTemplateDto } from './dto/reply-library.dto'
import type {
  StoredReplyTemplate,
  StoredReplyTemplateVisibility,
} from './ports/reply-library.repository'

type ResolveInput = Readonly<{
  builtin: BuiltinReplyLibrary
  accountTemplates: readonly StoredReplyTemplate[]
  propertyTemplates: readonly StoredReplyTemplate[]
  visibility: readonly StoredReplyTemplateVisibility[]
}>

function templateRef(id: string): ReplyLibraryRef {
  return `template:${id}` as ReplyLibraryRef
}

function builtinRef(key: string): ReplyLibraryRef {
  return `builtin:${key}` as ReplyLibraryRef
}

function groupedWordings(
  template: StoredReplyTemplate,
): ReplyLibraryTemplateDto['wordings'] {
  const groups: Record<string, { key: string; body: string }[]> = {}
  for (const wording of template.wordings) {
    ;(groups[wording.languageGroup] ??= []).push({ key: wording.key, body: wording.body })
  }
  return groups
}

function fromStored(
  template: StoredReplyTemplate,
  input: Readonly<{
    ref: ReplyLibraryRef
    layer: 'account' | 'property'
    essential: boolean
    status: 'customized' | 'yours'
    baseChanged: boolean
  }>,
): ReplyLibraryTemplateDto {
  return {
    ref: input.ref,
    layer: input.layer,
    revision: template.revision,
    title: template.title,
    starsMin: template.starsMin,
    starsMax: template.starsMax,
    reviewKind: template.reviewKind,
    topic: template.topic,
    essential: input.essential,
    wordings: groupedWordings(template),
    status: input.status,
    baseChanged: input.baseChanged,
  }
}

// fallow-ignore-next-line complexity -- ordered account/property overlay rules are resolved in one deterministic pass
export function resolveReplyLibraryTemplates(
  input: ResolveInput,
): readonly ReplyLibraryTemplateDto[] {
  const resolved = new Map<ReplyLibraryRef, ReplyLibraryTemplateDto>()
  const builtinByKey = new Map(
    input.builtin.templates.map((template) => [template.key, template]),
  )
  for (const template of input.builtin.templates) {
    resolved.set(builtinRef(template.key), {
      ref: builtinRef(template.key),
      layer: 'builtin',
      revision: BUILTIN_REPLY_LIBRARY_VERSION_NUMBER,
      title: template.title,
      starsMin: template.starsMin,
      starsMax: template.starsMax,
      reviewKind: template.reviewKind,
      topic: template.topic,
      essential: template.essential,
      wordings: Object.fromEntries(
        Object.keys(input.builtin.languages).map((language) => [
          language,
          template.wordings.map((wording) => ({
            key: wording.key,
            body: wording.text[language as keyof typeof wording.text],
          })),
        ]),
      ),
      status: 'builtin',
      baseChanged: false,
    })
  }

  const accountById = new Map<string, StoredReplyTemplate>()
  for (const template of input.accountTemplates) {
    accountById.set(template.id, template)
    if (template.builtinKey !== null) {
      const base = builtinByKey.get(template.builtinKey)
      resolved.set(
        builtinRef(template.builtinKey),
        fromStored(template, {
          ref: builtinRef(template.builtinKey),
          layer: 'account',
          essential: base?.essential ?? false,
          status: 'customized',
          baseChanged:
            template.basedOnBuiltinVersion !== BUILTIN_REPLY_LIBRARY_VERSION_NUMBER,
        }),
      )
    } else {
      resolved.set(
        templateRef(template.id),
        fromStored(template, {
          ref: templateRef(template.id),
          layer: 'account',
          essential: false,
          status: 'yours',
          baseChanged: false,
        }),
      )
    }
  }

  for (const visibility of input.visibility) {
    if (visibility.propertyId !== null) continue
    const current = resolved.get(visibility.ref)
    if (current) resolved.set(visibility.ref, { ...current, status: 'hidden' })
  }

  for (const template of input.propertyTemplates) {
    if (template.builtinKey !== null) {
      const base = builtinByKey.get(template.builtinKey)
      resolved.set(
        builtinRef(template.builtinKey),
        fromStored(template, {
          ref: builtinRef(template.builtinKey),
          layer: 'property',
          essential: base?.essential ?? false,
          status: 'customized',
          baseChanged:
            template.basedOnBuiltinVersion !== BUILTIN_REPLY_LIBRARY_VERSION_NUMBER,
        }),
      )
      continue
    }
    if (template.basedOnTemplateId !== null) {
      const base = accountById.get(template.basedOnTemplateId)
      const ref = templateRef(template.basedOnTemplateId)
      resolved.set(
        ref,
        fromStored(template, {
          ref,
          layer: 'property',
          essential: resolved.get(ref)?.essential ?? false,
          status: 'customized',
          baseChanged:
            base !== undefined && base.revisionCreatedAt > template.revisionCreatedAt,
        }),
      )
      continue
    }
    resolved.set(
      templateRef(template.id),
      fromStored(template, {
        ref: templateRef(template.id),
        layer: 'property',
        essential: false,
        status: 'yours',
        baseChanged: false,
      }),
    )
  }

  for (const visibility of input.visibility) {
    if (visibility.propertyId === null) continue
    const current = resolved.get(visibility.ref)
    if (current) resolved.set(visibility.ref, { ...current, status: 'hidden' })
  }
  return [...resolved.values()]
}
