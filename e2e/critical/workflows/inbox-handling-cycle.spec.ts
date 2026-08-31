// IBX-01-T9 — the full Inbox handling-cycle journeys.
//
// One Inbox Item, many numbered work episodes. These specs walk both sources
// through new → unassigned → claim → assigned → escalated → handled →
// corrected → reopened → withdrawn, and assert the two things the Handling
// Cycle model exists to guarantee:
//
//   * Closing is SOURCE-specific. A manager can never close Google work, and
//     private feedback closes only on an explicit chosen outcome.
//   * Nothing is edited in place. A reopen opens cycle N+1; a correction
//     appends a superseding outcome and leaves the original completion time and
//     timing result untouched.
//
// Provider truth (a reply observed live on Google, a reply deleted at Google)
// is supplied as a fixture rather than driven through the publication
// pipeline: `reply-lifecycle.spec.ts` already covers that pipeline end to end,
// and duplicating it here would test Review rather than the Inbox journey.
//
// The Handling History is asserted through `getInboxItemHistoryFn` — the exact
// server contract the manager history panel renders — so this journey stays
// valid whether the panel is present or still landing.

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import {
  e2eRunId,
  cleanupE2eData,
  cleanupE2ePrivateFeedback,
  seedReview,
  seedReviewInboxItemWithCycle,
  seedPrivateFeedbackInboxItem,
  seedStaffUserWithGrant,
  withdrawPrivateFeedbackInboxItem,
  closeInboxItemBySourceAuthority,
  reopenInboxItemBySourceAuthority,
  getInboxItemById,
  getInboxHandlingCycles,
  getInboxHandlingCycleHead,
  getInboxHandlingTransitions,
  getFeedbackHandlingOutcomes,
  callServerFn,
  callServerFnGet,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-hc-'
const seed = requireE2eSeedState()

type HistoryEntry = Readonly<{
  kind: string
  cycleNumber: number
  detail: Readonly<Record<string, unknown>>
}>

type HistoryResult = Readonly<{ entries: readonly HistoryEntry[]; truncated: boolean }>

const readHistory = (page: Parameters<typeof callServerFnGet>[0], inboxItemId: string) =>
  callServerFnGet<HistoryResult>(page, {
    file: 'src/contexts/inbox/server/inbox-item-queries.ts',
    exportName: 'getInboxItemHistoryFn',
    data: { inboxItemId },
  })

test.describe('Critical workflow: Inbox handling cycle journeys', () => {
  test.beforeEach(async () => {
    await cleanupE2ePrivateFeedback({
      organizationId: seed.organizationId,
      prefix: PREFIX,
    })
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('Google journey: unassigned → claim → assign → escalate → resolve → closed on Google → provider deletion reopens cycle 2', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      externalId: `${PREFIX}review-${e2eRunId}`,
      rating: 2,
      text: 'Google journey review body — the room was not ready on arrival.',
      reviewerName: 'Handling Cycle Reviewer',
    })
    const { inboxItemId } = await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId,
    })
    // role 'owner', not the fixture's default Staff: assignment authorizes the
    // ASSIGNEE as its own principal now, and Staff is not a beta-interactive
    // role, so the hand-off is refused before any grant is read.
    const colleague = await seedStaffUserWithGrant({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      email: `${PREFIX}colleague-${e2eRunId}@example.com`,
      name: 'E2E Handling Colleague',
      role: 'owner',
    })

    // NEW — the item arrives unassigned. Assignment is never implied by who
    // happened to look at it first.
    expect((await getInboxItemById(inboxItemId))?.assigned_to).toBeNull()

    await signIn(page)
    await page.goto(`/inbox?itemId=${inboxItemId}`)
    await expect(page.getByText('Handling Cycle Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })

    // CLAIM — the signed-in manager takes the work.
    const unassigned = await getInboxItemById(inboxItemId)
    await callServerFn(page, {
      file: 'src/contexts/inbox/server/inbox-item-actions.ts',
      exportName: 'assignInboxItemFn',
      data: {
        inboxItemId,
        assignedToUserId: seed.managerUserId,
        expectedCommandRevision: Number(unassigned?.command_revision),
      },
    })
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.assigned_to === seed.managerUserId ? item : null
      },
      { timeoutMs: 10_000, description: 'inbox item claimed' },
    )

    // ASSIGNED — handed to a colleague with access to the same Property.
    const claimed = await getInboxItemById(inboxItemId)
    await callServerFn(page, {
      file: 'src/contexts/inbox/server/inbox-item-actions.ts',
      exportName: 'assignInboxItemFn',
      data: {
        inboxItemId,
        assignedToUserId: colleague.userId,
        expectedCommandRevision: Number(claimed?.command_revision),
      },
    })
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.assigned_to === colleague.userId ? item : null
      },
      { timeoutMs: 10_000, description: 'inbox item reassigned' },
    )

    // ESCALATED — orthogonal to the cycle: the head stays open.
    await page.goto(`/inbox?itemId=${inboxItemId}`)
    await expect(page.getByText('Handling Cycle Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: 'Escalate', exact: true }).click()
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.is_escalated === true ? item : null
      },
      { timeoutMs: 10_000, description: 'inbox item escalated' },
    )
    expect((await getInboxHandlingCycleHead(inboxItemId))?.status).toBe('open')

    // RESOLVED — still one cycle, still open.
    await page.getByRole('button', { name: 'Resolve', exact: true }).click()
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.is_escalated === false ? item : null
      },
      { timeoutMs: 10_000, description: 'escalation resolved' },
    )
    expect(await getInboxHandlingCycles(inboxItemId)).toHaveLength(1)

    // CLOSED BY OBSERVED LIVE REPLY — source authority, not a manager action.
    await closeInboxItemBySourceAuthority({
      organizationId: seed.organizationId,
      inboxItemId,
      closeReason: 'external_reply_observed',
    })
    expect((await getInboxHandlingCycleHead(inboxItemId))?.status).toBe('closed')

    // PROVIDER REPLY DELETED — a NEW numbered cycle, never an edit of cycle 1.
    await reopenInboxItemBySourceAuthority({
      organizationId: seed.organizationId,
      inboxItemId,
      openedReason: 'provider_reply_deleted',
    })
    const cycles = await getInboxHandlingCycles(inboxItemId)
    expect(cycles).toHaveLength(2)
    expect(cycles[0]).toMatchObject({ cycle_number: 1, opened_reason: 'review_observed' })
    expect(cycles[1]).toMatchObject({
      cycle_number: 2,
      opened_reason: 'provider_reply_deleted',
      supersedes_cycle_number: 1,
    })
    expect(
      (await getInboxHandlingTransitions(inboxItemId)).map(
        (row) => row.transition_reason,
      ),
    ).toEqual(['review_observed', 'external_reply_observed', 'provider_reply_deleted'])

    // The item is workable again and reads as open in the product.
    await page.goto(`/inbox?itemId=${inboxItemId}`)
    await expect(page.getByText('Handling Cycle Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })

    // HISTORY — both cycles with their reasons, told as one ordered story.
    const history = await readHistory(page, inboxItemId)
    expect(history.truncated).toBe(false)
    const cycleStory = history.entries
      .filter(
        (entry) => entry.kind === 'cycle_opened' || entry.kind === 'cycle_transition',
      )
      .map((entry) => ({
        cycleNumber: entry.cycleNumber,
        reason: entry.detail.openedReason ?? entry.detail.transitionReason ?? null,
      }))
    expect(cycleStory).toEqual([
      { cycleNumber: 1, reason: 'review_observed' },
      { cycleNumber: 1, reason: 'review_observed' },
      { cycleNumber: 1, reason: 'external_reply_observed' },
      { cycleNumber: 2, reason: 'provider_reply_deleted' },
      { cycleNumber: 2, reason: 'provider_reply_deleted' },
    ])
    expect(
      history.entries.some(
        (entry) => entry.kind === 'escalation' && entry.detail.escalation === 'escalated',
      ),
    ).toBe(true)
    expect(history.entries.some((entry) => entry.kind === 'assignment')).toBe(true)
  })

  test('private-feedback journey: submitted → claimed → handled → corrected → reopened, and a withdrawn item claims no outcome', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const handled = await seedPrivateFeedbackInboxItem({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      slug: `${PREFIX}portal-a-${e2eRunId}`,
      body: 'Private feedback journey — the shower ran cold every morning.',
      rating: 2,
    })
    const withdrawn = await seedPrivateFeedbackInboxItem({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      slug: `${PREFIX}portal-b-${e2eRunId}`,
      body: 'Withdrawn private feedback journey body.',
      rating: 1,
    })
    await withdrawPrivateFeedbackInboxItem({
      organizationId: seed.organizationId,
      inboxItemId: withdrawn.inboxItemId,
      responseId: withdrawn.responseId,
    })

    await signIn(page)

    // CLAIM the live private-feedback item.
    await page.goto(`/inbox?itemId=${handled.inboxItemId}`)
    await expect(page.getByText('Feedback handling')).toBeVisible({ timeout: 15_000 })
    const unclaimed = await getInboxItemById(handled.inboxItemId)
    await callServerFn(page, {
      file: 'src/contexts/inbox/server/inbox-item-actions.ts',
      exportName: 'assignInboxItemFn',
      data: {
        inboxItemId: handled.inboxItemId,
        assignedToUserId: seed.managerUserId,
        expectedCommandRevision: Number(unclaimed?.command_revision),
      },
    })
    await waitFor(
      async () => {
        const item = await getInboxItemById(handled.inboxItemId)
        return item?.assigned_to === seed.managerUserId ? item : null
      },
      { timeoutMs: 10_000, description: 'private feedback claimed' },
    )

    // MARK AS HANDLED — one approved outcome closes the cycle.
    await page.reload()
    await expect(page.getByText('Feedback handling')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Mark as handled' }).click()
    const markDialog = page.getByRole('dialog')
    await expect(markDialog.getByText('Mark feedback as handled')).toBeVisible()
    await markDialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Follow-up completed' }).click()
    await markDialog
      .getByPlaceholder('Add context that will help other managers')
      .fill('Called the guest and arranged a boiler service.')
    await markDialog.getByRole('button', { name: 'Mark as handled' }).click()
    await waitFor(
      async () => {
        const outcomes = await getFeedbackHandlingOutcomes(handled.inboxItemId)
        return outcomes.length === 1 ? outcomes : null
      },
      { timeoutMs: 10_000, description: 'handling outcome recorded' },
    )
    const first = (await getFeedbackHandlingOutcomes(handled.inboxItemId))[0]
    expect(first).toMatchObject({ outcome: 'follow_up_completed', outcome_revision: 1 })
    expect((await getInboxHandlingCycleHead(handled.inboxItemId))?.status).toBe('closed')

    // CORRECT THE OUTCOME — a superseding fact. The completion time and the
    // timing result are the two things a correction must never rewrite.
    await page.goto(`/inbox?folder=closed&itemId=${handled.inboxItemId}`)
    await expect(page.getByText('Current outcome')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Correct outcome' }).click()
    const correctDialog = page.getByRole('dialog')
    await expect(correctDialog.getByText('Correct handling outcome')).toBeVisible()
    await correctDialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Handled with the team' }).click()
    await correctDialog.getByRole('button', { name: 'Save correction' }).click()
    await waitFor(
      async () => {
        const outcomes = await getFeedbackHandlingOutcomes(handled.inboxItemId)
        return outcomes.length === 2 ? outcomes : null
      },
      { timeoutMs: 10_000, description: 'handling outcome corrected' },
    )
    const [original, correction] = await getFeedbackHandlingOutcomes(handled.inboxItemId)
    expect(correction).toMatchObject({
      outcome: 'handled_with_team',
      outcome_revision: 2,
    })
    expect(correction.completion_at).toEqual(original.completion_at)
    expect(correction.deadline_result).toBe(original.deadline_result)
    // Both facts are shown; the original is never overwritten.
    await expect(page.getByText('Marked as handled', { exact: false })).toBeVisible()
    // The middle dot scopes this to the HISTORY entry. Without it the toast
    // ("Handling outcome corrected") also matches and the strict locator fails,
    // which would say nothing about whether the fact was recorded.
    await expect(page.getByText('Outcome corrected ·', { exact: false })).toBeVisible()

    // MANUAL REOPEN with reason 'other' plus a short explanation.
    await page.getByRole('combobox', { name: 'Work status' }).click()
    await page.getByRole('option', { name: 'Open', exact: true }).click()
    await expect(page.getByRole('dialog').getByText('Reopen work')).toBeVisible()
    await page.getByRole('combobox', { name: 'Reason for reopening' }).click()
    await page.getByRole('option', { name: 'Other', exact: true }).click()
    await page
      .getByLabel('Short explanation')
      .fill('Regional manager asked for a second call.')
    await page.getByRole('button', { name: 'Reopen', exact: true }).click()
    await waitFor(
      async () => {
        const head = await getInboxHandlingCycleHead(handled.inboxItemId)
        return head?.current_cycle_number === 2 ? head : null
      },
      { timeoutMs: 10_000, description: 'private feedback reopened as cycle 2' },
    )
    const feedbackCycles = await getInboxHandlingCycles(handled.inboxItemId)
    expect(feedbackCycles[1]).toMatchObject({
      cycle_number: 2,
      opened_reason: 'manual_reopen',
      manual_reopen_reason: 'other',
      manual_reopen_explanation: 'Regional manager asked for a second call.',
    })
    // The two outcomes belong to cycle 1 and are not carried into cycle 2.
    expect(
      (await getFeedbackHandlingOutcomes(handled.inboxItemId)).every(
        (row) => row.cycle_number === 1,
      ),
    ).toBe(true)

    // WITHDRAWN — a separate item that must claim no manager handling at all.
    await page.goto(`/inbox?folder=closed&itemId=${withdrawn.inboxItemId}`)
    await expect(
      page.getByText(
        'This feedback was withdrawn by the guest. No manager outcome was recorded.',
      ),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Mark as handled' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Correct outcome' })).toHaveCount(0)
    expect(await getFeedbackHandlingOutcomes(withdrawn.inboxItemId)).toEqual([])
    expect(
      (await getInboxHandlingTransitions(withdrawn.inboxItemId)).map(
        (row) => row.transition_reason,
      ),
    ).toEqual(['feedback_submitted', 'guest_withdrawn'])
  })

  test('a stale second tab is refused with a visible conflict and overwrites nothing', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000)
    const item = await seedPrivateFeedbackInboxItem({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      slug: `${PREFIX}portal-stale-${e2eRunId}`,
      body: 'Stale client journey — the breakfast queue was very long.',
      rating: 2,
    })

    await signIn(page)
    await page.goto(`/inbox?itemId=${item.inboxItemId}`)
    await expect(page.getByText('Feedback handling')).toBeVisible({ timeout: 15_000 })

    // The second tab loads the SAME revision, then the first tab moves on.
    const stale = await context.newPage()
    await stale.goto(`/inbox?itemId=${item.inboxItemId}`)
    await expect(stale.getByText('Feedback handling')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Mark as handled' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Follow-up completed' }).click()
    await dialog.getByRole('button', { name: 'Mark as handled' }).click()
    await waitFor(
      async () => {
        const outcomes = await getFeedbackHandlingOutcomes(item.inboxItemId)
        return outcomes.length === 1 ? outcomes : null
      },
      { timeoutMs: 10_000, description: 'first tab recorded the outcome' },
    )

    // The stale tab still believes the work is open and submits its own outcome.
    await stale.getByRole('button', { name: 'Mark as handled' }).click()
    const staleDialog = stale.getByRole('dialog')
    await staleDialog.getByRole('combobox').first().click()
    await stale.getByRole('option', { name: 'Content concern reviewed' }).click()
    await staleDialog.getByRole('button', { name: 'Mark as handled' }).click()

    // Visible refusal, not a silent overwrite.
    await expect(staleDialog.getByText('Unable to complete this action')).toBeVisible({
      timeout: 15_000,
    })
    const outcomes = await getFeedbackHandlingOutcomes(item.inboxItemId)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({
      outcome: 'follow_up_completed',
      outcome_revision: 1,
    })

    // Reloading the stale tab shows the CURRENT state, not its own attempt.
    await stale.reload()
    await stale.goto(`/inbox?folder=closed&itemId=${item.inboxItemId}`)
    await expect(stale.getByText('Follow-up completed').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(stale.getByText('Content concern reviewed')).toHaveCount(0)
    await stale.close()
  })

  test('no Bulk Close control is reachable anywhere in the bulk toolbar', async ({
    page,
  }) => {
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      externalId: `${PREFIX}bulk-${e2eRunId}`,
      rating: 3,
      text: 'Bulk toolbar review body.',
      reviewerName: 'Bulk Toolbar Reviewer',
    })
    await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId,
    })

    await signIn(page)
    await page.goto('/inbox')
    await expect(page.getByText('Bulk Toolbar Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })

    // Selecting work reveals the bulk toolbar. Bulk Reopen and Assign exist;
    // Bulk Close is deliberately absent until it has per-cycle compatibility
    // preview and settled closure outcomes.
    await page.getByRole('checkbox').first().check()
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
    for (const forbidden of ['Close', 'Close selected', 'Mark as closed', 'Bulk close']) {
      await expect(
        page.getByRole('button', { name: forbidden, exact: true }),
      ).toHaveCount(0)
    }
    await expect(page.getByRole('menuitem', { name: /close/i })).toHaveCount(0)
  })
})
