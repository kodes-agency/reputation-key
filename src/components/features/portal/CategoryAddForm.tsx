// Portal context — category creation form

import { useState } from 'react'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import { Plus } from 'lucide-react'

type Props = Readonly<{
  onSubmit: (title: string) => Promise<void> | void
}>

export function CategoryAddForm({ onSubmit }: Props) {
  const [title, setTitle] = useState('')

  const handleSubmit = async () => {
    const trimmed = title.trim()
    if (!trimmed) return
    await onSubmit(trimmed)
    setTitle('')
  }

  return (
    <div className="mb-6 flex gap-2">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New category name"
        className="max-w-xs"
      />
      <Button onClick={handleSubmit} disabled={!title.trim()}>
        <Plus />
        Add Category
      </Button>
    </div>
  )
}
