import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { userId } from '#/shared/domain/ids'
import { parseNotificationAudience } from './notification-audience.server'
import {
  buildAudienceDeps,
  cycleAudience,
  cycleFacts,
  decide,
  inboxItemFacts,
  INBOX_ITEM,
  ORG,
  PORTAL,
  RECIPIENT,
  reminderAudience,
  reminderFacts,
  REPLACEMENT_ASSIGNEE,
  RESPONSIBLE_MANAGER,
  SECOND_INBOX_ITEM,
  TARGET_SCHEDULED_FOR,
} from './notification-audience.test-fixtures'

let held: HeldTransaction
beforeAll(async () => {
  held = await holdTransaction()
})
afterAll(async () => {
  await held?.rollBack()
})

const buildDeps = () => buildAudienceDeps(held.db)

const REVIEW_CYCLE = {
  sourceType: 'review' as const,
  sourceId: 'review-source-1',
  sourceRevision: 2,
  stateRevision: 3,
}

describe('notification audience authorization', () => {
  it('revalidates an exact current Handling Cycle and current scoped responsibility at delivery', async () => {
    const deps = buildDeps()
    deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue(
      cycleFacts(),
    )
    deps.responsibleManagers.findForPortal.mockResolvedValue([RECIPIENT])
    const audience = cycleAudience()

    await expect(decide(deps, { audience })).resolves.toBe(true)
    expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledWith(ORG, PORTAL)
    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()

    deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue(
      cycleFacts({ currentCycleNumber: 3, stateRevision: 8 }),
    )
    await expect(decide(deps, { audience })).resolves.toBe(false)
  })

  // I15: the eligible assignee is a recipient of a cycle notice, so the send
  // must still admit them when they are not in the responsible scope.
  it('admits the eligible assignee of a Handling Cycle who is not responsible', async () => {
    const deps = buildDeps()
    deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue(
      cycleFacts({
        portalId: null,
        assignedTo: RECIPIENT,
        sourceType: 'review',
        sourceId: 'review-source-1',
        currentSourceRevision: 2,
        stateRevision: 3,
      }),
    )
    deps.responsibleManagers.findForProperty.mockResolvedValue([RESPONSIBLE_MANAGER])
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    const audience = cycleAudience({ ...REVIEW_CYCLE, actorUserId: null })

    await expect(decide(deps, { audience })).resolves.toBe(true)

    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)
    await expect(decide(deps, { audience })).resolves.toBe(false)
  })

  // I15: a note reaches whoever has written on the item before.
  it("admits a recipient who is still one of the item's note authors", async () => {
    const deps = buildDeps()
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue(
      inboxItemFacts({ createdAt: new Date('2026-08-27T08:00:00.000Z') }),
    )
    deps.inboxItemLookup.findNoteAuthors.mockResolvedValue([RECIPIENT])
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    const audience = { kind: 'inbox_note_author' as const, inboxItemId: INBOX_ITEM }

    await expect(decide(deps, { audience })).resolves.toBe(true)

    deps.inboxItemLookup.findNoteAuthors.mockResolvedValue([RESPONSIBLE_MANAGER])
    await expect(decide(deps, { audience })).resolves.toBe(false)
  })

  it('suppresses the Handling Cycle actor before any delivery-time authority lookup', async () => {
    const deps = buildDeps()
    const audience = cycleAudience({ ...REVIEW_CYCLE, actorUserId: RECIPIENT })

    await expect(decide(deps, { audience })).resolves.toBe(false)
    expect(deps.inboxItemLookup.findHandlingCycleNotificationFacts).not.toHaveBeenCalled()
  })

  describe('a grouped bulk reopen', () => {
    const cycle = (item: typeof INBOX_ITEM, stateRevision = 3) => ({
      inboxItemId: item,
      sourceType: 'review' as const,
      sourceId: `review-${item}`,
      cycleNumber: 2,
      sourceRevision: 1,
      stateRevision,
    })
    const audience = {
      kind: 'bulk_handling_cycle' as const,
      cycles: [cycle(INBOX_ITEM), cycle(SECOND_INBOX_ITEM)],
      actorUserId: userId('bulk-actor'),
    }
    const currentHead = (item: string, stateRevision = 3) =>
      cycleFacts({
        portalId: null,
        sourceType: 'review',
        sourceId: `review-${item}`,
        currentSourceRevision: 1,
        stateRevision,
      })
    const depsWithHeads = (stateRevisions: Readonly<Record<string, number>> = {}) => {
      const deps = buildDeps()
      deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockImplementation(
        async (item: string) => currentHead(item, stateRevisions[item] ?? 3),
      )
      deps.responsibleManagers.findForProperty.mockResolvedValue([RECIPIENT])
      return deps
    }

    it('counts every cycle still open that the recipient is responsible for', async () => {
      await expect(decide(depsWithHeads(), { audience })).resolves.toEqual({
        itemCount: 2,
      })
    })

    // Per-item reopen facts notify nobody, so one changed item must not
    // silence the rest: the notice stands for the cycles that still stand.
    it('still delivers once one cycle has moved on, counting only the rest', async () => {
      const deps = depsWithHeads({ [SECOND_INBOX_ITEM]: 4 })

      await expect(decide(deps, { audience })).resolves.toEqual({ itemCount: 1 })
    })

    it('drops the notice once every cycle in the group has moved on', async () => {
      const deps = depsWithHeads({ [INBOX_ITEM]: 4, [SECOND_INBOX_ITEM]: 4 })

      await expect(decide(deps, { audience })).resolves.toBe(false)
    })

    it('never delivers the grouped notice to the manager who reopened the items', async () => {
      const deps = depsWithHeads()

      await expect(
        decide(deps, { audience: { ...audience, actorUserId: RECIPIENT } }),
      ).resolves.toBe(false)
      expect(
        deps.inboxItemLookup.findHandlingCycleNotificationFacts,
      ).not.toHaveBeenCalled()
    })
  })

  it('revalidates an exact active Response Target reminder and current responsibility', async () => {
    const deps = buildDeps()
    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue(
      reminderFacts(),
    )
    deps.responsibleManagers.findForPortal.mockResolvedValue([RECIPIENT])
    const audience = reminderAudience()

    expect(parseNotificationAudience(audience)).toEqual(audience)
    await expect(decide(deps, { audience })).resolves.toBe(true)
    expect(
      deps.inboxItemLookup.findResponseTargetReminderNotificationFacts,
    ).toHaveBeenCalledWith({
      inboxItemId: INBOX_ITEM,
      organizationId: ORG,
      cycleNumber: 2,
      targetKind: 'private_feedback_handling',
      reminderKind: 'halfway',
      scheduledFor: new Date(TARGET_SCHEDULED_FOR),
    })
    expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledWith(ORG, PORTAL)

    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue(
      null,
    )
    await expect(decide(deps, { audience })).resolves.toBe(false)
  })

  it.each([
    [
      'authorizes only the current eligible assignee for an assigned halfway reminder',
      'halfway',
      RECIPIENT,
      [RESPONSIBLE_MANAGER],
      [
        [RECIPIENT, true],
        [RESPONSIBLE_MANAGER, false],
      ],
      true,
    ],
    [
      'revalidates assignment changes before delivering a halfway reminder',
      'halfway',
      REPLACEMENT_ASSIGNEE,
      [],
      [
        [RECIPIENT, false],
        [REPLACEMENT_ASSIGNEE, true],
      ],
      false,
    ],
    [
      'authorizes both scoped responsibility and an eligible assignee for target-passed delivery',
      'target_passed',
      RECIPIENT,
      [RESPONSIBLE_MANAGER],
      [
        [RECIPIENT, true],
        [RESPONSIBLE_MANAGER, true],
      ],
      false,
    ],
  ] as const)(
    '%s',
    async (_title, reminderKind, assignedTo, portalManagers, probes, portalNotAsked) => {
      const deps = buildDeps()
      deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue(
        reminderFacts({ assignedTo, reminderKind }),
      )
      deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
      deps.responsibleManagers.findForPortal.mockResolvedValue([...portalManagers])
      const audience = reminderAudience({ reminderKind })

      for (const [probe, expected] of probes) {
        await expect(decide(deps, { audience, userId: probe })).resolves.toBe(expected)
      }
      if (portalNotAsked) {
        expect(deps.responsibleManagers.findForPortal).not.toHaveBeenCalled()
      }
    },
  )
})
