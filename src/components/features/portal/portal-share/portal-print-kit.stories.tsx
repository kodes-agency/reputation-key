// fallow-ignore-file code-duplication
// The Share tab's Print kit (round 4, slice 45; board 06): the pieces, the
// languages, the call to action and the download, with the print drawn beside
// them. The server makes the PDF; a story hands the download a small file.
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
import { PortalShare } from './portal-share'
import type { DownloadPrintKitInput } from './portal-print-kit-types'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

const QR_ADDRESS =
  'https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'
const issuedLink: IssuedPortalLink = {
  publicUrl: QR_ADDRESS,
  publicUrls: { qr: QR_ADDRESS, nfc: `${QR_ADDRESS}-nfc` },
  addressRecoverable: true,
}

const liveToken = (addressRecoverable: boolean): PortalTokenStatus => ({
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 3,
  issuedAt: '2026-03-12T09:30:00.000Z',
  graceExpiresAt: null,
  addressRecoverable,
})

/** A photograph's stand-in: a warm sky over a dark terrace, as a picture the browser can load. */
const PHOTO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8b27a"/><stop offset=".55" stop-color="#6d7f6a"/><stop offset="1" stop-color="#26332c"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><circle cx="1180" cy="260" r="130" fill="#fff1cf"/></svg>',
  )

const view = (overrides: Partial<PortalPrintKitView> = {}): PortalPrintKitView => ({
  portalId: 'portal-1',
  portalName: 'Pool & Terrace',
  primaryLocale: 'en',
  locales: ['en', 'bg'],
  titles: { en: 'Pool & Terrace', bg: 'Басейн и тераса' },
  look: {
    wordmark: 'Avela',
    accentColour: '#EAD6A8',
    fieldColour: '#15110D',
    heroUrl: null,
    heroFocal: null,
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
  fileName: 'pool-terrace-table-tent.pdf',
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

const preview = (canvasElement: HTMLElement) =>
  within(canvasElement).findByRole('img', { name: /print preview/i })

export const TableTent: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: 'Print kit' }),
    ).toBeInTheDocument()
    const front = await preview(canvasElement)
    await expect(front).toHaveAccessibleName(
      /table tent, front, English and Bulgarian, "Rate your visit"/i,
    )
    await expect(canvas.getByText(/table tent a6 · front · 105 × 148 mm/i)).toBeVisible()
    await expect(canvas.getByText(/3 mm bleed and crop marks/i)).toBeVisible()
    await expect(within(front).getByText('Оценете посещението си')).toBeInTheDocument()
    // The short address is on the print as words, without the scan marker.
    await expect(
      within(front).getByText(/app\.reputationkey\.app\/p\/pt_AbCd/),
    ).toBeInTheDocument()
    await expect(within(front).queryByText(/accessArtifact/i)).toBeNull()
  },
}

export const BackLeadsWithTheSecondLanguage: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'Back' }))
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /table tent, back, Bulgarian and English, "Оценете посещението си"/i,
    )
    await expect(canvas.getByText(/table tent a6 · back/i)).toBeVisible()
  },
}

export const CounterCardInOneLanguage: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /counter card/i }))
    await userEvent.click(canvas.getByRole('radio', { name: 'Български' }))
    await userEvent.click(
      canvas.getByRole('radio', { name: /how was your visit\? tell us privately/i }),
    )
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /counter card, front, Bulgarian, "Как мина посещението ви\?"/i,
    )
    // One language on a counter card is one side: nothing to switch.
    await expect(canvas.queryByRole('radio', { name: 'Back' })).toBeNull()
    await expect(canvas.getByText(/one A6 page per side/i)).toBeVisible()
  },
}

export const WithThePropertyPhoto: Story = {
  args: {
    ...baseArgs,
    printKit: {
      read: async () =>
        view({
          look: {
            wordmark: 'Avela',
            accentColour: '#EAD6A8',
            fieldColour: '#15110D',
            heroUrl: PHOTO,
            heroFocal: { x: 0.7, y: 0.3 },
            logoUrl: null,
          },
        }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    await expect(await preview(canvasElement)).toBeInTheDocument()
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
          look: {
            wordmark: 'Kempinski Hotel Grand Arena Bansko',
            accentColour: '#EAD6A8',
            fieldColour: '#15110D',
            heroUrl: PHOTO,
            heroFocal: { x: 0.7, y: 0.3 },
            logoUrl: null,
          },
        }),
      downloadMutation: downloadMutation(),
    },
  },
  play: async ({ canvasElement }) => {
    const front = await preview(canvasElement)
    for (const word of [/KEMPINSKI/u, /BANSKO/u, /SPA & WELLNESS/u, /RECEPTION DESK/u]) {
      await expect(within(front).getByText(word)).toBeInTheDocument()
    }
  },
}

export const DownloadsThePdf: Story = {
  args: baseArgs,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: 'Български' }))
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
          piece: 'table_tent',
          languages: ['bg'],
          callToAction: 'rate',
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
    await expect(await canvas.findByRole('radio', { name: 'Deutsch' })).toBeChecked()
    await expect(await preview(canvasElement)).toHaveAccessibleName(
      /table tent, front, German, "Bewerten Sie Ihren Besuch"/i,
    )
  },
}

export const ViewerGetsNoPrintKit: Story = {
  args: baseArgs,
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/view-only access/i)).toBeInTheDocument()
    await expect(canvas.queryByRole('heading', { name: 'Print kit' })).toBeNull()
  },
}
