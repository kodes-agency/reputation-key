import { Check, CircleAlert, CircleDashed, LockKeyhole } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type {
  SetupChecklist,
  SetupChecklistStep,
} from '#/contexts/dashboard/application/public-api'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { SetupChecklistActionLink } from './setup-checklist-action-link'

const STEP_COPY = {
  google_connection: {
    title: 'Connect Google',
    description: 'Keep one organization-owned Google connection ready.',
  },
  initial_review_sync: {
    title: 'Complete the first review sync',
    description: 'Wait for the verified Google review inventory to finish.',
  },
  published_portal: {
    title: 'Publish a guest portal',
    description: 'Configure and publish the first review gateway.',
  },
  responsible_managers: {
    title: 'Assign responsible managers',
    description: 'Choose who will receive Property and Portal work notifications.',
  },
} as const

function statusPresentation(step: SetupChecklistStep) {
  switch (step.status) {
    case 'complete':
      return { label: 'Complete', icon: Check, className: 'text-emerald-700' }
    case 'degraded':
      return { label: 'Check setup', icon: CircleAlert, className: 'text-amber-700' }
    case 'incomplete':
      return {
        label: 'Next step',
        icon: CircleDashed,
        className: 'text-muted-foreground',
      }
    case 'waiting':
      return {
        label: 'Waiting for an account admin',
        icon: CircleDashed,
        className: 'text-muted-foreground',
      }
    case 'no_access':
      return {
        label: 'No property access',
        icon: LockKeyhole,
        className: 'text-muted-foreground',
      }
  }
}

const milestoneDate = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

export function SetupChecklistPanel({
  checklist,
}: Readonly<{ checklist: SetupChecklist }>) {
  const completed = checklist.steps.filter(
    (step) => step.firstCompletedAt !== null,
  ).length
  return (
    <section aria-labelledby="setup-checklist-title" className="rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="setup-checklist-title" className="font-semibold">
            Setup checklist
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Leave and return at any time. Progress comes from verified setup state.
          </p>
        </div>
        <Badge variant="secondary">
          {completed} of {checklist.steps.length} milestones reached
        </Badge>
      </div>

      <ol className="mt-5 grid gap-3">
        {checklist.steps.map((step) => {
          const copy = STEP_COPY[step.key]
          const presentation = statusPresentation(step)
          const Icon = presentation.icon
          return (
            <li
              key={step.key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3"
            >
              <div className="flex min-w-0 items-start gap-3">
                <Icon
                  aria-hidden="true"
                  className={`mt-0.5 size-4 shrink-0 ${presentation.className}`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{copy.title}</p>
                  <p className="text-sm text-muted-foreground">{copy.description}</p>
                  <p className={`mt-1 text-xs ${presentation.className}`}>
                    {presentation.label}
                    {step.status === 'degraded' && step.firstCompletedAt
                      ? ` · first completed ${milestoneDate.format(step.firstCompletedAt)}`
                      : ''}
                  </p>
                </div>
              </div>
              {step.action && step.status !== 'complete' ? (
                <SetupChecklistActionLink action={step.action} />
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function SetupChecklistLanding({
  checklist,
  propertyId,
}: Readonly<{ checklist: SetupChecklist; propertyId: string }>) {
  return (
    <PageShell tier="dashboard">
      <PageHeader title="Dashboard" description="Finish setup at your own pace." />
      <SetupChecklistPanel checklist={checklist} />
      <div>
        <Button asChild variant="ghost">
          <Link to="/properties/$propertyId" params={{ propertyId }}>
            Open property dashboard
          </Link>
        </Button>
      </div>
    </PageShell>
  )
}
