// fallow-ignore-file code-duplication
// The saved wording of the final Print cards section (2026-10-27): Share opens on
// the wording the manager saved, "Save wording" keeps the words on show for next
// time, and the words on show survive a download and the read after it. The
// server saves and makes the PDF; a story hands each a small answer.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type {
  PortalPrintKitDownload,
  PortalPrintKitLastPrint,
  PortalPrintKitView,
  PortalTokenStatus,
  PrintFinalSavedWording,
} from '#/contexts/portal/application/public-api'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { PortalShare } from './portal-share'
import type {
  DownloadPrintFinalInput,
  DownloadPrintKitInput,
  SavePrintWordingInput,
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

const lastPrint = (
  settings: Partial<PortalPrintKitLastPrint['settings']>,
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
  photo: { kind: 'same' },
})

const view = (
  savedWording: PrintFinalSavedWording | null = null,
  last: PortalPrintKitLastPrint | null = null,
): PortalPrintKitView => ({
  portalId: 'portal-1',
  kit: 'final',
  lastPrint: last,
  savedWording,
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

const printKit = (
  read: () => Promise<PortalPrintKitView>,
  saveWording: (input: SavePrintWordingInput) => Promise<PrintFinalSavedWording> = async (
    input,
  ) => ({
    callToAction: input.data.callToAction,
    customWords: input.data.customWords ?? null,
  }),
) => ({
  read,
  downloadMutation: action<DownloadPrintKitInput, PortalPrintKitDownload>(
    async () => TINY_PDF,
  ),
  downloadFinalMutation: action<DownloadPrintFinalInput, PortalPrintKitDownload>(
    async () => TINY_PDF,
  ),
  saveWordingMutation: action<SavePrintWordingInput, PrintFinalSavedWording>(saveWording),
})

const argsFor = (kit: ReturnType<typeof printKit>) => ({
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
  countryCode: 'US',
  printKit: kit,
})

const meta: Meta<typeof PortalShare> = {
  title: 'Portal/PortalShare/Print kit final/Saved wording',
  component: PortalShare,
  parameters: { layout: 'fullscreen', theme: 'light' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof PortalShare>

type Canvas = ReturnType<typeof within>

const SAVE = { name: 'Save wording' }
const OWN = { headline: 'Thanks for staying', subline: 'Tell us more' }
const SAVED_OWN: PrintFinalSavedWording = {
  callToAction: 'how_was_stay',
  customWords: { en: OWN },
}

/** Picks a wording of the menu by its headline. */
async function pickWording(canvas: Canvas, headline: RegExp) {
  await userEvent.click(await canvas.findByRole('combobox', { name: 'Call to action' }))
  await userEvent.click(
    await within(document.body).findByRole('option', { name: headline }),
  )
}

/** Opens "Write your own…" and types a headline in the first language. */
async function writeOwnHeadline(canvas: Canvas, headline: string) {
  await userEvent.click(await canvas.findByRole('combobox', { name: 'Call to action' }))
  await userEvent.click(
    await within(document.body).findByRole('option', { name: /Write your own/ }),
  )
  const [field] = await canvas.findAllByRole('textbox', { name: 'Headline' })
  if (field === undefined) throw new Error('The first language has a headline')
  await userEvent.clear(field)
  if (headline !== '') await userEvent.type(field, headline)
}

/** The new wording sits right after "How was your visit?", with its own sub-line. */
export const HowWasYourStayInTheMenu: Story = {
  args: argsFor(printKit(async () => view())),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('combobox', { name: 'Call to action' }))
    const options = await within(document.body).findAllByRole('option')
    const names = options.map((option) => option.textContent ?? '')
    const visit = names.findIndex((name) => name.startsWith('How was your visit?'))
    expect(names[visit + 1]).toBe('How was your stay?Share your experience')
    await userEvent.click(
      within(document.body).getByRole('option', { name: /How was your stay\?/ }),
    )
    await expect(
      canvas.getByRole('combobox', { name: 'Call to action' }),
    ).toHaveTextContent('How was your stay? · Share your experience')
  },
}

/** A saved wording is what Share opens on, with nothing to save. */
export const OpensOnTheSavedWording: Story = {
  args: argsFor(
    printKit(async () =>
      view({ callToAction: 'how_was_stay', customWords: null }, lastPrint({})),
    ),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('combobox', { name: 'Call to action' }),
    ).toHaveTextContent('How was your stay? · Share your experience')
    await expect(canvas.queryByRole('button', SAVE)).toBeNull()
  },
}

/** Saved own words come back in "Write your own…", ahead of the last print's wording. */
export const OpensOnTheSavedOwnWords: Story = {
  args: argsFor(printKit(async () => view(SAVED_OWN, lastPrint({})))),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [headline] = await canvas.findAllByRole('textbox', { name: 'Headline' })
    await expect(headline).toHaveValue(OWN.headline)
    const [subline] = canvas.getAllByRole('textbox', { name: 'Sub-line' })
    await expect(subline).toHaveValue(OWN.subline)
    await expect(canvas.queryByRole('button', SAVE)).toBeNull()
  },
}

/** With nothing saved, Share opens on the wording of the last print, as it did before saving was offered. */
export const OpensOnTheLastPrintsWordingWhenNothingIsSaved: Story = {
  args: argsFor(
    printKit(async () => view(null, lastPrint({ callToAction: 'rate_visit' }))),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('combobox', { name: 'Call to action' }),
    ).toHaveTextContent('Rate your visit · About 30 seconds')
    await expect(canvas.queryByRole('button', SAVE)).toBeNull()
  },
}

/** Picking another wording offers Save; saving sends exactly the wording, and the button goes. */
export const SaveAPickedWording: Story = {
  args: argsFor(printKit(async () => view())),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('combobox', { name: 'Call to action' })
    await expect(canvas.queryByRole('button', SAVE)).toBeNull()
    await pickWording(canvas, /How was your stay\?/)
    await expect(await canvas.findByRole('button', SAVE)).toBeEnabled()
    await expect(
      canvas.getByText('Share opens with these words next time.'),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', SAVE))
    await waitFor(() =>
      expect(args.printKit?.saveWordingMutation).toHaveBeenCalledWith({
        data: { portalId: 'portal-1', callToAction: 'how_was_stay', customWords: null },
      }),
    )
    await waitFor(() => expect(canvas.queryByRole('button', SAVE)).toBeNull())
    // Back to the wording it opened on: that is now unsaved.
    await pickWording(canvas, /How did we do\?/)
    await expect(await canvas.findByRole('button', SAVE)).toBeVisible()
  },
}

/** Own words are saved as the download sends them: only where they differ from the wording, normalised. */
export const SaveOwnWords: Story = {
  args: argsFor(printKit(async () => view())),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await writeOwnHeadline(canvas, 'Thanks for staying')
    await userEvent.click(await canvas.findByRole('button', SAVE))
    await waitFor(() =>
      expect(args.printKit?.saveWordingMutation).toHaveBeenCalledWith({
        data: {
          portalId: 'portal-1',
          callToAction: 'how_did_we_do',
          customWords: {
            en: { headline: 'Thanks for staying', subline: 'About 30 seconds' },
          },
        },
      }),
    )
    await waitFor(() => expect(canvas.queryByRole('button', SAVE)).toBeNull())
  },
}

/** Words that are not the saved ones offer Save even when they do not fit the print: Download keeps its own block. */
export const SaveWordsThatDoNotFitThePrint: Story = {
  args: argsFor(printKit(async () => view())),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'Upright' }))
    await writeOwnHeadline(canvas, 'Tell us how your visit went today, in a few taps')
    await expect(
      await canvas.findByRole('button', { name: 'Shorten to fit' }),
    ).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', SAVE))
    await waitFor(() =>
      expect(args.printKit?.saveWordingMutation).toHaveBeenCalledTimes(1),
    )
  },
}

/** No headline, no save: the button is off and says why, as the Download note does. */
export const SaveIsOffWithoutAHeadline: Story = {
  args: argsFor(printKit(async () => view())),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await writeOwnHeadline(canvas, '')
    await expect(await canvas.findByRole('button', SAVE)).toBeDisabled()
    await expect(
      canvas.getAllByText('Write a headline, or pick a wording.').length,
    ).toBeGreaterThan(0)
    await expect(args.printKit?.saveWordingMutation).not.toHaveBeenCalled()
  },
}

/** An offer cannot be saved either, and Save says so in its own words, not the Download note's PDF. */
export const SaveIsOffForAnOffer: Story = {
  args: argsFor(printKit(async () => view())),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await writeOwnHeadline(canvas, 'Get 10% off')
    const save = await canvas.findByRole('button', SAVE)
    await expect(save).toBeDisabled()
    await expect(save).toHaveAccessibleDescription(
      'Remove the offer to save these words.',
    )
  },
}

/** A refused save leaves the words and the button where they are. */
export const SaveRefusedKeepsTheWords: Story = {
  args: argsFor(
    printKit(
      async () => view(),
      async () => {
        throw new Error('Too many downloads. Please wait a little before trying again.')
      },
    ),
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await writeOwnHeadline(canvas, 'Thanks for staying')
    await userEvent.click(await canvas.findByRole('button', SAVE))
    await waitFor(() =>
      expect(args.printKit?.saveWordingMutation).toHaveBeenCalledTimes(1),
    )
    const [field] = canvas.getAllByRole('textbox', { name: 'Headline' })
    await expect(field).toHaveValue('Thanks for staying')
    await expect(canvas.getByRole('button', SAVE)).toBeEnabled()
  },
}

/**
 * The owner's report: words written, the PDF downloaded, and the words went back.
 * The read after a download names the print as the Portal's last, and the server
 * has saved its wording; the words on show stay, and nothing is left to save.
 */
const downloadFinal = action<DownloadPrintFinalInput, PortalPrintKitDownload>(
  async () => TINY_PDF,
)
export const WordsSurviveADownload: Story = {
  args: argsFor({
    ...printKit(async () => {
      const calls = (downloadFinal as unknown as { mock: { calls: unknown[] } }).mock
        .calls
      return calls.length === 0
        ? view()
        : view(
            {
              callToAction: 'how_did_we_do',
              customWords: {
                en: { headline: 'Thanks for staying', subline: 'About 30 seconds' },
              },
            },
            lastPrint({
              customWords: {
                en: { headline: 'Thanks for staying', subline: 'About 30 seconds' },
              },
            }),
          )
    }),
    downloadFinalMutation: downloadFinal,
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await writeOwnHeadline(canvas, 'Thanks for staying')
    await expect(await canvas.findByRole('button', SAVE)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /download pdf/i }))
    // The read has been asked again: the last print is on the page.
    await expect(await canvas.findByText(/^Last printed Oct 12/)).toBeVisible()
    const [field] = canvas.getAllByRole('textbox', { name: 'Headline' })
    await expect(field).toHaveValue('Thanks for staying')
    // A download saved what it printed: there is nothing left to save.
    await expect(canvas.queryByRole('button', SAVE)).toBeNull()
  },
}

/**
 * The read is cached for the session and Share is built again on every visit to
 * its tab, so a save asks the read again: without that a visit a minute later
 * would open on the wording from before the save.
 */
export const SaveAsksTheReadAgain: Story = {
  args: argsFor(printKit(fn(async () => view()))),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await pickWording(canvas, /How was your stay\?/)
    await userEvent.click(await canvas.findByRole('button', SAVE))
    await waitFor(() =>
      expect(
        (args.printKit?.read as unknown as { mock: { calls: unknown[] } }).mock.calls
          .length,
      ).toBeGreaterThanOrEqual(2),
    )
  },
}

/** A keyboard save: the button goes, and focus goes to the call to action the words belong to, not to the page. */
export const FocusReturnsToTheCallToActionAfterASave: Story = {
  args: argsFor(printKit(async () => view())),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await pickWording(canvas, /How was your stay\?/)
    const save = await canvas.findByRole('button', SAVE)
    save.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(canvas.queryByRole('button', SAVE)).toBeNull())
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: 'Call to action' })).toHaveFocus(),
    )
  },
}

/** A refused keyboard save leaves focus on "Save wording", so the manager can try again. */
export const FocusStaysOnSaveWhenTheSaveIsRefused: Story = {
  args: argsFor(
    printKit(
      async () => view(),
      async () => {
        throw new Error('Too many downloads. Please wait a little before trying again.')
      },
    ),
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await pickWording(canvas, /How was your stay\?/)
    const save = await canvas.findByRole('button', SAVE)
    save.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(args.printKit?.saveWordingMutation).toHaveBeenCalledTimes(1),
    )
    await waitFor(() => expect(canvas.getByRole('button', SAVE)).toHaveFocus())
  },
}

/**
 * A read that arrives after a download says another wording (the print's, saved
 * elsewhere, a save that failed): the words on show are still the manager's.
 */
const downloadThenAnotherRead = action<DownloadPrintFinalInput, PortalPrintKitDownload>(
  async () => TINY_PDF,
)
export const AReadAfterADownloadNeverReplacesTheWords: Story = {
  args: argsFor({
    ...printKit(async () => {
      const calls = (downloadThenAnotherRead as unknown as { mock: { calls: unknown[] } })
        .mock.calls
      return calls.length === 0
        ? view()
        : view(
            { callToAction: 'rate_visit', customWords: null },
            lastPrint({ callToAction: 'rate_visit' }),
          )
    }),
    downloadFinalMutation: downloadThenAnotherRead,
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await writeOwnHeadline(canvas, 'Thanks for staying')
    await userEvent.click(canvas.getByRole('button', { name: /download pdf/i }))
    await expect(await canvas.findByText(/^Last printed Oct 12/)).toBeVisible()
    const [field] = canvas.getAllByRole('textbox', { name: 'Headline' })
    await expect(field).toHaveValue('Thanks for staying')
    await expect(
      canvas.getByRole('combobox', { name: 'Call to action' }),
    ).toHaveTextContent('Your own words')
  },
}
