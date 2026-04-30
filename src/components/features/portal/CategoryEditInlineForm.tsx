// Portal context — inline category title editing form

import { useState } from 'react'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'

type Props = Readonly<{
  initialTitle: string
  onSubmit: (title: string) => Promise<void> | void
  onCancel: () => void
}>

export function CategoryEditInlineForm({ initialTitle, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initialTitle)

  const handleSubmit = async () => {
    const trimmed = title.trim()
    if (!trimmed) return
    await onSubmit(trimmed)
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Category name"
        className="max-w-xs"
      />
      <Button size="sm" onClick={handleSubmit} disabled={!title.trim()}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
