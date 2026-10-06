// One Organization in the operator console (ADR 0065): who it is, what needs
// the operator, and — only while it has no Account Admin — its open admin
// invitations and a form to invite another. Once an Account Admin has joined,
// the console stops acting on the Organization (and stops showing invitee
// addresses), so the row says so instead of offering controls. Every live
// invitation stays acceptable after the first, so the row warns while more
// than one is out.

import { Badge } from '#/components/ui/badge'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import type {
  InviteOrganizationAdminInput,
  InviteOrganizationAdminResult,
  PlatformOrganizationView,
} from '#/contexts/identity/application/dto/platform-console.dto'
import type { Action } from '#/components/hooks/use-action'
import { InviteOrganizationAdminForm } from './invite-organization-admin-form'
import {
  PlatformAdminInvitations,
  type CancelAdminInvitationAction,
  type ResendAdminInvitationAction,
} from './platform-admin-invitations'
import {
  canInviteAdmin,
  formatConsoleDate,
  hasCompetingAdminInvitations,
  organizationFlags,
  type OrganizationFlag,
} from './platform-console-model'

type Props = Readonly<{
  organization: PlatformOrganizationView
  inviteAdmin: Action<
    { data: InviteOrganizationAdminInput },
    InviteOrganizationAdminResult
  >
  resend: ResendAdminInvitationAction
  cancel: CancelAdminInvitationAction
}>

/** Waiting on the operator is the one flag that needs them: a tone, not a look. */
const FLAG_VARIANT: Readonly<Record<OrganizationFlag['id'], 'warn' | 'outline'>> = {
  'needs-account-admin': 'warn',
  lifecycle: 'outline',
  'controlled-beta-off': 'outline',
}

function Fact({ term, value }: Readonly<{ term: string; value: number }>) {
  return (
    <DescriptionItem term={term}>
      <span className="font-medium tabular-nums">{value}</span>
    </DescriptionItem>
  )
}

function AdministrationSection({ organization, inviteAdmin, resend, cancel }: Props) {
  const { id, name, accountAdminCount, lifecycleState } = organization
  if (accountAdminCount > 0) {
    return (
      <p className="text-sm text-muted-foreground">
        It has an Account Admin, so its admins manage invitations from here on.
      </p>
    )
  }
  const invitable = canInviteAdmin(organization)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Account Admin invitations</h4>
        <PlatformAdminInvitations
          organizationId={id}
          organizationName={name}
          invitations={organization.pendingAdminInvitations}
          canResend={lifecycleState === 'active'}
          resend={resend}
          cancel={cancel}
        />
        {organization.pendingAdminInvitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open invitation.</p>
        ) : null}
        {hasCompetingAdminInvitations(organization) ? (
          <Alert variant="warning">
            <AlertDescription>
              More than one invitation is live. Everyone who accepts becomes an Account
              Admin, and once one has joined only they can cancel the rest. Cancel any you
              did not mean to send.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
      {invitable ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">
            {organization.pendingAdminInvitations.length > 0
              ? 'Invite another Account Admin'
              : 'Invite an Account Admin'}
          </h4>
          <InviteOrganizationAdminForm
            organizationId={id}
            organizationName={name}
            inviteAdmin={inviteAdmin}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This Organization is not active, so it cannot take a new invitation.
        </p>
      )}
    </div>
  )
}

export function PlatformOrganizationRow(props: Props) {
  const { organization } = props
  const flags = organizationFlags(organization)
  const headingId = `platform-organization-${organization.id}`
  const betaFlag = flags.find((flag) => flag.id === 'controlled-beta-off')

  return (
    <li aria-labelledby={headingId} className="flex flex-col gap-4 px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={headingId} className="text-base font-semibold">
            {organization.name}
          </h3>
          <p className="text-xs text-muted-foreground">
            <code className="font-mono">{organization.slug}</code> · Created{' '}
            {formatConsoleDate(organization.createdAt)}
          </p>
        </div>
        {flags.length > 0 ? (
          <ul
            aria-label={`Attention for ${organization.name}`}
            className="flex flex-wrap gap-1.5"
          >
            {flags.map((flag) => (
              <li key={flag.id}>
                <Badge variant={FLAG_VARIANT[flag.id]}>{flag.label}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <DescriptionList termWidth="wide">
        <Fact term="Members" value={organization.memberCount} />
        <Fact term="Account Admins" value={organization.accountAdminCount} />
        <Fact term="Pending invitations" value={organization.pendingInvitationCount} />
      </DescriptionList>

      {betaFlag?.detail ? (
        <p className="text-sm text-muted-foreground">
          Add <code className="font-mono">{betaFlag.detail}</code> to BETA_ALLOWLIST_ORGS
          on web and worker to turn controlled-beta capabilities on for it.
        </p>
      ) : null}

      <AdministrationSection {...props} />
    </li>
  )
}
