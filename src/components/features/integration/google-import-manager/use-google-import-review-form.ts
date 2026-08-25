import { useForm } from '@tanstack/react-form'
import {
  googleImportReviewDraftSchema,
  type GoogleImportReviewDraftInput,
} from '#/contexts/integration/application/dto/google-import-v2.dto'

const EMPTY_REVIEW: GoogleImportReviewDraftInput = { items: [] }

type Options = Readonly<{
  initialDraft: GoogleImportReviewDraftInput | null
  onSubmit: (draft: GoogleImportReviewDraftInput) => void | Promise<void>
}>

export function useGoogleImportReviewForm({ initialDraft, onSubmit }: Options) {
  return useForm({
    defaultValues: initialDraft ?? EMPTY_REVIEW,
    validators: { onSubmit: googleImportReviewDraftSchema },
    onSubmit: ({ value }) => onSubmit(value),
  })
}

export type GoogleImportReviewFormApi = ReturnType<typeof useGoogleImportReviewForm>
