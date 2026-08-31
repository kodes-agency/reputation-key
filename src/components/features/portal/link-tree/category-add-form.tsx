// Portal context — category creation form

import { useForm } from '@tanstack/react-form'
import type { Ref } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { createLinkCategoryInputSchema } from '#/contexts/portal/application/dto/portal-link-category.dto'
import { CategoryFormError } from './category-form-error'

const TITLE_INPUT_ID = 'link-tree-new-category'
const categoryTitleFormSchema = createLinkCategoryInputSchema
  .pick({ title: true })
  .required()

type Props = Readonly<{
  onSubmit: (title: string) => Promise<void> | void
  isPending?: boolean
  error?: unknown
  /** Lets the empty-state CTA move focus here. */
  inputRef?: Ref<HTMLInputElement>
}>

export function CategoryAddForm({ onSubmit, isPending, error, inputRef }: Props) {
  const form = useForm({
    defaultValues: { title: '' },
    validators: { onSubmit: categoryTitleFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = categoryTitleFormSchema.parse(value)
      await onSubmit(parsed.title)
      form.reset()
    },
  })
  const submitIcon = isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus />

  return (
    <form
      className="mb-6 flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <div className="flex gap-2">
        <form.Field name="title">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <div className="max-w-xs flex-1">
                <Label htmlFor={TITLE_INPUT_ID} className="sr-only">
                  New category name
                </Label>
                <Input
                  id={TITLE_INPUT_ID}
                  ref={inputRef}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={invalid}
                  placeholder="New category name"
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
            <Button type="submit" disabled={!title.trim() || isPending}>
              {submitIcon}
              Add Category
            </Button>
          )}
        </form.Subscribe>
      </div>
      <CategoryFormError error={error} fallback="Failed to create category" />
    </form>
  )
}
