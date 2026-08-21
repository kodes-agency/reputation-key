import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { PortalShare } from './portal-share'
import type { Action } from '#/components/hooks/use-action'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../../.storybook/AuthedRouterDecorator'

type IssueInput = { data: { portalId: string; printBatch?: string } }
type RotateInput = { data: { portalId: string } }
type RevokeInput = { data: { portalId: string; reason: string } }
type LinkResult = { publicUrl: string }

const publicUrl = 'https://portal.example/p/opaque-token-shown-once'

const noActiveToken: PortalTokenStatus = {
  hasActiveToken: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
}

// What the Share tab sees after a reload: a live token whose URL is gone.
const activeToken: PortalTokenStatus = {
  hasActiveToken: true,
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
      return { publicUrl }
    },
    { isPending: false, error, isSuccess: data !== null, data },
  )

const rotateAction = (data: LinkResult | null = null): Action<RotateInput, LinkResult> =>
  Object.assign(async (_input: RotateInput) => ({ publicUrl }), {
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
    issuedLink: { publicUrl },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(publicUrl)).toBeInTheDocument()
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
    await expect(canvas.queryByRole('button', { name: /rotate link/i })).toBeNull()
  },
}

export const RotateConfirmation: Story = {
  args: {
    ...baseArgs,
    issuedLink: { publicUrl },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /rotate link/i }),
    )
    await expect(
      await within(document.body).findByRole('alertdialog', {
        name: /rotate this public link/i,
      }),
    ).toBeInTheDocument()
  },
}

export const RevokeRequiresReason: Story = {
  args: {
    ...baseArgs,
    issuedLink: { publicUrl },
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
    await expect(canvas.getByRole('button', { name: /rotate link/i })).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: /revoke links/i }),
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
