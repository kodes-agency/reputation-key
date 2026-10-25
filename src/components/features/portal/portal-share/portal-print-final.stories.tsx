// fallow-ignore-file code-duplication
// The Share tab's final Print cards section (final design spec §11), as the
// boards share-desktop-light, share-desktop-dark and share-phone draw it: shown
// because the read says the server has PRINT_KIT_FINAL_ENABLED on. What is
// printed and which way up, the look, who prints, how many and the words; the
// download with its summary and How to print; the preview beside it, or on a
// phone the pinned bar and its Preview sheet. The server makes the PDF; a story
// hands the download a small file.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type {
  PortalPrintKitDownload,
  PortalPrintKitView,
  PortalTokenStatus,
} from '#/contexts/portal/application/public-api'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { PortalShare } from './portal-share'
import type {
  DownloadPrintFinalInput,
  DownloadPrintKitInput,
} from './portal-print-kit-types'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'
import { DARK_LOGO, PHOTO } from './print-final-story-fixtures'

const QR_ADDRESS = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const issuedLink: IssuedPortalLink = {
  publicUrl: QR_ADDRESS,
  publicUrls: {
    qr: QR_ADDRESS,
    nfc: QR_ADDRESS,
    direct: 'https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGh',
  },
  addressRecoverable: true,
}

const liveToken: PortalTokenStatus = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 3,
  issuedAt: '2026-10-24T09:30:00.000Z',
  graceExpiresAt: null,
  addressRecoverable: true,
  madeBy: null,
}

/** Oakmere's stand-in: a dark tree logo, a navy field, a pale blue accent and its photo's size. */
const view = (
  overrides: Partial<PortalPrintKitView['look']> = {},
): PortalPrintKitView => ({
  portalId: 'portal-1',
  kit: 'final',
  portalName: 'Reception',
  primaryLocale: 'en',
  locales: ['en', 'es', 'bg'],
  titles: { en: 'Reception', es: 'Recepción', bg: 'Рецепция' },
  look: {
    wordmark: 'Oakmere',
    propertyName: 'Oakmere by Larkspur',
    accentColour: '#A8C6FE',
    fieldColour: '#16224A',
    heroUrl: PHOTO,
    heroFocal: { x: 0.5, y: 0.4 },
    heroSize: { width: 1195, height: 669 },
    logoUrl: DARK_LOGO,
    ...overrides,
  },
})

const action = <TInput, TOutput = unknown>(
  run: (input: TInput) => Promise<TOutput>,
): Action<TInput, TOutput> =>
  Object.assign(fn(run), {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  }) as unknown as Action<TInput, TOutput>

const TINY_PDF: PortalPrintKitDownload = {
  fileName: 'reception-table-tents-wide-en-es-letter.pdf',
  contentType: 'application/pdf',
  pdfBase64: btoa('%PDF-1.3\n%%EOF'),
}

const mutations: PortalShareMutations = {
  issueMutation: action(async () => issuedLink),
  rotateMutation: action(async () => issuedLink),
  revokeMutation: action(async () => ({ revoked: true })),
  revealMutation: action(async () => issuedLink),
}

const printKit = (read: PortalPrintKitView = view()) => ({
  read: async () => read,
  downloadMutation: action<DownloadPrintKitInput, PortalPrintKitDownload>(
    async () => TINY_PDF,
  ),
  downloadFinalMutation: action<DownloadPrintFinalInput, PortalPrintKitDownload>(
    async () => TINY_PDF,
  ),
})

const baseArgs = {
  portalId: 'portal-1',
  portalName: 'Reception',
  propertyId: 'property-1',
  issuedLink,
  revoked: false,
  tokenStatus: liveToken,
  onLinkIssued: fn(),
  onAddressRevealed: fn(),
  onLinksRevoked: fn(),
  ...mutations,
  // A US property: Letter paper.
  countryCode: 'US',
  printKit: printKit(),
}

const meta: Meta<typeof PortalShare> = {
  title: 'Portal/PortalShare/Print kit final/Share',
  component: PortalShare,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof PortalShare>

type Canvas = ReturnType<typeof within>

const radio = (canvas: Canvas, name: string | RegExp) =>
  canvas.getByRole('radio', { name })

/** The board share-desktop-light: ten wide Paper tents on Letter, English then Español. */
export const PaperTentsOnLetter: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: 'Print cards' }),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('heading', { name: 'Print kit' })).toBeNull()
    await expect(radio(canvas, /^Table tents/)).toBeChecked()
    await expect(
      canvas.getByText('Tables and nightstands · 4.25 × 2.75 in faces · 4 per sheet'),
    ).toBeVisible()
    await expect(radio(canvas, 'Wide')).toBeChecked()
    await expect(
      canvas.getByText(
        'Wide tents stand about 2.5 in tall. Upright ones stand 3.9 in and fold from a strip.',
      ),
    ).toBeVisible()
    await expect(
      canvas.getByText('White, little ink. 4 tents a sheet, cut in half each way.'),
    ).toBeVisible()
    await expect(canvas.getByRole('combobox', { name: 'Languages' })).toHaveTextContent(
      'English, then Español',
    )
    await expect(canvas.getByText(/10 tents · wide · Letter · one side/)).toBeVisible()
    await expect(
      await canvas.findByRole('img', { name: 'Your sheet, Letter · sheet 1 of 3' }),
    ).toBeVisible()
  },
}

/** The board share-desktop-dark: Immersive upright Counter cards, a photo that may look soft. */
export const ImmersiveCountersMayLookSoft: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Counter cards/ }))
    await userEvent.click(radio(canvas, /^Immersive/))
    await expect(radio(canvas, 'Upright')).toBeChecked()
    await expect(
      canvas.getByText(
        'Your photo, like your guest page. 2 cards a sheet, 6 cuts, more toner.',
      ),
    ).toBeVisible()
    await expect(
      await canvas.findByText('Your photo may look soft at this size'),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Change photo' })).toBeVisible()
    await expect(canvas.getByText('Fills 5 sheets exactly.')).toBeVisible()
  },
}

/** The other tier: a 584 px tall photo on a wide Counter card will look soft. */
export const WideCounterWillLookSoft: Story = {
  args: {
    ...baseArgs,
    printKit: printKit(view({ heroSize: { width: 1043, height: 584 } })),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Counter cards/ }))
    await userEvent.click(radio(canvas, /^Immersive/))
    await userEvent.click(radio(canvas, 'Wide'))
    await expect(
      await canvas.findByText('Your photo will look soft at this size'),
    ).toBeVisible()
    await expect(canvas.getByText(/It prints at 137 dpi here\./)).toBeVisible()
  },
}

/** A print shop takes no tents: Share moves to Counter cards and the file is one page. */
export const PrintShopOffersCounterCards: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'A print shop' }))
    await expect(radio(canvas, /^Counter cards/)).toBeChecked()
    await expect(radio(canvas, /^Table tents/)).toBeDisabled()
    await expect(canvas.queryByRole('group', { name: 'How many?' })).toBeNull()
    await expect(canvas.getByText(/one card per page · upright · 4 × 6 in/)).toBeVisible()
  },
}

/** English and Bulgarian cannot share the bar: the download says why and stays off. */
export const TwoCuesThatDoNotFit: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('combobox', { name: 'Languages' }))
    await userEvent.click(
      await within(document.body).findByRole('option', {
        name: 'English, then Български',
      }),
    )
    await expect(
      canvas.getByText(
        'The scan line in these two languages does not fit this piece. Choose one language.',
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: /download pdf/i })).toBeDisabled()
  },
}

/** The download asks for exactly the print chosen. */
export const DownloadSendsTheChoice: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'Upright' }))
    await userEvent.click(canvas.getByRole('checkbox', { name: /fill the last sheet/i }))
    await userEvent.click(canvas.getByRole('button', { name: /download pdf/i }))
    await waitFor(() =>
      expect(args.printKit?.downloadFinalMutation).toHaveBeenCalledWith({
        data: {
          portalId: 'portal-1',
          piece: 'tent',
          orientation: 'upright',
          look: 'paper',
          paper: 'letter',
          printer: 'my_printer',
          quantity: 10,
          fillSpares: true,
          backPage: false,
          languages: ['en', 'es'],
          callToAction: 'rate',
        },
      }),
    )
  },
}

/** A card's back page: under More options, off until asked for; the summary says both sides, the preview gets a Back side, and the download asks for it. */
export const CounterCardBackPage: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Counter cards/ }))
    await expect(canvas.getByText(/10 cards · upright · Letter · one side/)).toBeVisible()
    await expect(canvas.queryByRole('radio', { name: 'Back' })).toBeNull()
    await userEvent.click(canvas.getByText('More options'))
    const back = canvas.getByRole('checkbox', { name: 'Print a back page' })
    await expect(back).not.toBeChecked()
    await userEvent.click(back)
    await expect(
      canvas.getByText(/10 cards · upright · Letter · both sides/),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: 'Back' }))
    await expect(
      await canvas.findByRole('img', { name: 'Upright back, shown smaller' }),
    ).toBeVisible()
    await expect(
      await canvas.findByRole('img', {
        name: 'Your sheet, Letter · back of sheet 1 of 4',
      }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /download pdf/i }))
    await waitFor(() =>
      expect(args.printKit?.downloadFinalMutation).toHaveBeenCalledWith({
        data: expect.objectContaining({ piece: 'counter', backPage: true }),
      }),
    )
  },
}

/** A tent prints its front on both faces: there is no back page to ask for. */
export const TentsHaveNoBackPage: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByText('More options'))
    await expect(canvas.getByRole('combobox', { name: 'Tents per sheet' })).toBeVisible()
    await expect(canvas.queryByRole('checkbox', { name: 'Print a back page' })).toBeNull()
  },
}

/** A print shop gets a card's back as its second page; More options holds just the back page. */
export const PrintShopCardBackPage: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'A print shop' }))
    await userEvent.click(canvas.getByText('More options'))
    await expect(canvas.queryByRole('combobox', { name: /per sheet/ })).toBeNull()
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Print a back page' }))
    await expect(
      canvas.getByText(/one card per page · upright · 4 × 6 in · both sides/),
    ).toBeVisible()
    await expect(
      canvas.getByText(/the front on page 1 and the back on page 2\./),
    ).toBeVisible()
  },
}

/** Where the server has the final kit off, the tab shows today's Print kit, untouched. */
export const TodaysKitWhenTheServerHasItOff: Story = {
  args: { ...baseArgs, printKit: printKit({ ...view(), kit: 'current' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: 'Print kit' }),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('heading', { name: 'Print cards' })).toBeNull()
  },
}

/** The board share-phone: upright tents, the pinned bar, and Preview as a sheet with its own orientation control. */
export const PhoneUprightTents: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  globals: { viewport: { value: 'mobileStaff', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'Upright' }))
    await expect(canvas.getByText(/^· 10 tents · upright · Letter$/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }))
    const sheet = within(await within(document.body).findByRole('dialog'))
    await expect(
      sheet.getByText(/Español prints as one small line on upright tents\./),
    ).toBeVisible()
    await userEvent.click(sheet.getByRole('radio', { name: 'Wide' }))
    await expect(sheet.getByRole('radio', { name: 'Wide' })).toBeChecked()
    await expect(
      await sheet.findByRole('img', { name: 'Your sheet, Letter · sheet 1 of 3' }),
    ).toBeVisible()
  },
}
