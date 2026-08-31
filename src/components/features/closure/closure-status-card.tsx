// LIF-01-T17 — the honest state of an Organization closure.
//
// Every label here is deliberately plain. A closure is the one workflow where
// a euphemism is a safety problem: somebody reading this card has to be able
// to tell "we can still stop this" from "this is now irreversible" without
// interpreting product tone. Purging and Closed therefore get destructive
// treatment and the word "permanently"; Closing and Purge Pending get the
// exact deadline instead of a relative "soon".

import { AlertTriangle, CircleCheck, Clock, ShieldAlert } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import type { ClosureCenterView } from '#/contexts/identity/application/dto/organization-closure.dto'

type LifecycleState = ClosureCenterView['state']

type StateCopy = Readonly<{
  label: string
  description: string
  tone: 'default' | 'secondary' | 'destructive' | 'outline'
  reversible: boolean
}>

/**
 * One row per lifecycle state, so a UI that renders an unmapped state is a
 * type error rather than a blank card.
 */
export const CLOSURE_STATE_COPY: Readonly<Record<LifecycleState, StateCopy>> = {
  active: {
    label: 'Active',
    description: 'This organization is open. No closure has been requested.',
    tone: 'secondary',
    reversible: true,
  },
  closure_requested: {
    label: 'Closure requested',
    description:
      'A closure was requested. The workspace is read only from now on, and the request can still be cancelled.',
    tone: 'outline',
    reversible: true,
  },
  closing: {
    label: 'Closing',
    description:
      'Delivery, publishing and provider work have stopped. Nothing has been deleted, and the closure can still be cancelled until the recovery deadline.',
    tone: 'outline',
    reversible: true,
  },
  purge_pending: {
    label: 'Purge pending',
    description:
      'The recovery window has ended. Permanent deletion has not started, but it can no longer be cancelled from this page — contact support.',
    tone: 'destructive',
    reversible: false,
  },
  purging: {
    label: 'Purging',
    description: 'Permanent deletion is in progress. This cannot be stopped or reversed.',
    tone: 'destructive',
    reversible: false,
  },
  closed: {
    label: 'Closed',
    description:
      'This organization was permanently deleted. Its data cannot be restored.',
    tone: 'destructive',
    reversible: false,
  },
}

/**
 * The deadline in the Organization's own timezone, never the browser's.
 *
 * A deadline rendered in the reader's local zone can be off by a day near
 * midnight, which on this page means believing you still have time when you
 * do not. The zone is printed alongside the date so the reader can see which
 * clock the deadline is measured on.
 */
export function formatDeadline(iso: string | null, timeZone: string): string {
  if (!iso) return '—'
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return '—'
  // Explicit components rather than dateStyle/timeStyle: the two presets
  // cannot be combined with `timeZoneName`, and the zone abbreviation is the
  // part that tells the reader WHICH clock the deadline is measured on.
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(value)
}

type Props = Readonly<{ view: ClosureCenterView }>

export function ClosureStatusCard({ view }: Props) {
  const copy = CLOSURE_STATE_COPY[view.state]
  const Icon = copy.reversible
    ? view.state === 'active'
      ? CircleCheck
      : Clock
    : ShieldAlert

  return (
    <Card data-testid="closure-status-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Icon aria-hidden="true" className="size-5" />
              {view.organizationName}
            </CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </div>
          <Badge variant={copy.tone} data-testid="closure-state-badge">
            {copy.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">
              Closure requested
            </dt>
            <dd data-testid="closure-requested-at">
              {formatDeadline(view.closureRequestedAt, view.timezone)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">
              Recovery deadline
            </dt>
            <dd className="font-medium" data-testid="closure-recovery-deadline">
              {formatDeadline(view.recoverableUntil, view.timezone)}
            </dd>
          </div>
          {view.irreversibleAt ? (
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Permanent deletion started
              </dt>
              <dd data-testid="closure-irreversible-at">
                {formatDeadline(view.irreversibleAt, view.timezone)}
              </dd>
            </div>
          ) : null}
          {view.closedAt ? (
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Closed
              </dt>
              <dd data-testid="closure-closed-at">
                {formatDeadline(view.closedAt, view.timezone)}
              </dd>
            </div>
          ) : null}
        </dl>

        {view.reactivationRequired && view.state === 'active' ? (
          <Alert data-testid="closure-reactivation-required">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Reactivation required</AlertTitle>
            <AlertDescription>
              The closure was cancelled, but nothing has resumed. This workspace stays
              read only until every reactivation check passes and each portal, feature and
              Google connection is turned back on deliberately.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
