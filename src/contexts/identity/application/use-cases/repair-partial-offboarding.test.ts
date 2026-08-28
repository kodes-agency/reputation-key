import { describe, expect, it, vi } from 'vitest'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  classifyPartialOffboarding,
  repairPartialOffboarding,
  type PartialOffboardingObservation,
} from './repair-partial-offboarding'

const NOW = new Date('2026-04-10T12:00:00Z')
const ORG = 'org-00000000-0000-0000-0000-000000000001'
const USER = 'user-departed'
const MEMBER_ID = 'member-departed'
const OPERATOR = 'user-operator-000000000000001'

const partial: PartialOffboardingObservation = {
  organizationId: ORG,
  userId: USER,
  memberId: MEMBER_ID,
  activeGrantCount: 0,
  offboardedGrantCount: 3,
  bindingState: 'active',
}

function setup(observations: readonly PartialOffboardingObservation[]) {
  const events = createCapturingEventBus()
  const commandStore = createSequentialIdentityCommandStore({ events })
  commandStore.seedMember({
    id: MEMBER_ID,
    organizationId: ORG,
    userId: USER,
    email: 'departed@test.com',
    role: 'admin',
    createdAt: new Date('2026-01-01'),
  })
  // A second AccountAdmin so the last-owner guard never masks the repair.
  commandStore.seedMember({
    id: 'member-owner',
    organizationId: ORG,
    userId: 'user-owner',
    email: 'owner@test.com',
    role: 'owner',
    createdAt: new Date('2026-01-01'),
  })
  let call = 0
  const observe = vi.fn(async () => {
    const current = observations[Math.min(call, observations.length - 1)]!
    call += 1
    return current
  })
  const listCandidates = vi.fn(async () => [{ organizationId: ORG, userId: USER }])
  const command = repairPartialOffboarding({
    lookup: { observe, listCandidates },
    commandStore,
    clock: () => NOW,
    operatorUserId: OPERATOR,
  })
  return { command, commandStore, events, observe, listCandidates }
}

describe('classifyPartialOffboarding', () => {
  it('names the exact inconsistent state: grants revoked, membership present', () => {
    expect(classifyPartialOffboarding(partial)).toBe('partial_offboarding')
  })

  it('does not treat an ordinary member with no grants as a partial offboarding', () => {
    expect(classifyPartialOffboarding({ ...partial, offboardedGrantCount: 0 })).toBe(
      'not_offboarding',
    )
  })

  it('does not claim a repair is needed while the member still holds access', () => {
    expect(classifyPartialOffboarding({ ...partial, activeGrantCount: 1 })).toBe(
      'not_offboarding',
    )
  })

  it('reports a completed offboarding rather than repairing it again', () => {
    expect(classifyPartialOffboarding({ ...partial, memberId: null })).toBe(
      'already_offboarded',
    )
  })
})

describe('repairPartialOffboarding', () => {
  it('reports the inconsistent state content-free without changing anything', async () => {
    const { command, commandStore, events } = setup([partial])

    const report = await command.inspect({ organizationId: ORG, userId: USER })

    expect(report).toEqual({
      finding: 'partial_offboarding',
      observation: partial,
      repaired: false,
    })
    // Identifiers and counts only — no name, email or resource title.
    expect(JSON.stringify(report)).not.toMatch(/@|departed@test/u)
    expect(commandStore.memberById(MEMBER_ID)).not.toBeNull()
    expect(events.capturedEvents).toEqual([])
  })

  it('converges by completing the offboarding, never by re-granting', async () => {
    const { command, commandStore, events } = setup([partial])

    const report = await command.inspect({
      organizationId: ORG,
      userId: USER,
      apply: true,
    })

    expect(report.repaired).toBe(true)
    expect(commandStore.memberById(MEMBER_ID)).toBeNull()
    expect(events.capturedEvents.map((event) => event._tag)).toEqual([
      'identity.member.removed',
    ])
    expect(events.capturedEvents[0]).toMatchObject({ removedBy: OPERATOR })
  })

  it('is idempotent on retry: the second run finds nothing left to repair', async () => {
    const { command, commandStore, events } = setup([
      partial,
      { ...partial, memberId: null, bindingState: 'released' },
    ])

    const first = await command.inspect({
      organizationId: ORG,
      userId: USER,
      apply: true,
    })
    const second = await command.inspect({
      organizationId: ORG,
      userId: USER,
      apply: true,
    })

    expect(first.repaired).toBe(true)
    expect(second).toMatchObject({ finding: 'already_offboarded', repaired: false })
    expect(commandStore.memberById(MEMBER_ID)).toBeNull()
    // Exactly one removal fact across both runs.
    expect(events.capturedEvents).toHaveLength(1)
  })

  it('refuses to repair a member who still holds active access', async () => {
    const { command, commandStore } = setup([{ ...partial, activeGrantCount: 2 }])

    const report = await command.inspect({
      organizationId: ORG,
      userId: USER,
      apply: true,
    })

    expect(report).toMatchObject({ finding: 'not_offboarding', repaired: false })
    expect(commandStore.memberById(MEMBER_ID)).not.toBeNull()
  })

  it('sweeps a bounded candidate set in report-only mode by default', async () => {
    const { command, listCandidates, commandStore } = setup([partial])

    const reports = await command.sweep({ limit: 500 })

    expect(listCandidates).toHaveBeenCalledWith({ limit: 100 })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ repaired: false })
    expect(commandStore.memberById(MEMBER_ID)).not.toBeNull()
  })
})
