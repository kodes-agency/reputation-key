// fallow-ignore-file code-duplication
// The batch "Review & publish" on the Property look page (board 9's button):
// "Avela Resort" has five live portals and one draft. The reader answers per
// portal, and the publish action records what it is asked, so the plays prove
// who is offered a tick, what is sent, and what each outcome reads.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { previewReader } from '../portal-preview/__fixtures__/portal-preview-fixtures'
import {
  allPublished,
  AVELA_MEDIA,
  AVELA_PORTALS,
  AVELA_PROFILE,
  blockedReview,
  manyLivePortals,
  neverAnswered,
  nothingNewReview,
  publishingPortals,
  readyReview,
  reviewingPortals,
  savingHero,
  savingLocales,
  savingLogo,
  savingLook,
} from './property-look-page-fixtures'
import { PropertyLookPage } from './property-look-page'

const WAIT = { timeout: 5000 }

const meta = {
  title: 'Portal/PropertyLook/BatchPublish',
  component: PropertyLookPage,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  args: {
    propertyId: 'prop-1',
    propertyName: 'Avela Resort',
    profile: AVELA_PROFILE,
    canEdit: true,
    canPublish: true,
    rows: AVELA_PORTALS,
    getPortalPreview: previewReader(),
    getPortalReview: reviewingPortals({
      'p-olive': nothingNewReview('p-olive'),
      'p-spa': blockedReview('p-spa'),
    }),
    publishPortals: publishingPortals(),
    saveLook: savingLook(),
    saveLocales: savingLocales(),
    saveHero: savingHero(),
    saveLogo: savingLogo(),
    media: AVELA_MEDIA,
    photoDescriptions: {},
  },
} satisfies Meta<typeof PropertyLookPage>

export default meta
type Story = StoryObj<typeof meta>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

async function openReview(canvasElement: HTMLElement, count = 5) {
  await userEvent.click(
    within(canvasElement).getByRole('button', {
      name: `Review & publish ${count} portals`,
    }),
  )
  const dialog = await body(canvasElement).findByRole('dialog', {
    name: `Review & publish ${count} portals`,
  })
  // The reviews are read when it opens; the list replaces "Checking".
  await within(dialog).findByRole('list', { name: 'Live portals' }, WAIT)
  return dialog
}

/** The button is the board's: it counts the live portals the look reaches, not the draft. */
export const ButtonCountsTheLivePortals: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Review & publish 5 portals' }),
    ).toBeEnabled()
  },
}

/** Without the right to publish, or with nothing live, there is no button to refuse. */
export const NoButtonWithoutTheRightToPublish: Story = {
  args: { canPublish: false },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: /Review & publish/ }),
    ).toBeNull()
  },
}

export const NoButtonWithNoLivePortal: Story = {
  args: { rows: AVELA_PORTALS.filter((row) => row.publicationState === 'draft') },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: /Review & publish/ }),
    ).toBeNull()
  },
}

/** An edit still being saved is not reviewed: the button waits for the save to settle. */
export const WaitsForTheSaveToSettle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Wordmark'), 'X')
    await expect(
      canvas.getByRole('button', { name: 'Review & publish 5 portals' }),
    ).toBeDisabled()
    await waitFor(
      () =>
        expect(
          canvas.getByRole('button', { name: 'Review & publish 5 portals' }),
        ).toBeEnabled(),
      WAIT,
    )
  },
}

/** Each live portal says what it would do: ready ones are ticked, the others say why not. */
export const ReviewListsEachLivePortal: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openReview(canvasElement)
    const list = within(within(dialog).getByRole('list', { name: 'Live portals' }))
    await expect(
      within(dialog).getByText(
        '3 to publish · 1 with nothing new · 1 cannot be published',
      ),
    ).toBeVisible()
    await expect(list.getByRole('checkbox', { name: /Reception/ })).toBeChecked()
    await expect(list.getByRole('checkbox', { name: /Pool & Terrace/ })).toBeChecked()
    await expect(list.getAllByRole('checkbox')).toHaveLength(3)
    await expect(list.getByText('Nothing new to publish')).toBeVisible()
    await expect(
      list.getByText(
        'Cannot be published · No one is responsible for this portal; Български · 1 text missing',
      ),
    ).toBeVisible()
    await expect(
      list.getByRole('link', { name: /Open Spa & thermal pools/ }),
    ).toHaveAttribute('href', '/properties/prop-1/portals/p-spa/review')
    await expect(
      within(dialog).getByRole('button', { name: 'Publish 3 portals' }),
    ).toBeEnabled()
    // A draft is not live, so it is not on the list.
    await expect(list.queryByText('Pool bar')).toBeNull()
  },
}

/** What is ticked is what is sent: a portal left out is not published, and nothing else is. */
export const PublishesTheTickedPortals: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openReview(canvasElement)
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /Pool & Terrace/ }),
    )
    await expect(within(dialog).getByText(/Left out/)).toBeVisible()
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Publish 2 portals' }),
    )
    await expect(await within(dialog).findByRole('status', {}, WAIT)).toHaveTextContent(
      '2 published',
    )
    await expect(args.publishPortals).toHaveBeenCalledTimes(1)
    await expect(args.publishPortals).toHaveBeenCalledWith({
      data: { portalIds: ['p-reception', 'p-rooms'] },
    })
    const outcomes = within(within(dialog).getByRole('list', { name: /What happened/ }))
    await expect(outcomes.getAllByText('Published as version 4')).toHaveLength(2)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(body(canvasElement).queryByRole('dialog')).toBeNull())
  },
}

/** One portal that cannot be published does not hold the others back, and can be tried again. */
const POOL_FAILS_AT_FIRST = publishingPortals((ids) =>
  ids.length === 1
    ? allPublished(ids)
    : allPublished(ids).map((outcome) =>
        outcome.portalId === 'p-pool'
          ? {
              portalId: 'p-pool',
              outcome: 'failed' as const,
              code: 'publication_not_ready' as never,
              message: 'No verified Google review address',
            }
          : outcome,
      ),
)

export const AFailedPortalDoesNotStopTheRest: Story = {
  args: { publishPortals: POOL_FAILS_AT_FIRST },
  play: async ({ canvasElement, args }) => {
    const dialog = await openReview(canvasElement)
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Publish 3 portals' }),
    )
    await expect(await within(dialog).findByRole('status', {}, WAIT)).toHaveTextContent(
      '2 published · 1 not published',
    )
    await expect(
      within(dialog).getByText('Not published · No verified Google review address'),
    ).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try it again' }))
    await waitFor(() => expect(args.publishPortals).toHaveBeenCalledTimes(2), WAIT)
    // Only the portal that failed is sent again.
    await expect(args.publishPortals).toHaveBeenLastCalledWith({
      data: { portalIds: ['p-pool'] },
    })
    // Its new answer replaces the old one: three published, the retried portal listed once.
    await waitFor(
      () => expect(within(dialog).getByRole('status')).toHaveTextContent('3 published'),
      WAIT,
    )
    const outcomes = within(within(dialog).getByRole('list', { name: /What happened/ }))
    await expect(outcomes.getAllByRole('listitem')).toHaveLength(3)
    await expect(outcomes.getAllByText('Published as version 4')).toHaveLength(3)
    await expect(outcomes.queryByText(/Not published/)).toBeNull()
    await expect(within(dialog).queryByRole('button', { name: /again/ })).toBeNull()
  },
}

/** While a retry runs, what the first run showed stays, with the retried portal marked in progress. */
export const ARetryKeepsTheOutcomesOnScreen: Story = {
  args: {
    publishPortals: publishingPortals((ids) =>
      ids.length === 1
        ? neverAnswered(ids)
        : allPublished(ids).map((outcome) =>
            outcome.portalId === 'p-pool'
              ? {
                  portalId: 'p-pool',
                  outcome: 'failed' as const,
                  code: 'publication_not_ready' as never,
                  message: 'Wait a moment',
                }
              : outcome,
          ),
    ),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openReview(canvasElement)
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Publish 3 portals' }),
    )
    await within(dialog).findByRole('button', { name: 'Try it again' }, WAIT)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try it again' }))
    const outcomes = within(
      await within(dialog).findByRole('list', { name: /What happened/ }, WAIT),
    )
    await expect(await outcomes.findByText('Trying again…')).toBeVisible()
    // The two that went live are still listed; the review list does not come back.
    await expect(outcomes.getAllByText('Published as version 4')).toHaveLength(2)
    await expect(within(dialog).queryByRole('list', { name: 'Live portals' })).toBeNull()
    await expect(within(dialog).getByRole('button', { name: 'Done' })).toBeDisabled()
  },
}

/** The ticks are what was sent: while a request is in flight they cannot be changed. */
export const TheTicksLockWhilePublishing: Story = {
  args: { publishPortals: publishingPortals(neverAnswered) },
  play: async ({ canvasElement }) => {
    const dialog = await openReview(canvasElement)
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Publish 3 portals' }),
    )
    await expect(
      await within(dialog).findByRole('button', { name: 'Publishing…' }),
    ).toBeDisabled()
    for (const tick of within(dialog).getAllByRole('checkbox')) {
      await expect(tick).toBeDisabled()
    }
  },
}

/**
 * A request refused as a whole says so in the server's words. It does not say
 * the portals in it were left alone: the server publishes them one by one.
 */
export const ARefusedRequestSaysWhy: Story = {
  args: {
    publishPortals: publishingPortals(
      new ServerFunctionError(
        'PortalError',
        'Portals are switched off here',
        'forbidden',
        403,
      ),
    ),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openReview(canvasElement)
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Publish 3 portals' }),
    )
    const alert = await within(dialog).findByRole('alert', {}, WAIT)
    await expect(alert).toHaveTextContent(
      'Publishing stopped: Portals are switched off here.',
    )
    await expect(alert).toHaveTextContent('trying again is safe')
    await expect(alert).not.toHaveTextContent(/not touched/i)
    await expect(
      within(dialog).getByRole('button', { name: 'Try them again' }),
    ).toBeVisible()
  },
}

/** A fault that says nothing about which portals went live (a 500, a dropped answer) claims none was untouched. */
export const AServerFaultDoesNotClaimNothingWasPublished: Story = {
  args: {
    publishPortals: publishingPortals(
      new ServerFunctionError('InternalError', 'boom', 'internal_error', 500),
    ),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openReview(canvasElement)
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Publish 3 portals' }),
    )
    const alert = await within(dialog).findByRole('alert', {}, WAIT)
    await expect(alert).toHaveTextContent(
      'Publishing stopped: Something went wrong. Try again.',
    )
    await expect(alert).not.toHaveTextContent(/not touched/i)
    const outcomes = within(within(dialog).getByRole('list', { name: /What happened/ }))
    await expect(
      outcomes.getAllByText(
        'Not confirmed · may have been published; trying again is safe',
      ),
    ).toHaveLength(3)
    await expect(outcomes.queryByText(/Not tried/)).toBeNull()
  },
}

/** A long list scrolls inside the dialog, so "Publish" stays on a phone screen (measured in the metrics). */
export const FiftyLivePortals: Story = {
  args: { rows: manyLivePortals(50) },
  play: async ({ canvasElement }) => {
    const dialog = await openReview(canvasElement, 50)
    await expect(within(dialog).getAllByRole('checkbox')).toHaveLength(50)
    await expect(
      within(dialog).getByRole('button', { name: 'Publish 50 portals' }),
    ).toBeEnabled()
  },
}

/** A review that cannot be read leaves that portal out and the others ready. */
export const AnUnreadablePortalIsLeftOut: Story = {
  args: {
    getPortalReview: reviewingPortals({
      'p-pool': new Error('offline'),
      'p-olive': nothingNewReview('p-olive'),
    }),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openReview(canvasElement)
    await expect(within(dialog).getByText('Could not be checked')).toBeVisible()
    await expect(
      within(dialog).getByRole('button', { name: 'Publish 3 portals' }),
    ).toBeEnabled()
  },
}

/** When nothing is waiting anywhere, the primary action says so and cannot be pressed. */
export const NothingToPublish: Story = {
  args: {
    getPortalReview: reviewingPortals(
      Object.fromEntries(
        AVELA_PORTALS.map((row) => [row.portalId, nothingNewReview(row.portalId)]),
      ),
    ),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openReview(canvasElement)
    await expect(
      within(dialog).getByRole('button', { name: 'Nothing to publish' }),
    ).toBeDisabled()
    await expect(within(dialog).getByText('5 with nothing new')).toBeVisible()
  },
}

/** A portal the viewer cannot publish is told so, not offered a tick. */
export const ANotAllowedPortalHasNoTick: Story = {
  args: {
    getPortalReview: reviewingPortals({
      'p-pool': { ...readyReview('p-pool'), canPublish: false },
      'p-olive': nothingNewReview('p-olive'),
      'p-spa': nothingNewReview('p-spa'),
    }),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openReview(canvasElement)
    await expect(within(dialog).getByText('You cannot publish this portal')).toBeVisible()
    await expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2)
  },
}
