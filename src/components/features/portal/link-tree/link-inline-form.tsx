// Portal context — shared inline link form for add and edit modes

import { useForm } from '@tanstack/react-form'
import { useId } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { createLinkInputSchema } from '#/contexts/portal/application/dto/portal-link.dto'
import { LinkInlineField } from './link-inline-field'

const linkFormSchema = createLinkInputSchema.pick({ label: true, url: true }).required()

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
  const form = useForm({
    defaultValues: { label: initialLabel, url: initialUrl },
    validators: { onSubmit: linkFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = linkFormSchema.parse(value)
      await onSubmit(parsed.label, parsed.url)
    },
  })
  const fieldId = useId()

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <div className="flex gap-2">
        <form.Field name="label">
          {(field) => (
            <LinkInlineField
              field={field}
              id={`${fieldId}-label`}
              label="Link label"
              placeholder="Link label"
              maxLength={100}
              disabled={isPending}
            />
          )}
        </form.Field>
        <form.Field name="url">
          {(field) => (
            <LinkInlineField
              field={field}
              id={`${fieldId}-url`}
              label="Link URL"
              placeholder="https://..."
              maxLength={500}
              disabled={isPending}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values}>
          {(value) => (
            <Button
              type="submit"
              disabled={!value.label.trim() || !value.url.trim() || isPending}
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {submitLabel}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
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
