// Portal context — inline category title editing form

import { useState } from 'react'
import { Input } from '#/components/ui/input'
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

  const handleSubmit = async () => {
    const trimmed = title.trim()
    if (!trimmed) return
    await onSubmit(trimmed)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Category name"
          className="max-w-xs"
          disabled={isPending}
        />
        <Button size="sm" onClick={handleSubmit} disabled={!title.trim() || isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
      {error != null ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to update category'}
        </p>
      ) : null}
    </div>
  )
}
