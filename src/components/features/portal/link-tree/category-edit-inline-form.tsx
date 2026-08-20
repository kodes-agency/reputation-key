// Portal context — inline category title editing form

import { useId, useState } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'

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
  const [title, setTitle] = useState(initialTitle)
  // useId keeps the label association unique per open form instance.
  const titleId = useId()

  return (
    // A real <form> so Enter saves the rename (WCAG 3.3.2).
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = title.trim()
        if (!trimmed) return
        void Promise.resolve(onSubmit(trimmed)).catch(() => undefined)
      }}
    >
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
        <Button size="sm" type="submit" disabled={!title.trim() || isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
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
      {error != null ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to update category'}
        </p>
      ) : null}
    </form>
  )
}
