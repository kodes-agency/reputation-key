import type { Action } from '#/components/hooks/use-action'
import type {
  ReplyLibraryDto,
  ReplyLibraryTemplateDto,
} from '#/contexts/review/application/dto/reply-library.dto'
import { resolveReplyLibraryTemplates } from '#/contexts/review/application/reply-library-resolver'
import { BUILTIN_REPLY_LIBRARY } from '#/shared/reply-library/builtin-library'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'

export function replyLibraryFixture(
  overrides: Partial<ReplyLibraryDto> = {},
): ReplyLibraryDto {
  return {
    voice: resolveVoice(BUILTIN_REPLY_VOICE, null, null),
    voiceVersion: { account: 0, property: 0 },
    templates: resolveReplyLibraryTemplates({
      builtin: BUILTIN_REPLY_LIBRARY,
      accountTemplates: [],
      propertyTemplates: [],
      visibility: [],
    }),
    supportedLanguages: ['en-Latn', 'es-Latn'],
    canManage: true,
    ...overrides,
  }
}

export function withTemplateStatus(
  template: ReplyLibraryTemplateDto,
  status: ReplyLibraryTemplateDto['status'],
): ReplyLibraryTemplateDto {
  return {
    ...template,
    layer: status === 'builtin' ? 'builtin' : 'property',
    revision: status === 'builtin' ? template.revision : 2,
    status,
  }
}

export function storyAction<TInput, TOutput>(result: TOutput): Action<TInput, TOutput> {
  const execute = async (_input: TInput) => result
  return Object.assign(execute, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })
}
