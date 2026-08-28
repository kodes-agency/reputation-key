// LIF-01-T18 — the reactivation checklist.
//
// Program bullet 4: "nothing resumes silently". This surface exists to make
// that visible. It shows two different kinds of thing and never blurs them:
//
//   * CHECKS the system evaluated (health, responsible managers, fresh Google
//     authorization, a deliberately re-enabled Portal, cleared schedules).
//     The reader cannot tick these; they are answers, not choices.
//   * DELIBERATE ACTIONS a human must have already performed elsewhere. These
//     ARE checkboxes, and each one is a confirmation that the separate action
//     is done — the button below never performs any of them.
//
// The submit button stays disabled until both halves are complete, and the
// server refuses independently, so a client that ignores this cannot reactivate.

import { useState } from 'react'
import { CircleCheck, CircleDashed, Undo2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import type { AnyAction } from '#/components/hooks/use-action'
import type { ClosureCenterView } from '#/contexts/identity/application/dto/organization-closure.dto'

type Check = ClosureCenterView['reactivationChecks'][number]

const CHECK_LABELS: Readonly<Record<Check['id'], string>> = {
  data_cell_health: 'The data cell serving this workspace is accepting work',
  responsible_manager: 'Every property has an eligible current responsible manager',
  google_authorization: 'A fresh Google authorization exists',
  portal_reactivation: 'At least one portal has been deliberately re-enabled',
  schedule_quarantine_cleared: 'Background schedules are out of quarantine',
}

/**
 * The three separate actions. The wording is imperative and past tense on
 * purpose: the reader is confirming something they already did, not asking
 * this page to do it.
 */
export const REACTIVATION_ACTIONS = [
  {
    id: 'portal_republished',
    reasonCode: 'portal_restored',
    label: 'I re-published the portals that should be live again',
    help: 'Republishing re-points a new activation at the portal snapshot that was kept. Reactivation never does this for you.',
  },
  {
    id: 'ai_capability_reviewed',
    reasonCode: 'ai_reviewed',
    label: 'I reviewed which AI capabilities should be on',
    help: 'AI capabilities stay off until they are turned on explicitly.',
  },
  {
    id: 'google_reauthorized',
    reasonCode: 'fresh_consent',
    label: 'I re-authorized the Google connection',
    help: 'A credential stored before the closure is not evidence of current consent.',
  },
] as const

type Props = Readonly<{
  checks: ClosureCenterView['reactivationChecks']
  reactivate: AnyAction
}>

export function ReactivationChecklist({ checks, reactivate }: Props) {
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set())

  const blockedChecks = checks.filter((check) => !check.satisfied)
  const allActionsConfirmed = REACTIVATION_ACTIONS.every((action) =>
    confirmed.has(action.id),
  )
  const canReactivate = blockedChecks.length === 0 && allActionsConfirmed

  const toggle = (id: string, next: boolean) => {
    // Immutable: a new Set per change, never a mutation of the held one.
    const updated = new Set(confirmed)
    if (next) updated.add(id)
    else updated.delete(id)
    setConfirmed(updated)
  }

  return (
    <Card data-testid="reactivation-checklist">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Undo2 aria-hidden="true" className="size-5" />
          Reactivate this organization
        </CardTitle>
        <CardDescription>
          Cancelling the closure stopped the deletion. It resumed nothing. Everything
          below has to be true before this workspace is usable again.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <section aria-labelledby="reactivation-checks-heading" className="space-y-3">
          <h3
            id="reactivation-checks-heading"
            className="text-muted-foreground text-xs font-medium uppercase tracking-wide"
          >
            Checks
          </h3>
          <ul className="space-y-2">
            {checks.map((check) => (
              <li
                key={check.id}
                className="flex items-start gap-2 text-sm"
                data-testid={`reactivation-check-${check.id}`}
                data-satisfied={check.satisfied ? 'true' : 'false'}
              >
                {check.satisfied ? (
                  <CircleCheck aria-hidden="true" className="mt-0.5 size-4" />
                ) : (
                  <CircleDashed aria-hidden="true" className="mt-0.5 size-4" />
                )}
                <span>
                  {CHECK_LABELS[check.id]}
                  <span className="sr-only">
                    {check.satisfied ? ' — satisfied' : ' — not satisfied'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="reactivation-actions-heading" className="space-y-3">
          <h3
            id="reactivation-actions-heading"
            className="text-muted-foreground text-xs font-medium uppercase tracking-wide"
          >
            Deliberate actions
          </h3>
          {REACTIVATION_ACTIONS.map((action) => (
            <div key={action.id} className="flex items-start gap-3">
              <Checkbox
                id={`reactivation-${action.id}`}
                checked={confirmed.has(action.id)}
                onCheckedChange={(next) => toggle(action.id, next === true)}
                data-testid={`reactivation-action-${action.id}`}
              />
              <div className="space-y-1">
                <Label htmlFor={`reactivation-${action.id}`}>{action.label}</Label>
                <p className="text-muted-foreground text-xs">{action.help}</p>
              </div>
            </div>
          ))}
        </section>
      </CardContent>

      <CardFooter>
        <Button
          disabled={!canReactivate || reactivate.isPending}
          data-testid="reactivate-organization"
          onClick={() =>
            void reactivate({
              data: {
                acknowledgements: REACTIVATION_ACTIONS.map((action) => ({
                  id: action.id,
                  reasonCode: action.reasonCode,
                })),
              },
            })
          }
        >
          Reactivate organization
        </Button>
      </CardFooter>
    </Card>
  )
}
