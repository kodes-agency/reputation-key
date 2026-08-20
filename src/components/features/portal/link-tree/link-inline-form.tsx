// Portal context — shared inline link form for add and edit modes

import { useId, useState } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'
import { isValidExternalUrl } from '#/contexts/portal/application/public-api'

/** Mirrors the create-link/update-link use cases' 'must use https:// scheme'. */
const URL_SCHEME_MESSAGE = 'Links must start with https://'

type Props = Readonly<{
  initialLabel?: string
  initialUrl?: string
  submitLabel: string
  onSubmit: (label: string, url: string) => Promise<void> | void
  onCancel: () => void
  isPending?: boolean
  error?: unknown
  className?: string
}>

export function LinkInlineForm({
  initialLabel = '',
  initialUrl = '',
  submitLabel,
  onSubmit,
  onCancel,
  isPending,
  error,
  className = 'mb-2 flex flex-col gap-1 rounded-lg border bg-muted/30 p-3',
}: Props) {
  const [label, setLabel] = useState(initialLabel)
  const [url, setUrl] = useState(initialUrl)
  const [urlError, setUrlError] = useState<string | null>(null)
  // useId keeps the label associations unique across the concurrently mounted
  // add form and per-row edit forms.
  const fieldId = useId()
  const labelId = `${fieldId}-label`
  const urlId = `${fieldId}-url`
  const urlErrorId = `${fieldId}-url-error`

  /**
   * Client-side gate on the exact predicate the server rejects with
   * ('link URL must use https:// scheme' in create-link/update-link), imported
   * rather than re-implemented so the two cannot drift. The server check stays —
   * this only saves the round trip for 'example.com' / 'http://…' / 'mailto:…'.
   */
  const validateUrl = (value: string): boolean => {
    const trimmed = value.trim()
    if (trimmed !== '' && !isValidExternalUrl(trimmed)) {
      setUrlError(URL_SCHEME_MESSAGE)
      return false
    }
    setUrlError(null)
    return true
  }

  return (
    // A real <form> so Enter submits (WCAG 3.3.2).
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault()
        const trimmedLabel = label.trim()
        const trimmedUrl = url.trim()
        if (!trimmedLabel || !trimmedUrl) return
        if (!validateUrl(trimmedUrl)) return
        void Promise.resolve(onSubmit(trimmedLabel, trimmedUrl)).catch(() => undefined)
      }}
    >
      <div className="flex gap-2">
        <Label htmlFor={labelId} className="sr-only">
          Link label
        </Label>
        <Input
          id={labelId}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Link label"
          disabled={isPending}
        />
        <Label htmlFor={urlId} className="sr-only">
          Link URL
        </Label>
        <Input
          id={urlId}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            // Clear while typing; re-checked on blur and on submit.
            if (urlError) setUrlError(null)
          }}
          onBlur={(e) => {
            validateUrl(e.target.value)
          }}
          aria-invalid={urlError != null}
          aria-describedby={urlError != null ? urlErrorId : undefined}
          placeholder="https://..."
          disabled={isPending}
        />
        <Button type="submit" disabled={!label.trim() || !url.trim() || isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
      {urlError != null ? (
        <p id={urlErrorId} className="text-sm text-destructive">
          {urlError}
        </p>
      ) : null}
      {error != null ? (
        <p className="text-sm text-destructive">
          {error instanceof Error
            ? error.message
            : `Failed to ${submitLabel.toLowerCase()} link`}
        </p>
      ) : null}
    </form>
  )
}
