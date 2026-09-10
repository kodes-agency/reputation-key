import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Pencil, Plus } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { FormTextarea, type BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { FieldGroup } from '#/components/ui/field'
import {
  REPLY_LIBRARY_FIELD_LIMITS,
  replyTemplateValuesSchema,
  type ReplyTemplateValues,
  type SavePropertyReplyTemplateInput,
} from '#/contexts/review/application/dto/reply-library.dto'
import type {
  PropertyReplyLibraryProfile,
  PropertyReplyLibraryTemplate,
} from '#/contexts/review/application/use-cases/reply-library-operations'
import {
  ReplyTemplateAspectSelect,
  ReplyTemplateRatingSelect,
  ReplyTemplateReviewTypeSelect,
  type ReplyTemplateSelectFieldApi,
} from './reply-template-select-field'
import { ReplyTemplatePreview } from './reply-template-preview'

export type SaveReplyTemplateAction = Action<{
  data: SavePropertyReplyTemplateInput
}>

type Props = Readonly<{
  propertyId: string
  profile: PropertyReplyLibraryProfile | null
  template: PropertyReplyLibraryTemplate | null
  defaultLanguageTag: string | null
  action: SaveReplyTemplateAction
}>

function editorValues(
  template: PropertyReplyLibraryTemplate | null,
  defaultLanguageTag: string | null,
): ReplyTemplateValues {
  return {
    title: template?.title ?? '',
    ratingMin: template?.ratingMin ?? 4,
    ratingMax: template?.ratingMax ?? 5,
    hasText: template?.hasText ?? true,
    aspect: template?.aspect ?? null,
    openLabel: template?.openLabel ?? '',
    languageTag: template?.languageTag ?? defaultLanguageTag ?? 'en-Latn',
    body: template?.body ?? '',
    enabled: template?.enabled ?? true,
  }
}

function saveData(
  propertyId: string,
  template: PropertyReplyLibraryTemplate | null,
  value: ReplyTemplateValues,
): SavePropertyReplyTemplateInput {
  const parsed = replyTemplateValuesSchema.parse({
    ...value,
    openLabel: value.openLabel?.trim() || null,
  })
  return template === null
    ? { propertyId, template: parsed }
    : { propertyId, templateId: template.id, template: parsed }
}

function EditorTrigger({
  template,
}: Readonly<{ template: PropertyReplyLibraryTemplate | null }>) {
  const editing = template !== null
  return (
    <DialogTrigger asChild>
      <Button
        type="button"
        variant={editing ? 'ghost' : 'default'}
        size={editing ? 'sm' : 'default'}
        className="min-h-11"
        aria-label={editing ? `Edit ${template.title}` : undefined}
      >
        {editing ? (
          <Pencil data-icon="inline-start" />
        ) : (
          <Plus data-icon="inline-start" />
        )}
        {editing ? 'Edit' : 'Add template'}
      </Button>
    </DialogTrigger>
  )
}

function EditorHeader({ editing }: Readonly<{ editing: boolean }>) {
  return (
    <DialogHeader>
      <DialogTitle>{editing ? 'Edit reply template' : 'Add reply template'}</DialogTitle>
      <DialogDescription>
        Templates stay Property-specific. The preview applies the current reply profile
        before you save.
      </DialogDescription>
    </DialogHeader>
  )
}

export function ReplyTemplateEditor({
  propertyId,
  profile,
  template,
  defaultLanguageTag,
  action,
}: Props) {
  const [open, setOpen] = useState(false)
  const defaultValues = editorValues(template, defaultLanguageTag)
  const form = useForm({
    defaultValues,
    validators: { onSubmit: replyTemplateValuesSchema },
    onSubmit: async ({ value }) => {
      await action({ data: saveData(propertyId, template, value) })
      setOpen(false)
    },
  })
  const editing = template !== null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <EditorTrigger template={template} />
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-4xl [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center">
        <form className="flex flex-col gap-5" onSubmit={submitHandler(form)}>
          <EditorHeader editing={editing} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]">
            <FieldGroup>
              <form.Field name="title">
                {(field) => (
                  <FormTextField
                    field={field as BaseFieldApi}
                    id="reply-template-title"
                    label="Template title"
                    maxLength={REPLY_LIBRARY_FIELD_LIMITS.title}
                    className="min-h-11"
                    disabled={action.isPending}
                  />
                )}
              </form.Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="ratingMin">
                  {(field) => (
                    <ReplyTemplateRatingSelect
                      id="reply-template-rating-min"
                      label="Minimum rating"
                      field={field as ReplyTemplateSelectFieldApi<number>}
                      disabled={action.isPending}
                    />
                  )}
                </form.Field>
                <form.Field name="ratingMax">
                  {(field) => (
                    <ReplyTemplateRatingSelect
                      id="reply-template-rating-max"
                      label="Maximum rating"
                      field={field as ReplyTemplateSelectFieldApi<number>}
                      disabled={action.isPending}
                    />
                  )}
                </form.Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="hasText">
                  {(field) => (
                    <ReplyTemplateReviewTypeSelect
                      field={field as ReplyTemplateSelectFieldApi<boolean>}
                      disabled={action.isPending}
                    />
                  )}
                </form.Field>
                <form.Field name="aspect">
                  {(field) => (
                    <ReplyTemplateAspectSelect
                      field={
                        field as ReplyTemplateSelectFieldApi<
                          ReplyTemplateValues['aspect']
                        >
                      }
                      disabled={action.isPending}
                    />
                  )}
                </form.Field>
              </div>
              <form.Field name="openLabel">
                {(field) => (
                  <FormTextField
                    field={field as BaseFieldApi}
                    id="reply-template-open-label"
                    label="Open label (optional)"
                    maxLength={REPLY_LIBRARY_FIELD_LIMITS.openLabel}
                    className="min-h-11"
                    disabled={action.isPending}
                  />
                )}
              </form.Field>
              <form.Field name="languageTag">
                {(field) => (
                  <FormTextField
                    field={field as BaseFieldApi}
                    id="reply-template-language"
                    label="Language tag"
                    placeholder="en-Latn-US"
                    maxLength={REPLY_LIBRARY_FIELD_LIMITS.languageTag}
                    className="min-h-11"
                    disabled={action.isPending}
                  />
                )}
              </form.Field>
              <form.Field name="body">
                {(field) => (
                  <FormTextarea
                    field={field as BaseFieldApiTextarea}
                    id="reply-template-body"
                    label="Template body"
                    rows={8}
                    maxLength={REPLY_LIBRARY_FIELD_LIMITS.body}
                    disabled={action.isPending}
                  />
                )}
              </form.Field>
            </FieldGroup>
            <form.Subscribe selector={(state) => state.values}>
              {(values) => (
                <ReplyTemplatePreview
                  body={values.body}
                  profile={profile}
                  rating={values.ratingMax}
                />
              )}
            </form.Subscribe>
          </div>
          <FormErrorBanner error={action.error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="min-h-11">
                Cancel
              </Button>
            </DialogClose>
            <SubmitButton mutation={action} form={form} className="min-h-11">
              {editing ? 'Save template' : 'Create template'}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
