import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { PortalShare } from './portal-share'
import type { Action } from '#/components/hooks/use-action'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../../.storybook/AuthedRouterDecorator'

type IssueInput = { data: { portalId: string } }
type RotateInput = {
  data: {
    portalId: string
    replacementKind?: 'planned' | 'security'
    gracePeriodDays?: number
  }
}
type RevokeInput = { data: { portalId: string; reason: string } }
type LinkResult = {
  publicUrl: string
  publicUrls?: { qr: string; nfc: string }
}

const publicUrl = 'https://portal.example/p/opaque-token-shown-once'
const nfcPublicUrl = 'https://portal.example/p/opaque-token-shown-once?nfc'
const issuedLink = {
  publicUrl,
  publicUrls: { qr: publicUrl, nfc: nfcPublicUrl },
}

const noActiveToken: PortalTokenStatus = {
  hasActiveToken: false,
  qualifiedScanReady: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
}

// What the Share tab sees after a reload: a live token whose URL is gone.
const activeToken: PortalTokenStatus = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 3,
  issuedAt: '2026-08-12T09:30:00.000Z',
  graceExpiresAt: null,
}

const issueAction = (
  data: LinkResult | null = null,
  error: globalThis.Error | null = null,
): Action<IssueInput, LinkResult> =>
  Object.assign(
    async (_input: IssueInput) => {
      if (error) throw error
      return issuedLink
    },
    { isPending: false, error, isSuccess: data !== null, data },
  )

const rotateAction = (data: LinkResult | null = null): Action<RotateInput, LinkResult> =>
  Object.assign(async (_input: RotateInput) => issuedLink, {
    isPending: false,
    error: null,
    isSuccess: data !== null,
    data,
  })

const revokeAction = (): Action<RevokeInput> =>
  Object.assign(async (_input: RevokeInput) => ({ revoked: true }), {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })

const meta: Meta<typeof PortalShare> = {
  title: 'Portal/PortalShare',
  component: PortalShare,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof PortalShare>

const baseArgs = {
  portalId: 'portal-1',
  issuedLink: null,
  revoked: false,
  tokenStatus: noActiveToken,
  onLinkIssued: fn(),
  onLinksRevoked: fn(),
  portalName: 'Guest services',
  issueMutation: issueAction(),
  rotateMutation: rotateAction(),
  revokeMutation: revokeAction(),
}

export const GenerateLink: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /generate public link/i }),
    ).toBeInTheDocument()
    await expect(canvas.queryByText(/opaque-token/i)).toBeNull()
  },
}

export const NewlyIssued: Story = {
  args: {
    ...baseArgs,
    issuedLink,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(publicUrl)).toBeInTheDocument()
    await expect(canvas.getByText(nfcPublicUrl)).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: /copy nfc address/i }),
    ).toBeInTheDocument()
    await expect(canvas.getByText(/save this link now/i)).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: /show qr code/i }),
    ).toBeInTheDocument()
  },
}

export const MutationError: Story = {
  args: {
    ...baseArgs,
    issueMutation: issueAction(
      null,
      new globalThis.Error('A public link could not be generated.'),
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      /could not be generated/i,
    )
  },
}

export const PermissionDenied: Story = {
  args: baseArgs,
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/view-only access/i)).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /generate/i })).toBeNull()
  },
}

// `revoked` is in-session truth: the detail query has not refetched yet, so
// tokenStatus still claims a live token and must not resurrect the affordances.
export const Revoked: Story = {
  args: {
    ...baseArgs,
    revoked: true,
    tokenStatus: activeToken,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/public links revoked/i)).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: /generate public link/i }),
    ).toBeInTheDocument()
    await expect(
      canvas.queryByRole('button', { name: /replace access materials/i }),
    ).toBeNull()
  },
}

export const PlannedReplacement: Story = {
  args: {
    ...baseArgs,
    issuedLink,
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /replace access materials/i }),
    )
    const dialog = within(
      await within(document.body).findByRole('alertdialog', {
        name: /plan an access replacement/i,
      }),
    )
    await expect(dialog.getByLabelText(/transition period/i)).toHaveValue(30)
    await expect(dialog.getByText(/between 1 and 90 days/i)).toBeInTheDocument()
  },
}

export const ImmediateReplacement: Story = {
  args: {
    ...baseArgs,
    issuedLink,
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /replace immediately/i }),
    )
    await expect(
      await within(document.body).findByRole('alertdialog', {
        name: /replace access immediately/i,
      }),
    ).toHaveTextContent(/stop working now/i)
  },
}

export const RevokeRequiresReason: Story = {
  args: {
    ...baseArgs,
    issuedLink,
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /revoke links/i }),
    )
    const dialog = within(
      await within(document.body).findByRole('alertdialog', {
        name: /revoke every public link/i,
      }),
    )
    await expect(dialog.getByRole('button', { name: /revoke links/i })).toBeDisabled()
    await expect(dialog.getByLabelText(/reason/i)).toHaveFocus()
  },
}

// After a reload the raw URL is gone but the token is still live. Rotate and
// revoke must stay reachable — revocation is the only mitigation for a leaked
// opaque link — and the issue form must not be offered (issuePortalToken would
// throw token_unavailable).
export const ActiveLinkAfterReload: Story = {
  args: {
    ...baseArgs,
    tokenStatus: activeToken,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/a public link is active/i)).toBeInTheDocument()
    await expect(canvas.getByText(/version 3, issued Aug 12, 2026/i)).toBeInTheDocument()
    await expect(canvas.queryByText(publicUrl)).toBeNull()
    await expect(
      canvas.queryByRole('button', { name: /generate public link/i }),
    ).toBeNull()
    await expect(
      canvas.getByRole('button', { name: /replace access materials/i }),
    ).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: /revoke links/i }),
    ).toBeInTheDocument()
  },
}

export const LegacyAddressNeedsQrReplacement: Story = {
  args: {
    ...baseArgs,
    tokenStatus: { ...activeToken, qualifiedScanReady: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/qr update available/i)).toBeInTheDocument()
    await expect(
      canvas.getByText(/not included in scan-based goals/i),
    ).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: /replace access materials/i }),
    ).toBeInTheDocument()
  },
}

export const RotatedWithinGracePeriod: Story = {
  args: {
    ...baseArgs,
    tokenStatus: {
      ...activeToken,
      version: 4,
      graceExpiresAt: '2026-08-19T09:30:00.000Z',
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/keeps working until Aug 19, 2026/i),
    ).toBeInTheDocument()
  },
}

export const PlannedReplacementUsesSharedDto: Story = {
  args: {
    ...baseArgs,
    issuedLink,
    rotateMutation: Object.assign(
      fn(async (_input: RotateInput) => issuedLink),
      { isPending: false, error: null, isSuccess: false, data: null },
    ) as unknown as Action<RotateInput, LinkResult>,
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /replace access materials/i }),
    )
    const dialog = within(
      await within(document.body).findByRole('alertdialog', {
        name: /plan an access replacement/i,
      }),
    )
    const days = dialog.getByLabelText(/transition period/i)
    await userEvent.clear(days)
    await userEvent.type(days, '7')
    await userEvent.click(dialog.getByRole('button', { name: /create replacement/i }))
    await waitFor(() =>
      expect(args.rotateMutation).toHaveBeenCalledWith({
        data: {
          portalId: 'portal-1',
          replacementKind: 'planned',
          gracePeriodDays: 7,
        },
      }),
    )
  },
}

export const RevokeUsesSharedDto: Story = {
  args: {
    ...baseArgs,
    issuedLink,
    revokeMutation: Object.assign(
      fn(async (_input: RevokeInput) => ({ revoked: true })),
      { isPending: false, error: null, isSuccess: false, data: null },
    ) as unknown as Action<RevokeInput>,
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /revoke links/i }),
    )
    const dialog = within(
      await within(document.body).findByRole('alertdialog', {
        name: /revoke every public link/i,
      }),
    )
    await userEvent.type(dialog.getByLabelText(/reason/i), '  Printed code retired  ')
    await userEvent.click(dialog.getByRole('button', { name: /revoke links/i }))
    await waitFor(() =>
      expect(args.revokeMutation).toHaveBeenCalledWith({
        data: { portalId: 'portal-1', reason: 'Printed code retired' },
      }),
    )
  },
}
