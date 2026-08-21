// Portal context — inline category title editing form

import { useId } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useCategoryForm } from './use-category-form'
import { CategoryFormError } from './category-form-error'

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
  const { title, setTitle, handleSubmit, canSubmit } = useCategoryForm({
    initialTitle,
    onSubmit,
    clearOnSuccess: false,
    isPending,
  })
  // useId keeps the label association unique per open form instance.
  const titleId = useId()
  const submitIcon = isPending ? <Loader2 className="size-4 animate-spin" /> : null

  return (
    // A real <form> so Enter saves the rename (WCAG 3.3.2).
    <form className="flex flex-col gap-1" onSubmit={handleSubmit}>
      <div className="flex items-center gap-2">
        <Label htmlFor={titleId} className="sr-only">
          Category name
        </Label>
        <Input
          id={titleId}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Category name"
          className="max-w-xs"
          disabled={isPending}
        />
        <Button size="sm" type="submit" disabled={!canSubmit}>
          {submitIcon}
          Save
        </Button>
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
