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
  PortalPrintKitLastPrint,
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
  lastPrint: PortalPrintKitLastPrint | null = null,
): PortalPrintKitView => ({
  portalId: 'portal-1',
  kit: 'final',
  lastPrint,
  savedWording: null,
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
    // The photo is the portal's: its Look section says whose it is and where to change it.
    await expect(canvas.getByRole('link', { name: 'Change photo' })).toHaveAttribute(
      'href',
      '/properties/property-1/portals/portal-1?tab=page&section=look',
    )
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
    await expect(canvas.getByText(/from your own printer only/)).toBeVisible()
    await expect(canvas.queryByRole('group', { name: 'How many?' })).toBeNull()
    await expect(canvas.getByText(/one card per page · upright · 4 × 6 in/)).toBeVisible()
  },
}

/** English and Bulgarian share the bar, one short cue a line: nothing holds the download back. */
export const TwoCuesShareTheBar: Story = {
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
      canvas.queryByText(/scan line in these two languages does not fit/i),
    ).toBeNull()
    await expect(canvas.getByRole('button', { name: /download pdf/i })).toBeEnabled()
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
          cropMarks: false,
          backPage: false,
          languages: ['en', 'es'],
          callToAction: 'how_did_we_do',
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
    await expect(canvas.getByRole('checkbox', { name: 'Add crop marks' })).toBeVisible()
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Print a back page' }))
    await expect(
      canvas.getByText(/one card per page · upright · 4 × 6 in · both sides/),
    ).toBeVisible()
    await expect(
      canvas.getByText(/the front on page 1 and the back on page 2\./),
    ).toBeVisible()
  },
}

/** The board print-shop: a print shop is told what to order and gets one page with its print margin, and no talk of bleed. */
export const PrintShopOrderAndPage: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'A print shop' }))
    await expect(
      canvas.getByText(
        /^Order 4 × 6 in postcards, 14–16 pt, matte, one side\. Upload this PDF as it is\./,
      ),
    ).toBeVisible()
    await expect(
      canvas.getByText(/One card per page, with a 1\/8 in print margin round it\./),
    ).toBeVisible()
    await expect(
      await canvas.findByRole('img', { name: 'Print-shop file, page 1 of 1' }),
    ).toBeVisible()
    await expect(canvas.queryByRole('img', { name: /^Your sheet/ })).toBeNull()
    await expect(canvas.queryByText(/bleed/iu)).toBeNull()
  },
}

/** Crop marks are under More options, off until asked for: on, the page grows, the summary says so and the download asks for them. */
export const PrintShopCropMarks: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'A print shop' }))
    await userEvent.click(canvas.getByText('More options'))
    const marks = canvas.getByRole('checkbox', { name: 'Add crop marks' })
    await expect(marks).not.toBeChecked()
    await expect(canvas.getByText(/^4\.25 × 6\.25 in\. One card per page/)).toBeVisible()
    await userEvent.click(marks)
    await expect(
      canvas.getByText(/one card per page · upright · 4 × 6 in · crop marks · one side/),
    ).toBeVisible()
    await expect(canvas.getByText(/^4\.75 × 6\.75 in\. One card per page/)).toBeVisible()
    await expect(canvas.getByText(/Crop marks stand just outside it/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /download pdf/i }))
    await waitFor(() =>
      expect(args.printKit?.downloadFinalMutation).toHaveBeenCalledWith({
        data: expect.objectContaining({
          piece: 'counter',
          printer: 'print_shop',
          cropMarks: true,
        }),
      }),
    )
  },
}

/** Where a story stubs the clipboard, and puts the browser's own back after. */
async function withClipboard(
  writeText: (text: string) => Promise<void>,
  copyCommand: boolean,
  run: () => Promise<void>,
) {
  const execCommand = document.execCommand.bind(document)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  document.execCommand = () => copyCommand
  try {
    await run()
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard')
    document.execCommand = execCommand
  }
}

/** The note for the print shop is one press away, and says it is copied. */
export const PrintShopNoteIsCopied: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const writeText = fn(async () => undefined)
    await userEvent.click(await canvas.findByRole('radio', { name: 'A print shop' }))
    await withClipboard(writeText, false, async () => {
      await userEvent.click(
        canvas.getByRole('button', { name: 'Copy a note for the print shop' }),
      )
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          expect.stringContaining('Trim 4 × 6 in (TrimBox). Bleed 1/8 in on every side'),
        ),
      )
      await expect(await canvas.findByRole('button', { name: 'Copied' })).toBeVisible()
    })
  },
}

/** A browser that blocks the clipboard shows the note, selected, to copy by hand. */
export const PrintShopNoteCopyBlocked: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'A print shop' }))
    await withClipboard(
      async () => {
        throw new Error('blocked')
      },
      false,
      async () => {
        await userEvent.click(
          canvas.getByRole('button', { name: 'Copy a note for the print shop' }),
        )
        await expect(await canvas.findByRole('alert')).toHaveTextContent(
          'Copy failed: this browser blocked clipboard access.',
        )
        await expect(
          canvas.getByText(/Print-ready PDF\. One card per page\./),
        ).toBeVisible()
      },
    )
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

/** What the Portal's last print was, as the read gives it; noon UTC keeps the day the same in every zone a manager is in. */
const lastPrint = (
  settings: Partial<PortalPrintKitLastPrint['settings']>,
  photo: PortalPrintKitLastPrint['photo'] = { kind: 'same' },
): PortalPrintKitLastPrint => ({
  printedAt: '2026-10-12T12:00:00.000Z',
  settings: {
    piece: 'tent',
    orientation: 'wide',
    look: 'paper',
    paper: 'letter',
    printer: 'my_printer',
    quantity: 10,
    fillSpares: false,
    perSheet: null,
    cropMarks: false,
    backPage: false,
    languages: ['en', 'es'],
    callToAction: 'how_did_we_do',
    customWords: null,
    ...settings,
  },
  photo,
})

/** The board share-desktop-dark: Immersive Counter cards last printed, the photo changed since; "Use the same settings" sets them again. */
export const LastPrintedImmersiveCardsPhotoChanged: Story = {
  args: {
    ...baseArgs,
    printKit: printKit(
      view(
        {},
        lastPrint(
          {
            piece: 'counter',
            orientation: 'upright',
            look: 'immersive',
            quantity: 25,
            languages: ['en'],
          },
          { kind: 'changed', on: '2026-10-20T12:00:00.000Z' },
        ),
      ),
    ),
  },
  parameters: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        /^Last printed Oct 12(, 2026)? · 25 Immersive Counter cards, upright, on Letter$/,
      ),
    ).toBeVisible()
    await expect(
      canvas.getByText('Your photo changed on Oct 20. Printing again uses the new one.'),
    ).toBeVisible()
    // The look the last print used is the one the section opens on; the rest is the board's start.
    await expect(radio(canvas, /^Table tents/)).toBeChecked()
    await expect(radio(canvas, /^Immersive/)).toBeChecked()
    await userEvent.click(canvas.getByRole('button', { name: 'Use the same settings' }))
    await expect(radio(canvas, /^Counter cards/)).toBeChecked()
    await expect(radio(canvas, 'Upright')).toBeChecked()
    await expect(canvas.getByRole('textbox', { name: /cards you need/i })).toHaveValue(
      '25',
    )
    await expect(canvas.getByRole('combobox', { name: 'Languages' })).toHaveTextContent(
      'English',
    )
    // Nothing is left to set again, so the button goes; the notice stays.
    await expect(
      canvas.queryByRole('button', { name: 'Use the same settings' }),
    ).toBeNull()
    await expect(canvas.getByText(/^Last printed Oct 12/)).toBeVisible()
  },
}

/** A Paper print has no photo, so its notice has no photo line; "Use the same settings" sets the Small cards again, and comes back once a choice differs. */
export const LastPrintedPaperSmallCardsSetAgain: Story = {
  args: {
    ...baseArgs,
    printKit: printKit(
      view({}, lastPrint({ piece: 'small', quantity: 6, languages: ['en'] })),
    ),
  },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        /^Last printed Oct 12(, 2026)? · 6 Paper Small cards, wide, on Letter$/,
      ),
    ).toBeVisible()
    await expect(canvas.queryByText(/Your photo (changed|was removed)/)).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Use the same settings' }))
    await expect(radio(canvas, /^Small cards/)).toBeChecked()
    await expect(canvas.getByRole('textbox', { name: /cards you need/i })).toHaveValue(
      '6',
    )
    // Changing a choice brings the button back: it would put the last print's choice back.
    await userEvent.click(radio(canvas, 'Upright'))
    await expect(
      canvas.getByRole('button', { name: 'Use the same settings' }),
    ).toBeVisible()
  },
}

/** A print that is already what the page shows has nothing to set again: the notice says when, and the button is not offered. */
export const LastPrintedWhatTheSectionOpensOn: Story = {
  args: { ...baseArgs, printKit: printKit(view({}, lastPrint({}))) },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        /^Last printed Oct 12(, 2026)? · 10 Paper table tents, wide, on Letter, English \+ Español$/,
      ),
    ).toBeVisible()
    await expect(
      canvas.queryByRole('button', { name: 'Use the same settings' }),
    ).toBeNull()
  },
}

/** A photo that was only chosen since, or reframed, has no day to name; one that was taken off says so. */
export const LastPrintedPhotoChangedWithNoDay: Story = {
  args: {
    ...baseArgs,
    printKit: printKit(
      view({}, lastPrint({ look: 'immersive' }, { kind: 'changed', on: null })),
    ),
  },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        'Your photo changed since. Printing again uses the new one.',
      ),
    ).toBeVisible()
  },
}

/** A Portal that was never printed has no notice at all. */
export const NeverPrinted: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('heading', { name: 'Print cards' })
    await expect(canvas.queryByText(/^Last printed/)).toBeNull()
    await expect(
      canvas.queryByRole('button', { name: 'Use the same settings' }),
    ).toBeNull()
  },
}

/** A download makes the print the Portal's last: the read is asked again, and the notice appears with no button, the choices on show being the print's own. */
const downloadFinal = action<DownloadPrintFinalInput, PortalPrintKitDownload>(
  async () => TINY_PDF,
)
export const LastPrintedAppearsAfterADownload: Story = {
  args: {
    ...baseArgs,
    printKit: {
      ...printKit(),
      read: async () =>
        view(
          {},
          (downloadFinal as unknown as { mock: { calls: unknown[] } }).mock.calls
            .length === 0
            ? null
            : lastPrint({}),
        ),
      downloadFinalMutation: downloadFinal,
    },
  },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('heading', { name: 'Print cards' })
    await expect(canvas.queryByText(/^Last printed/)).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /download pdf/i }))
    await expect(
      await canvas.findByText(
        /^Last printed Oct 12(, 2026)? · 10 Paper table tents, wide, on Letter, English \+ Español$/,
      ),
    ).toBeVisible()
    await expect(
      canvas.queryByRole('button', { name: 'Use the same settings' }),
    ).toBeNull()
  },
}

/** Opens "Write your own…" in the call-to-action menu and types a headline in the first language. */
async function writeOwnHeadline(canvas: Canvas, headline: string) {
  await userEvent.click(await canvas.findByRole('combobox', { name: 'Call to action' }))
  await userEvent.click(
    await within(document.body).findByRole('option', { name: /Write your own/ }),
  )
  const [field] = await canvas.findAllByRole('textbox', { name: 'Headline' })
  if (field === undefined) throw new Error('The first language has a headline')
  await userEvent.clear(field)
  await userEvent.type(field, headline)
}

/** The board share-words-custom: the manager's own headline, one language, fits at full size on a wide tent. */
export const WriteYourOwnWords: Story = {
  args: { ...baseArgs, printKit: printKit(view({}, null)) },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('combobox', { name: 'Languages' }))
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'English' }),
    )
    await writeOwnHeadline(canvas, 'Thanks for staying with us')
    await expect(canvas.getByText('Your own words')).toBeVisible()
    await expect(await canvas.findByText('Fits at full size (19 pt)')).toBeVisible()
    await expect(canvas.getByText('26 characters · guide 30 on a tent')).toBeVisible()
    await expect(canvas.getByText('These words on every card')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /download pdf/i })).toBeEnabled()
  },
}

/** The board share-words-states panel 3: words an upright tent cannot hold turn Download into "Shorten to fit". */
export const OwnWordsTooLongForUprightTents: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'Upright' }))
    await writeOwnHeadline(canvas, 'Tell us how your visit went today, in a few taps')
    await expect(
      await canvas.findByText(/Too long for an upright tent, even at the smallest size/),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Shorten to fit' })).toBeDisabled()
  },
}

/** The board share-words-two-languages: own words in English and Español, the second never translated. */
export const OwnWordsInTwoLanguages: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await writeOwnHeadline(canvas, 'How was today?')
    const [, second] = canvas.getAllByRole('textbox', { name: 'Headline' })
    if (second === undefined) throw new Error('The second language has its own headline')
    await userEvent.clear(second)
    await userEvent.type(second, '¿Qué tal hoy?')
    await expect(
      await canvas.findByText('14 characters · guide 15 with two languages'),
    ).toBeVisible()
    await expect(
      canvas.getByText(/never translate them\. Ask someone who speaks the language/),
    ).toBeVisible()
  },
}

/** The board share-words-states panel 6: a clear offer blocks the print. */
export const OwnWordsWithAnOfferCannotPrint: Story = {
  args: baseArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await writeOwnHeadline(canvas, 'Review us, get 10% off')
    await expect(
      await canvas.findByRole('button', { name: 'Remove the offer to print' }),
    ).toBeDisabled()
  },
}
