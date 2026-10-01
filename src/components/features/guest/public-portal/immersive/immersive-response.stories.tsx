// Boards G03 (rating chosen), G04 and G05 (after a low and a high rating), G06
// (writing the note), G07 (note sent), G08 (Google unavailable) and G11
// (Bulgarian, no rating chosen) of the round-4 guest design, built on the real
// shell with the real response view. Axe runs on every story
// (`a11y.test = 'error'` in .storybook/preview.tsx). The play functions add what
// axe cannot see: the keyboard, focus, the 54 px targets and what the cards do.
import type { Decorator, Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import type { GuestPagePreviewState } from '../guest-page-preview-state'
import { bgV2 } from '../language-packs/bg-v2'
import { enV2 } from '../language-packs/en-v2'
import { ResponsePageStandIn } from './__fixtures__/response-page-stand-in'
import { STORY_HERO_PHOTO } from './__fixtures__/story-hero-photo'
import { immersiveResponseProps } from './immersive-response-preview'
import {
  ImmersiveResponseView,
  type ImmersiveResponseViewProps,
} from './immersive-response-view'
import { ImmersiveShell } from './immersive-shell'

const PHONE_WIDTH = 390
const PHONE_HEIGHT = 844
const CHAMPAGNE = { accentColour: '#EAD6A8', fieldColour: '#15110D' } as const
const DISPLAY_NAME = 'Avela Resort'

const PhoneFrame: Decorator = (Story) => (
  <div
    data-testid="phone-frame"
    style={{
      width: PHONE_WIDTH,
      height: PHONE_HEIGHT,
      margin: '0 auto',
      overflowY: 'auto',
    }}
  >
    <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} />
    <Story />
  </div>
)

type StoryArgs = Readonly<{
  state: GuestPagePreviewState
  locale?: 'en' | 'bg'
  overrides?: Partial<ImmersiveResponseViewProps>
  /**
   * The page moves on by itself, as the container will make it: an accepted
   * rating becomes a rated page and an accepted note a sent one. Without it the
   * page stays in `state`.
   */
  live?: boolean
}>

/** What the container does with an accepted call, for the stories that watch focus. */
function useLiveHandlers(
  start: GuestPagePreviewState,
  live: boolean,
  overrides: Partial<ImmersiveResponseViewProps> | undefined,
): readonly [GuestPagePreviewState, Partial<ImmersiveResponseViewProps> | undefined] {
  const [state, setState] = useState(start)
  if (!live) return [start, overrides]
  return [
    state,
    {
      ...overrides,
      onSubmitRating: async (value) => {
        await overrides?.onSubmitRating?.(value)
        setState({ kind: 'rated', rating: value.rating })
      },
      onSubmitNote: async (value) => {
        const accepted = (await overrides?.onSubmitNote?.(value)) ?? true
        if (accepted)
          setState({ kind: 'done', rating: state.kind === 'arrival' ? 1 : state.rating })
        return accepted
      },
    },
  ]
}

function ResponsePage({
  state: start,
  locale = 'en',
  overrides: given,
  live = false,
}: StoryArgs) {
  const pack = locale === 'bg' ? bgV2 : enV2
  const [state, overrides] = useLiveHandlers(start, live, given)
  return (
    <ImmersiveShell
      brand={{ ...CHAMPAGNE, hero: STORY_HERO_PHOTO }}
      heroAlt={{ value: 'The colonnade pool at dusk, under an old olive tree' }}
      lang={locale}
      height="container"
    >
      <ResponsePageStandIn
        kicker={locale === 'bg' ? 'Басейн и тераса' : 'Pool & Terrace'}
        language={locale === 'bg' ? 'Български' : 'English'}
        linktreeTitle={locale === 'bg' ? 'Около курорта' : 'Around the resort'}
        privacy={pack.copy.privacyNoticeLink}
        madeWith={pack.copy.footerMadeWith}
      >
        <ImmersiveResponseView
          {...immersiveResponseProps(state, { pack, displayName: DISPLAY_NAME })}
          {...overrides}
        />
      </ResponsePageStandIn>
    </ImmersiveShell>
  )
}

const meta: Meta<typeof ResponsePage> = {
  title: 'Features/Guest/ImmersiveResponse',
  component: ResponsePage,
  decorators: [PhoneFrame],
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof ResponsePage>

/** The Google card's top edge, in the page: after every rating it is the same place. */
const googleCard = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('heading', { name: enV2.copy.googleTitle })

const starTargets = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll<HTMLElement>('.ih-star')].map((star) =>
    star.getBoundingClientRect(),
  )

/** Board G03. A star picked with the mouse fills up to it and names the word. */
export const G03RatingChosen: Story = {
  args: { state: { kind: 'arrival' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText(enV2.copy.ratingThanks)).toBeNull()
    for (const target of starTargets(canvasElement)) {
      expect(target.width).toBe(54)
      expect(target.height).toBe(54)
    }
    await userEvent.click(canvas.getByRole('radio', { name: '4 stars, Very good' }))
    expect(canvas.getByRole('radio', { name: '4 stars, Very good' })).toBeChecked()
    expect(
      canvasElement.querySelectorAll('.ih-star__glyph[data-filled="true"]'),
    ).toHaveLength(4)
    expect(canvasElement.querySelector('.ih-scale__word')?.textContent).toBe('Very good')
    expect(canvas.getByRole('button', { name: 'Send privately' })).toBeEnabled()
    expect(canvas.queryByRole('alert')).toBeNull()
  },
}

/** The arrow keys move the choice, as in any radio group, and a star keeps a focus ring. */
export const KeyboardChoosesAStar: Story = {
  args: { state: { kind: 'arrival' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('radio', { name: '1 star, Poor' }).focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(canvas.getByRole('radio', { name: '3 stars, Good' })).toBeChecked()
    expect(canvas.getByRole('radio', { name: '3 stars, Good' })).toHaveFocus()
    expect(canvasElement.querySelector('.ih-scale__word')?.textContent).toBe('Good')
  },
}

/** Sending with no star: the card asks for one, and nothing is sent. */
export const AsksForARating: Story = {
  args: { state: { kind: 'arrival' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Send privately' }))
    expect(await canvas.findByRole('alert')).toHaveTextContent(enV2.copy.ratingChoose)
    await userEvent.click(canvas.getByRole('radio', { name: '5 stars, Excellent' }))
    expect(canvas.queryByRole('alert')).toBeNull()
  },
}

/** A choice sends the rating and the empty honeypot, once. */
export const SendsTheChosenRating: Story = {
  args: {
    state: { kind: 'arrival' },
    live: true,
    overrides: { onSubmitRating: fn(async () => undefined) },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: '2 stars, Fair' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Send privately' }))
    expect(args.overrides?.onSubmitRating).toHaveBeenCalledTimes(1)
    expect(args.overrides?.onSubmitRating).toHaveBeenCalledWith({
      rating: 2,
      honeypot: '',
    })
    // The card the guest pressed Send in is gone; focus goes to the receipt.
    const thanks = await canvas.findByRole('heading', { name: 'Thank you.' })
    expect(thanks).toHaveFocus()
  },
}

/** The save failed: the banner is in the card, the choice stays. */
export const RatingSaveFailed: Story = {
  args: { state: { kind: 'arrival' }, overrides: { failure: 'rating' } },
  play: async ({ canvasElement }) => {
    expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      enV2.copy.ratingSaveFailed,
    )
  },
}

/** Board G04. A low rating: the receipt, then Google, then the optional note. */
export const G04AfterLow: Story = {
  args: { state: { kind: 'rated', rating: 2 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Thank you.' })).toBeVisible()
    expect(canvas.getByRole('img', { name: '2 stars' })).toBeVisible()
    expect(canvas.getByText('Fair · sent privately')).toBeVisible()
    expect(canvas.getByRole('button', { name: /Continue to Google/ })).toBeEnabled()
    expect(
      canvas.getByRole('button', { name: enV2.copy.responseChangeTitle }),
    ).toBeVisible()
    // The hint is read with the button.
    expect(
      canvas.getByRole('button', { name: /Continue to Google/ }),
    ).toHaveAccessibleDescription(enV2.copy.googleHint)
    const note = canvas.getByRole('heading', { name: enV2.copy.noteOfferTitle })
    expect(googleCard(canvasElement).compareDocumentPosition(note)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(canvas.queryByRole('textbox')).toBeNull()
  },
}

/** Board G05. A high rating: the same Google card, in the same place, and no note. */
export const G05AfterHigh: Story = {
  args: { state: { kind: 'rated', rating: 5 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Excellent · sent privately')).toBeVisible()
    expect(canvas.getByRole('button', { name: /Continue to Google/ })).toBeEnabled()
    expect(canvas.queryByText(enV2.copy.noteOfferTitle)).toBeNull()
    // The card follows the receipt directly, as it does after a low rating.
    const card = googleCard(canvasElement).closest('section')
    expect(card?.previousElementSibling?.className).toBe('ih-receipt')
  },
}

/** Opening the note moves focus into it; "Not now" gives focus back to the button. */
export const NoteOpensAndCloses: Story = {
  args: { state: { kind: 'rated', rating: 3 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: enV2.copy.noteOfferAction }))
    const field = canvas.getByRole('textbox', { name: enV2.copy.noteLabel })
    expect(field).toHaveFocus()
    await userEvent.type(field, 'The towels ran out')
    await userEvent.click(canvas.getByRole('button', { name: enV2.copy.noteDismiss }))
    expect(canvas.getByRole('button', { name: enV2.copy.noteOfferAction })).toHaveFocus()
    expect(canvas.queryByRole('textbox')).toBeNull()
  },
}

/** Sending an empty note asks for words; a written note goes out once. */
export const NoteIsSent: Story = {
  args: {
    state: { kind: 'note-writing', rating: 2 },
    live: true,
    overrides: { onSubmitNote: fn(async () => true) },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: enV2.copy.noteSend }))
    expect(await canvas.findByRole('alert')).toHaveTextContent(enV2.copy.noteRequired)
    // The banner is tied to the field, so the field says why it is invalid.
    const field = canvas.getByRole('textbox', { name: enV2.copy.noteLabel })
    expect(field).toHaveAccessibleDescription(
      `${enV2.copy.noteHint} ${enV2.copy.noteRequired}`,
    )
    expect(args.overrides?.onSubmitNote).not.toHaveBeenCalled()
    await userEvent.type(
      canvas.getByRole('textbox', { name: enV2.copy.noteLabel }),
      '  Worth a look at the afternoon rounds.  ',
    )
    await userEvent.click(canvas.getByRole('button', { name: enV2.copy.noteSend }))
    expect(args.overrides?.onSubmitNote).toHaveBeenCalledTimes(1)
    expect(args.overrides?.onSubmitNote).toHaveBeenCalledWith({
      text: 'Worth a look at the afternoon rounds.',
      honeypot: '',
    })
    // The form is gone; focus goes to the confirmation, which is read out.
    const sent = await canvas.findByText('Your note was sent privately to Avela Resort.')
    expect(sent).toHaveFocus()
    expect(canvas.queryByRole('textbox')).toBeNull()
  },
}

/** Board G06. The note is open with the guest's words in it; Google stays above it. */
export const G06NoteWriting: Story = {
  args: {
    state: {
      kind: 'note-writing',
      rating: 2,
      draft:
        'The pool was lovely, but the towels ran out by four and nobody came to restock them.',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox', { name: enV2.copy.noteLabel })).toHaveValue(
      'The pool was lovely, but the towels ran out by four and nobody came to restock them.',
    )
    expect(canvas.getByText(enV2.copy.noteHint)).toBeVisible()
    expect(canvas.getByRole('button', { name: enV2.copy.noteSend })).toBeEnabled()
    expect(canvas.getByRole('button', { name: enV2.copy.noteDismiss })).toBeEnabled()
  },
}

/** Board G07 (the part this slice builds). The sent note replaces the form. */
export const G07NoteSent: Story = {
  args: { state: { kind: 'done', rating: 2 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('status')).toHaveTextContent(
      'Your note was sent privately to Avela Resort.',
    )
    expect(canvas.queryByRole('textbox')).toBeNull()
    expect(canvas.getByRole('button', { name: /Continue to Google/ })).toBeEnabled()
  },
}

/** Board G08. Google cannot be offered: a gentle status in the Google card's place. */
export const G08GoogleUnavailable: Story = {
  args: { state: { kind: 'googleUnavailable', rating: 3 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { name: enV2.copy.googleUnavailableTitle })
    expect(title.closest('section')?.getAttribute('role')).toBe('status')
    expect(canvas.queryByRole('button', { name: /Continue to Google/ })).toBeNull()
    expect(
      canvas.getByText('Your rating reached Avela Resort privately. Thank you.'),
    ).toBeVisible()
    // The private note still works.
    expect(canvas.getByRole('button', { name: enV2.copy.noteOfferAction })).toBeEnabled()
  },
}

/** Board G11. Bulgarian, no rating chosen: the error is in the guest's language. */
export const G11BulgarianError: Story = {
  args: { state: { kind: 'arrival' }, locale: 'bg' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: bgV2.copy.ratingSend }))
    expect(await canvas.findByRole('alert')).toHaveTextContent(bgV2.copy.ratingChoose)
    expect(canvas.getByRole('radio', { name: '1 звезда, Слабо' })).toBeVisible()
  },
}

/** Bulgarian after a rating: Cyrillic in the receipt, the cards and the buttons. */
export const BulgarianAfterLow: Story = {
  args: { state: { kind: 'rated', rating: 2 }, locale: 'bg' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('img', { name: '2 звезди' })).toBeVisible()
    expect(canvas.getByRole('heading', { name: bgV2.copy.googleTitle })).toBeVisible()
  },
}

/** A call is on its way: the choices wait and say so. */
export const Sending: Story = {
  args: { state: { kind: 'arrival' }, overrides: { pending: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: enV2.copy.sending })).toBeDisabled()
    expect(canvas.getByRole('radio', { name: '3 stars, Good' })).toBeDisabled()
  },
}
