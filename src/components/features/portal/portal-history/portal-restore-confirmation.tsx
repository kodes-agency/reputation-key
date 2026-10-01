// "Make version 4 live again?": the inline confirmation under a publish line,
// and the body of the dialog when the choice starts from the rail. It says what
// would change back for guests (read from the two snapshots, never guessed),
// what stays as it is, and what publishing the draft later would do.

import { useEffect, useRef } from 'react'
import { Check, Undo2 } from 'lucide-react'
import type { PortalVersionDetail } from '#/contexts/portal/application/public-api'
import { Button } from '#/components/ui/button'
import { formatHistoryTime } from './portal-history-time'
import { PhraseView } from './portal-phrase-view'
import { describeGuestEffect } from './portal-version-summary'

type Props = Readonly<{
  detail: PortalVersionDetail
  /** How many changes the draft holds; the draft is never touched. */
  draftChangeCount: number
  timeZone: string
  now: Date
  submitting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
  /** Move focus to the heading when it opens, so a keyboard user lands on it. */
  focusOnOpen?: boolean
}>

const draftLine = (count: number): string =>
  count === 0
    ? 'Your draft stays as it is'
    : `Your draft keeps its ${count} ${count === 1 ? 'change' : 'changes'}`

/** The sentence about publishing the draft later, which depends on which way the choice goes. */
function laterLine(detail: PortalVersionDetail): string {
  const { version, liveVersion, nextVersion } = detail
  const makes = `Publishing the draft later makes it version ${nextVersion}`
  if (liveVersion === null || version > liveVersion) return `${makes}.`
  return liveVersion === version + 1
    ? `${makes} and brings back what version ${liveVersion} added.`
    : `${makes} and brings these changes back.`
}

export function PortalRestoreConfirmation({
  detail,
  draftChangeCount,
  timeZone,
  now,
  submitting,
  error,
  onCancel,
  onConfirm,
  focusOnOpen = true,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnOpen) heading.current?.focus()
  }, [focusOnOpen])
  const published = formatHistoryTime(detail.publishedAt, now, timeZone)
  const by = detail.publishedBy?.displayName
  const effects = detail.changesFromLive.map((change) =>
    describeGuestEffect(change, detail.content.primaryLanguage),
  )
  const id = `restore-v${detail.version}`
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="my-1 rounded-lg border bg-card p-4 shadow-xs md:p-5"
    >
      <h3
        id={`${id}-title`}
        ref={heading}
        tabIndex={-1}
        className="text-sm font-semibold outline-none"
      >
        Make version {detail.version} live again?
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Guests will see version {detail.version} as{' '}
        {by ? `${by} published` : 'it was published'} it on{' '}
        <time dateTime={published.dateTime} title={published.title}>
          {published.date}
        </time>
        . It keeps its number, and nothing is deleted.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-sm font-medium">What changes back for guests</h4>
          <ul className="mt-2 space-y-1.5 text-sm">
            {effects.length === 0 ? (
              <li className="text-muted-foreground">Nothing guests can see changes.</li>
            ) : (
              effects.map((effect, index) => (
                <li key={`${index}-${effect.topic}`} className="flex items-start gap-2">
                  <Undo2
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span>
                    <span className="font-medium">{effect.topic}</span> ·{' '}
                    <PhraseView phrase={effect.text} />
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-medium">Stays as it is</h4>
          <ul className="mt-2 space-y-1.5 text-sm">
            {[
              'Printed codes keep working',
              'Results and private notes are kept',
              draftLine(draftChangeCount),
            ].map((text) => (
              <li key={text} className="flex items-start gap-2">
                <Check
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {error === null ? null : (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {laterLine(detail)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={submitting}>
            {submitting ? 'Making it live…' : `Make version ${detail.version} live`}
          </Button>
        </div>
      </div>
    </section>
  )
}
