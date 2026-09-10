import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  REPLY_TEMPLATE_SLOT_TOKENS,
  renderReplyTemplate,
  unfilledReplySlots,
} from '#/contexts/review/application/public-api'
import type { PropertyReplyLibraryProfile } from '#/contexts/review/application/use-cases/reply-library-operations'

type Props = Readonly<{
  body: string
  profile: PropertyReplyLibraryProfile | null
  rating: number
}>

export function ReplyTemplatePreview({ body, profile, rating }: Props) {
  const hasNoSlots = body.trim().length > 0 && unfilledReplySlots(body).length === 0
  const preview = renderReplyTemplate({ body }, profile, rating)

  return (
    <section
      className="flex min-w-0 flex-col gap-4"
      aria-labelledby="reply-preview-title"
    >
      <div className="flex flex-col gap-2">
        <h3 id="reply-preview-title" className="font-medium">
          Live preview
        </h3>
        <pre
          aria-label="Rendered reply preview"
          className="min-h-40 whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 font-sans text-sm"
        >
          {preview || 'Start writing to preview the rendered reply.'}
        </pre>
      </div>
      {hasNoSlots ? (
        <Alert>
          <TriangleAlert />
          <AlertTitle>No slots in this body</AlertTitle>
          <AlertDescription>
            That is allowed. Add a slot only when this template needs a personalised
            value.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2 text-sm">
        <p className="font-medium">Available slots</p>
        <p className="text-muted-foreground">
          Insert any of these tokens exactly as shown:
        </p>
        <div className="flex flex-wrap gap-2">
          {REPLY_TEMPLATE_SLOT_TOKENS.map((slot) => (
            <code key={slot} className="rounded bg-muted px-2 py-1 text-xs">
              {slot}
            </code>
          ))}
        </div>
      </div>
    </section>
  )
}
