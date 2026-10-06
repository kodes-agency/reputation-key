// The platform operator console (ADR 0065): every Organization with its
// counts, the ones waiting for a first Account Admin, and the forms to create
// an Organization and invite, resend or cancel that admin.
//
// Presentational: the route owns the list and the Actions. The operator holds
// no role in these Organizations, so nothing here reads tenant permissions.

import { Building2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { SectionTitle } from '#/components/ui/section-title'
import type { Action } from '#/components/hooks/use-action'
import type {
  InviteOrganizationAdminInput,
  InviteOrganizationAdminResult,
  PlatformOrganizationView,
} from '#/contexts/identity/application/dto/platform-console.dto'
import {
  CreateOrganizationDialog,
  type ProvisionOrganizationAction,
} from './create-organization-dialog'
import type {
  CancelAdminInvitationAction,
  ResendAdminInvitationAction,
} from './platform-admin-invitations'
import { isReauthRequired, summarizeOrganizations } from './platform-console-model'
import { PlatformOrganizationRow } from './platform-organization-row'

export type OperatorConsoleActions = Readonly<{
  provision: ProvisionOrganizationAction
  inviteAdmin: Action<
    { data: InviteOrganizationAdminInput },
    InviteOrganizationAdminResult
  >
  resend: ResendAdminInvitationAction
  cancel: CancelAdminInvitationAction
}>

type Props = Readonly<{
  organizations: ReadonlyArray<PlatformOrganizationView>
  actions: OperatorConsoleActions
  /** Ends the session and returns to sign-in, then back here. */
  onSignInAgain: () => void
}>

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`

function ReauthNotice({ onSignInAgain }: Readonly<{ onSignInAgain: () => void }>) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Sign in again to make changes</AlertTitle>
      <AlertDescription>
        <p>
          Changes need a sign-in from the last 30 minutes. You can still read the list.
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onSignInAgain}>
          Sign in again
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function ConsoleSummary({
  organizations,
}: Readonly<{ organizations: ReadonlyArray<PlatformOrganizationView> }>) {
  const summary = summarizeOrganizations(organizations)
  return (
    <MetricStrip aria-label="Organizations at a glance">
      <Metric label="Organizations">
        <MetricValue value={summary.organizations} />
      </Metric>
      <Metric label="Need an Account Admin">
        <MetricValue
          value={summary.needAccountAdmin}
          detail={plural(
            summary.openAdminInvitations,
            'open invitation',
            'open invitations',
          )}
        />
      </Metric>
      <Metric
        label="Controlled beta off"
        state={summary.darkForControlledBeta > 0 ? 'ready' : 'unavailable'}
      >
        <MetricValue
          value={summary.darkForControlledBeta}
          detail="Not on BETA_ALLOWLIST_ORGS"
        />
      </Metric>
    </MetricStrip>
  )
}

export function OperatorConsolePage({ organizations, actions, onSignInAgain }: Props) {
  const needsReauth = [
    actions.provision,
    actions.inviteAdmin,
    actions.resend,
    actions.cancel,
  ].some((action) => isReauthRequired(action.error))

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <PageShell>
        <PageHeader
          title="Operator console"
          description="Create Organizations and hand each to its first Account Admin. You act on an Organization only until it has one."
          actions={<CreateOrganizationDialog provision={actions.provision} />}
        />

        {needsReauth ? <ReauthNotice onSignInAgain={onSignInAgain} /> : null}

        {organizations.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No organizations yet"
            description="New organization creates one and invites its first Account Admin."
          />
        ) : (
          <>
            <ConsoleSummary organizations={organizations} />
            <section aria-labelledby="platform-organizations-heading">
              <SectionTitle id="platform-organizations-heading" className="mb-3">
                Organizations
              </SectionTitle>
              <ul className="divide-y rounded-lg border bg-card">
                {organizations.map((organization) => (
                  <PlatformOrganizationRow
                    key={organization.id}
                    organization={organization}
                    inviteAdmin={actions.inviteAdmin}
                    resend={actions.resend}
                    cancel={actions.cancel}
                  />
                ))}
              </ul>
            </section>
          </>
        )}
      </PageShell>
    </div>
  )
}
