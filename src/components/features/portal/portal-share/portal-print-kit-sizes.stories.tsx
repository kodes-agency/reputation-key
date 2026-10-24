// fallow-ignore-file code-duplication
// The Share tab's Print kit with its sizes, as the share board draws it (round-3
// spec-delta S7): Large, Table and Mini with the code shrinking with the size, the
// piece at each size, the output of an Immersive card and its per-sheet counts,
// the switch for the property's name under the logo and its hint, and the
// refusal of a size whose code would print too small. Managers are offered only
// the sizes in `PRINT_KIT_SELECTABLE_SIZES`, which is Large while Table, the tent
// and Mini wait for the short print address and a phone test; these stories offer
// all three through the section's `sizes`.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type {
  PortalPrintKitDownload,
  PortalPrintKitView,
  PortalTokenStatus,
} from '#/contexts/portal/application/public-api'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { PRINT_KIT_SIZES } from '#/shared/domain/portal-print-kit'
import { PortalShare } from './portal-share'
import type { DownloadPrintKitInput } from './portal-print-kit-types'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

/** What a code carries once print codes are minted: the print host and a 20-character print code. */
const SHORT_ADDRESS = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
/** What the beta prints today: its own host, the whole token and the marker. */
const LONG_ADDRESS =
  'https://web-closed-beta-v2.up.railway.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'

const linkOf = (address: string): IssuedPortalLink => ({
  publicUrl: address,
  publicUrls: { qr: address, nfc: address.toLowerCase() },
  addressRecoverable: true,
})

const liveToken: PortalTokenStatus = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 3,
  issuedAt: '2026-03-12T09:30:00.000Z',
  graceExpiresAt: null,
  addressRecoverable: true,
  madeBy: null,
}

/** A dark badge logo with a transparent edge: a ring with a letter, and the name. */
const LOGO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" viewBox="0 0 900 220"><circle cx="110" cy="116" r="92" fill="none" stroke="currentColor" stroke-width="5" color="#1A1A1A"/><text x="110" y="160" font-family="Georgia" font-size="120" text-anchor="middle" fill="#1A1A1A">O</text><text x="250" y="150" font-family="Georgia" font-size="110" letter-spacing="14" fill="#1A1A1A">OAKMERE</text></svg>',
  )

/** A photograph's stand-in: a terrace and a pool under a dusk sky. */
const PHOTO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a7a72"/><stop offset=".55" stop-color="#3b4a63"/><stop offset=".7" stop-color="#4a3a30"/><stop offset="1" stop-color="#2a201a"/></linearGradient></defs><rect width="1600" height="1067" fill="url(#s)"/><rect x="380" y="820" width="660" height="150" fill="#c9b99a"/><rect x="400" y="836" width="620" height="118" fill="#3aa4b4"/></svg>',
  )

/** The board's Oakmere: a logo, a photo and a long name, in English and Spanish. */
const view = (withLogo = true): PortalPrintKitView => ({
  portalId: 'portal-1',
  portalName: 'Oakmere Reception',
  primaryLocale: 'en',
  locales: ['en', 'es'],
  titles: { en: 'Reception', es: 'Recepción' },
  look: {
    wordmark: 'Oakmere',
    propertyName: 'Oakmere by Larkspur Hotel Houston Hobby Airport',
    accentColour: '#D4E3FE',
    fieldColour: '#001E57',
    heroUrl: PHOTO,
    heroFocal: { x: 0.5, y: 0.5 },
    logoUrl: withLogo ? LOGO : null,
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
  fileName: 'oakmere-reception-table-card-en-4up-letter.pdf',
  contentType: 'application/pdf',
  pdfBase64: btoa('%PDF-1.3\n%%EOF'),
}

const mutations = (address: string): PortalShareMutations => ({
  issueMutation: action(async () => linkOf(address)),
  rotateMutation: action(async () => linkOf(address)),
  revokeMutation: action(async () => ({ revoked: true })),
  revealMutation: action(async () => linkOf(address)),
})

const argsOf = (
  options: Readonly<{
    address?: string
    sizes?: readonly (typeof PRINT_KIT_SIZES)[number][]
    withLogo?: boolean
    countryCode?: string
  }> = {},
) => {
  const address = options.address ?? SHORT_ADDRESS
  return {
    portalId: 'portal-1',
    portalName: 'Oakmere Reception',
    issuedLink: linkOf(address),
    revoked: false,
    tokenStatus: liveToken,
    onLinkIssued: fn(),
    onAddressRevealed: fn(),
    onLinksRevoked: fn(),
    ...mutations(address),
    countryCode: options.countryCode ?? 'US',
    printKit: {
      read: async () => view(options.withLogo ?? true),
      downloadMutation: action<DownloadPrintKitInput, PortalPrintKitDownload>(
        async () => TINY_PDF,
      ),
      sizes: options.sizes ?? PRINT_KIT_SIZES,
    },
  }
}

const meta: Meta<typeof PortalShare> = {
  title: 'Portal/PortalShare/Print kit sizes',
  component: PortalShare,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof PortalShare>

type Canvas = ReturnType<typeof within>

const radio = (canvas: Canvas, name: string | RegExp) =>
  canvas.getByRole('radio', { name })

/** The whole-sheet or one-face picture: whichever the preview shows. */
const preview = (canvasElement: HTMLElement) =>
  within(canvasElement).findByRole('img', { name: /letter|a4 ·|print shop|3\.5|5 ×/i })

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

/** The board's own state: Table, a card, Paper on Letter, English and Spanish. */
export const TableIsTheDefaultOnceOffered: Story = {
  args: argsOf(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('radio', { name: /^Table ·/ })).toBeChecked()
    await expect(radio(canvas, /^Large ·/)).not.toBeChecked()
    await expect(radio(canvas, /^Mini ·/)).not.toBeChecked()
    // Each size says what it is and where it goes, and the note says the code shrinks with it.
    await expect(canvas.getByText('Reception and counters, in a holder')).toBeVisible()
    await expect(canvas.getByText('Tables, nightstands and bars')).toBeVisible()
    await expect(canvas.getByText('Key-card sleeves, check presenters')).toBeVisible()
    await expect(
      canvas.getByText(
        /^The code shrinks with the size: 1\.75\sin on Large, 1\.4\sin on Table, 1\.25\sin on Mini\.$/,
      ),
    ).toBeVisible()
    // The piece at this size: the card for a holder, the tent beside it (D8).
    await expect(radio(canvas, /^Card/)).toBeChecked()
    await expect(canvas.getByText(/^3\.5\s×\s5\sin, for a holder$/)).toBeVisible()
    await expect(
      canvas.getByText(/^Stands on its own, 5\s×\s3\.5\sin faces$/),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        /^Letter makes 3\.5\s×\s5\sin Table cards\. A4 makes 90\s×\s130\smm cards\.$/,
      ),
    ).toBeVisible()
    // Paper has one output, so no Output to choose, and the file says four to a sheet.
    await expect(canvas.queryByText('Output')).toBeNull()
    await expect(
      canvas.getByText('oakmere-reception-table-card-en-es-4up-letter.pdf'),
    ).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /^Letter · four 3\.5 × 5 in Table cards · page 1 of 2, fronts/i,
    )
    // The bar to check is Table's tile, and the steps cut 3 down and 3 across.
    await expect(
      step(
        canvas,
        /^Check the size: the coloured bar under each code measures 1\.4\sin \(3\.6\scm\)\.$/,
      ),
    ).toBeVisible()
    await expect(
      step(canvas, /^Cut on the grey ticks: 3 cuts down, 3 across\.$/),
    ).toBeVisible()
    await expect(canvas.getByText(/^How to print · Paper Table card$/)).toBeVisible()
  },
}

/** While Large is the only size offered, there is no Size to choose: a lone card is not a choice. */
export const LargeAloneIsNotAChoice: Story = {
  args: argsOf({ sizes: ['large'] }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('radio', { name: /^Counter card/ }),
    ).toBeChecked()
    await expect(canvas.queryByText('Size')).toBeNull()
    await expect(canvas.queryByRole('radio', { name: /^Table ·/ })).toBeNull()
    await expect(canvas.queryByRole('radio', { name: /^Mini ·/ })).toBeNull()
    await expect(
      canvas.getByText('oakmere-reception-counter-card-en-es-letter.pdf'),
    ).toBeVisible()
  },
}

/** The tent stands beside the card at Table: two to a sheet, one language a face. */
export const TheSmallTentIsBesideTheTableCard: Story = {
  args: argsOf(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Table tent/ }))
    await expect(
      canvas.getByText('oakmere-reception-table-tent-en-es-2up-letter.pdf'),
    ).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      'Letter · two table tents, 5 × 3.5 in faces, folded on the dashed line',
    )
    await expect(canvas.getByText(/^How to print · Paper table tent$/)).toBeVisible()
    await expect(
      step(
        canvas,
        /^Cut on the grey ticks, then score and fold on the dashed line\. Each tent stands about 3\.4\sin tall\.$/,
      ),
    ).toBeVisible()
    // The tent has a face for each language, so the Back switch is there.
    await expect(radio(canvas, 'Back')).toBeInTheDocument()
  },
}

/** A Mini card carries one language, and is a card only: no second language, no piece to choose. */
export const MiniIsOneLanguageAndOnlyACard: Story = {
  args: argsOf(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Mini ·/ }))
    await expect(canvas.queryByText('Piece')).toBeNull()
    await expect(
      canvas.getByRole('combobox', { name: 'Languages on the print' }),
    ).toHaveTextContent('English')
    await userEvent.click(
      canvas.getByRole('combobox', { name: 'Languages on the print' }),
    )
    const options = await within(document.body).findAllByRole('option')
    await expect(options.map((option) => option.textContent)).toEqual([
      'English',
      'Español',
    ])
    await userEvent.keyboard('{Escape}')
    await expect(
      canvas.getByText('oakmere-reception-mini-card-en-10up-letter.pdf'),
    ).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /^Letter · ten 2 × 3\.5 in Mini cards/i,
    )
    await expect(
      step(
        canvas,
        /^Check the size: the coloured bar under each code measures 1\.25\sin \(3\.2\scm\)\.$/,
      ),
    ).toBeVisible()
    await expect(
      step(canvas, /^Cut on the grey ticks: 3 cuts down, 6 across\.$/),
    ).toBeVisible()
  },
}

/** An Immersive card can go to a print shop or onto the manager's own printer, and the counts are on the labels. */
export const ImmersiveCardOutputsAreCounted: Story = {
  args: argsOf(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Immersive/ }))
    // Each style starts on its own output: Immersive to a print shop.
    await expect(
      radio(canvas, 'For a print shop · 1 card per page with bleed'),
    ).toBeChecked()
    await expect(
      canvas.getByText('oakmere-reception-table-card-en-es-immersive-letter.pdf'),
    ).toBeVisible()
    await expect(
      canvas.getByText(/^How to print · Immersive Table card · print shop$/),
    ).toBeVisible()
    await userEvent.click(radio(canvas, 'For my printer · 4 cards per sheet'))
    await expect(
      canvas.getByText('oakmere-reception-table-card-en-es-immersive-4up-letter.pdf'),
    ).toBeVisible()
    await expect(
      canvas.getByText(/^How to print · Immersive Table card · my printer$/),
    ).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      'Letter · four 3.5 × 5 in Table cards, one bleed around them',
    )
    await expect(
      step(
        canvas,
        /^Cut on the crop marks: 3 cuts down, 3 across\. The colour runs 1\/8\sin past the outer edge\.$/,
      ),
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: /download print kit \(pdf\)/i }),
    )
    const download = args.printKit?.downloadMutation as unknown as ReturnType<typeof fn>
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith({
        data: expect.objectContaining({
          style: 'immersive',
          size: 'table',
          output: 'office',
          piece: 'counter_card',
        }),
      }),
    )
  },
}

/** The share board's own state: Immersive, Table, a card for my printer, in English, with the property's name under the logo. */
export const TheShareBoardState: Story = {
  args: argsOf(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Immersive/ }))
    await userEvent.click(radio(canvas, 'For my printer · 4 cards per sheet'))
    await pickLanguages(canvas, 'English')
    await expect(radio(canvas, /^Table ·/)).toBeChecked()
    await expect(radio(canvas, /^Card/)).toBeChecked()
    await expect(
      canvas.getByText('oakmere-reception-table-card-en-immersive-4up-letter.pdf'),
    ).toBeVisible()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      'Letter · four 3.5 × 5 in Table cards, one bleed around them',
    )
    await expect(
      canvas.getByRole('checkbox', { name: 'Print the property name under the logo' }),
    ).toBeChecked()
    // One language: the print has no back, so no Front and Back to switch between.
    await expect(canvas.queryByRole('radio', { name: 'Back' })).toBeNull()
  },
}

/** An Immersive Large card has an office sheet of two, and an Immersive Mini or tent has one way to be printed. */
export const OutputsFollowTheSizeAndPiece: Story = {
  args: argsOf(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Immersive/ }))
    await userEvent.click(radio(canvas, /^Large ·/))
    await expect(radio(canvas, 'For my printer · 2 cards per sheet')).toBeInTheDocument()
    await userEvent.click(radio(canvas, /^Mini ·/))
    // A Mini has no office sheet, so there is no choice to show.
    await expect(canvas.queryByText('Output')).toBeNull()
    await expect(
      canvas.getByText('oakmere-reception-mini-card-en-immersive-letter.pdf'),
    ).toBeVisible()
    await userEvent.click(radio(canvas, /^Table ·/))
    await userEvent.click(radio(canvas, /^Table tent/))
    await expect(canvas.queryByText('Output')).toBeNull()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /^5 × 3\.5 in table tent for a print shop/,
    )
  },
}

/** The name under the logo is a switch, with the hint that says where it is printed (D12). */
export const TheNameUnderTheLogoHasASwitch: Story = {
  args: argsOf(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const name = await canvas.findByRole('checkbox', {
      name: 'Print the property name under the logo',
    })
    await expect(name).toBeChecked()
    await expect(name).toHaveAccessibleDescription(
      'Large and Table cards. The tent and Mini show the logo alone.',
    )
    await userEvent.click(name)
    await userEvent.click(
      canvas.getByRole('button', { name: /download print kit \(pdf\)/i }),
    )
    const download = args.printKit?.downloadMutation as unknown as ReturnType<typeof fn>
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith({
        data: expect.objectContaining({ showPropertyName: false }),
      }),
    )
  },
}

/** A property with no logo prints its wordmark, which is the name: there is nothing to switch. */
export const NoLogoNoNameSwitch: Story = {
  args: argsOf({ withLogo: false }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('radio', { name: /^Table ·/ })).toBeChecked()
    await expect(canvas.queryByRole('checkbox')).toBeNull()
  },
}

/** The A4 sizes are in millimetres, and the bar to check is Table's 36 mm. */
export const A4SizesAreInMillimetres: Story = {
  args: argsOf({ countryCode: 'BG' }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('radio', { name: 'A4' })).toBeChecked()
    await expect(
      canvas.getByText(
        /^The code shrinks with the size: 44\smm on Large, 36\smm on Table, 32\smm on Mini\.$/,
      ),
    ).toBeVisible()
    await expect(canvas.getByText(/^90\s×\s130\smm, for a holder$/)).toBeVisible()
    await expect(
      step(
        canvas,
        /^Check the size: the coloured bar under each code measures 36\smm \(3\.6\scm\)\.$/,
      ),
    ).toBeVisible()
    await expect(
      canvas.getByText('oakmere-reception-table-card-en-es-4up-a4.pdf'),
    ).toBeVisible()
  },
}

/** A code that still has the long address cannot be printed small: the section says so, in the server's words, and keeps the download off. */
export const ALongAddressRefusesTheSmallSizes: Story = {
  args: argsOf({ address: LONG_ADDRESS }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Table ·/ }))
    const refusals = await canvas.findAllByText('Replace the code to print this size.')
    await expect(refusals.length).toBeGreaterThan(0)
    await expect(
      canvas.getByRole('button', { name: /download print kit \(pdf\)/i }),
    ).toBeDisabled()
    // Large still prints: it falls back to today's 2 in tile.
    await userEvent.click(radio(canvas, /^Large ·/))
    await waitFor(() =>
      expect(
        canvas.getByRole('button', { name: /download print kit \(pdf\)/i }),
      ).toBeEnabled(),
    )
    await expect(
      step(
        canvas,
        /^Check the size: the coloured bar under each code measures 2\sin \(5\.1\scm\)\.$/,
      ),
    ).toBeVisible()
  },
}

/** The size cards stack on a phone, and nothing runs past its edge. */
export const PhoneStacksTheSizes: Story = {
  args: argsOf(),
  globals: { viewport: { value: 'mobileStaff', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /^Immersive/ }))
    const section = await canvas.findByRole('region', { name: 'Print kit' })
    const edge = document.documentElement.clientWidth
    const past = [section, ...section.querySelectorAll('*')].filter(
      (element) => element.getBoundingClientRect().right > edge + 1,
    )
    await expect(past).toHaveLength(0)
    await expect(radio(canvas, /^Table ·/)).toBeChecked()
    await pickLanguages(canvas, 'English')
    await expect(
      canvas.getByText('oakmere-reception-table-card-en-immersive-letter.pdf'),
    ).toBeVisible()
  },
}
