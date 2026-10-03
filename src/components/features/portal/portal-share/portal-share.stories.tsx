// fallow-ignore-file code-duplication
import { useState } from 'react'
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
type RevealInput = { data: { portalId: string; purpose: 'download' | 'copy' | 'show' } }
type LinkResult = {
  publicUrl: string
  publicUrls?: { qr: string; nfc: string }
}

const publicUrl = 'https://portal.example/p/opaque-token-shown-once'
// What issue and rotate return: the QR and NFC addresses each carry an
// access-artifact marker. The address row must show the bare `publicUrl`.
const qrPublicUrl = `${publicUrl}?accessArtifact=artifact-qr-1`
const nfcPublicUrl = `${publicUrl}?accessArtifact=artifact-nfc-1`
const issuedLink = {
  publicUrl: qrPublicUrl,
  publicUrls: { qr: qrPublicUrl, nfc: nfcPublicUrl },
}

const noActiveToken: PortalTokenStatus = {
  hasActiveToken: false,
  qualifiedScanReady: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
  addressRecoverable: false,
  madeBy: null,
}

// What the Share tab sees after a reload: a live token whose URL is gone.
const activeToken: PortalTokenStatus = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 3,
  issuedAt: '2026-08-12T09:30:00.000Z',
  graceExpiresAt: null,
  addressRecoverable: false,
  madeBy: 'Georgi Ivanov',
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

// What a code sealed with a keyring reports after a reload: its address can be
// fetched again (ADR 0064).
const recoverableToken: PortalTokenStatus = { ...activeToken, addressRecoverable: true }

const revealAction = (
  error: globalThis.Error | null = null,
): Action<RevealInput, LinkResult> =>
  Object.assign(
    fn(async (_input: RevealInput) => {
      if (error) throw error
      return issuedLink
    }),
    { isPending: false, error, isSuccess: false, data: null },
  ) as unknown as Action<RevealInput, LinkResult>

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
  onAddressRevealed: fn(),
  onLinksRevoked: fn(),
  portalName: 'Guest services',
  issueMutation: issueAction(),
  rotateMutation: rotateAction(),
  revokeMutation: revokeAction(),
  revealMutation: revealAction(),
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
    // A website or email click must not be counted as a QR scan.
    await expect(canvas.queryByText(/accessArtifact/i)).toBeNull()
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
    await expect(
      canvas.getByText('Made Aug 12, 2026 by Georgi Ivanov'),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /more code actions/i })).toBeNull()
  },
}

// A code that recorded no maker (or one the directory cannot name) says only
// when it was made, never a placeholder after "by".
export const MadeWithoutAKnownMaker: Story = {
  args: { ...baseArgs, tokenStatus: { ...activeToken, madeBy: null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Made Aug 12, 2026')).toBeInTheDocument()
    await expect(canvas.queryByText(/ by /)).toBeNull()
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
    await expect(canvas.getByText(/made aug 12, 2026/i)).toBeInTheDocument()
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

// With a keyring the address is not lost on reload: the code can be downloaded
// again, so the reveal-once wording and warning are gone.
export const DownloadAgainAfterReload: Story = {
  args: { ...baseArgs, tokenStatus: recoverableToken },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /download again/i })).toBeEnabled()
    await expect(
      canvas.getByRole('button', { name: /copy nfc address/i }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /show address/i })).toBeEnabled()
    await expect(
      canvas.getByText(/download the code again whenever you need it/i),
    ).toBeInTheDocument()
    await expect(canvas.queryByText(/shown only when a code is made/i)).toBeNull()
    await expect(canvas.queryByText(/save this address now/i)).toBeNull()
    await expect(canvas.queryByText(publicUrl)).toBeNull()
    await expect(
      canvas.getByRole('button', { name: /more code actions/i }),
    ).toBeInTheDocument()
  },
}

export const ShowAddressFetchesItOnce: Story = {
  args: { ...baseArgs, tokenStatus: recoverableToken },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /show address/i }),
    )
    await waitFor(() =>
      expect(args.revealMutation).toHaveBeenCalledWith({
        data: { portalId: 'portal-1', purpose: 'show' },
      }),
    )
    await waitFor(() => expect(args.onAddressRevealed).toHaveBeenCalledWith(issuedLink))
  },
}

export const CopyNfcFetchesItFirst: Story = {
  args: { ...baseArgs, tokenStatus: recoverableToken },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /copy nfc address/i }),
    )
    await waitFor(() =>
      expect(args.revealMutation).toHaveBeenCalledWith({
        data: { portalId: 'portal-1', purpose: 'copy' },
      }),
    )
  },
}

export const DownloadAgainOffersBothFormats: Story = {
  args: { ...baseArgs, tokenStatus: recoverableToken },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /download again/i }),
    )
    const menu = within(await within(document.body).findByRole('menu'))
    await expect(menu.getByRole('menuitem', { name: /png image/i })).toBeInTheDocument()
    await expect(menu.getByRole('menuitem', { name: /svg file/i })).toBeInTheDocument()
  },
}

// A code made with a keyring needs no warning: leaving the page loses nothing.
export const NewlyMadeWithKeyring: Story = {
  args: { ...baseArgs, issuedLink, tokenStatus: recoverableToken },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(publicUrl)).toBeInTheDocument()
    await expect(canvas.queryByText(/save this address now/i)).toBeNull()
    await expect(canvas.getByRole('button', { name: /^download$/i })).toBeEnabled()
  },
}

// The detail has not refetched since the code was made: the result's own answer
// stands, so a newly made sealed code is not told to "save it now".
export const NewlyMadeWithKeyringBeforeTheRefetch: Story = {
  args: {
    ...baseArgs,
    issuedLink: { ...issuedLink, addressRecoverable: true },
    tokenStatus: noActiveToken,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(publicUrl)).toBeInTheDocument()
    await expect(canvas.queryByText(/save this address now/i)).toBeNull()
  },
}

// The page keeps what a fetch returns, as the workspace does.
function ShareThatKeepsTheFetchedAddress(args: React.ComponentProps<typeof PortalShare>) {
  const [link, setLink] = useState<typeof issuedLink | null>(null)
  return (
    <PortalShare
      {...args}
      issuedLink={link}
      onAddressRevealed={(revealed) => setLink({ ...issuedLink, ...revealed })}
    />
  )
}

// The button that was pressed is replaced by the address, so focus follows it.
export const ShowAddressMovesFocusToIt: Story = {
  args: { ...baseArgs, tokenStatus: recoverableToken },
  render: (args) => <ShareThatKeepsTheFetchedAddress {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /show address/i }))
    const address = await canvas.findByText(publicUrl)
    await waitFor(() => expect(address).toHaveFocus())
  },
}

// A fetched address belongs to the code tokenStatus describes, so the date is
// that code's, not today's.
export const FetchedAddressKeepsTheMadeDate: Story = {
  args: {
    ...baseArgs,
    issuedLink: { ...issuedLink, revealed: true },
    tokenStatus: recoverableToken,
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/made aug 12, 2026/i),
    ).toBeInTheDocument()
  },
}

export const DownloadAgainRefused: Story = {
  args: {
    ...baseArgs,
    tokenStatus: recoverableToken,
    revealMutation: revealAction(
      new globalThis.Error(
        'This code cannot be downloaded again. Replace the code to get a new set.',
      ),
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      /replace the code to get a new set/i,
    )
  },
}

// A viewer cannot fetch the address, whatever the code holds.
export const ViewerCannotDownloadAgain: Story = {
  args: { ...baseArgs, tokenStatus: recoverableToken },
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /download again/i })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /show address/i })).toBeNull()
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
      within(canvasElement).getByText(/keeps working until aug 19, 2026/i),
    ).toBeInTheDocument()
  },
}

// The detail query has not refetched, so tokenStatus still describes the code
// that was just replaced: the block must not show that code's date.
export const ReplacedInSessionWithOldStatus: Story = {
  args: { ...baseArgs, issuedLink, tokenStatus: activeToken },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/^made \w+ \d+, \d{4}$/i)).toBeInTheDocument()
    await expect(canvas.queryByText(/made aug 12, 2026/i)).toBeNull()
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
    // The submit says what it does: every printed code stops now.
    await expect(
      dialog.getByRole('button', { name: /replace now and stop the old code/i }),
    ).toBeInTheDocument()
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
    await userEvent.click(
      dialog.getByRole('button', { name: /replace now and stop the old code/i }),
    )
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
