// BQC-6.5 item 5 — inbox triage: status, assignment, note, escalation/resolve
// with persistence. UI-driven for every control the UI exposes (status,
// notes, escalation); the assignment goes through the server fn because the
// product has no assignee picker (assignment is a data field + timeline).
//
// Transitions verified (each durable, then re-verified after a full reload):
//   open → closed (Close), closed → open (Reopen), unassigned → assigned,
//   note added, escalated, escalation resolved — all persisted across reload.

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import {
  e2eRunId,
  cleanupE2eData,
  seedReview,
  seedInboxItemForReview,
  seedStaffUserWithGrant,
  getInboxItemById,
  getInboxNotes,
  callServerFn,
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
    const { inboxItemId } = await seedInboxItemForReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId,
    })
    // Assignment target: a staff member with a grant to the property (uuid id —
    // assignInboxItemFn validates assignedToUserId as uuid).
    const assignee = await seedStaffUserWithGrant({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      email: `${PREFIX}assignee-${e2eRunId}@example.com`,
      name: 'E2E Triage Assignee',
    })

    await signIn(page)
    await page.goto(`/inbox?itemId=${inboxItemId}`)
    // Detail panel open with the review content.
    await expect(page.getByText('Triage Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })

    // 1. Close (status transition) — durable. The item drops out of the Open
    // folder's list (drop-from-filter UX), so reopen from the Closed folder.
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.status === 'closed' ? item : null
      },
      { timeoutMs: 10_000, description: 'inbox item closed' },
    )

    // 2. Reopen from the Closed folder — durable.
    await page.goto(`/inbox?folder=closed&itemId=${inboxItemId}`)
    await expect(page.getByText('Triage Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: 'Reopen', exact: true }).click()
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.status === 'open' ? item : null
      },
      { timeoutMs: 10_000, description: 'inbox item reopened' },
    )

    // 3. Assign to the staff assignee (no UI control exists — the server fn
    // is the product surface; verified durably below). Back on the Open-folder
    // detail after the folder hops above.
    await page.goto(`/inbox?itemId=${inboxItemId}`)
    await expect(page.getByText('Triage Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })
    await callServerFn(page, {
      file: 'src/contexts/inbox/server/inbox-item-actions.ts',
      exportName: 'assignInboxItemFn',
      data: { inboxItemId, assignedToUserId: assignee.userId },
    })
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.assigned_to === assignee.userId ? item : null
      },
      { timeoutMs: 10_000, description: 'inbox item assigned' },
    )

    // 4. Add a note (UI) — durable.
    await page.getByPlaceholder('Add a note…').fill('Triage note: called the guest back.')
    await page.getByRole('button', { name: 'Add Note' }).click()
    await waitFor(
      async () => {
        const notes = await getInboxNotes(inboxItemId)
        return notes.length === 1 ? notes : null
      },
      { timeoutMs: 10_000, description: 'inbox note persisted' },
    )

    // 5. Escalate (UI) — durable.
    await page.getByRole('button', { name: 'Escalate', exact: true }).click()
    await waitFor(
      async () => {
        const item = await getInboxItemById(inboxItemId)
        return item?.is_escalated === true ? item : null
      },
      { timeoutMs: 10_000, description: 'inbox item escalated' },
    )

    // 6. Resolve escalation (UI) — durable.
    await page.getByRole('button', { name: 'Resolve escalation' }).click()
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
    // status open → the Close action is offered (closed would offer Reopen)
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
    // escalation resolved → the Escalate action is offered again
    await expect(
      page.getByRole('button', { name: 'Escalate', exact: true }),
    ).toBeVisible()
    // the note survived
    await expect(page.getByText('Triage note: called the guest back.')).toBeVisible()

    // Final durable state, all six transitions:
    const item = await getInboxItemById(inboxItemId)
    expect(item?.status).toBe('open')
    expect(item?.assigned_to).toBe(assignee.userId)
    expect(item?.is_escalated).toBe(false)
    expect(item?.escalation_resolved_at).toBeTruthy()
    const notes = await getInboxNotes(inboxItemId)
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toBe('Triage note: called the guest back.')
  })
})
