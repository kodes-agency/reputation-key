// Portal context — category creation form

import { useState } from 'react'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import { Plus, Loader2 } from 'lucide-react'

type Props = Readonly<{
  onSubmit: (title: string) => Promise<void> | void
  isPending?: boolean
  error?: unknown
}>

export function CategoryAddForm({ onSubmit, isPending, error }: Props) {
  const [title, setTitle] = useState('')

  const handleSubmit = async () => {
    const trimmed = title.trim()
    if (!trimmed) return
    await onSubmit(trimmed)
    setTitle('')
  }

  return (
    <div className="mb-6 flex flex-col gap-1">
      <div className="flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New category name"
          className="max-w-xs"
          disabled={isPending}
        />
        <Button onClick={handleSubmit} disabled={!title.trim() || isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus />}
          Add Category
        </Button>
      </div>
      {error != null ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to create category'}
        </p>
      ) : null}
    </div>
  )
}
