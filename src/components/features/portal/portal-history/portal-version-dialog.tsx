// A published version, read-only: when it went live, who published it, and what
// it shows guests, as the page itself (`preview`, the editor preview's page
// drawn from the version) beside what it lists in words. Opened from "View" on
// a publish line and from a tile of the Versions rail. When the viewer may make
// it live again, the same dialog turns into the confirmation (the caller passes
// it as `confirmation`).

import type { ReactNode } from 'react'
import type { PortalVersionDetail } from '#/contexts/portal/application/public-api'
import { Button } from '#/components/ui/button'
import { RegionError } from '#/components/ui/region-error'
import {
  Dialog,
  DialogCancel,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { GUEST_LOCALE_METADATA } from '#/shared/domain/guest-locale'
import { formatHistoryTime } from './portal-history-time'

type Props = Readonly<{
  version: number
  detail: PortalVersionDetail | null
  /** Loading or failed, while there is no detail. */
  status: 'loading' | 'error' | 'ready'
  now: Date
  timeZone: string
  /** Offer "Make live again…" (viewer may, version is not live). */
  canMakeLive: boolean
  /** The version's page as guests see it; it reads for itself. Absent: the words alone. */
  preview?: ReactNode
  /** Replaces the read-only view when the choice has been started. */
  confirmation: ReactNode | null
  /** The confirmation's request is in flight: Escape and the overlay are refused. */
  submitting?: boolean
  onMakeLive: () => void
  onRetry: () => void
  /** `onRetry` is reading; the failure stays, its button busy. */
  retrying?: boolean
  onClose: () => void
}>

function Facts({ detail }: Readonly<{ detail: PortalVersionDetail }>) {
  const { content } = detail
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
      <dt className="text-muted-foreground">Languages</dt>
      <dd>
        {content.languages
          .map((locale) => GUEST_LOCALE_METADATA[locale].nativeName)
          .join(', ')}{' '}
        <span className="text-muted-foreground">
          (main: {GUEST_LOCALE_METADATA[content.primaryLanguage].nativeName})
        </span>
      </dd>
      {content.title === null ? null : (
        <>
          <dt className="text-muted-foreground">Title</dt>
          <dd lang={content.primaryLanguage}>{content.title}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Linktree</dt>
      <dd>
        {content.linktreeEnabled === false ? (
          'Switched off'
        ) : content.links.length === 0 ? (
          'No tiles'
        ) : (
          <ul className="space-y-1">
            {content.links.map((link) => (
              <li key={`${link.label}-${link.address}`}>
                <span lang={content.primaryLanguage}>{link.label}</span>{' '}
                <span className="break-all text-xs text-muted-foreground">
                  {link.address}
                </span>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </dl>
  )
}

// fallow-ignore-next-line complexity
export function PortalVersionDialog({
  version,
  detail,
  status,
  now,
  timeZone,
  canMakeLive,
  preview = null,
  confirmation,
  submitting = false,
  onMakeLive,
  onRetry,
  retrying = false,
  onClose,
}: Props) {
  const published = detail ? formatHistoryTime(detail.publishedAt, now, timeZone) : null
  const by = detail?.publishedBy?.displayName ?? null
  return (
    <Dialog
      open
      // Only the confirmation commits something; the read-only view is never held.
      busy={confirmation !== null && submitting}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent
        size="xl"
        // The footer's Close is the exit, so the corner close is dropped.
        showCloseButton={false}
        // Narrow windows give the page the room the padding would take; the
        // dialog keeps its 1rem margin from the window at every width. The padding
        // is the dialog's variable, so the pinned footer reaches over the same amount.
        className="[--dialog-pad:1rem] sm:[--dialog-pad:1.5rem]"
        // The confirmation has no description to point at; saying so keeps the
        // dialog from naming an element that is not there.
        {...(confirmation === null ? {} : { 'aria-describedby': undefined })}
      >
        {confirmation !== null ? (
          // The confirmation carries its own visible heading; the dialog still
          // needs a title of its own to be named.
          <DialogTitle className="sr-only">Make version {version} live again</DialogTitle>
        ) : null}
        {confirmation ?? (
          <>
            <DialogHeader>
              <DialogTitle>Version {version}</DialogTitle>
              <DialogDescription>
                {published
                  ? `Published ${published.date}${by ? ` by ${by}` : ''}${detail?.isLive ? ' · live now' : ''}`
                  : 'What this version shows guests.'}
              </DialogDescription>
            </DialogHeader>
            <div
              className={
                preview === null
                  ? undefined
                  : 'grid gap-6 md:grid-cols-[auto_minmax(16rem,1fr)] md:items-start'
              }
            >
              {preview}
              <div className="min-w-0 space-y-3">
                {preview === null ? null : (
                  <h3 className="text-sm font-medium">What it lists</h3>
                )}
                {status === 'ready' && detail ? <Facts detail={detail} /> : null}
                {status === 'loading' ? (
                  <p className="text-sm text-muted-foreground">
                    Loading version {version}…
                  </p>
                ) : null}
                {status === 'error' ? (
                  <RegionError
                    size="compact"
                    message="This version couldn’t be loaded."
                    onRetry={onRetry}
                    retrying={retrying}
                  />
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <DialogCancel>Close</DialogCancel>
              {canMakeLive && detail !== null && !detail.isLive ? (
                <Button type="button" onClick={onMakeLive}>
                  Make live again…
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
