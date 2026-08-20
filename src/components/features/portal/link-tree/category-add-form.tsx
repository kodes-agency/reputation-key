// Portal context — category creation form

import { useState, type Ref } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Button } from '#/components/ui/button'
import { Plus, Loader2 } from 'lucide-react'

const TITLE_INPUT_ID = 'link-tree-new-category'

type Props = Readonly<{
  onSubmit: (title: string) => Promise<void> | void
  isPending?: boolean
  error?: unknown
  /** Lets the empty-state CTA move focus here. */
  inputRef?: Ref<HTMLInputElement>
}>

export function CategoryAddForm({ onSubmit, isPending, error, inputRef }: Props) {
  const [title, setTitle] = useState('')

  return (
    // A real <form> so Enter submits (WCAG 3.3.2 — the placeholder-only <div> +
    // <Button onClick> forced a mouse trip for every add).
    <form
      className="mb-6 flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = title.trim()
        if (!trimmed) return
        void Promise.resolve(onSubmit(trimmed))
          .then(() => setTitle(''))
          .catch(() => undefined)
      }}
    >
      <div className="flex gap-2">
        <Label htmlFor={TITLE_INPUT_ID} className="sr-only">
          New category name
        </Label>
        <Input
          id={TITLE_INPUT_ID}
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New category name"
          className="max-w-xs"
          disabled={isPending}
        />
        <Button type="submit" disabled={!title.trim() || isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus />}
          Add Category
        </Button>
      </div>
      {error != null ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to create category'}
        </p>
      ) : null}
    </form>
  )
}
