// Portal context — inline link creation form

import { useState } from 'react'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'

type Props = Readonly<{
  onSubmit: (label: string, url: string) => Promise<void> | void
  onCancel: () => void
}>

export function LinkAddInlineForm({ onSubmit, onCancel }: Props) {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')

  const handleSubmit = async () => {
    const trimmedLabel = label.trim()
    const trimmedUrl = url.trim()
    if (!trimmedLabel || !trimmedUrl) return
    await onSubmit(trimmedLabel, trimmedUrl)
    setLabel('')
    setUrl('')
  }

  return (
    <div className="mb-4 flex gap-2 rounded-lg border p-3">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Link label"
      />
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://..."
      />
      <Button onClick={handleSubmit} disabled={!label.trim() || !url.trim()}>
        Add
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
