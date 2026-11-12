// The time-relative texts the served clock keeps equal between the server's page
// and the browser's first render, each through the code the product uses.
import type { ReactNode } from 'react'
import {
  useServedNow,
  ServedClockContext,
  servedAtProps,
  useServedAt,
} from './served-clock'
import { useNow } from '#/components/features/portal/shared/use-now'
import { derivePortalShareViewFromProps } from '#/components/features/portal/portal-share/portal-share-state'
import type { PortalShareProps } from '#/components/features/portal/portal-share/portal-share-types'
import { presentResponseTargetChip } from '#/components/inbox/response-target-chip'
import { formatHistoryTime } from '#/contexts/portal/workspace/ui/portal-history-time'
import { useMinuteClock } from '#/contexts/reputation/inbox/ui/inbox-case-toolbar'
import type { ResponseTargetView } from '#/contexts/inbox/application/public-api'

export const PROPERTY_ZONE = 'America/Los_Angeles'

/** What `RootDocument` does: one reading for the request, stamped and shared. */
export function ServedPage({ children }: Readonly<{ children: ReactNode }>) {
  const servedAt = useServedAt()
  return (
    <ServedClockContext.Provider value={servedAt}>
      <div id="served-stamp" {...servedAtProps(servedAt)} />
      {children}
    </ServedClockContext.Provider>
  )
}

export function EditedAt({ at }: Readonly<{ at: string }>) {
  return <p>{formatHistoryTime(at, useNow(), PROPERTY_ZONE).label}</p>
}

export function ShareGraceCutoff({
  graceExpiresAt,
}: Readonly<{ graceExpiresAt: string }>) {
  const props = {
    tokenStatus: { hasActiveToken: true, graceExpiresAt, issuedAt: null },
    revoked: false,
    timeZone: 'UTC',
  } as unknown as PortalShareProps
  const view = derivePortalShareViewFromProps(props, true, null, useServedNow())
  return <p>{view.graceLabel}</p>
}

export function ReplyDue({ dueAt }: Readonly<{ dueAt: string }>) {
  const target = {
    targetKind: 'google_review_response',
    dueAt: new Date(dueAt),
    propertyTimezone: PROPERTY_ZONE,
    evaluation: { state: 'active', overdue: false, elapsedMinutes: 0 },
  } as unknown as ResponseTargetView
  return <p>{presentResponseTargetChip(target, useMinuteClock(true)).label}</p>
}
