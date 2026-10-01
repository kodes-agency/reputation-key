// D3 (ADR 0052, amended 2026-09-30) — a PropertyAccessGrant alone is enough to
// work a Property. The manager here is what every real PropertyManager looks
// like: an active membership ('admin'), a current grant, and NO Staff
// Participation or login link (nothing in the product creates those rows).
//
// Before D3 such a manager was refused everywhere Staff was consulted:
//   - assigning them an Inbox item was refused as "authority is no longer
//     current", and every command they ran themselves was refused too;
//   - they were never an eligible Responsible Manager, so the notification
//     authorizer dropped their notices before any row was written.
//
// Transitions verified:
//   a. an AccountAdmin assigns an item to the grant-only manager and the
//      manager's Bell receives `inbox.assigned` (delivery eligibility)
//   b. the manager signs in, opens the item and adds a note through the UI
//      (command authority as ACTOR): durable, authored by them, no refusal shown
//
// The reopen/unassign server-function case is left to the real-Postgres
// integration suite (inbox-command-authority.integration.test.ts), which
// already proves bulk reopen and revocation with an exact fence.

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { dismissToasts } from '../../helpers/interaction'
import { requireE2eSeedState } from '../../helpers/seed-state'
import {
  e2eRunId,
  cleanupE2eData,
  seedReview,
  seedReviewInboxItemWithCycle,
  seedMemberUserWithGrant,
  getInboxItemById,
  getInboxNotes,
  getNotificationsForUser,
  callServerFn,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-pm-'
const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const seed = requireE2eSeedState()

async function seedInboxItemAndManager(label: string) {
  const { reviewId } = await seedReview({
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    externalId: `${PREFIX}${label}-review-${e2eRunId}`,
    rating: 2,
    text: 'The room was not ready when we arrived.',
    reviewerName: 'Grant Only Reviewer',
  })
  const { inboxItemId } = await seedReviewInboxItemWithCycle({
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    reviewId,
  })
  // role 'admin' = PropertyManager. seedMemberUserWithGrant writes a grant and
  // no Staff rows, which is the whole point of this spec.
  const manager = await seedMemberUserWithGrant({
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    email: `${PREFIX}${label}-manager-${e2eRunId}@example.com`,
    name: 'E2E Grant Only Manager',
    role: 'admin',
  })
  return { inboxItemId, manager }
}

test.describe('Critical workflow: a grant-only PropertyManager works the Inbox', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('an item assigned to a grant-only manager reaches their Bell', async ({
    page,
  }) => {
    const { inboxItemId, manager } = await seedInboxItemAndManager('bell')
    await signIn(page)

    const before = await getInboxItemById(inboxItemId)
    await callServerFn(page, {
      file: 'src/contexts/inbox/server/inbox-item-actions.ts',
      exportName: 'assignInboxItemFn',
      data: {
        inboxItemId,
        assignedToUserId: manager.userId,
        expectedCommandRevision: Number(before?.command_revision),
      },
    })

    // The assignee is authorized as its own principal on the command, and again
    // when the worker decides who the notice is for. `inbox.assigned` is an
    // in-app default (workflow collaboration), so no preference row is needed.
    const notice = await waitFor(
      async () => {
        const rows = await getNotificationsForUser(manager.userId)
        return (
          rows.find(
            (r) => r.type === 'inbox.assigned' && r.resource_id === inboxItemId,
          ) ?? null
        )
      },
      {
        timeoutMs: 30_000,
        description: 'inbox.assigned notice for the grant-only manager',
      },
    )
    expect(notice.user_id).toBe(manager.userId)
    expect((await getInboxItemById(inboxItemId))?.assigned_to).toBe(manager.userId)
  })

  test('a grant-only manager adds a note through the Inbox without a refusal', async ({
    browser,
  }) => {
    const { inboxItemId, manager } = await seedInboxItemAndManager('note')

    const context = await browser.newContext({ baseURL: BASE_ORIGIN })
    try {
      const page = await context.newPage()
      await signIn(page, manager.email, manager.password, BASE_ORIGIN)
      await page.goto(`/inbox?itemId=${inboxItemId}`)
      await expect(page.getByText('Grant Only Reviewer').first()).toBeVisible({
        timeout: 15_000,
      })

      // Same composer as the triage spec: Internal note mode, then Add Note.
      await page.getByRole('tab', { name: 'Internal note' }).click()
      await page
        .getByPlaceholder('Add a note…')
        .fill('Called the guest back about the room.')
      await page.getByRole('button', { name: 'Add Note' }).click()

      const notes = await waitFor(
        async () => {
          const rows = await getInboxNotes(inboxItemId)
          return rows.length === 1 ? rows : null
        },
        {
          timeoutMs: 10_000,
          description: 'inbox note persisted for the grant-only manager',
        },
      )
      expect(notes[0]?.author_user_id).toBe(manager.userId)
      expect(notes[0]?.text).toBe('Called the guest back about the room.')

      // No refusal is surfaced: the command authority message never appears and
      // the note is rendered in the thread.
      await dismissToasts(page)
      await expect(page.getByText(/authority is no longer current/i)).toHaveCount(0)
      await expect(page.getByText('Called the guest back about the room.')).toBeVisible()
    } finally {
      await context.close()
    }
  })
})
