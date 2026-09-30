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

const openMenu = async (canvasElement: HTMLElement) =>
  userEvent.click(
    within(canvasElement).getByRole('button', { name: /more code actions/i }),
  )

export const NoCodeYet: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /make code/i })).toBeInTheDocument()
    await expect(canvas.queryByText(/opaque-token/i)).toBeNull()
    await expect(canvas.queryByText(/qr code and nfc tag/i)).toBeNull()
  },
}

export const NewlyMade: Story = {
  args: { ...baseArgs, issuedLink },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(publicUrl)).toBeInTheDocument()
    await expect(canvas.getByText(/save this address now/i)).toBeInTheDocument()
    await expect(canvas.getByText(/qr code and nfc tag/i)).toBeInTheDocument()
    await expect(
      canvas.getByText(/printed codes keep working when you publish changes/i),
    ).toBeInTheDocument()
    await expect(
      await canvas.findByRole('img', { name: /qr code for guest services/i }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /download/i })).toBeEnabled()
    await expect(
      canvas.getByRole('button', { name: /copy nfc address/i }),
    ).toBeInTheDocument()
  },
}

export const DownloadFormats: Story = {
  args: { ...baseArgs, issuedLink },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /download/i }),
    )
    const menu = within(await within(document.body).findByRole('menu'))
    await expect(menu.getByRole('menuitem', { name: /png image/i })).toBeInTheDocument()
    await expect(menu.getByRole('menuitem', { name: /svg file/i })).toBeInTheDocument()
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
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/view-only access/i)).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /make code/i })).toBeNull()
  },
}

// A viewer sees that a code exists and when it was made, and gets no controls.
export const ViewerSeesTheCode: Story = {
  args: { ...baseArgs, tokenStatus: activeToken },
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/made 12 aug 2026/i)).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /more code actions/i })).toBeNull()
  },
}

// `revoked` is in-session truth: the detail query has not refetched yet, so
// tokenStatus still claims a live token and must not resurrect the affordances.
export const Stopped: Story = {
  args: { ...baseArgs, revoked: true, tokenStatus: activeToken },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/all codes stopped/i)).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /make code/i })).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /more code actions/i })).toBeNull()
  },
}

// After a reload the address is gone but the code is still live. Replace and
// stop must stay reachable, because stopping is the only mitigation for a leaked
// code, and the make form must not be offered (issuePortalToken would throw
// token_unavailable).
export const CodeAfterReload: Story = {
  args: { ...baseArgs, tokenStatus: activeToken },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/made 12 aug 2026/i)).toBeInTheDocument()
    await expect(canvas.getByText(/shown only when a code is made/i)).toBeInTheDocument()
    await expect(canvas.queryByText(publicUrl)).toBeNull()
    await expect(canvas.queryByRole('img', { name: /qr code/i })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /download/i })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /make code/i })).toBeNull()
    await expect(
      canvas.getByRole('button', { name: /more code actions/i }),
    ).toBeInTheDocument()
  },
}

export const LegacyAddressNeedsQrReplacement: Story = {
  args: { ...baseArgs, tokenStatus: { ...activeToken, qualifiedScanReady: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/qr update available/i)).toBeInTheDocument()
    await expect(
      canvas.getByText(/not included in scan-based goals/i),
    ).toBeInTheDocument()
  },
}

export const ReplacedWithinTransition: Story = {
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
      within(canvasElement).getByText(/keeps working until 19 aug 2026/i),
    ).toBeInTheDocument()
  },
}

export const ReplaceMenuOffersBothWays: Story = {
  args: { ...baseArgs, issuedLink },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement)
    const menu = within(await within(document.body).findByRole('menu'))
    await expect(menu.getByRole('menuitem', { name: /replace code/i })).toHaveTextContent(
      /planned, or at once for security/i,
    )
    await expect(
      menu.getByRole('menuitem', { name: /stop all codes/i }),
    ).toHaveTextContent(/turn off the public address at once/i)
  },
}

const openReplaceDialog = async (canvasElement: HTMLElement) => {
  await openMenu(canvasElement)
  await userEvent.click(
    await within(document.body).findByRole('menuitem', { name: /replace code/i }),
  )
  return within(
    await within(document.body).findByRole('alertdialog', { name: /replace the code/i }),
  )
}

export const PlannedReplacement: Story = {
  args: { ...baseArgs, issuedLink },
  play: async ({ canvasElement }) => {
    const dialog = await openReplaceDialog(canvasElement)
    await expect(dialog.getByRole('radio', { name: /^planned/i })).toBeChecked()
    await expect(dialog.getByLabelText(/transition period \(days\)/i)).toHaveValue(30)
    await expect(dialog.getByText(/between 1 and 90 days/i)).toBeInTheDocument()
  },
}

export const SecurityReplacementHidesTransition: Story = {
  args: { ...baseArgs, issuedLink },
  play: async ({ canvasElement }) => {
    const dialog = await openReplaceDialog(canvasElement)
    await userEvent.click(dialog.getByRole('radio', { name: /at once, for security/i }))
    await expect(dialog.queryByLabelText(/transition period \(days\)/i)).toBeNull()
  },
}

const spiedRotate = () =>
  Object.assign(
    fn(async (_input: RotateInput) => issuedLink),
    { isPending: false, error: null, isSuccess: false, data: null },
  ) as unknown as Action<RotateInput, LinkResult>

export const PlannedReplacementUsesSharedDto: Story = {
  args: { ...baseArgs, issuedLink, rotateMutation: spiedRotate() },
  play: async ({ canvasElement, args }) => {
    const dialog = await openReplaceDialog(canvasElement)
    const days = dialog.getByLabelText(/transition period \(days\)/i)
    await userEvent.clear(days)
    await userEvent.type(days, '7')
    await userEvent.click(dialog.getByRole('button', { name: /replace code/i }))
    await waitFor(() =>
      expect(args.rotateMutation).toHaveBeenCalledWith({
        data: { portalId: 'portal-1', replacementKind: 'planned', gracePeriodDays: 7 },
      }),
    )
  },
}

export const SecurityReplacementSendsNoGracePeriod: Story = {
  args: { ...baseArgs, issuedLink, rotateMutation: spiedRotate() },
  play: async ({ canvasElement, args }) => {
    const dialog = await openReplaceDialog(canvasElement)
    await userEvent.click(dialog.getByRole('radio', { name: /at once, for security/i }))
    await userEvent.click(dialog.getByRole('button', { name: /replace code/i }))
    await waitFor(() =>
      expect(args.rotateMutation).toHaveBeenCalledWith({
        data: { portalId: 'portal-1', replacementKind: 'security' },
      }),
    )
  },
}

const openStopDialog = async (canvasElement: HTMLElement) => {
  await openMenu(canvasElement)
  await userEvent.click(
    await within(document.body).findByRole('menuitem', { name: /stop all codes/i }),
  )
  return within(
    await within(document.body).findByRole('alertdialog', { name: /stop all codes/i }),
  )
}

export const StopRequiresReason: Story = {
  args: { ...baseArgs, issuedLink },
  play: async ({ canvasElement }) => {
    const dialog = await openStopDialog(canvasElement)
    await expect(dialog.getByRole('button', { name: /stop all codes/i })).toBeDisabled()
    await expect(dialog.getByLabelText(/reason/i)).toHaveFocus()
  },
}

export const StopUsesSharedDto: Story = {
  args: {
    ...baseArgs,
    issuedLink,
    revokeMutation: Object.assign(
      fn(async (_input: RevokeInput) => ({ revoked: true })),
      { isPending: false, error: null, isSuccess: false, data: null },
    ) as unknown as Action<RevokeInput>,
  },
  play: async ({ canvasElement, args }) => {
    const dialog = await openStopDialog(canvasElement)
    await userEvent.type(dialog.getByLabelText(/reason/i), '  Printed code retired  ')
    await userEvent.click(dialog.getByRole('button', { name: /stop all codes/i }))
    await waitFor(() =>
      expect(args.revokeMutation).toHaveBeenCalledWith({
        data: { portalId: 'portal-1', reason: 'Printed code retired' },
      }),
    )
  },
}
