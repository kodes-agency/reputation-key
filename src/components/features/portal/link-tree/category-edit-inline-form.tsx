// Portal context — inline category title editing form

import { useForm } from '@tanstack/react-form'
import { useId } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { updateLinkCategoryInputSchema } from '#/contexts/portal/application/dto/portal-link-category.dto'
import { CategoryFormError } from './category-form-error'

const categoryTitleFormSchema = updateLinkCategoryInputSchema
  .pick({ title: true })
  .required()

type Props = Readonly<{
  initialTitle: string
  onSubmit: (title: string) => Promise<void> | void
  onCancel: () => void
  isPending?: boolean
  error?: unknown
}>

export function CategoryEditInlineForm({
  initialTitle,
  onSubmit,
  onCancel,
  isPending,
  error,
}: Props) {
  const form = useForm({
    defaultValues: { title: initialTitle },
    validators: { onSubmit: categoryTitleFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = categoryTitleFormSchema.parse(value)
      await onSubmit(parsed.title)
    },
  })
  const titleId = useId()
  const submitIcon = isPending ? <Loader2 className="size-4 animate-spin" /> : null

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <div className="flex items-center gap-2">
        <form.Field name="title">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <div className="max-w-xs flex-1">
                <Label htmlFor={titleId} className="sr-only">
                  Category name
                </Label>
                <Input
                  id={titleId}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={invalid}
                  placeholder="Category name"
                  disabled={isPending}
                  maxLength={100}
                />
                {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
              </div>
            )
          }}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.title}>
          {(title) => (
            <Button size="sm" type="submit" disabled={!title.trim() || isPending}>
              {submitIcon}
              Save
            </Button>
          )}
        </form.Subscribe>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
      <CategoryFormError error={error} fallback="Failed to update category" />
    </form>
  )
}
