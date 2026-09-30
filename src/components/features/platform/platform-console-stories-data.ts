// Fixtures and mock Actions for the operator console stories. A story builds its
// Actions here (callable, with controllable pending/error state) because the
// console's real ones are the route's mutations over server functions.

import type { Action } from '#/components/hooks/use-action'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type {
  PlatformAdminInvitationView,
  PlatformOrganizationView,
} from '#/contexts/identity/application/dto/platform-console.dto'
import type { OperatorConsoleActions } from './operator-console-page'

/**
 * A callable Action whose outcome and state a story controls. `impl` is used as
 * given, so a story that wants to assert on calls passes its own `fn()` spy.
 */
export function makeAction<TInput, TOutput>(
  impl: (input: TInput) => Promise<TOutput>,
  state: Readonly<{ isPending?: boolean; error?: unknown }> = {},
): Action<TInput, TOutput> {
  return Object.assign(impl, {
    isPending: state.isPending ?? false,
    error: state.error ?? null,
    isSuccess: false,
    data: null,
  }) as unknown as Action<TInput, TOutput>
}

const invitation = (
  overrides: Partial<PlatformAdminInvitationView> = {},
): PlatformAdminInvitationView => ({
  id: 'inv-live',
  email: 'owner@rivierahotels.example',
  expiresAt: '2026-10-07T09:05:00.000Z',
  expired: false,
  ...overrides,
})

/** No Account Admin yet; one live invitation out. */
export const awaitingFirstAdmin: PlatformOrganizationView = {
  id: 'org-riviera',
  name: 'Riviera Hotels',
  slug: 'riviera-hotels',
  createdAt: '2026-09-30T08:12:00.000Z',
  lifecycleState: 'active',
  memberCount: 0,
  accountAdminCount: 0,
  pendingInvitationCount: 1,
  controlledBetaEnabled: true,
  pendingAdminInvitations: [invitation()],
}

/** The first invitation lapsed and a second one is out. */
export const lapsedInvitation: PlatformOrganizationView = {
  id: 'org-harbor',
  name: 'Harbor Collective',
  slug: 'harbor-collective',
  createdAt: '2026-09-12T14:40:00.000Z',
  lifecycleState: 'active',
  memberCount: 0,
  accountAdminCount: 0,
  pendingInvitationCount: 1,
  controlledBetaEnabled: true,
  pendingAdminInvitations: [
    invitation({
      id: 'inv-second',
      email: 'gm@harborcollective.example',
      expiresAt: '2026-10-08T10:30:00.000Z',
    }),
    invitation({
      id: 'inv-lapsed',
      email: 'director@harborcollective.example',
      expiresAt: '2026-09-19T14:40:00.000Z',
      expired: true,
    }),
  ],
}

/** Every invitation was cancelled: nothing is out, so only the form remains. */
export const noInvitationOut: PlatformOrganizationView = {
  id: 'org-sunset',
  name: 'Sunset Apartments',
  slug: 'sunset-apartments',
  createdAt: '2026-09-02T11:00:00.000Z',
  lifecycleState: 'active',
  memberCount: 0,
  accountAdminCount: 0,
  pendingInvitationCount: 0,
  controlledBetaEnabled: true,
  pendingAdminInvitations: [],
}

/** Already administered: the console shows counts only, and no invitee address. */
export const administered: PlatformOrganizationView = {
  id: 'org-alpine',
  name: 'Alpine Stays',
  slug: 'alpine-stays',
  createdAt: '2026-08-21T09:30:00.000Z',
  lifecycleState: 'active',
  memberCount: 6,
  accountAdminCount: 2,
  pendingInvitationCount: 3,
  controlledBetaEnabled: false,
  pendingAdminInvitations: [],
}

/** Closing down with an invitation still out: it can be cancelled, not resent. */
export const closing: PlatformOrganizationView = {
  id: 'org-gardens',
  name: 'Closed Gardens',
  slug: 'closed-gardens',
  createdAt: '2026-07-04T16:00:00.000Z',
  lifecycleState: 'closure_requested',
  memberCount: 0,
  accountAdminCount: 0,
  pendingInvitationCount: 1,
  controlledBetaEnabled: true,
  pendingAdminInvitations: [
    invitation({ id: 'inv-closing', email: 'owner@closedgardens.example' }),
  ],
}

export const fleet: ReadonlyArray<PlatformOrganizationView> = [
  awaitingFirstAdmin,
  lapsedInvitation,
  noInvitationOut,
  administered,
  closing,
]

export const reauthError = new ServerFunctionError(
  'AuthError',
  'Sign in again to change Organizations from the operator console.',
  'operator_reauth_required',
  403,
)

export function makeActions(
  overrides: Partial<OperatorConsoleActions> = {},
): OperatorConsoleActions {
  return {
    provision: makeAction(async ({ data }) => ({
      organizationId: 'org-new',
      slug: data.slug ?? 'new-organization',
      invitationId: 'inv-new',
      emailSent: true,
    })),
    inviteAdmin: makeAction(async () => ({ invitationId: 'inv-next', emailSent: true })),
    resend: makeAction(async () => ({
      expiresAt: '2026-10-08T09:05:00.000Z',
      emailSent: true,
    })),
    cancel: makeAction(async () => undefined),
    ...overrides,
  }
}
