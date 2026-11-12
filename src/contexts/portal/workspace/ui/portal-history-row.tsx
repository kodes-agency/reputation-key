// One entry of the ledger: the disc, the sentence, its quiet tags and the time,
// and on a publish line the two things a manager may do with that version.

import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import {
  TimelineConnector,
  TimelineContent,
  TimelineItem,
} from '#/components/ui/timeline'
import { cn } from '#/lib/utils'
import { usePortalHistory } from './portal-history-context'
import { HistoryGlyphDisc } from './portal-history-glyph'
import { describeHistoryEntry } from './portal-history-line'
import { plain, type Phrase } from './portal-history-phrase'
import { formatHistoryTime } from './portal-history-time'
import type { HistoryEntryRow } from './portal-history-rows'
import { PortalHistoryRowRestore } from './portal-history-restore'
import { PhraseView } from './portal-phrase-view'
import { summarizeVersion } from './portal-version-summary'

/** A small state beside the sentence: a dot, filled when it is true now, hollow when it is not yet. */
function StateTag({
  filled,
  children,
}: Readonly<{ filled: boolean; children: ReactNode }>) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full border border-current',
          filled ? 'bg-current' : 'bg-transparent',
        )}
      />
      {children}
    </span>
  )
}

const dot = <span aria-hidden="true"> · </span>

/** An edit that is in a version says which; the draft's edits wear the "In draft" tag instead. */
function withPublishedIn(
  detail: Phrase | null,
  draft: HistoryEntryRow['draft'],
): Phrase | null {
  if (draft?.kind !== 'published') return detail
  const where = plain(`published in version ${draft.version}`)
  return detail === null ? [where] : [...detail, plain(' · '), where]
}

// fallow-ignore-next-line complexity
export function PortalHistoryRow({ row }: Readonly<{ row: HistoryEntryRow }>) {
  const {
    portalName,
    now,
    timeZone,
    canMakeLive,
    selection,
    revealedVersion,
    restoredVersion,
    select,
  } = usePortalHistory()
  const { version } = row
  const line = describeHistoryEntry(row.entry, {
    portalName,
    versionSummary:
      row.entry.detail.kind === 'version_published' && version !== null
        ? summarizeVersion(version)
        : null,
    timeZone,
    now,
  })
  const detail = withPublishedIn(line.detail, row.draft)
  // The confirmation is open on this line; the version just revealed takes
  // focus; the version just made live again hands focus back to its View.
  const restoreOpen =
    version !== null &&
    selection?.mode === 'restore' &&
    selection.host === 'row' &&
    selection.version === version.version
  const focusView = version !== null && version.version === revealedVersion
  const restored = version !== null && version.version === restoredVersion
  const time = formatHistoryTime(row.entry.occurredAt, now, timeZone)
  const restoreButton = useRef<HTMLButtonElement>(null)
  const viewButton = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  // Closing the confirmation hands focus back to the button that opened it. A
  // version that was just made live has no such button any more (it is live),
  // so focus goes to the line's View instead of falling to the page.
  useEffect(() => {
    if (wasOpen.current && !restoreOpen) {
      ;(restored ? viewButton : restoreButton).current?.focus()
    }
    wasOpen.current = restoreOpen
  }, [restoreOpen, restored])
  // "Show" replaces its own row, which held focus: the first revealed line takes it.
  useEffect(() => {
    if (focusView) viewButton.current?.focus()
  }, [focusView])

  return (
    <TimelineItem role="listitem" className="group/row">
      <TimelineConnector />
      <HistoryGlyphDisc glyph={line.glyph} actorName={line.actor} />
      <TimelineContent>
        <div
          className={cn(
            'flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded-md px-2 py-1 -mx-2 transition-colors',
            (restoreOpen || version !== null) &&
              'group-hover/row:bg-muted group-focus-within/row:bg-muted',
            restoreOpen && 'bg-muted',
          )}
        >
          <p className="min-w-0 flex-[1_1_18rem] py-0.5 text-sm text-foreground">
            {line.actor === null ? null : (
              <>
                <b className="font-medium">{line.actor}</b>{' '}
              </>
            )}
            <PhraseView phrase={line.action} />
            {detail === null ? null : (
              <>
                {dot}
                <span className="text-muted-foreground">
                  <PhraseView phrase={detail} />
                </span>
              </>
            )}
            {row.draft?.kind === 'draft' ? (
              <span className="text-muted-foreground">
                {dot}
                <StateTag filled={false}>In draft</StateTag>
              </span>
            ) : null}
            {row.isLive ? (
              <span className="text-muted-foreground">
                {dot}
                <StateTag filled>Live now</StateTag>
              </span>
            ) : null}
            <span className="whitespace-nowrap text-muted-foreground">
              {dot}
              <time dateTime={time.dateTime} title={time.title}>
                {time.label}
              </time>
            </span>
          </p>
          {version === null ? null : (
            <span
              className={cn(
                'flex shrink-0 gap-2 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100',
                restoreOpen && 'opacity-100',
              )}
            >
              <Button
                ref={viewButton}
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  select({ version: version.version, mode: 'view', host: 'dialog' })
                }
                aria-label={`View version ${version.version}`}
              >
                View
              </Button>
              {canMakeLive && version.restorable && !version.isLive ? (
                <Button
                  ref={restoreButton}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Make live again… version ${version.version}`}
                  aria-expanded={restoreOpen}
                  aria-controls={`restore-v${version.version}`}
                  onClick={() =>
                    select({ version: version.version, mode: 'restore', host: 'row' })
                  }
                >
                  Make live again…
                </Button>
              ) : null}
            </span>
          )}
        </div>
        {restoreOpen && version !== null ? (
          <PortalHistoryRowRestore version={version.version} />
        ) : null}
      </TimelineContent>
    </TimelineItem>
  )
}
