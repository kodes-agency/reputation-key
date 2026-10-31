import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import { ReplyCompose } from './reply-editor-compose'
import { draftReviewTextDigest } from './reply-draft-session'
import { ReplyDraftSessionProvider } from './reply-draft-session-context'
import { ReviewProse } from './review-prose'
import type { DraftStream } from './reply-draft-stream'
import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { Button } from '#/components/ui/button'
const fixtureItem = makeInboxItem({
  id: '750e8400-e29b-41d4-a716-446655440020',
  sourceType: 'review',
})
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

const ORIGINAL =
  'Check-in took forty minutes and nobody apologised. The room smelled of smoke and the bathroom floor was sticky. The pool area was lovely though.'
const FRAME = {
  prefix: 'Hello Anna,',
  suffix:
    'You can reach us at stay@seabreeze.example.\n\nWe would welcome the chance to do better.\n\nKind regards,\nSeabreeze Hotel Management',
}
const BODY =
  'The long check-in and condition of your room made for a poor arrival, and we are sorry. You should have been able to settle in promptly and comfortably.'
const generated = fn()
const save = fn(async () => undefined)
const submit = fn(async () => undefined)
type Stage = 'writing' | 'answering' | 'slow' | 'rewording' | 'refused' | 'done'
const detail: InboxItemDetailResult = {
  item: fixtureItem,
  reviewText: ORIGINAL,
  reviewTranslatedText: null,
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: null,
  googlePropertyReviewsUrl: null,
  reviewContentStatus: 'available',
  reviewRating: 2,
  feedbackComment: null,
  feedbackRatingValue: null,
  reply: null,
  analysis: null,
  feedbackHandling: null,
  responseTarget: null,
  propertyDefaultReplyLanguage: 'en-Latn',
  reviewReplyLanguage: 'en-Latn',
  replyDraftingAvailable: false,
}
function Harness({
  stage,
  reducedMotion = false,
  reviewLanguage = 'en-Latn',
}: {
  stage: Stage
  reducedMotion?: boolean
  reviewLanguage?: string
}) {
  const [collapsed, setCollapsed] = useState(false)
  const stream = useMemo<DraftStream>(
    () => async (request, signal, receive) => {
      generated(request)
      const localFrame =
        request.tone === 'friendly'
          ? {
              ...FRAME,
              suffix: FRAME.suffix.replace(
                'We would welcome the chance to do better.',
                'We hope your next visit feels easier.',
              ),
            }
          : FRAME
      receive({
        sequence: 1,
        step: 'reading',
        frame: localFrame,
        reviewTextDigest: await draftReviewTextDigest(ORIGINAL),
      })
      if (stage === 'refused') {
        receive({
          sequence: 2,
          step: 'refused',
          reason: 'provider_unavailable',
          retryAfterEpochMillis: null,
        })
        return
      }
      receive({ sequence: 2, step: 'answering', sentenceNumbers: [1, 2] })
      if (stage === 'done') {
        receive({
          sequence: 3,
          step: 'done',
          result: {
            status: 'ready',
            profileVersion: 'reply-draft-v4',
            localFrame,
            replyText: `${localFrame.prefix}\n\n${request.length === 'short' ? 'We appreciate you sharing this experience with us.' : BODY}\n\n${localFrame.suffix}`,
            provenanceToken: 'story-token',
            expiresAtEpochMillis: Date.now() + 60_000,
            concreteLanguageTag:
              request.targetLanguage.kind === 'review_language'
                ? reviewLanguage
                : 'en-Latn',
            baseReplyStateRevision: 0,
          },
        })
        return
      }
      if (stage === 'writing') receive({ sequence: 3, step: 'writing' })
      if (stage === 'rewording') receive({ sequence: 3, step: 'rewording', ordinal: 1 })
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
    },
    [stage, reviewLanguage],
  )
  return (
    <ReplyDraftSessionProvider item={fixtureItem} detail={detail} stream={stream}>
      <div
        data-density="compact"
        data-reduced-motion={reducedMotion}
        className="mx-auto flex max-w-2xl flex-col gap-4 p-4"
      >
        <div role="group" aria-label="Original review">
          <ReviewProse text={ORIGINAL} evidence={null} />
        </div>
        <div role="group" aria-label="Translation">
          <ReviewProse
            text="Translated review: the room was not clean."
            evidence={null}
          />
        </div>
        <Button type="button" variant="outline" onClick={() => setCollapsed(!collapsed)}>
          Toggle editor
        </Button>
        {!collapsed && (
          <ReplyCompose
            propertyId={fixtureItem.propertyId}
            initialText=""
            initialLanguageTag={null}
            initialAiGenerated={false}
            propertyDefaultReplyLanguage="en-Latn"
            reviewReplyLanguage={reviewLanguage}
            reviewLanguageReadiness="detectable"
            isSaving={false}
            onSaveDraft={save}
            onSubmit={submit}
            onListTemplates={async () => ({
              profile: null,
              groups: [],
              recommendedTemplateId: null,
            })}
            onLoadTemplate={async () => ({
              text: 'A template reply.',
              replyLanguageTag: 'en-Latn',
            })}
          />
        )}
      </div>
    </ReplyDraftSessionProvider>
  )
}
const meta = {
  title: 'Inbox/Reply drafting v2',
  component: Harness,
  decorators: [withRole('PropertyManager')],
  args: { stage: 'writing' },
} satisfies Meta<typeof Harness>
export default meta
type Story = StoryObj<typeof meta>
const start: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const c = within(canvasElement)
  await userEvent.click(c.getByRole('button', { name: 'Draft with AI' }))
  await c.findByRole('button', { name: 'Stop' })
  expect(c.getByText(FRAME.prefix)).toBeVisible()
  expect(c.getByRole('textbox', { name: 'Public reply' })).toBeEnabled()
  expect(c.getByRole('button', { name: 'Choose a reply template' })).toBeEnabled()
}
export const Writing: Story = { play: start }
export const AnsweringHighlight: Story = {
  args: { stage: 'answering' },
  play: async (context) => {
    await start(context)
    const c = within(context.canvasElement)
    expect(c.getByLabelText('Original review').querySelectorAll('mark')).toHaveLength(2)
    expect(c.getByLabelText('Translation').querySelectorAll('mark')).toHaveLength(0)
    await userEvent.type(c.getByRole('textbox', { name: 'Public reply' }), 'My own reply')
    expect(c.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(c.getByLabelText('Original review').querySelectorAll('mark')).toHaveLength(0)
    expect(
      c.queryByText('The review changed. Reload and try again.'),
    ).not.toBeInTheDocument()
  },
}
export const Slow: Story = {
  args: { stage: 'slow' },
  play: async (context) => {
    await start(context)
    const c = within(context.canvasElement)
    // The step is written twice on purpose: the card prints it, and a
    // screen-reader-only status announces it. This looks at the printed one.
    const card = within(c.getByRole('region', { name: 'Draft suggestion' }))
    await waitFor(
      () => expect(card.getByText(/Taking longer than usual/)).toBeVisible(),
      {
        timeout: 12_000,
      },
    )
    await userEvent.click(c.getByRole('button', { name: 'use a template' }))
    await within(document.body).findByRole('menu')
  },
}
export const Rewording: Story = {
  args: { stage: 'rewording' },
  play: async (context) => {
    await start(context)
    expect(
      within(context.canvasElement).getAllByText('Rewording one phrase…').length,
    ).toBeGreaterThan(0)
  },
}
export const Refused: Story = {
  args: { stage: 'refused' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Draft with AI' }))
    await c.findByText("AI couldn't write a personalized draft this time.")
    expect(c.getByRole('button', { name: 'Use a template instead' })).toBeEnabled()
  },
}
export const Stopped: Story = {
  play: async (context) => {
    await start(context)
    const c = within(context.canvasElement)
    expect(c.getByRole('button', { name: 'Drafting…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(c.getByRole('button', { name: 'Drafting…' })).toBeEnabled()
    await userEvent.click(c.getByRole('button', { name: 'Stop' }))
    expect(c.getByRole('button', { name: 'Draft with AI' })).toHaveFocus()
    expect(c.queryByRole('region', { name: 'Draft suggestion' })).not.toBeInTheDocument()
    expect(c.getByLabelText('Original review').querySelectorAll('mark')).toHaveLength(0)
  },
}
export const Done: Story = {
  args: { stage: 'done' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Draft with AI' }))
    await c.findByText('Personalized AI suggestion')
    expect(c.getByRole('button', { name: 'Use draft' })).toBeEnabled()
    await userEvent.click(c.getByRole('button', { name: 'Dismiss' }))
    expect(c.getByLabelText('Original review').querySelectorAll('mark')).toHaveLength(0)
  },
}
export const ReducedMotion: Story = {
  args: { reducedMotion: true },
  play: async (context) => {
    await start(context)
    expect(
      getComputedStyle(
        within(context.canvasElement).getByLabelText('Reply body is being written'),
      ).animationName,
    ).toBe('none')
  },
}

async function reopenHeldDraft(c: ReturnType<typeof within>) {
  const calls = generated.mock.calls.length
  await userEvent.click(c.getByRole('button', { name: 'Toggle editor' }))
  await userEvent.click(c.getByRole('button', { name: 'Toggle editor' }))
  await c.findByRole('button', { name: 'Use draft' })
  expect(c.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  expect(generated).toHaveBeenCalledTimes(calls)
}
export const MenuSettings: Story = {
  args: { stage: 'done', reviewLanguage: 'tr-Latn' },
  play: async ({ canvasElement }) => {
    generated.mockClear()
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /^AI tone and language:/ }))
    await userEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Friendly' }),
    )
    expect(generated).not.toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: /^AI tone and language:/ }))
    await userEvent.click(
      within(document.body).getByRole('menuitem', { name: /Turkish/ }),
    )
    expect(generated).not.toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: 'Draft with AI' }))
    await c.findByRole('button', { name: 'Use draft' })
    expect(generated).toHaveBeenCalledTimes(1)
    expect(generated).toHaveBeenLastCalledWith({
      reviewId: fixtureItem.sourceId,
      tone: 'friendly',
      targetLanguage: { kind: 'review_language' },
      trigger: 'draft',
      variation: 0,
      intent: 'explicit',
      idempotencyKey: expect.any(String),
    })
  },
}

export const RegenerationButtons: Story = {
  args: { stage: 'done' },
  play: async ({ canvasElement }) => {
    generated.mockClear()
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Draft with AI' }))
    await userEvent.click(await c.findByRole('button', { name: 'Use draft' }))
    await userEvent.click(c.getByRole('button', { name: 'Shorter' }))
    await c.findByRole('button', { name: 'Use draft' })
    expect(generated).toHaveBeenLastCalledWith({
      reviewId: fixtureItem.sourceId,
      tone: 'professional',
      targetLanguage: { kind: 'property_default' },
      trigger: 'shorter',
      length: 'short',
      maxWords: Math.max(8, Math.floor(BODY.split(/\s+/u).length * 0.6)),
      variation: 0,
      intent: 'explicit',
      idempotencyKey: expect.any(String),
    })
    await reopenHeldDraft(c)
    await userEvent.click(c.getByRole('button', { name: 'Use draft' }))
    expect(c.queryByRole('button', { name: 'Shorter' })).not.toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Tone' }))
    await userEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Friendly' }),
    )
    await c.findByRole('button', { name: 'Use draft' })
    expect(c.queryByRole('button', { name: 'Shorter' })).not.toBeInTheDocument()
    expect(generated).toHaveBeenLastCalledWith({
      reviewId: fixtureItem.sourceId,
      tone: 'friendly',
      targetLanguage: { kind: 'property_default' },
      trigger: 'tone',
      variation: 0,
      intent: 'explicit',
      idempotencyKey: expect.any(String),
    })
    await reopenHeldDraft(c)
    await userEvent.click(c.getByRole('button', { name: 'Use draft' }))
    await userEvent.click(c.getByRole('button', { name: 'Try again' }))
    await c.findByRole('button', { name: 'Use draft' })
    expect(generated).toHaveBeenLastCalledWith({
      reviewId: fixtureItem.sourceId,
      tone: 'friendly',
      targetLanguage: { kind: 'property_default' },
      trigger: 'try_again',
      variation: 1,
      intent: 'explicit',
      idempotencyKey: expect.any(String),
    })
    await reopenHeldDraft(c)
  },
}
