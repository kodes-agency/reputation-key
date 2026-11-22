import { describe, expect, it } from 'vitest'
import { useGoalProgramRepositorySuite } from './goal-program-repository-suite.test-fixtures'

const JANUARY = {
  start: new Date('2026-01-01T00:00:00.000Z'),
  end: new Date('2026-02-01T00:00:00.000Z'),
}

describe.sequential('Goal Program repository ending (integration)', () => {
  const suite = useGoalProgramRepositorySuite('goal-program-ending')

  it('ends a scheduled Program as an empty interval and releases its subject', async () => {
    const at = new Date('2026-01-15T12:00:00.000Z')
    const effectiveFrom = new Date('2026-02-01T00:00:00.000Z')
    const {
      repository,
      targetPropertyId,
      bundle: original,
    } = await suite.seed('Scheduled Goal Property', {
      status: 'scheduled',
      effectiveFrom,
      at,
    })

    await expect(
      suite.endGoal(original, {
        expectedStatus: 'scheduled',
        status: 'ended',
        reason: 'cancelled before start',
        at: new Date('2026-01-20T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'ended' })

    const ended = await suite.history(original)
    expect(ended?.version.effectiveTo).toEqual(effectiveFrom)
    expect(ended?.assignments[0]?.effectiveTo).toEqual(effectiveFrom)

    const replacement = suite.bundle({
      propertyId: targetPropertyId,
      status: 'scheduled',
      effectiveFrom,
      at: new Date('2026-01-21T12:00:00.000Z'),
    })
    await expect(
      repository.create({
        bundle: replacement,
        auditAction: 'goal.program.created',
      }),
    ).resolves.toBe('created')
  })

  // A goal can wait past its planned start: its metric source is not active,
  // or the hourly job has not activated it yet. It has still never started, so
  // ending it leaves the same empty window and its subject is free for the
  // month that is running, not only from the moment it was ended.
  it('ends a scheduled Program whose start has passed as an empty interval too', async () => {
    const {
      repository,
      targetPropertyId,
      bundle: overdue,
    } = await suite.seed('Overdue Goal Property', {
      status: 'scheduled',
      effectiveFrom: JANUARY.start,
      at: new Date('2025-12-15T12:00:00.000Z'),
    })

    await expect(
      suite.endGoal(overdue, {
        expectedStatus: 'scheduled',
        status: 'ended',
        reason: null,
        at: new Date('2026-01-12T09:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'ended' })

    const ended = await suite.history(overdue)
    expect(ended?.version).toMatchObject({
      effectiveFrom: JANUARY.start,
      effectiveTo: JANUARY.start,
    })
    expect(ended?.assignments).toMatchObject([
      { effectiveFrom: JANUARY.start, effectiveTo: JANUARY.start },
    ])
    expect(ended?.results).toEqual([])

    // Set again the same day, for January.
    await expect(suite.conflictsFor(targetPropertyId, JANUARY.start)).resolves.toEqual([])
    const setAgain = suite.bundle({
      propertyId: targetPropertyId,
      status: 'active',
      effectiveFrom: JANUARY.start,
      at: new Date('2026-01-12T09:05:00.000Z'),
      withOpenResult: { end: JANUARY.end },
    })
    await expect(
      repository.create({ bundle: setAgain, auditAction: 'goal.program.created' }),
    ).resolves.toBe('created')
  })

  // A goal ended before its start keeps the empty window [start, start). The
  // no-overlap constraint ignores an empty range, so the pre-check must too:
  // counting it refused a goal the database would have accepted.
  it('a goal cancelled before its start does not block a this-month goal for the same subject and metric', async () => {
    const {
      repository,
      targetPropertyId,
      bundle: cancelled,
    } = await suite.seed('Cancelled Goal Property', {
      status: 'scheduled',
      effectiveFrom: JANUARY.end,
      at: new Date('2026-01-15T12:00:00.000Z'),
    })
    await expect(
      suite.endGoal(cancelled, {
        expectedStatus: 'scheduled',
        status: 'ended',
        reason: 'cancelled before start',
        at: new Date('2026-01-20T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'ended' })

    const subjects = [{ kind: 'property', propertyId: targetPropertyId }] as const
    await expect(
      suite.conflictsFor(targetPropertyId, JANUARY.start, subjects),
    ).resolves.toEqual([])

    // Set on the 21st for January: active from the 1st, with January open.
    const thisMonth = suite.bundle({
      propertyId: targetPropertyId,
      status: 'active',
      effectiveFrom: JANUARY.start,
      at: new Date('2026-01-21T12:00:00.000Z'),
      withOpenResult: { end: JANUARY.end },
    })
    await expect(
      repository.create({ bundle: thisMonth, auditAction: 'goal.program.created' }),
    ).resolves.toBe('created')
    await expect(suite.history(thisMonth)).resolves.toMatchObject({
      program: { status: 'active' },
      version: { effectiveFrom: JANUARY.start, effectiveTo: null },
      results: [{ periodStart: JANUARY.start, periodEnd: JANUARY.end, status: 'open' }],
    })
    // The live goal now holds the subject, and the pre-check says which one.
    await expect(
      suite.conflictsFor(targetPropertyId, JANUARY.start, subjects),
    ).resolves.toEqual([
      { subject: subjects[0], programId: thisMonth.program.id, effectiveTo: null },
    ])
  })

  // Ending a started goal holds its subject until the open month ends. A
  // replacement for that same month overlaps it; the write is refused as a
  // conflict the caller can report, and leaves nothing behind.
  it('a same-month replacement after ending a started goal returns a conflict, not a 500', async () => {
    const {
      repository,
      targetPropertyId,
      bundle: started,
    } = await suite.seed('Replaced Goal Property', {
      status: 'active',
      effectiveFrom: JANUARY.start,
      at: JANUARY.start,
      withOpenResult: { end: JANUARY.end },
    })
    await expect(
      suite.endGoal(started, {
        expectedStatus: 'active',
        status: 'ended',
        reason: 'wrong target',
        at: new Date('2026-01-15T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'ended' })

    const subjects = [{ kind: 'property', propertyId: targetPropertyId }] as const
    await expect(
      suite.conflictsFor(targetPropertyId, JANUARY.start, subjects),
    ).resolves.toEqual([
      { subject: subjects[0], programId: started.program.id, effectiveTo: JANUARY.end },
    ])

    const sameMonth = suite.bundle({
      propertyId: targetPropertyId,
      status: 'active',
      effectiveFrom: JANUARY.start,
      at: new Date('2026-01-16T12:00:00.000Z'),
      withOpenResult: { end: JANUARY.end },
    })
    await expect(
      repository.create({ bundle: sameMonth, auditAction: 'goal.program.created' }),
    ).resolves.toBe('subject_has_goal')
    await expect(suite.history(sameMonth)).resolves.toBeNull()

    // From February the subject is free again.
    await expect(
      suite.conflictsFor(targetPropertyId, JANUARY.end, subjects),
    ).resolves.toEqual([])
    const nextMonth = suite.bundle({
      propertyId: targetPropertyId,
      status: 'scheduled',
      effectiveFrom: JANUARY.end,
      at: new Date('2026-01-16T12:00:00.000Z'),
    })
    await expect(
      repository.create({ bundle: nextMonth, auditAction: 'goal.program.created' }),
    ).resolves.toBe('created')
  })

  it('keeps an open month inside the interval when an active Program ends', async () => {
    const {
      repository,
      targetPropertyId,
      bundle: original,
    } = await suite.seed('Active Goal Property', {
      status: 'active',
      effectiveFrom: JANUARY.start,
      at: JANUARY.start,
      withOpenResult: { end: JANUARY.end },
    })

    await expect(
      suite.endGoal(original, {
        expectedStatus: 'active',
        status: 'ended',
        reason: 'stop after current month',
        at: new Date('2026-01-15T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'ended' })

    const ended = await suite.history(original)
    expect(ended?.version.effectiveTo).toEqual(JANUARY.end)
    expect(ended?.assignments[0]?.effectiveTo).toEqual(JANUARY.end)
    expect(ended?.results[0]?.periodEnd).toEqual(JANUARY.end)

    const replacement = suite.bundle({
      propertyId: targetPropertyId,
      status: 'scheduled',
      effectiveFrom: JANUARY.end,
      at: new Date('2026-01-16T12:00:00.000Z'),
    })
    await expect(
      repository.create({
        bundle: replacement,
        auditAction: 'goal.program.created',
      }),
    ).resolves.toBe('created')
  })
})
