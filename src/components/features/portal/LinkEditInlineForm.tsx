// Portal context — inline link editing form

import { useState } from 'react'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'

type Props = Readonly<{
  initialLabel: string
  initialUrl: string
  onSubmit: (label: string, url: string) => Promise<void> | void
  onCancel: () => void
}>

export function LinkEditInlineForm({ initialLabel, initialUrl, onSubmit, onCancel }: Props) {
  const [label, setLabel] = useState(initialLabel)
  const [url, setUrl] = useState(initialUrl)

  const handleSubmit = async () => {
    const trimmedLabel = label.trim()
    const trimmedUrl = url.trim()
    if (!trimmedLabel || !trimmedUrl) return
    await onSubmit(trimmedLabel, trimmedUrl)
  }

  return (
    <div className="mb-2 flex gap-2 rounded-lg border bg-muted/30 p-3">
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
        Save
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
