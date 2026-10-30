import { useForm } from '@tanstack/react-form'
import type { Action } from '#/components/hooks/use-action'
import {
  saveReplyTemplateInputSchema,
  type ReplyLibraryDto,
  type SaveReplyTemplateInput,
} from '#/contexts/review/application/dto/reply-library.dto'

export type ReplyTemplateSaveAction = Action<
  { data: SaveReplyTemplateInput },
  ReplyLibraryDto
>

export function useReplyTemplateEditorForm(
  defaultValues: SaveReplyTemplateInput,
  action: ReplyTemplateSaveAction,
  onSaved: () => void,
) {
  return useForm({
    defaultValues,
    validators: { onSubmit: saveReplyTemplateInputSchema },
    onSubmit: async ({ value }) => {
      await action({ data: normalizeTemplateInput(value) })
      onSaved()
    },
  })
}

export type ReplyTemplateEditorForm = ReturnType<typeof useReplyTemplateEditorForm>

export type EditorWording = Readonly<{ key: string; en: string; es: string }>
export type EditorLanguage = 'en-Latn' | 'es-Latn'
export type EditorFinding = Readonly<{ code: string; message: string; language: string }>

export function normalizeTemplateInput(
  input: SaveReplyTemplateInput,
): SaveReplyTemplateInput {
  return {
    ...input,
    wordings: input.wordings.filter(({ body }) => body.trim().length > 0),
  }
}

export function groupEditorWordings(
  wordings: SaveReplyTemplateInput['wordings'],
): EditorWording[] {
  const keys = [...new Set(wordings.map(({ key }) => key))]
  return keys.map((key) => ({
    key,
    en:
      wordings.find(
        (wording) => wording.key === key && wording.languageGroup === 'en-Latn',
      )?.body ?? '',
    es:
      wordings.find(
        (wording) => wording.key === key && wording.languageGroup === 'es-Latn',
      )?.body ?? '',
  }))
}
