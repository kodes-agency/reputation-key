// fallow-ignore-file code-duplication
// The Share tab's Print kit, as the share board draws it (spec 7.2): the style,
// the piece, the paper beside the languages, the call to action, the download
// with its file's name and how to print, with the sheet drawn beside it. The
// server makes the PDF; a story hands the download a small file.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type {
  PortalPrintKitDownload,
  PortalPrintKitView,
  PortalTokenStatus,
} from '#/contexts/portal/application/public-api'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../../.storybook/AuthedRouterDecorator'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { FACE_TYPE_PT } from '#/shared/domain/portal-print-kit-size-type'
import { SOFT_PHOTO_NOTICE } from './print-kit-photo-notice'
import { PortalShare } from './portal-share'
import type { DownloadPrintKitInput } from './portal-print-kit-types'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

const QR_ADDRESS =
  'https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'
const issuedLink: IssuedPortalLink = {
  publicUrl: QR_ADDRESS,
  publicUrls: {
    qr: QR_ADDRESS,
    nfc: `${QR_ADDRESS}-nfc`,
    direct: QR_ADDRESS.split('?')[0] ?? QR_ADDRESS,
  },
  addressRecoverable: true,
}

const liveToken = (addressRecoverable: boolean): PortalTokenStatus => ({
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 3,
  issuedAt: '2026-03-12T09:30:00.000Z',
  graceExpiresAt: null,
  addressRecoverable,
  madeBy: null,
})

/** A photograph's stand-in: a warm sky over a dark terrace, as a picture the browser can load. */
const PHOTO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8b27a"/><stop offset=".55" stop-color="#6d7f6a"/><stop offset="1" stop-color="#26332c"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><circle cx="1180" cy="260" r="130" fill="#fff1cf"/></svg>',
  )

const view = (overrides: Partial<PortalPrintKitView> = {}): PortalPrintKitView => ({
  portalId: 'portal-1',
  kit: 'current',
  lastPrint: null,
  portalName: 'Pool & Terrace',
  primaryLocale: 'en',
  locales: ['en', 'bg'],
  titles: { en: 'Pool & Terrace', bg: 'Басейн и тераса' },
  look: {
    wordmark: 'Avela',
    propertyName: 'Avela Beach Resort',
    accentColour: '#EAD6A8',
    fieldColour: '#15110D',
    heroUrl: null,
    heroFocal: null,
    heroSize: null,
    logoUrl: null,
  },
  ...overrides,
})

const action = <TInput, TOutput = unknown>(
  run: (input: TInput) => Promise<TOutput>,
  error: unknown = null,
): Action<TInput, TOutput> =>
  Object.assign(fn(run), {
    isPending: false,
    error,
    isSuccess: false,
    data: null,
  }) as unknown as Action<TInput, TOutput>

/** The smallest file that is still a PDF: enough for the browser to save. */
const TINY_PDF: PortalPrintKitDownload = {
  fileName: 'pool-terrace-counter-card-en-bg-letter.pdf',
  contentType: 'application/pdf',
  pdfBase64: btoa('%PDF-1.3\n%%EOF'),
}

const mutations: PortalShareMutations = {
  issueMutation: action(async () => issuedLink),
  rotateMutation: action(async () => issuedLink),
  revokeMutation: action(async () => ({ revoked: true })),
  revealMutation: action(async () => issuedLink),
}

const downloadMutation = (error: unknown = null) =>
  action<DownloadPrintKitInput, PortalPrintKitDownload>(async () => TINY_PDF, error)

const baseArgs = {
  portalId: 'portal-1',
  portalName: 'Pool & Terrace',
  issuedLink,
  revoked: false,
  tokenStatus: liveToken(true),
  onLinkIssued: fn(),
  onAddressRevealed: fn(),
  onLinksRevoked: fn(),
  ...mutations,
  // A US property: Letter paper.
  countryCode: 'US',
  printKit: { read: async () => view(), downloadMutation: downloadMutation() },
}

const meta: Meta<typeof PortalShare> = {
  title: 'Portal/PortalShare/Print kit',
  component: PortalShare,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof PortalShare>

type Canvas = ReturnType<typeof within>

/** The whole-sheet or one-face picture: whichever the preview shows. */
const preview = (canvasElement: HTMLElement) =>
  within(canvasElement).findByRole('img', {
    name: /print preview|letter ·|a4 ·|print shop/i,
  })

const radio = (canvas: Canvas, name: string | RegExp) =>
  canvas.getByRole('radio', { name })

/** A "How to print" step by its words: a stressed phrase splits the text, so match the whole line. */
const step = (canvas: Canvas, words: RegExp) =>
  canvas.getByText((_text: string, element: Element | null) => {
    return (
      element?.tagName === 'SPAN' &&
      element.classList.contains('text-pretty') &&
      words.test(element.textContent ?? '')
    )
  })

/** Picks the languages from the select; its list opens outside the canvas. */
async function pickLanguages(canvas: Canvas, option: string) {
  await userEvent.click(canvas.getByRole('combobox', { name: 'Languages on the print' }))
  await userEvent.click(
    await within(document.body).findByRole('option', { name: option }),
  )
}

/** What the section starts with, as the board draws it: Paper on Letter, a counter card, English and Bulgarian, asking for a rating. */
export const PaperOnLetterByDefault: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: 'Print kit' }),
    ).toBeInTheDocument()
    // The preview and the file follow the live version, not an edit not yet published.
    await expect(
      canvas.getByText('Prints use the version that is live now.'),
    ).toBeVisible()
    await expect(canvas.queryByText(/bleed and crop marks\.$/i)).toBeNull()
    await expect(radio(canvas, /^Paper/)).toBeChecked()
    await expect(radio(canvas, /^Immersive/)).not.toBeChecked()
    await expect(radio(canvas, /^Counter card/)).toBeChecked()
    await expect(canvas.getByText('4 × 6 in · 2 on a Letter sheet')).toBeVisible()
    await expect(canvas.getByText('Letter, folded in half')).toBeVisible()
    await expect(radio(canvas, 'Letter')).toBeChecked()
    await expect(
      canvas.getByText(
        /^Letter prints two 4\s×\s6\sin cards per sheet\. A4 prints four A6 cards\.$/,
      ),
    ).toBeVisible()
    await expect(
      canvas.getByRole('combobox', { name: 'Languages on the print' }),
    ).toHaveTextContent('English + Български')
    await expect(radio(canvas, /rate your visit/i)).toBeChecked()
    // The file's name is shown beside the button, and the button names it.
    await expect(
      canvas.getByText('pool-terrace-counter-card-en-bg-letter.pdf'),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: /download print kit \(pdf\)/i }),
    ).toHaveAccessibleDescription('pool-terrace-counter-card-en-bg-letter.pdf')
    // The whole sheet is the preview, and its picture says what it is.
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /^Letter · two 4 × 6 in counter cards · page 1 of 2, fronts/i,
    )
    await expect(radio(canvas, 'Whole sheet')).toBeChecked()
  },
}

/** The country, not the browser, says A4: a property in Bulgaria starts on A4 paper. */
export const A4ForAnEuropeanProperty: Story = {
  args: { ...baseArgs, countryCode: 'BG' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('radio', { name: 'A4' })).toBeChecked()
    await expect(canvas.getByText('A6 · 4 on an A4 sheet')).toBeVisible()
    await expect(canvas.getByText('A4, folded in half')).toBeVisible()
    await expect(canvas.getByText('pool-terrace-counter-card-en-bg-a4.pdf')).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /^A4 · four A6 counter cards/i,
    )
  },
}

/** No country recorded: Letter, since most customers print on it. */
export const LetterWhenTheCountryIsUnknown: Story = {
  args: { ...baseArgs, countryCode: null },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('radio', { name: 'Letter' }),
    ).toBeChecked()
  },
}

/** The manager's paper beats the country's, and what the cards say follows it. */
export const ChoosingAPaperChangesWhatThePiecesAre: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('4 × 6 in · 2 on a Letter sheet')).toBeVisible()
    await userEvent.click(radio(canvas, 'A4'))
    await expect(canvas.getByText('A6 · 4 on an A4 sheet')).toBeVisible()
    await expect(canvas.getByText('A4, folded in half')).toBeVisible()
    await expect(canvas.getByText('pool-terrace-counter-card-en-bg-a4.pdf')).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /^A4 · four A6 counter cards · page 1 of 2, fronts/i,
    )
  },
}

/** The paper control is described by the one line under it. */
export const PaperSizeIsDescribedByItsNote: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = await canvas.findByRole('radiogroup', { name: 'Paper size' })
    await expect(group).toHaveAccessibleDescription(
      /Letter prints two 4\s×\s6\sin cards per sheet/,
    )
  },
}

/** A table tent folds a Letter or A4 sheet in half: its faces, its steps and its name follow the paper. */
export const TableTentOnA4: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Table tent/ }))
    await expect(canvas.getByText('Letter, folded in half')).toBeVisible()
    await expect(
      canvas.getByText(
        /^Letter folds into two 8\.5\s×\s5\.5\sin faces\. A4 folds into two A5 faces\.$/,
      ),
    ).toBeVisible()
    await userEvent.click(radio(canvas, 'A4'))
    await expect(canvas.getByText('A4, folded in half')).toBeVisible()
    await expect(canvas.getByText('pool-terrace-table-tent-en-bg-a4.pdf')).toBeVisible()
    await expect(
      step(canvas, /^Use 160–200\sg\/m² matte card .* in an A5-landscape holder\.$/),
    ).toBeVisible()
    await expect(
      step(canvas, /^Fold on the grey ticks; the fold line stays blank\.$/),
    ).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /^A4 · table tent, folded in half to two A5 faces/i,
    )
  },
}

/** A counter card on Letter: the five steps, the Bulgarian backs on a second page. */
export const CounterCardOnLetter: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(/^How to print · Paper counter card$/),
    ).toBeVisible()
    for (const line of [
      /^Print at Actual size \(100%\)\. Never “Fit to page”\.$/,
      /^Check the size: the coloured bar under each code measures 2\sin \(5\.1\scm\)\.$/,
      /^Two languages print double-sided: flip on the long edge\.$/,
      /^Use 65–110\slb cover card stock if your printer takes it, or plain paper in a 4\s×\s6\sin sign holder\.$/,
      /^Cut down on the three grey ticks, then across 6\sin from the top edge\.$/,
    ]) {
      await expect(step(canvas, line)).toBeVisible()
    }
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /^Letter · two 4 × 6 in counter cards · page 1 of 2, fronts/i,
    )
    await expect(
      canvas.getByText(/Page 2 holds the backs, Bulgarian first\./),
    ).toBeVisible()
  },
}

/** The share board's own state: Avela's counter card in English and Spanish, on Letter. */
export const CounterCardInEnglishAndSpanish: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () =>
        view({
          locales: ['en', 'es'],
          titles: { en: 'Pool & Terrace', es: 'Piscina y terraza' },
        }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('combobox', { name: 'Languages on the print' }),
    ).toHaveTextContent('English + Español')
    await expect(
      canvas.getByText('pool-terrace-counter-card-en-es-letter.pdf'),
    ).toBeVisible()
    await expect(
      canvas.getByText(/Page 2 holds the backs, Spanish first\./),
    ).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /^Letter · two 4 × 6 in counter cards · page 1 of 2, fronts/i,
    )
  },
}

/** One language: a card has no back, so no double-sided step and no Back to look at. */
export const CounterCardInOneLanguage: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('radio', { name: 'Back' })).toBeInTheDocument()
    await pickLanguages(canvas, 'Български')
    await userEvent.click(radio(canvas, /how was your visit\? about 30 seconds/i))
    await expect(canvas.queryByRole('radio', { name: 'Back' })).toBeNull()
    await expect(canvas.queryByText(/double-sided/i)).toBeNull()
    await expect(
      canvas.getByText('pool-terrace-counter-card-bg-letter.pdf'),
    ).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /two 4 × 6 in counter cards · page 1 of 1, fronts/i,
    )
  },
}

/** Immersive is for a print shop: its own piece lines, steps and file name, and its size family. */
export const ImmersiveIsForAPrintShop: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Immersive/ }))
    await expect(canvas.getByText('4 × 6 in')).toBeVisible()
    await expect(canvas.getByText('4 × 6 in, folded · print shop')).toBeVisible()
    await expect(
      canvas.getByText('Letter makes 4 × 6 in pieces. A4 makes A6 pieces.'),
    ).toBeVisible()
    await expect(
      canvas.getByText(/^How to print · Immersive counter card · print shop$/),
    ).toBeVisible()
    await expect(
      canvas.getByText('Made for a print shop. Send the PDF as it is.'),
    ).toBeVisible()
    await expect(
      canvas.getByText(/Convert to CMYK with your profile\. Field as a warm rich black/),
    ).toBeVisible()
    await expect(
      canvas.getByText('pool-terrace-counter-card-en-bg-immersive-letter.pdf'),
    ).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /4 × 6 in counter card for a print shop, with bleed and crop marks · page 1 of 2, front/i,
    )
    await userEvent.click(radio(canvas, /^Table tent/))
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /table tent for a print shop, 4 × 12 in flat with bleed and crop marks/i,
    )
    await userEvent.click(radio(canvas, 'A4'))
    await expect(canvas.getByText('A6, folded · print shop')).toBeVisible()
    await expect(canvas.getByText(/Cards 350\sg\/m²/)).toBeVisible()
  },
}

/** "How to print" is open until the manager closes it, and stays as they left it as the choice changes. */
export const HowToPrintStaysAsLeft: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = await canvas.findByText(/^How to print · Paper counter card$/)
    await expect(canvas.getByText(/Cut down on the three grey ticks/)).toBeVisible()
    await userEvent.click(summary)
    await expect(canvas.getByText(/Cut down on the three grey ticks/)).not.toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: /^Table tent/ }))
    // Closed it stays, with the new title.
    await expect(canvas.getByText(/^How to print · Paper table tent$/)).toBeVisible()
    await expect(canvas.getByText(/Fold on the grey ticks/)).not.toBeVisible()
  },
}

/** One card is the face as it prints; the Back switch is for a print with two sides. */
export const OneFaceAndItsBack: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'One card' }))
    const front = await preview(canvasElement)
    await expect(front).toHaveAccessibleName(
      /4 × 6 in counter card, front, English and Bulgarian, "Rate your visit"/i,
    )
    await expect(canvas.getByText(/4\s×\s6\sin counter card · front/)).toBeVisible()
    await expect(within(front).getByText('Оценете посещението си')).toBeInTheDocument()
    // No address is on the print as words (owner decision D2): the code carries it.
    await expect(within(front).queryByText(/reputationkey/i)).toBeNull()
    await expect(within(front).queryByText(/accessArtifact/i)).toBeNull()
    await userEvent.click(canvas.getByRole('radio', { name: 'Back' }))
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /counter card, back, Bulgarian and English, "Оценете посещението си"/i,
    )
  },
}

/** The same Back switch turns the whole sheet to its second page. */
export const BackIsTheSecondPageOfACard: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'Back' }))
    await expect(await preview(canvasElement)).toHaveAccessibleName(/page 2 of 2, backs/i)
  },
}

export const CallToActionIsOnThePrint: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'One card' }))
    await userEvent.click(
      canvas.getByRole('radio', { name: /how was your visit\? about 30 seconds/i }),
    )
    const front = await preview(canvasElement)
    await expect(within(front).getByText('How was your visit?')).toBeInTheDocument()
    await expect(within(front).getByText('About 30 seconds')).toBeInTheDocument()
  },
}

/** Long words shrink in the preview as they do in the file, so it never shows them larger. */
export const LongCopyShrinksAsInTheFile: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () =>
        view({
          primaryLocale: 'fr',
          locales: ['fr', 'en'],
          titles: {
            fr: 'Restaurant panoramique et terrasse du dernier étage',
            en: 'Rooftop restaurant and terrace, top floor',
          },
        }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'One card' }))
    await userEvent.click(
      canvas.getByRole('radio', { name: /how was your visit\? about 30 seconds/i }),
    )
    const front = await preview(canvasElement)
    const headline = within(front).getByText(/^Comment s’est/u)
    // The call to action is 30 pt on a Paper 4 × 6 in card, 288 pt wide: the full scale is 10.42 cqw.
    const fullSize = (FACE_TYPE_PT.large.ctaPaper * 100) / 288
    await expect(Number.parseFloat(headline.style.fontSize)).toBeLessThanOrEqual(
      fullSize + 0.01,
    )
  },
}

/** The photograph is the Immersive print's window; Paper has none. */
export const WithThePropertyPhoto: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () =>
        view({
          look: {
            wordmark: 'Avela',
            propertyName: 'Avela Beach Resort',
            accentColour: '#EAD6A8',
            fieldColour: '#15110D',
            heroUrl: PHOTO,
            heroFocal: { x: 0.7, y: 0.3 },
            heroSize: { width: 2400, height: 1600 },
            logoUrl: null,
          },
        }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Immersive/ }))
    await userEvent.click(canvas.getByRole('radio', { name: 'One card' }))
    const front = await preview(canvasElement)
    await expect(front.querySelector(`img[src="${PHOTO}"]`)).not.toBeNull()
    await userEvent.click(canvas.getByRole('radio', { name: /^Paper/ }))
    await expect(
      (await preview(canvasElement)).querySelector(`img[src="${PHOTO}"]`),
    ).toBeNull()
  },
}

/** A property whose photo is `heroSize` pixels, as the upload stored it. */
const photoView = (heroSize: Readonly<{ width: number; height: number }>) =>
  view({
    look: { ...view().look, heroUrl: PHOTO, heroFocal: { x: 0.5, y: 0.5 }, heroSize },
  })

/** A portrait photo the upload accepts (500 × 1000) prints soft across Large's band: one warning, and the download stays on. */
export const SoftPhotoWarnsAndStillDownloads: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () => photoView({ width: 500, height: 1000 }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    // Paper has no photo, so there is nothing to warn of.
    await userEvent.click(await canvas.findByRole('radio', { name: /^Paper/ }))
    await expect(canvas.queryByText(SOFT_PHOTO_NOTICE)).toBeNull()
    await userEvent.click(canvas.getByRole('radio', { name: /^Immersive/ }))
    const notice = await canvas.findByText(SOFT_PHOTO_NOTICE)
    await expect(notice.closest('[data-slot="alert"]')).toHaveAttribute(
      'data-variant',
      'warning',
    )
    const button = canvas.getByRole('button', { name: /download print kit \(pdf\)/i })
    await expect(button).toBeEnabled()
    await userEvent.click(button)
    const download = args.printKit?.downloadMutation as unknown as ReturnType<typeof fn>
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    await userEvent.click(canvas.getByRole('radio', { name: /^Paper/ }))
    await waitFor(() => expect(canvas.queryByText(SOFT_PHOTO_NOTICE)).toBeNull())
  },
}

/** A photo as wide as the upload hint asks for prints sharp: Immersive shows no notice. */
export const SharpPhotoShowsNoNotice: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () => photoView({ width: 1000, height: 500 }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Immersive/ }))
    await expect(await preview(canvasElement)).toBeVisible()
    await expect(canvas.queryByText(SOFT_PHOTO_NOTICE)).toBeNull()
  },
}

/** A brand and a title far longer than most: they shrink and wrap inside the margins, as in the file. */
export const LongBrandAndTitle: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () =>
        view({
          titles: {
            en: 'Spa & Wellness Centre Reception Desk and Lobby',
            bg: 'Басейн и тераса',
          },
          look: { ...view().look, wordmark: 'Kempinski Hotel Grand Arena Bansko' },
        }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'One card' }))
    const front = await preview(canvasElement)
    // The card sets the wordmark and the title in capitals, as the file does.
    for (const word of [/KEMPINSKI/u, /BANSKO/u, /SPA & WELLNESS CENTRE/u]) {
      await expect(within(front).getByText(word)).toBeInTheDocument()
    }
  },
}

/** A brand in a script the fonts lack: the file leaves it out, so the preview does too, and one line says so. */
export const CharactersTheFontsLackAreLeftOutAndNamed: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () => view({ look: { ...view().look, wordmark: 'Αθήνα Hotel' } }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        'These characters will not print, because the print kit’s fonts don’t have them: Α Θ Ή Ν.',
      ),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: 'One card' }))
    const front = await preview(canvasElement)
    await expect(within(front).getByText('HOTEL')).toBeInTheDocument()
    await expect(within(front).queryByText(/Αθ|ΑΘ/u)).toBeNull()
  },
}

/** A tracked line is set letter by letter in the file, so the preview turns ligatures off on it (the TT of TRATTORIA). */
export const TrackedLinesKeepEveryLetterSeparate: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () => view({ look: { ...view().look, wordmark: 'Trattoria' } }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'One card' }))
    const front = within(await preview(canvasElement))
    const ligatures = (element: HTMLElement) =>
      getComputedStyle(element).fontVariantLigatures
    await expect(ligatures(front.getByText('TRATTORIA'))).toBe('none')
    // Running words keep the font's own.
    await expect(ligatures(front.getByText('Rate your visit'))).toBe('normal')
  },
}

/** The download is asked for by style, paper, size and output, always: the server's defaults are for anyone else. */
export const DownloadsThePdf: Story = {
  args: baseArgs,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await pickLanguages(canvas, 'Български')
    const button = await canvas.findByRole('button', {
      name: /download print kit \(pdf\)/i,
    })
    await expect(button).toBeEnabled()
    await userEvent.click(button)
    const download = args.printKit?.downloadMutation as unknown as ReturnType<typeof fn>
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith({
        data: {
          portalId: 'portal-1',
          style: 'paper',
          paper: 'letter',
          size: 'large',
          output: 'office',
          piece: 'counter_card',
          languages: ['bg'],
          callToAction: 'rate',
          showPropertyName: true,
        },
      }),
    )
  },
}

export const DownloadsTheChosenStyleAndPaper: Story = {
  args: { ...baseArgs, countryCode: 'BG' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Immersive/ }))
    await userEvent.click(radio(canvas, /^Counter card/))
    await userEvent.click(radio(canvas, 'Letter'))
    await userEvent.click(
      canvas.getByRole('button', { name: /download print kit \(pdf\)/i }),
    )
    const download = args.printKit?.downloadMutation as unknown as ReturnType<typeof fn>
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith({
        data: {
          portalId: 'portal-1',
          style: 'immersive',
          paper: 'letter',
          size: 'large',
          output: 'print_shop',
          piece: 'counter_card',
          languages: ['en', 'bg'],
          callToAction: 'rate',
          showPropertyName: true,
        },
      }),
    )
  },
}

export const DownloadRefused: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () => view(),
      downloadMutation: downloadMutation(
        Object.assign(new Error('This code cannot be downloaded again.'), {
          status: 422,
        }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('button', {
        name: /download print kit \(pdf\)/i,
      }),
    ).toBeInTheDocument()
  },
}

// A code made without a keyring cannot be fetched again, so the PDF cannot hold it.
export const CodeThatCannotBeFetchedAgain: Story = {
  args: {
    ...baseArgs,
    issuedLink: null,
    tokenStatus: liveToken(false),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = await canvas.findByRole('button', {
      name: /download print kit \(pdf\)/i,
    })
    await expect(button).toBeDisabled()
    await expect(canvas.getByText(/replace the code to make one/i)).toBeVisible()
    // Without the live address the preview says it draws a sample.
    await expect(canvas.getByText(/the preview draws a sample code/i)).toBeVisible()
  },
}

export const OneLanguageOnly: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () =>
        view({ locales: ['de'], primaryLocale: 'de', titles: { de: 'Pool & Terrasse' } }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('combobox', { name: 'Languages on the print' }),
    ).toHaveTextContent('Deutsch')
    await expect(
      canvas.getByText('pool-terrace-counter-card-de-letter.pdf'),
    ).toBeVisible()
  },
}

/** A phone sees the sheet before the download, and the choices wrap to one column. */
export const PhoneShowsThePrintBeforeTheDownload: Story = {
  args: baseArgs,
  globals: { viewport: { value: 'mobileStaff', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sheet = await preview(canvasElement)
    const download = canvas.getByRole('button', { name: /download print kit \(pdf\)/i })
    // The preview comes first in the page, and there is only one of it.
    await expect(
      sheet.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await expect(canvas.getAllByRole('img', { name: /^Letter ·/i })).toHaveLength(1)
    // Nothing of the section runs past the phone's edge.
    const section = canvas.getByRole('region', { name: 'Print kit' })
    const edge = document.documentElement.clientWidth
    const past = [section, ...section.querySelectorAll('*')].filter(
      (element) => element.getBoundingClientRect().right > edge + 1,
    )
    await expect(past).toHaveLength(0)
  },
}

/** A failed read says so where the controls and the preview would be, and Try again reads once more. */
export const ReadFailsThenRecovers: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: (() => {
        let calls = 0
        return async () => {
          calls += 1
          if (calls === 1) throw new Error('Print kit unavailable')
          return view()
        }
      })(),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('The print kit couldn’t be loaded.'),
    ).toBeVisible()
    await expect(canvas.getByText('The preview couldn’t be loaded.')).toBeVisible()
    await userEvent.click(canvas.getAllByRole('button', { name: 'Try again' })[0]!)
    await expect(await preview(canvasElement)).toBeInTheDocument()
    await expect(canvas.queryByText('The print kit couldn’t be loaded.')).toBeNull()
  },
}

const NOT_LIVE_NOTICE =
  /publish this portal to make a print kit\. a print carries the code of the live page\./i
const REVIEW_HREF = '/properties/property-1/portals/portal-1/review?tab=share'

const printKitSection = (canvasElement: HTMLElement) =>
  within(canvasElement).findByRole('region', { name: 'Print kit' })

/** Nothing is live to print from: one notice in place of the section and the preview, and no read. */
export const NotLiveYetGetsOneNotice: Story = {
  args: {
    ...baseArgs,
    publicationState: 'draft',
    propertyId: 'property-1',
    printKit: { read: fn(async () => view()), downloadMutation: downloadMutation() },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const section = within(await printKitSection(canvasElement))
    await expect(section.getByText(NOT_LIVE_NOTICE)).toBeVisible()
    await expect(section.getByRole('link', { name: 'Review & publish' })).toHaveAttribute(
      'href',
      REVIEW_HREF,
    )
    // No dead end: nothing failed to load, nothing to try again, no download, no preview.
    await expect(canvas.queryByText(/couldn’t be loaded/i)).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Try again' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /download print kit/i })).toBeNull()
    await expect(canvas.queryByRole('img', { name: /print preview/i })).toBeNull()
    await expect(canvas.queryByRole('region', { name: 'Print preview' })).toBeNull()
    await expect(args.printKit?.read).not.toHaveBeenCalled()
  },
}

export const TurnedOffPortalAsksToPublishAgain: Story = {
  args: { ...NotLiveYetGetsOneNotice.args, publicationState: 'disabled' },
  play: async ({ canvasElement }) => {
    const section = within(await printKitSection(canvasElement))
    await expect(
      section.getByText(/publish this portal again to make a print kit/i),
    ).toBeVisible()
    await expect(section.getByRole('link', { name: 'Review & publish' })).toBeVisible()
  },
}

/** An archived portal is restored first (the workspace notice offers Restore), so there is no review to go to. */
export const ArchivedPortalAsksToRestore: Story = {
  args: { ...NotLiveYetGetsOneNotice.args, publicationState: 'archived' },
  play: async ({ canvasElement }) => {
    const section = within(await printKitSection(canvasElement))
    await expect(section.getByText(/restore this portal and publish it/i)).toBeVisible()
    await expect(section.queryByRole('link', { name: 'Review & publish' })).toBeNull()
  },
}

/** A page whose state is behind: the server's "nothing live" is the same notice, not a failure. */
export const ServerSaysNothingIsLive: Story = {
  args: {
    ...baseArgs,
    publicationState: 'published',
    propertyId: 'property-1',
    printKit: {
      read: async () => {
        throw new ServerFunctionError(
          'PortalError',
          'Publish this Portal before printing it: a print carries the live code.',
          'publication_snapshot_unavailable',
          409,
        )
      },
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The section is there while the read is out, so wait for the notice itself.
    await expect(await canvas.findByText(NOT_LIVE_NOTICE)).toBeVisible()
    await expect(canvas.queryByText(/couldn’t be loaded/i)).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Try again' })).toBeNull()
  },
}

export const ViewerGetsNoPrintKit: Story = {
  args: baseArgs,
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('heading', { name: 'Print kit' })).toBeNull()
    // The print kit is not silently gone: the viewer is told whom to ask.
    await expect(canvas.getByText(/for the QR code or print kit\./)).toBeInTheDocument()
  },
}
