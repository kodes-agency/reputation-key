// BQC-6.5 item 5 / IBX-01-T9 — inbox triage: status, assignment, note,
// escalation/resolve with persistence.
//
// This spec was stale against the shipped Handling Cycle contract in three
// ways, and every one of them was a product fact rather than a selector drift:
//
//   1. There is no `Close` button. Closing is source-specific — a Google review
//      closes when its current reply is observed on Google, private feedback
//      closes on an explicit manager outcome — so `updateInboxStatus` REFUSES
//      `closed`. The spec now proves the refusal and closes through source
//      authority instead.
//   2. Reopening requires a neutral reason. It runs through
//      `InboxReopenDialog`, not a bare `Reopen` button.
//   3. Every human command is optimistically fenced, so `assignInboxItemFn`
//      needs the item's current `expectedCommandRevision`.
//
// It also seeds the Handling Cycle head. Serving reads resolve status from the
// head, so an `inbox_items` row without one is invisible to the product.

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { dismissToasts } from '../../helpers/interaction'
import { requireE2eSeedState } from '../../helpers/seed-state'
import {
  e2eRunId,
  cleanupE2eData,
  seedReview,
  seedReviewInboxItemWithCycle,
  seedStaffUserWithGrant,
  closeInboxItemBySourceAuthority,
  getInboxItemById,
  getInboxHandlingCycles,
  getInboxHandlingCycleHead,
  getInboxNotes,
  callServerFn,
  callServerFnExpectError,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-tri-'
const seed = requireE2eSeedState()

test.describe('Critical workflow: inbox triage persists', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('status, assignment, note, escalation/resolve all persist', async ({ page }) => {
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      externalId: `${PREFIX}review-${e2eRunId}`,
      rating: 4,
      text: 'Triage review body — customer had a good stay overall.',
      reviewerName: 'Triage Reviewer',
    })
    const { inboxItemId } = await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId,
    })
    // Assignment target: a manager with a grant to the property (uuid id —
    // assignInboxItemFn validates assignedToUserId as uuid).
    //
    // role 'owner', not the fixture's default Staff: assignment authorizes the
    // ASSIGNEE as its own principal now, and Staff is not a beta-interactive
    // role, so handing the item to one is refused before any grant is read.
    const assignee = await seedStaffUserWithGrant({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      email: `${PREFIX}assignee-${e2eRunId}@example.com`,
      name: 'E2E Triage Assignee',
      role: 'owner',
    })

    await signIn(page)
    await page.goto(`/inbox?itemId=${inboxItemId}`)
    // Detail panel open with the review content.
    await expect(page.getByText('Triage Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })

    // 1. Managers cannot close Google review work — no control exists, and the
    // generic status endpoint refuses the transition outright.
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
    const open = await getInboxItemById(inboxItemId)
    const refusal = await callServerFnExpectError(page, {
      file: 'src/contexts/inbox/server/inbox-status.ts',
      exportName: 'updateInboxStatusFn',
      data: {
        inboxItemId,
        status: 'closed',
        expectedCommandRevision: Number(open?.command_revision),
      },
    })
    expect(refusal.message ?? '').toContain('observed on Google')
    expect((await getInboxHandlingCycleHead(inboxItemId))?.status).toBe('open')

    // 2. Source-authoritative close: the current reply is live on Google.
    await closeInboxItemBySourceAuthority({
      organizationId: seed.organizationId,
      inboxItemId,
      closeReason: 'external_reply_observed',
    })

    // 3. Reopen from the Closed folder — through the reason dialog, durable.
    await page.goto(`/inbox?folder=closed&itemId=${inboxItemId}`)
    await expect(page.getByText('Triage Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('combobox', { name: 'Work status' }).click()
    await page.getByRole('option', { name: 'Open', exact: true }).click()
    await expect(page.getByRole('dialog').getByText('Reopen work')).toBeVisible()
    await page.getByRole('combobox', { name: 'Reason for reopening' }).click()
    await page.getByRole('option', { name: 'Guest follow-up is still needed' }).click()
    await page.getByRole('button', { name: 'Reopen', exact: true }).click()
    await waitFor(
      async () => {
        const head = await getInboxHandlingCycleHead(inboxItemId)
        return head?.status === 'open' ? head : null
      },
      { timeoutMs: 10_000, description: 'inbox item reopened as a new cycle' },
    )
    const cycles = await getInboxHandlingCycles(inboxItemId)
    expect(cycles).toHaveLength(2)
    expect(cycles[1]).toMatchObject({
      cycle_number: 2,
      opened_reason: 'manual_reopen',
      manual_reopen_reason: 'guest_follow_up_still_needed',
      supersedes_cycle_number: 1,
    })

    // 4. Assign to the staff assignee (no UI control exists — the server fn is
    // the product surface). Every human command is revision-fenced, so the
    // current revision is read immediately before the call.
    const beforeAssign = await getInboxItemById(inboxItemId)
    await callServerFn(page, {
      file: 'src/contexts/inbox/server/inbox-item-actions.ts',
      exportName: 'assignInboxItemFn',
      data: {
        inboxItemId,
        assignedToUserId: assignee.userId,
        expectedCommandRevision: Number(beforeAssign?.command_revision),
      },
    })
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.assigned_to === assignee.userId ? item : null
      },
      { timeoutMs: 10_000, description: 'inbox item assigned' },
    )

    // The out-of-band assignment advanced the fence; reload so the UI's own
    // commands below carry the current revision rather than a stale one.
    await page.goto(`/inbox?itemId=${inboxItemId}`)
    await expect(page.getByText('Triage Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })

    // 5. Add a note (UI) — durable.
    // The composer is tabbed since "feat(ui): rebuild product surfaces on
    // context-owned reads and product-state boundaries"; Public reply is
    // selected by default, so the note field is not in the document until the
    // Internal note tab is opened.
    await page.getByRole('tab', { name: 'Internal note' }).click()
    await page.getByPlaceholder('Add a note…').fill('Triage note: called the guest back.')
    await page.getByRole('button', { name: 'Add Note' }).click()
    await waitFor(
      async () => {
        const notes = await getInboxNotes(inboxItemId)
        return notes.length === 1 ? notes : null
      },
      { timeoutMs: 10_000, description: 'inbox note persisted' },
    )

    // 6. Escalate (UI) — durable and orthogonal to the Handling Cycle.
    await page.getByRole('button', { name: 'Escalate', exact: true }).click()
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.is_escalated === true ? item : null
      },
      { timeoutMs: 10_000, description: 'inbox item escalated' },
    )

    // 7. Resolve the escalation (UI) — durable.
    // Steps 5 and 6 each raised a toast, and the stack now covers this button.
    await dismissToasts(page)
    await page.getByRole('button', { name: 'Resolve', exact: true }).click()
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.is_escalated === false && item?.escalation_resolved_at ? item : null
      },
      { timeoutMs: 10_000, description: 'escalation resolved' },
    )

    // Persistence proof: full reload — every state renders from stored data.
    await page.reload()
    await expect(page.getByText('Triage Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })
    // Open work shows the Open badge, never a manager close control.
    await expect(page.getByText('Open', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
    // escalation resolved → the Escalate action is offered again
    await expect(
      page.getByRole('button', { name: 'Escalate', exact: true }),
    ).toBeVisible()
    // the note survived — behind the Internal note tab again, because a reload
    // returns the composer to its default Public reply tab.
    await page.getByRole('tab', { name: 'Internal note' }).click()
    await expect(page.getByText('Triage note: called the guest back.')).toBeVisible()

    // Final durable state.
    const item = await getInboxItemById(inboxItemId)
    expect(item?.assigned_to).toBe(assignee.userId)
    expect(item?.is_escalated).toBe(false)
    expect(item?.escalation_resolved_at).toBeTruthy()
    expect((await getInboxHandlingCycleHead(inboxItemId))?.status).toBe('open')
    const notes = await getInboxNotes(inboxItemId)
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toBe('Triage note: called the guest back.')
  })
})
